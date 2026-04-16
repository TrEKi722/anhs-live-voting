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

// Cups state
let cupsIsActive = false;
let cupsCorrectOption = null;
let cupsMyPress = null;
let cupsMyRank = null; // rank among correct presses (1/2/3/4+), null if wrong or no press

// Yearbook state
let ybPhase = 'waiting';       // 'waiting' | 'guessing' | 'reveal'
let ybTeacherIndex = null;     // index into YEARBOOK_TEACHERS
let ybOptionIndices = [];      // array of 4 teacher indices (shuffled)
let ybRoundId = null;          // increments each round
let ybMyVote = null;           // teacher index I voted for (null = not voted)
let ybMyScore = 0;
let ybScoredRoundId = null;    // round_id for which score has been awarded locally
let ybVoteCounts = {};         // { teacherIndex: count } populated during reveal
let ybTeacherQueue = [];       // ordered list of teacher indices for the session
let ybQueuePosition = 0;       // current position in the queue (0-indexed)

// Name Game state
let ngIsActive = false;
let ngImageSet = null;
let ngImageOrder = [];
let ngDurationSeconds = 10;
let ngMemorizeDurationSeconds = 10;
let ngRoundStartTime = null;
let ngRoundEndTime = null;
let ngMyScore = 0;
let ngCorrectSet = new Set();
let ngCountdownRaf = null;
let ngWallCountdownRaf = null;

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
        const _p = window.location.pathname;
        if ((_p === '/admin' || _p.startsWith('/admin/') || _p === '/wall' || _p.startsWith('/wall/')) && !isAdmin) {
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
        if (!window.location.pathname.startsWith('/admin') && window.location.pathname !== '/sign-in') {
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

    // random background every page load
    document.body.style.backgroundImage = `url('/media/backgrounds/${Math.floor(Math.random() * 10 + 1)}.jpg')`;

    // /admin menu — auth required, no admin JS loaded here
    if (path === '/admin') {
        await initAuth(null);
        if (isAdmin) {
            const adminMenu = document.getElementById('admin-menu');
            if (adminMenu) adminMenu.style.display = 'flex';
            const adminsBtn = document.getElementById('adminMenuAdmins');
            if (adminsBtn && isSuperAdmin) adminsBtn.style.display = 'inline-block';
        }
        return;
    }

    // /admin/* sub-pages — auth + admin JS loaded by each page
    if (path.startsWith('/admin/')) {
        await initAuth(null);
        if (path === '/admin/cups') {
            await fetchCupsConfig();
            setupCupsRealtime();
            if (typeof updateCupsAdminUI === 'function') updateCupsAdminUI();
        }
        if (path === '/admin/name-game') {
            await fetchNameGameConfig();
            setupNameGameRealtime();
            if (typeof updateNGAdminUI === 'function') updateNGAdminUI();
        }
        if (path === '/admin/yearbook') {
            await fetchYearbookConfig();
            setupYearbookRealtime();
            if (typeof updateYBAdminUI === 'function') updateYBAdminUI();
        }
        return;
    }

    // Wall menu
    if (path === '/wall') {
        await initAuth(null);
        if (isAdmin) {
            const wallMenu = document.getElementById('wall-menu');
            if (wallMenu) wallMenu.style.display = 'flex';
        }
        return;
    }

    // Wall sub-pages
    if (path.startsWith('/wall/')) {
        await initAuth(null);
        if (path === '/wall/cups') {
            await fetchCupsConfig();
            setupCupsRealtime();
            await initWallCups();
        }
        if (path === '/wall/ng') {
            await fetchNameGameConfig();
            setupNameGameRealtime();
            initWallNG();
        }
        if (path === '/wall/yearbook') {
            await fetchYearbookConfig();
            setupYearbookRealtime();
            await initWallYearbook();
        }
        // /wall/vote uses fetchInitialData + setupRealtimeSubscriptions already called via initAuth
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

    // Cups route - requires auth, redirect to home if not signed in
    if (path === '/cups' || path === '/cups.html') {
        if (session) {
            await initAuth(null);
            await initCups();
        } else {
            window.location.href = '/?redirect=/cups';
        }
        return;
    }

    // Yearbook route - requires auth, redirect to home if not signed in
    if (path === '/yearbook' || path === '/yearbook.html') {
        if (session) {
            await initAuth(null);
            await initYearbook();
        } else {
            window.location.href = '/?redirect=/yearbook';
        }
        return;
    }

    // Name Game route - requires auth, redirect to home if not signed in
    if (path === '/name-game' || path === '/name-game.html') {
        if (session) {
            await initAuth(null);
            await initNameGame();
        } else {
            window.location.href = '/?redirect=/name-game';
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

    // Show #full-page for vote and wall sub-page routes
    const fPage = document.getElementById('full-page');
    const wallFlexPaths = ['/wall/vote', '/wall/cups', '/wall/ng', '/wall/yearbook'];
    if (fPage) fPage.style.display = wallFlexPaths.includes(path) ? 'flex' : 'block';

    // Show #adminDash for admin sub-pages
    const adminDash = document.getElementById('adminDash');
    if (adminDash) {
        if (isAdmin) {
            adminDash.style.display = 'flex';
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

    const hText = document.getElementById('hidden-text');
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
// 6. Cups
// ==========================================

async function fetchCupsConfig() {
    const { data: config } = await supabaseC
        .from('hats_config')
        .select('correct_option, is_active')
        .eq('id', 'main')
        .single();
    if (config) {
        cupsIsActive = config.is_active;
        cupsCorrectOption = config.correct_option;
    }
}

async function initCups() {
    await fetchCupsConfig();

    if (currentUser) {
        const { data: press } = await supabaseC
            .from('hats_presses')
            .select('choice, timestamp')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (press) {
            cupsMyPress = press.choice;
            if (cupsCorrectOption !== null && press.choice === cupsCorrectOption) {
                const { count } = await supabaseC
                    .from('hats_presses')
                    .select('*', { count: 'exact', head: true })
                    .eq('choice', cupsCorrectOption)
                    .lte('timestamp', press.timestamp);
                cupsMyRank = count;
            }
        }
    }

    updateCupsUI();
    setupCupsRealtime();

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'block';
}

function updateCupsUI() {
    const badge = document.getElementById('cups-status-badge');
    const pickDiv = document.getElementById('cups-pick');
    const inactiveDiv = document.getElementById('cups-inactive');
    const resultDiv = document.getElementById('cups-result');

    if (!badge) return;

    if (cupsMyPress !== null) {
        // User has submitted — show result, hide everything else
        if (pickDiv) pickDiv.style.display = 'none';
        if (inactiveDiv) inactiveDiv.style.display = 'none';
        if (resultDiv) {
            resultDiv.style.display = 'block';
            const isCorrect = cupsMyPress === cupsCorrectOption;
            const isTopThree = isCorrect && cupsMyRank !== null && cupsMyRank <= 3;

            if (isTopThree) {
                const emoji = ['', '🥇', '🥈', '🥉'][cupsMyRank];
                const place = ['', '1st Place!', '2nd Place!', '3rd Place!'][cupsMyRank];
                resultDiv.innerHTML = `
                    <div class="cups-result-card cups-result-win">
                        <div class="cups-result-emoji">${emoji}</div>
                        <h2>${place}</h2>
                        <p>You picked the right cup!</p>
                    </div>`;
            } else {
                const heading = isCorrect ? "Didn't place" : "Wrong answer";
                const sub = isCorrect
                    ? "You got it right, but didn't place in the top 3."
                    : "Better luck next time!";
                resultDiv.innerHTML = `
                    <div class="cups-result-card cups-result-neutral">
                        <h2>${heading}</h2>
                        <p>${sub}</p>
                    </div>`;
            }
        }
        badge.textContent = 'Round over';
        badge.className = 'status-badge status-locked';
    } else if (cupsIsActive) {
        if (pickDiv) pickDiv.style.display = 'block';
        if (inactiveDiv) inactiveDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';
        badge.textContent = 'Round is open — pick a cup!';
        badge.className = 'status-badge status-open';
    } else {
        if (pickDiv) pickDiv.style.display = 'none';
        if (inactiveDiv) inactiveDiv.style.display = 'block';
        if (resultDiv) resultDiv.style.display = 'none';
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
    }
}

function setupCupsRealtime() {
    supabaseC
        .channel('cups-config-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hats_config' }, payload => {
            if (!payload.new) return;
            const newCorrectOption = payload.new.correct_option ?? null;

            // Round was reset — clear local press state so UI returns to inactive
            if (newCorrectOption === null && cupsCorrectOption !== null) {
                cupsMyPress = null;
                cupsMyRank = null;
            }

            cupsIsActive = payload.new.is_active;
            cupsCorrectOption = newCorrectOption;
            updateCupsUI();
            if (typeof updateCupsAdminUI === 'function') updateCupsAdminUI();
            if (typeof updateWallCupsUI === 'function') updateWallCupsUI();
        })
        .subscribe();
}

window.pressCup = async function(option) {
    if (!currentUser) return showToast("Not authenticated.");
    if (!cupsIsActive) return showToast("Round is not active.");
    if (cupsMyPress !== null) return showToast("You already picked!");
    if (cupsCorrectOption === null) return showToast("Round not configured.");

    // Disable buttons immediately to prevent double-tap
    [1, 2, 3].forEach(n => {
        const btn = document.getElementById(`cups-btn-${n}`);
        if (btn) btn.disabled = true;
    });

    try {
        const { data: myPress, error } = await supabaseC
            .from('hats_presses')
            .insert({ user_id: currentUser.id, choice: option })
            .select('timestamp')
            .single();

        if (error) throw error;

        cupsMyPress = option;

        if (option === cupsCorrectOption) {
            const { count } = await supabaseC
                .from('hats_presses')
                .select('*', { count: 'exact', head: true })
                .eq('choice', cupsCorrectOption)
                .lte('timestamp', myPress.timestamp);
            cupsMyRank = count;
        } else {
            cupsMyRank = null;
        }

        updateCupsUI();
    } catch (error) {
        console.error("Cups press error:", error);
        showToast("Error recording your pick.");
        [1, 2, 3].forEach(n => {
            const btn = document.getElementById(`cups-btn-${n}`);
            if (btn) btn.disabled = false;
        });
    }
}

// ==========================================
// 7. Name Game
// ==========================================

async function fetchNameGameConfig() {
    const { data: config } = await supabaseC
        .from('name_game_config')
        .select('*')
        .eq('id', 'main')
        .single();
    if (config) {
        ngIsActive = config.is_active;
        ngImageSet = config.image_set;
        ngImageOrder = config.image_order || [];
        ngDurationSeconds = config.round_duration_seconds || 10;
        ngMemorizeDurationSeconds = config.memorize_duration_seconds || 10;
        ngRoundStartTime = config.round_start_time ? new Date(config.round_start_time).getTime() : null;
        ngRoundEndTime = config.round_end_time ? new Date(config.round_end_time).getTime() : null;
    }
}

// Returns current game phase: 'idle' | 'memorize' | 'recall' | 'done'
function ngGetPhase() {
    if (!ngIsActive || !ngRoundStartTime) return ngRoundStartTime ? 'done' : 'idle';
    const now = Date.now();
    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    let recallEnd = recallStart + ngDurationSeconds * 1000;
    if (ngRoundEndTime) recallEnd = Math.min(recallEnd, ngRoundEndTime);
    if (now < recallStart) return 'memorize';
    if (now < recallEnd) return 'recall';
    return 'done';
}

async function initNameGame() {
    await fetchNameGameConfig();

    if (currentUser) {
        const { data: scoreRow } = await supabaseC
            .from('name_game_scores')
            .select('score')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (scoreRow) ngMyScore = scoreRow.score;
    }

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';

    setupNameGameRealtime();
    updateNameGameUI();
}

function updateNameGameUI() {
    if (ngCountdownRaf) { cancelAnimationFrame(ngCountdownRaf); ngCountdownRaf = null; }

    const phase = ngGetPhase();
    ['ng-idle', 'ng-memorize', 'ng-recall', 'ng-done'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const activeEl = document.getElementById({ idle: 'ng-idle', memorize: 'ng-memorize', recall: 'ng-recall', done: 'ng-done' }[phase]);
    if (activeEl) activeEl.style.display = 'block';

    const timerSection = document.getElementById('ng-timer-section');
    if (timerSection) timerSection.style.display = (phase === 'memorize' || phase === 'recall') ? 'block' : 'none';

    if (phase === 'memorize') {
        buildNGImageGrid('ng-memorize-grid');
        startNGCountdown('memorize');
    } else if (phase === 'recall') {
        updateNGScoreDisplay();
        startNGCountdown('recall');
        const input = document.getElementById('ng-input');
        if (input) { input.value = ''; input.focus(); }
    } else if (phase === 'done') {
        showNGFinalScore();
    }
}

function buildNGImageGrid(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !NAME_GAME_SETS?.[ngImageSet]) return;
    if (container.dataset.built === ngImageSet) return;
    const images = NAME_GAME_SETS[ngImageSet].images;
    container.innerHTML = '';
    ngImageOrder.forEach(idx => {
        if (!images[idx]) return;
        const img = document.createElement('img');
        img.src = images[idx].path;
        img.className = 'ng-grid-img';
        img.alt = '';
        container.appendChild(img);
    });
    container.dataset.built = ngImageSet;
}

function updateNGScoreDisplay() {
    const el = document.getElementById('ng-score-display');
    if (el) el.textContent = `Score: ${ngMyScore}`;
}

function startNGCountdown(phase) {
    const bar = document.getElementById('ng-timer-bar');
    const timerText = document.getElementById('ng-timer-text');
    const badge = document.getElementById('ng-phase-badge');
    if (!bar || !ngRoundStartTime) return;

    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    const endTime = phase === 'memorize'
        ? recallStart
        : Math.min(recallStart + ngDurationSeconds * 1000, ngRoundEndTime || Infinity);
    const totalMs = phase === 'memorize' ? ngMemorizeDurationSeconds * 1000 : ngDurationSeconds * 1000;

    function tick() {
        const remaining = Math.max(0, endTime - Date.now());
        const pct = (remaining / totalMs) * 100;

        bar.style.width = pct + '%';
        bar.classList.remove('ng-timer-warning', 'ng-timer-danger');
        if (phase === 'recall') {
            if (pct <= 20) bar.classList.add('ng-timer-danger');
            else if (pct <= 40) bar.classList.add('ng-timer-warning');
        }

        const secs = Math.ceil(remaining / 1000);
        if (timerText) timerText.textContent = secs + 's';
        if (badge) badge.textContent = phase === 'memorize' ? `Memorize! ${secs}s` : `Recall — ${secs}s left`;

        if (remaining <= 0) { updateNameGameUI(); return; }
        ngCountdownRaf = requestAnimationFrame(tick);
    }
    ngCountdownRaf = requestAnimationFrame(tick);
}

function ngGameOver() {
    if (ngCountdownRaf) { cancelAnimationFrame(ngCountdownRaf); ngCountdownRaf = null; }
    updateNameGameUI();
}

function showNGFinalScore() {
    const finalEl = document.getElementById('ng-final-score');
    if (finalEl) finalEl.textContent = `You got ${ngMyScore} right!`;
}

function showNGFeedback(type, message) {
    const el = document.getElementById('ng-feedback');
    if (!el) return;
    el.textContent = message;
    el.className = `ng-feedback ng-feedback-show ng-${type}`;
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => {
        el.classList.remove('ng-feedback-show');
    }, type === 'correct' ? 600 : 1000);
}

function setupNameGameRealtime() {
    supabaseC
        .channel('name-game-config-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'name_game_config' }, payload => {
            if (!payload.new) return;
            const wasActive = ngIsActive;
            const newActive = payload.new.is_active;
            const newSet = payload.new.image_set ?? null;

            if (!newActive && newSet === null) {
                ngMyScore = 0;
                ngCorrectSet = new Set();
            }

            ngIsActive = newActive;
            ngImageSet = newSet;
            ngImageOrder = payload.new.image_order || [];
            ngDurationSeconds = payload.new.round_duration_seconds || 10;
            ngMemorizeDurationSeconds = payload.new.memorize_duration_seconds || 10;
            ngRoundStartTime = payload.new.round_start_time ? new Date(payload.new.round_start_time).getTime() : null;
            ngRoundEndTime = payload.new.round_end_time ? new Date(payload.new.round_end_time).getTime() : null;

            if (!wasActive && newActive) {
                ngMyScore = 0;
                ngCorrectSet = new Set();
                ['ng-memorize-grid', 'ng-wall-memorize-grid'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) delete el.dataset.built;
                });
            }

            updateNameGameUI();
            if (typeof updateNGAdminUI === 'function') updateNGAdminUI();
            if (typeof updateWallNGUI === 'function') updateWallNGUI();
        })
        .subscribe();
}

window.submitNGAnswer = async function() {
    if (ngGetPhase() !== 'recall') return;

    const input = document.getElementById('ng-input');
    if (!input) return;
    const answer = input.value.trim().toLowerCase();
    if (!answer) return;

    const images = NAME_GAME_SETS?.[ngImageSet]?.images;
    if (!images) return;

    // Find any unanswered image that matches this answer
    let matchedIdx = null;
    for (let i = 0; i < ngImageOrder.length; i++) {
        const imgIdx = ngImageOrder[i];
        if (ngCorrectSet.has(imgIdx)) continue;
        if (images[imgIdx]?.answers.map(a => a.toLowerCase()).includes(answer)) {
            matchedIdx = imgIdx;
            break;
        }
    }

    input.value = '';
    input.focus();

    if (matchedIdx !== null) {
        ngCorrectSet.add(matchedIdx);
        ngMyScore++;
        showNGFeedback('correct', '✓ Correct!');
        updateNGScoreDisplay();

        const displayName = currentUser?.user_metadata?.full_name
            || currentUser?.user_metadata?.name
            || currentUser?.email
            || 'Anonymous';
        await supabaseC.from('name_game_scores').upsert({
            user_id: currentUser.id,
            display_name: displayName,
            score: ngMyScore
        });
    } else {
        showNGFeedback('wrong', '✗ Try again');
    }
}

// ==========================================
// 8. Wall — Cups Display
// ==========================================

async function initWallCups() {
    await updateWallCupsUI();
    setupWallCupsRealtime();
}

async function updateWallCupsUI() {
    const badge = document.getElementById('cups-wall-badge');
    const inactiveDiv = document.getElementById('cups-wall-inactive');
    const activeDiv = document.getElementById('cups-wall-active');
    const countEl = document.getElementById('cups-wall-count');

    if (!badge) return;

    if (cupsIsActive) {
        badge.textContent = 'Round is live!';
        badge.className = 'status-badge status-open';
        if (inactiveDiv) inactiveDiv.style.display = 'none';
        if (activeDiv) activeDiv.style.display = 'block';

        if (cupsCorrectOption !== null && countEl) {
            const { count } = await supabaseC
                .from('hats_presses')
                .select('*', { count: 'exact', head: true })
                .eq('choice', cupsCorrectOption);
            countEl.textContent = count || 0;
        }
    } else {
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
        if (inactiveDiv) inactiveDiv.style.display = 'block';
        if (activeDiv) activeDiv.style.display = 'none';
    }
}

function setupWallCupsRealtime() {
    supabaseC
        .channel('wall-cups-presses')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hats_presses' }, () => {
            updateWallCupsUI();
        })
        .subscribe();
}

// ==========================================
// 9. Wall — Name Game Display
// ==========================================

let ngWallScoresChannel = null;

function initWallNG() {
    updateWallNGUI();
}

function updateWallNGUI() {
    const badge = document.getElementById('ng-wall-badge');
    if (!badge) return;

    if (ngWallCountdownRaf) { cancelAnimationFrame(ngWallCountdownRaf); ngWallCountdownRaf = null; }

    const phase = ngGetPhase();
    const phaseIds = ['ng-wall-idle', 'ng-wall-memorize', 'ng-wall-recall', 'ng-wall-done'];
    const showId = { idle: 'ng-wall-idle', memorize: 'ng-wall-memorize', recall: 'ng-wall-recall', done: 'ng-wall-done' }[phase];
    phaseIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === showId ? 'block' : 'none';
    });

    const timerSection = document.getElementById('ng-wall-timer-section');

    if (phase === 'idle') {
        badge.textContent = 'Waiting for round to start...';
        badge.className = 'status-badge status-locked';
        if (timerSection) timerSection.style.display = 'none';
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }

    } else if (phase === 'memorize') {
        badge.textContent = 'Memorize!';
        badge.className = 'status-badge status-open';
        if (timerSection) timerSection.style.display = 'block';
        buildNGImageGrid('ng-wall-memorize-grid');
        startWallNGCountdown('memorize');
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }

    } else if (phase === 'recall') {
        badge.textContent = ngRoundEndTime ? 'Ending soon!' : 'Recall phase!';
        badge.className = ngRoundEndTime ? 'status-badge status-locked' : 'status-badge status-open';
        if (timerSection) timerSection.style.display = 'block';
        startWallNGCountdown('recall');
        loadWallNGLeaderboard();
        setupWallNGScoresRealtime();

    } else if (phase === 'done') {
        badge.textContent = "Time's up!";
        badge.className = 'status-badge status-locked';
        if (timerSection) timerSection.style.display = 'none';
        loadWallNGLeaderboard();
        if (ngWallScoresChannel) { ngWallScoresChannel.unsubscribe(); ngWallScoresChannel = null; }
    }
}

function startWallNGCountdown(phase) {
    const bar = document.getElementById('ng-wall-timer-bar');
    const timerText = document.getElementById('ng-wall-timer-text');
    if (!bar || !ngRoundStartTime) return;

    const recallStart = ngRoundStartTime + ngMemorizeDurationSeconds * 1000;
    const endTime = phase === 'memorize'
        ? recallStart
        : Math.min(recallStart + ngDurationSeconds * 1000, ngRoundEndTime || Infinity);
    const totalMs = phase === 'memorize' ? ngMemorizeDurationSeconds * 1000 : (ngRoundEndTime ? 5000 : ngDurationSeconds * 1000);

    function tick() {
        const remaining = Math.max(0, endTime - Date.now());
        const pct = (remaining / totalMs) * 100;

        bar.style.width = pct + '%';
        bar.classList.remove('ng-timer-warning', 'ng-timer-danger');
        if (phase === 'recall') {
            if (ngRoundEndTime || pct <= 20) bar.classList.add('ng-timer-danger');
            else if (pct <= 40) bar.classList.add('ng-timer-warning');
        }

        const secs = Math.ceil(remaining / 1000);
        if (timerText) timerText.textContent = secs + 's';

        if (remaining <= 0) { updateWallNGUI(); return; }
        ngWallCountdownRaf = requestAnimationFrame(tick);
    }
    ngWallCountdownRaf = requestAnimationFrame(tick);
}

function setupWallNGScoresRealtime() {
    if (ngWallScoresChannel) return;
    ngWallScoresChannel = supabaseC
        .channel('wall-ng-scores')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'name_game_scores' }, () => {
            loadWallNGLeaderboard();
        })
        .subscribe();
}

async function loadWallNGLeaderboard() {
    const tables = ['ng-wall-leaderboard', 'ng-wall-done-leaderboard']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!tables.length) return;

    const { data: scores } = await supabaseC
        .from('name_game_scores')
        .select('display_name, score')
        .order('score', { ascending: false })
        .limit(5);

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const html = scores?.length
        ? scores.map((row, i) => `
            <tr style="border-bottom: 1px solid var(--card-border);">
                <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i] || (i + 1) + '.'}</td>
                <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                <td style="padding: 0.75rem; font-weight: bold;">${row.score}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:1rem;">No scores yet.</td></tr>';

    tables.forEach(t => t.innerHTML = html);
}

// ==========================================
// 10. Yearbook
// ==========================================

async function fetchYearbookConfig() {
    const { data: config } = await supabaseC
        .from('yearbook_config')
        .select('*')
        .eq('id', 'main')
        .single();
    if (config) {
        ybPhase = config.phase || 'waiting';
        ybTeacherIndex = config.teacher_index ?? null;
        ybOptionIndices = config.option_indices || [];
        ybRoundId = config.round_id ?? null;
        ybTeacherQueue = config.teacher_queue || [];
        ybQueuePosition = config.queue_position ?? 0;
    }
}

async function initYearbook() {
    await fetchYearbookConfig();

    if (currentUser) {
        if (ybRoundId !== null) {
            const { data: vote } = await supabaseC
                .from('yearbook_votes')
                .select('teacher_index')
                .eq('user_id', currentUser.id)
                .eq('round_id', ybRoundId)
                .maybeSingle();
            if (vote) ybMyVote = vote.teacher_index;
        }

        const { data: scoreRow } = await supabaseC
            .from('yearbook_scores')
            .select('score')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (scoreRow) ybMyScore = scoreRow.score;
    }

    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'block';

    setupYearbookRealtime();
    updateYearbookUI();
}

function updateYearbookUI() {
    ['yb-waiting', 'yb-guessing', 'yb-reveal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const activeEl = document.getElementById(`yb-${ybPhase}`);
    if (activeEl) activeEl.style.display = 'block';

    if (ybPhase === 'guessing') {
        renderYBOptions();
    } else if (ybPhase === 'reveal') {
        renderYBReveal();
    }
}

function renderYBOptions() {
    if (!YEARBOOK_TEACHERS || !ybOptionIndices.length) return;

    // Throwback photo
    const img = document.getElementById('yb-throwback-img');
    if (img && ybTeacherIndex !== null) {
        img.src = `media/teachers/throwbacks/${ybTeacherIndex}.${YEARBOOK_TEACHERS[ybTeacherIndex]?.ext || 'jpg'}`;
        img.alt = 'Who is this teacher?';
    }

    // Answer buttons
    const grid = document.getElementById('yb-options-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const btn = document.createElement('button');
        btn.className = 'yb-option-btn';
        btn.style.borderColor = colors[i];
        btn.textContent = teacher.name;
        btn.disabled = ybMyVote !== null;
        if (ybMyVote === teacherIdx) {
            btn.classList.add('yb-option-selected');
            btn.style.background = colors[i];
        }
        btn.onclick = () => submitYearbookVote(teacherIdx);
        grid.appendChild(btn);
    });
}

async function renderYBReveal() {
    if (!YEARBOOK_TEACHERS || ybTeacherIndex === null) return;

    // Photos
    const throwbackImg = document.getElementById('yb-reveal-throwback');
    const currentImg = document.getElementById('yb-reveal-current');
    const correctName = document.getElementById('yb-reveal-name');
    const teacher = YEARBOOK_TEACHERS[ybTeacherIndex];
    if (throwbackImg) throwbackImg.src = `media/teachers/throwbacks/${ybTeacherIndex}.${teacher?.ext || 'jpg'}`;
    if (currentImg) currentImg.src = `media/teachers/current/${ybTeacherIndex}.${teacher?.ext || 'jpg'}`;
    if (correctName) correctName.textContent = teacher?.name || '';

    // Personal result chip
    const chip = document.getElementById('yb-result-chip');
    if (chip && ybMyVote !== null) {
        const correct = ybMyVote === ybTeacherIndex;
        chip.textContent = correct ? 'Correct! +1 point' : 'Wrong answer';
        chip.className = `yb-result-chip ${correct ? 'yb-chip-correct' : 'yb-chip-wrong'}`;
        chip.style.display = 'inline-block';
    }

    // Fetch vote counts
    if (ybOptionIndices.length && ybRoundId !== null) {
        const { data: votes } = await supabaseC
            .from('yearbook_votes')
            .select('teacher_index')
            .eq('round_id', ybRoundId);

        ybVoteCounts = {};
        (votes || []).forEach(v => {
            ybVoteCounts[v.teacher_index] = (ybVoteCounts[v.teacher_index] || 0) + 1;
        });
        renderYBVoteBars();
    }

    // Award score if correct and not yet scored this round
    if (currentUser && ybMyVote === ybTeacherIndex && ybScoredRoundId !== ybRoundId) {
        ybScoredRoundId = ybRoundId;
        ybMyScore++;
        const displayName = currentUser?.user_metadata?.full_name
            || currentUser?.user_metadata?.name
            || currentUser?.email
            || 'Anonymous';
        await supabaseC.from('yearbook_scores').upsert({
            user_id: currentUser.id,
            display_name: displayName,
            score: ybMyScore
        });
    }
}

function renderYBVoteBars() {
    const grid = document.getElementById('yb-vote-bars');
    if (!grid || !YEARBOOK_TEACHERS) return;
    grid.innerHTML = '';

    const total = Object.values(ybVoteCounts).reduce((a, b) => a + b, 0);
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const count = ybVoteCounts[teacherIdx] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isCorrect = teacherIdx === ybTeacherIndex;

        const row = document.createElement('div');
        row.className = `yb-vote-row${isCorrect ? ' yb-vote-correct' : ''}`;
        row.innerHTML = `
            <div class="yb-vote-label">
                <span>${isCorrect ? '✓ ' : ''}${teacher.name}</span>
                <span>${pct}% (${count})</span>
            </div>
            <div class="yb-vote-track">
                <div class="yb-vote-bar" style="width:${pct}%; background:${isCorrect ? '#10b981' : colors[i]};"></div>
            </div>`;
        grid.appendChild(row);
    });
}

function setupYearbookRealtime() {
    supabaseC
        .channel('yearbook-config-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'yearbook_config' }, async payload => {
            if (!payload.new) return;
            const prevRoundId = ybRoundId;
            const prevPhase = ybPhase;

            ybPhase = payload.new.phase || 'waiting';
            ybTeacherIndex = payload.new.teacher_index ?? null;
            ybOptionIndices = payload.new.option_indices || [];
            ybRoundId = payload.new.round_id ?? null;
            ybTeacherQueue = payload.new.teacher_queue || [];
            ybQueuePosition = payload.new.queue_position ?? 0;

            // New round started — clear local vote state
            if (ybRoundId !== prevRoundId) {
                ybMyVote = null;
                ybVoteCounts = {};
            }

            updateYearbookUI();
            if (typeof updateYBAdminUI === 'function') updateYBAdminUI();
            if (typeof updateWallYearbookUI === 'function') updateWallYearbookUI();
        })
        .subscribe();
}

window.submitYearbookVote = async function(teacherIdx) {
    if (!currentUser) return showToast("Not authenticated.");
    if (ybPhase !== 'guessing') return showToast("Voting is not open.");
    if (ybMyVote !== null) return showToast("You already voted!");
    if (ybRoundId === null) return showToast("No active round.");

    // Disable all buttons immediately
    document.querySelectorAll('.yb-option-btn').forEach(b => b.disabled = true);

    try {
        const { error } = await supabaseC
            .from('yearbook_votes')
            .insert({ user_id: currentUser.id, round_id: ybRoundId, teacher_index: teacherIdx });
        if (error) throw error;

        ybMyVote = teacherIdx;
        renderYBOptions();
        showToast("Vote submitted!");
    } catch (e) {
        console.error("Yearbook vote error:", e);
        showToast("Error submitting vote.");
        document.querySelectorAll('.yb-option-btn').forEach(b => b.disabled = false);
    }
}

// ==========================================
// 11. Wall — Yearbook Display
// ==========================================

let ybWallScoresChannel = null;

async function initWallYearbook() {
    const fullPage = document.getElementById('full-page');
    if (fullPage) fullPage.style.display = 'flex';
    await updateWallYearbookUI();
}

async function updateWallYearbookUI() {
    const badge = document.getElementById('yb-wall-badge');
    if (!badge) return;

    ['yb-wall-waiting', 'yb-wall-guessing', 'yb-wall-reveal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (ybPhase === 'waiting') {
        badge.textContent = 'Get Ready!';
        badge.className = 'status-badge status-locked';
        const el = document.getElementById('yb-wall-waiting');
        if (el) el.style.display = 'block';
        if (ybWallScoresChannel) { ybWallScoresChannel.unsubscribe(); ybWallScoresChannel = null; }

    } else if (ybPhase === 'guessing') {
        badge.textContent = 'Round is live!';
        badge.className = 'status-badge status-open';
        const el = document.getElementById('yb-wall-guessing');
        if (el) el.style.display = 'block';
        renderWallYBOptions();
        await updateWallYBVoteCounts();
        setupWallYBVotesRealtime();

    } else if (ybPhase === 'reveal') {
        badge.textContent = 'Reveal!';
        badge.className = 'status-badge status-open';
        const el = document.getElementById('yb-wall-reveal');
        if (el) el.style.display = 'block';
        renderWallYBReveal();
        await loadYBLeaderboard();
        setupWallYBScoresRealtime();
    }
}

function renderWallYBOptions() {
    if (!YEARBOOK_TEACHERS || !ybOptionIndices.length) return;
    const img = document.getElementById('yb-wall-throwback');
    if (img && ybTeacherIndex !== null) {
        img.src = `media/teachers/throwbacks/${ybTeacherIndex}.${YEARBOOK_TEACHERS[ybTeacherIndex]?.ext || 'jpg'}`;
    }
    const grid = document.getElementById('yb-wall-options');
    if (!grid) return;
    grid.innerHTML = '';
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    ybOptionIndices.forEach((teacherIdx, i) => {
        const teacher = YEARBOOK_TEACHERS[teacherIdx];
        if (!teacher) return;
        const div = document.createElement('div');
        div.className = 'yb-wall-option';
        div.style.borderColor = colors[i];
        div.innerHTML = `<span>${teacher.name}</span><span class="yb-wall-count" id="yb-wall-count-${teacherIdx}">0</span>`;
        grid.appendChild(div);
    });
}

async function updateWallYBVoteCounts() {
    if (ybRoundId === null || !ybOptionIndices.length) return;
    const { data: votes } = await supabaseC
        .from('yearbook_votes')
        .select('teacher_index')
        .eq('round_id', ybRoundId);

    const counts = {};
    (votes || []).forEach(v => { counts[v.teacher_index] = (counts[v.teacher_index] || 0) + 1; });
    ybOptionIndices.forEach(idx => {
        const el = document.getElementById(`yb-wall-count-${idx}`);
        if (el) el.textContent = counts[idx] || 0;
    });
}

function setupWallYBVotesRealtime() {
    supabaseC
        .channel('wall-yb-votes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'yearbook_votes' }, () => {
            updateWallYBVoteCounts();
        })
        .subscribe();
}

function renderWallYBReveal() {
    if (!YEARBOOK_TEACHERS || ybTeacherIndex === null) return;
    const teacher = YEARBOOK_TEACHERS[ybTeacherIndex];
    const throwbackImg = document.getElementById('yb-wall-reveal-throwback');
    const currentImg = document.getElementById('yb-wall-reveal-current');
    const nameEl = document.getElementById('yb-wall-reveal-name');
    if (throwbackImg) throwbackImg.src = `media/teachers/throwbacks/${ybTeacherIndex}.${teacher?.ext || 'jpg'}`;
    if (currentImg) currentImg.src = `media/teachers/current/${ybTeacherIndex}.${teacher?.ext || 'jpg'}`;
    if (nameEl) nameEl.textContent = teacher?.name || '';
}

function setupWallYBScoresRealtime() {
    if (ybWallScoresChannel) return;
    ybWallScoresChannel = supabaseC
        .channel('wall-yb-scores')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'yearbook_scores' }, () => {
            loadYBLeaderboard();
        })
        .subscribe();
}

async function loadYBLeaderboard() {
    const tables = ['yb-wall-leaderboard', 'yb-wall-done-leaderboard']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!tables.length) return;

    const { data: scores } = await supabaseC
        .from('yearbook_scores')
        .select('display_name, score')
        .order('score', { ascending: false })
        .limit(5);

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const html = scores?.length
        ? scores.map((row, i) => `
            <tr>
                <td style="padding: 0.75rem; font-size: 1.5rem;">${medals[i] || (i + 1) + '.'}</td>
                <td style="padding: 0.75rem; text-align: left;">${row.display_name || 'Anonymous'}</td>
                <td style="padding: 0.75rem; font-weight: bold; color: var(--primary);">${row.score}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:1rem;">No scores yet.</td></tr>';

    tables.forEach(t => t.innerHTML = html);
}