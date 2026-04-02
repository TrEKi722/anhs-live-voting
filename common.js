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

// ==========================================
// 2. Authentication & Initialization
// ==========================================

async function initAuth(token) {
    try {
        const { data: { session } } = await supabaseC.auth.getSession();
        
        if (session) {
            currentUser = session.user;
            currentSession = session;
        } else if (window.location.pathname !== '/admin') {
            const { data, error } = await supabaseC.auth.signInAnonymously({
                options: { captchaToken: token }
            });
            if (error) throw error;
            currentUser = data.user;
            isAdmin = false;
        }
        
        await checkRole();
        
        console.log("Authenticated as:", currentUser.id, isSuperAdmin ? "(Super Admin)" : isAdmin ? "(Admin)" : "(Voter)");
        fetchInitialData();
        setupRealtimeSubscriptions();
    } catch (error) {
        if (window.location.pathname !== '/admin') {
            console.error("Auth error:", error);
            showToast("Authentication failed. Check console.");
        }
    }
    hideCaptcha();
    if (typeof updateAdminUI === 'function') await updateAdminUI();
}

addEventListener("DOMContentLoaded", async (event) => {
    const { data: { session } } = await supabaseC.auth.getSession();
    const authCon = document.getElementById('auth-container');

    if (!isAdmin && window.location.pathname === '/admin') {
        if (typeof logoutUser === 'function') logoutUser();
        loadTurnstile();
        document.getElementById('turnstile-container').style.display = 'flex';
    } else if (session) {
        initAuth(null);
    } else if (authCon) {
        authCon.style.display = 'flex';
    } else {
        loadTurnstile();
    }
});

window.signInWithGoogle = async function() {
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${window.location.origin}/${window.location.pathname}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Google sign in failed: " + error.message);
}

window.signInWithMicrosoft = async function() {
    const { error } = await supabaseC.auth.signInWithOAuth({
        provider: 'azure',
        options: {
            redirectTo: `${window.location.origin}/${window.location.pathname}`,
            scopes: 'openid email profile'
        }
    });
    if (error) showToast("Microsoft sign in failed: " + error.message);
}

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
        // reflect values in admin edit inputs if visible
        if (typeof updateAdminOptionInputs === 'function') updateAdminOptionInputs();
    }

    if (currentUser) {
        const { data: myVoteData } = await supabaseC
            .from('votes')
            .select('option_index')
            .eq('user_id', currentUser.id)
            .maybeSingle(); // <-- was .single()

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

        // Expected format:
        // { "role": "<role|string|null>" } OR { "error": "" }

        if (!response.ok || result.error) {
            console.error("Role fetch error:", result.error);
            isAdmin = false;
            isSuperAdmin = false;
            return;
        }

        isAdmin = result.role === "admin" || result.role === "super_admin" ;
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

// Theme application and detection, automatically listens for changes
addEventListener("DOMContentLoaded", (event) => {
    const darkModeMql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    
    // Function to apply theme
    const applyTheme = (isDark) => {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    };
    
    // Apply initial theme
    if (darkModeMql) {
        applyTheme(darkModeMql.matches);
        
        // Listen for changes
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

function hideCaptcha() {
    if (window.location.pathname !== '/admin') {
        document.getElementById('turnstile-container').style.display = 'none';
        document.getElementById('full-page').style.display = 'block';
    }
    if (window.location.pathname === '/wall') document.getElementById('full-page').style.display = 'flex';
}

// ==========================================
// 4.a Voter & Wall UI Updates
// ==========================================

function updateVoteBtns() {
    if (window.location.pathname === '/') {
        const buttons = document.querySelectorAll('.vote-btn');
        const wRes = document.getElementById('resultGrid');
        const hid = document.getElementById('hiddenGrid');
        const hBadge = document.getElementById('hidden-status-badge');
        const lBadge = document.getElementById('locked-status-badge');

        if (wRes && hid) {
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

        if (lBadge) {
            if (pollIsLocked) {
                lBadge.textContent = '🚫 Voting is locked 🚫';
                lBadge.classList.add('status-locked');
                lBadge.classList.remove('status-unlocked');
            } else {
                lBadge.textContent = '😎 Voting is open 😎';
                lBadge.classList.remove('status-locked');
                lBadge.classList.add('status-unlocked');
            }
        }

        buttons.forEach((btn) => {
            const optionIndex = parseInt(btn.dataset.option);
            btn.classList.remove('selected');
            
            if (myVote !== null) {
                btn.disabled = true;
                if (myVote === optionIndex) btn.classList.add('selected');
            } else if (pollIsLocked) {
                btn.disabled = true;
            } else {
                btn.disabled = false;
            }
        });
    }
}

// Updates live results bars
function updateResults(counts = [], total = 0) {
    const total_count= document.getElementById('total-count');
    if (total_count) total_count.innerText = total;

    counts.forEach((count, index) => {
        const barElement = document.getElementById(`bar-${index}`);
        const pctElement = document.getElementById(`pct-${index}`);
        const colors = ["yellow","green","blue","red"];
        
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

    const lBadge = document.getElementById('locked-status-badge');

    if (lBadge) {
        if (pollIsLocked) {
            lBadge.textContent = '🚫 Voting is locked 🚫';
            lBadge.classList.add('status-locked');
            lBadge.classList.remove('status-unlocked');
        } else {
            lBadge.textContent = '😎 Voting is open 😎';
            lBadge.classList.remove('status-locked');
            lBadge.classList.add('status-unlocked');
        }
    }

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