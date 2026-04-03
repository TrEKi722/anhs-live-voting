// ==========================================
// ANHS Live Voting - Common Script
// ==========================================

// ==========================================
// 1. Variables
// ==========================================
const SUPABASE_URL = 'https://ntzxejhhxtzdyyeqbfpn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50enhlamhoeHR6ZHl5ZXFiZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQzMjMsImV4cCI6MjA4ODgzMDMyM30.0oh9mGajdP5tVibXjk5fp1acviBq-LUCkauE3m1c6_0';

const supabaseC = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let token = null;

let currentUser = null;
let currentSession = null;
let pollIsLocked = false;
let pollIsHidden = false;
let question = "Loading question...";
let options = ["Loading...", "Loading...", "Loading...", "Loading..."];
let myVote = null;
let isAdmin = false;
let isSuperAdmin = false;

// Hats state
let hatsIsActive = false;
let hatsCorrectOption = null;
let hatsMyPress = null; // option the current user pressed, or null

// ==========================================
// 2. Authentication & Initialization
// ==========================================

async function initAuth(token) {
    try {
        const { data: { session } } = await supabaseC.auth.getSession();

        if (session) {
            currentUser = session.user;
            currentSession = session;
        }

        await checkRole();

        if (currentUser) {
            console.log("Authenticated as:", currentUser.id, isSuperAdmin ? "(Super Admin)" : isAdmin ? "(Admin)" : "(Voter)");
        }

        // Guard: admin & wall pages require admin role
        if ((window.location.pathname === '/admin' || window.location.pathname === '/wall') && !isAdmin) {
            await logoutUser();
            showToast("Sending you to sign in page...");
            setTimeout(() => {
                window.location.href = '/sign-in';
            }, 3000);
            return;
        }

        // If already signed in as admin on sign-in page, redirect
        if (window.location.pathname === '/sign-in' && isAdmin) {
            window.location.href = '/admin';
            return;
        }

        initalUIUpdate();
        fetchInitialData();
        setupRealtimeSubscriptions();

    } catch (error) {
        if (window.location.pathname !== '/admin' && window.location.pathname !== '/sign-in') {
            console.error("Auth error:", error);
            showToast("Authentication failed. Check console.");
        }
    }
    if (typeof updateAdminUI === 'function') await updateAdminUI();
}

addEventListener("DOMContentLoaded", async (event) => {
    const { data: { session } } = await supabaseC.auth.getSession();
    const authCon = document.getElementById('auth-container');
    const path = window.location.pathname;

    // Admin & Wall Routes - require auth, send to sign-in if missing
    if (path === '/admin' || path === '/wall') {
        await initAuth(null);
        return;
    }

    // Sign-in route
    if (path === '/sign-in') {
        if (session) {
            await initAuth(null);
            if (!isAdmin) {
                await logoutUser();
                showToast("Logged out because you are not an admin.");
                if (authCon) authCon.style.display = 'flex';
            }
            return;
        }
        loadTurnstile();
        return;
    }

    // Hats route - requires auth, redirect to home if not signed in
    if (path === '/hats' || path === '/hats.html') {
        if (session) {
            await initAuth(null);
            await initHats();
        } else {
            window.location.href = '/?redirect=/hats';
        }
        return;
    }

    // Vote route - requires auth, redirect to home if not signed in
    if (path === '/vote' || path === '/vote.html') {
        if (session) {
            await initAuth(null);
        } else {
            window.location.href = '/?redirect=/vote';
        }
        return;
    }

    // Index/menu route
    if (session) {
        currentUser = session.user;
        currentSession = session;
        const menuCon = document.getElementById('menu-container');
        if (menuCon) menuCon.style.display = 'flex';
        if (authCon) authCon.style.display = 'none';
    } else if (authCon) {
        authCon.style.display = 'flex';
    }
});

window.signInWithGoogle = async function() {
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    const redirectPath = redirectParam || window.location.pathname.replace(/\/$/, '') || '/';
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Google sign in failed: " + error.message);
}

window.signInWithMicrosoft = async function() {
    const redirectParam = new URLSearchParams(window.location.search).get('redirect');
    const redirectPath = redirectParam || window.location.pathname.replace(/\/$/, '') || '/';
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'azure',
        options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Microsoft sign in failed: " + error.message);
}

window.loginUser = async function() {
    const email = document.getElementById('admin-email')?.value;
    const pass = document.getElementById('admin-pass')?.value;

    if (!email || !pass) return showToast("Please enter an email and password.");
    if (!token) return showToast("Please complete the CAPTCHA.");

    await supabaseC.auth.signOut();

    try {
        const { data, error } = await supabaseC.auth.signInWithPassword({
            email,
            password: pass,
            options: { captchaToken: token }
        });

        if (error) throw error;

        token = null;
        currentUser = data.user;
        currentSession = data.session;
        showToast("User logged in successfully.");
        await initAuth(null);
    } catch (error) {
        showToast("Login failed: " + error.message);
        token = null;
    }
};

window.logoutUser = async function() {
    try {
        await supabaseC.auth.signOut();
        isAdmin = false;
        isSuperAdmin = false;
        currentUser = null;
        currentSession = null;
        const emailField = document.getElementById('admin-email');
        const passField = document.getElementById('admin-pass');
        if (emailField) emailField.value = '';
        if (passField) passField.value = '';
        showToast("User logged out.");
        if (typeof updateAdminUI === 'function') updateAdminUI();

        // On vote page, redirect home; on menu page, swap back to sign-in
        if (window.location.pathname === '/vote' || window.location.pathname === '/vote.html') {
            window.location.href = '/';
            return;
        }
        const menuCon = document.getElementById('menu-container');
        const authCon = document.getElementById('auth-container');
        if (menuCon) menuCon.style.display = 'none';
        if (authCon) authCon.style.display = 'flex';
    } catch (error) {
        console.log("Logout error:", error);
        showToast("Error logging out.");
    }
};

function loadTurnstile() {
    // Preconnect hint
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://challenges.cloudflare.com';
    document.head.appendChild(link);

    // Turnstile script
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    document.getElementById('turnstile-container').style.display = 'flex';

    // Create the Turnstile widget div
    const turnstileDiv = document.createElement('div');
    turnstileDiv.className = 'cf-turnstile';
    turnstileDiv.setAttribute('data-sitekey', '0x4AAAAAACp4ciLpxF9JPdqQ');
    turnstileDiv.setAttribute('data-callback', 'turnstileComplete');
    document.getElementById('turnstile-container').appendChild(turnstileDiv);
}

async function turnstileComplete(cToken) {
    token = cToken;
}

// ==========================================
// 3. Supabase
// ==========================================
async function fetchInitialData() {
    const { data: configData } = await supabaseC
        .from('poll_config')
        .select('results_hidden, is_locked, results_hidden, question, option0, option1, option2, option3')
        .eq('id', 'main')
        .single();
    
    if (configData) {
        pollIsHidden = configData.results_hidden;
        pollIsLocked = configData.is_locked;
        question = configData.question || question;
        options[0] = configData.option0 || options[0];
        options[1] = configData.option1 || options[1];
        options[2] = configData.option2 || options[2];
        options[3] = configData.option3 || options[3];
        if (typeof updateAdminOptionInputs === 'function') updateAdminOptionInputs();
    }

    if (currentUser) {
        const { data: myVoteData } = await supabaseC
            .from('votes')
            .select('option_index')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        myVote = myVoteData ? myVoteData.option_index : null;
    }

    updateVoteBtns();
    updateQandA();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    fetchAndUpdateAllVotes();
}

async function fetchAndUpdateAllVotes() {
    const { data: votes, error } = await supabaseC
        .from('votes')
        .select('option_index');

    if (error) {
        console.error("Error fetching votes:", error);
        showToast("Error fetching votes. Check console or reload.");
        return;
    }

    let voteCounts = [0, 0, 0, 0];
    let totalVotes = 0;

    if (votes) {
        votes.forEach(v => {
            if (v.option_index >= 0 && v.option_index <= 3) {
                voteCounts[v.option_index]++;
                totalVotes++;
            }
        });
    }

    updateResults(voteCounts, totalVotes);
}

function setupRealtimeSubscriptions() {
    supabaseC
        .channel('poll-config-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_config' }, payload => {
            if (payload.new && payload.new.is_locked !== undefined) {
                pollIsLocked = payload.new.is_locked;
                updateVoteBtns();
                fetchAndUpdateAllVotes();
                if (typeof updateAdminUI === 'function') updateAdminUI();
            }           
            if (payload.new && payload.new.results_hidden !== undefined) {
                pollIsHidden = payload.new.results_hidden;
                updateVoteBtns();
                fetchAndUpdateAllVotes();
                updateQandA();
                updateResults();
                if (typeof updateAdminUI === 'function') updateAdminUI();
            }
            if (payload.new && ( payload.new.question !== undefined || payload.new.option0 !== undefined || payload.new.option1 !== undefined || payload.new.option2 !== undefined || payload.new.option3 !== undefined )) {
                question = payload.new.question || question;
                options[0] = payload.new.option0 || options[0];
                options[1] = payload.new.option1 || options[1];
                options[2] = payload.new.option2 || options[2];
                options[3] = payload.new.option3 || options[3];
                updateQandA();
                updateResults();
                updateVoteBtns();
                fetchAndUpdateAllVotes();
                if (typeof updateAdminUI === 'function') updateAdminUI();
                if (typeof updateAdminOptionInputs === 'function') updateAdminOptionInputs();
            }
        })
        .subscribe();

    supabaseC
        .channel('votes-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, payload => {
            fetchAndUpdateAllVotes();
            if (payload.eventType === 'DELETE' && currentUser && payload.old.user_id === currentUser.id) {
                myVote = null;
                updateVoteBtns();
            }
        })
        .subscribe();
}

async function checkRole() {
    try {
        if (!currentUser) {
            isAdmin = false;
            isSuperAdmin = false;
            return;
        }

        const response = await fetch(
            `${SUPABASE_URL}/functions/v1/get-user-role?user_id=${currentUser.id}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        const result = await response.json();

        if (!response.ok || result.error) {
            console.error("Role fetch error:", result.error);
            isAdmin = false;
            isSuperAdmin = false;
            return;
        }

        isAdmin = result.role === "admin" || result.role === "super_admin";
        isSuperAdmin = result.role === "super_admin";

    } catch (err) {
        console.error("Error checking role:", err);
        isAdmin = false;
        isSuperAdmin = false;
    }
}

// ==========================================
// 4. UI
// ==========================================

// Theme application and detection
addEventListener("DOMContentLoaded", (event) => {
    const darkModeMql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    
    const applyTheme = (isDark) => {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    };
    
    if (darkModeMql) {
        applyTheme(darkModeMql.matches);
        darkModeMql.addEventListener('change', (e) => {
            applyTheme(e.matches);
        });
    }
});

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

function initalUIUpdate() {
    const path = window.location.pathname;

    // Show #full-page for vote and wall routes
    const fPage = document.getElementById('full-page');
    if (fPage) fPage.style.display = path === '/wall' ? 'flex' : 'block';

    // Show #adminDash for admin route
    const adminDash = document.getElementById('adminDash');
    if (adminDash) {
        if (isAdmin) {
            adminDash.style.display = 'flex';
            adminDash.style.flexDirection = 'row-reverse';
        } else {
            adminDash.style.display = 'none';
        }
    }

    updateVoteBtns();
    updateResults();
    updateQandA();
    if (typeof updateAdminUI === 'function') updateAdminUI();
}

// ==========================================
// 4.a Voter & Wall UI Updates
// ==========================================

function updateVoteBtns() {
    // Only update vote buttons on vote route
    const voterPaths = ['/vote', '/vote.html'];
    const isVoterPage = voterPaths.includes(window.location.pathname);

    const lBadge = document.getElementById('locked-status-badge');
    if (lBadge) {
        if (pollIsLocked) {
            lBadge.textContent = '🚫 Voting is locked 🚫';
            lBadge.classList.add('status-locked');
            lBadge.classList.remove('status-open');
        } else {
            lBadge.textContent = '😎 Voting is open 😎';
            lBadge.classList.remove('status-locked');
            lBadge.classList.add('status-open');
        }
    }

    if (!isVoterPage) return;

    const buttons = document.querySelectorAll('.vote-btn');
    const wRes = document.getElementById('resultGrid');
    const hid = document.getElementById('hiddenGrid');
    const hBadge = document.getElementById('hidden-status-badge');

    if (wRes && hid && hBadge) {
        if (pollIsHidden) {
            wRes.classList.add('hidden');
            hid.classList.remove('hidden');
            hBadge.style.display = 'block';
        } else {
            wRes.classList.remove('hidden');
            hid.classList.add('hidden');
            hBadge.style.display = 'none';
        }
    }

    buttons.forEach((button) => {
        const optionIndex = parseInt(button.dataset.option, 10);
        button.classList.remove('selected');

        if (myVote !== null) {
            button.disabled = true;
            if (myVote === optionIndex) button.classList.add('selected');
        } else if (pollIsLocked) {
            button.disabled = true;
        } else {
            button.disabled = false;
        }
    });
}

// Updates live results bars
function updateResults(counts = [], total = 0) {
    const total_count = document.getElementById('total-count');
    if (total_count) total_count.innerText = total;

    counts.forEach((count, index) => {
        const barElement = document.getElementById(`bar-${index}`);
        const pctElement = document.getElementById(`pct-${index}`);
        const colors = ["yellow", "green", "blue", "red"];
        
        if (barElement && pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            barElement.style.width = `${percentage}%`;
            barElement.style.background = colors[index] || 'var(--primary)';
            pctElement.innerText = `${percentage}% (${count})`;
        } else if (pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            pctElement.innerText = `${percentage}%`;
        }
    });

    const hText = document.getElementById('hiddenText');
    const lChart = document.getElementById('live-chart');

    if (hText && lChart) {
        if (pollIsHidden) {
            hText.style.display = 'block';
            lChart.style.display = 'none';
        } else {
            hText.style.display = 'none';
            lChart.style.display = 'block';
        }
    }
}

function updateQandA() {
    const questionEl = document.getElementById('question');
    const optionEls = [
        document.getElementById('option0'),
        document.getElementById('option1'),
        document.getElementById('option2'),
        document.getElementById('option3')
    ];

    if (questionEl) questionEl.innerText = question;

    if (optionEls) {
        optionEls.forEach((el, idx) => {
            if (el) {
                el.innerText = options[idx] || `Option ${idx + 1}`;
                el.style.display = options[idx] ? 'block' : 'none';
            }
        });
    }
}

// ==========================================
// 5. User Actions
// 
// 5.a Voters
// ==========================================

document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const optionIndex = parseInt(btn.dataset.option);
        castVote(optionIndex);
    });
});

window.castVote = async function(optionIndex) {
    if (!currentUser) return showToast("Not authenticated yet.");
    if (pollIsLocked) return showToast("Voting is currently locked.");
    if (myVote !== null) return showToast("You have already voted!");

    try {
        const { error } = await supabaseC
            .from('votes')
            .upsert({ user_id: currentUser.id, option_index: optionIndex });
            
        if (error) throw error;

        myVote = optionIndex;
        updateVoteBtns();
        showToast("Vote cast successfully!");
    } catch (error) {
        console.error("Voting error:", error);
        showToast("Error casting vote.");
    }
}

// ==========================================
// 6. Hats
// ==========================================

async function initHats() {
    // Fetch config
    const { data: config } = await supabaseC
        .from('hats_config')
        .select('correct_option, is_active')
        .eq('id', 'main')
        .single();

    if (config) {
        hatsIsActive = config.is_active;
        hatsCorrectOption = config.correct_option;
    }

    // Fetch this user's press if any
    if (currentUser) {
        const { data: press } = await supabaseC
            .from('hats_presses')
            .select('choice')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        hatsMyPress = press ? press.choice : null;
    }

    updateHatsUI();
    setupHatsRealtime();

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'block';
}

function updateHatsUI() {
    const badge = document.getElementById('hats-status-badge');
    const heading = document.getElementById('hats-heading');
    const resultDiv = document.getElementById('hats-result');
    const resultText = document.getElementById('hats-result-text');
    const btns = [1, 2, 3].map(n => document.getElementById(`hats-btn-${n}`));

    if (!badge) return;

    // Status badge
    if (hatsIsActive) {
        badge.textContent = 'Round is open — pick a hat!';
        badge.className = 'status-badge status-open';
    } else if (hatsCorrectOption !== null) {
        badge.textContent = 'Round over';
        badge.className = 'status-badge status-locked';
    } else {
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
    }

    // Button states
    btns.forEach((btn, i) => {
        const opt = i + 1;
        btn.classList.remove('hats-selected', 'hats-correct', 'hats-wrong');
        btn.disabled = false;

        if (hatsCorrectOption !== null) {
            // Answer revealed
            btn.disabled = true;
            if (opt === hatsCorrectOption) {
                btn.classList.add('hats-correct');
            } else if (opt === hatsMyPress) {
                btn.classList.add('hats-wrong');
            }
        } else if (hatsMyPress !== null) {
            // User already pressed, waiting for reveal
            btn.disabled = true;
            if (opt === hatsMyPress) btn.classList.add('hats-selected');
        } else if (!hatsIsActive) {
            btn.disabled = true;
        }
    });

    // Result panel
    if (hatsCorrectOption !== null && resultDiv && resultText) {
        resultDiv.style.display = 'block';
        if (hatsMyPress === hatsCorrectOption) {
            resultText.textContent = `You got it! Button ${hatsCorrectOption} was correct.`;
            resultText.style.color = 'var(--success)';
        } else if (hatsMyPress !== null) {
            resultText.textContent = `Not quite! The correct button was ${hatsCorrectOption}.`;
            resultText.style.color = 'var(--danger)';
        } else {
            resultText.textContent = `The correct button was ${hatsCorrectOption}.`;
            resultText.style.color = 'var(--text-color)';
        }
    } else if (resultDiv) {
        if (hatsMyPress !== null && hatsCorrectOption === null) {
            resultDiv.style.display = 'block';
            resultText.textContent = `You picked button ${hatsMyPress}. Waiting for the answer...`;
            resultText.style.color = 'var(--text-color)';
        } else {
            resultDiv.style.display = 'none';
        }
    }
}

function setupHatsRealtime() {
    supabaseC
        .channel('hats-config-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hats_config' }, payload => {
            if (!payload.new) return;
            hatsIsActive = payload.new.is_active;
            hatsCorrectOption = payload.new.correct_option ?? null;
            updateHatsUI();
            if (typeof updateHatsAdminUI === 'function') updateHatsAdminUI();
        })
        .subscribe();
}

window.pressHat = async function(option) {
    if (!currentUser) return showToast("Not authenticated.");
    if (!hatsIsActive) return showToast("Round is not active.");
    if (hatsMyPress !== null) return showToast("You already picked!");
    if (hatsCorrectOption !== null) return showToast("Round is already over.");

    try {
        const { error } = await supabaseC
            .from('hats_presses')
            .insert({
                user_id: currentUser.id,
                choice: option
            });

        if (error) throw error;

        hatsMyPress = option;
        updateHatsUI();
        showToast(`You picked button ${option}!`);
    } catch (error) {
        console.error("Hats press error:", error);
        showToast("Error recording your pick.");
    }
}