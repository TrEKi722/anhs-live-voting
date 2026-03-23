// ==========================================
// ANHS Live Voting - Combined Script
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
    updateAdminUI();
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
        console.error("Error checking super admin:", err);
        isAdmin = false;
        isSuperAdmin = false;
    }
}

addEventListener("DOMContentLoaded", (event) => {
    initSupabase();
});

async function initSupabase() {
    const { data: { session } } = await supabaseC.auth.getSession();

    if (session) {
        // Already logged in — skip Turnstile entirely
        initAuth(null); // call your existing post-auth function directly
        hideCaptcha();
    } else {
        // No session — show container and load Turnstile
        document.getElementById('turnstile-container').style.display = 'block';
        loadTurnstile();
    }
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
        updateAdminOptionInputs();
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
    updateAdminUI();
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
                updateVoteUI();
                // after lock change we need to recompute counts
                fetchAndUpdateAllVotes();
                updateAdminUI();
            }           
            if (payload.new && payload.new.results_hidden !== undefined) {
                pollIsHidden = payload.new.results_hidden;
                updateVoteUI();
                // after lock change we need to recompute counts
                fetchAndUpdateAllVotes();
                updateProjectorUI();
                updateAdminUI();
            }
            if (payload.new && ( payload.new.question !== undefined || payload.new.option0 !== undefined || payload.new.option1 !== undefined || payload.new.option2 !== undefined || payload.new.option3 !== undefined )) {
                question = payload.new.question || question;
                options[0] = payload.new.option0 || options[0];
                options[1] = payload.new.option1 || options[1];
                options[2] = payload.new.option2 || options[2];
                options[3] = payload.new.option3 || options[3];
                updateProjectorUI();
                updateVoteUI();
                // option titles changed, refresh counts as well
                fetchAndUpdateAllVotes();
                updateAdminUI();
                updateAdminOptionInputs();
            }
        })
        .subscribe();

    supabaseC
        .channel('votes-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, payload => {
            fetchAndUpdateAllVotes();
            if (payload.eventType === 'DELETE' && currentUser && payload.old.user_id === currentUser.id) {
                myVote = null;
                updateVoteUI();
            }
        })
        .subscribe();
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
    document.getElementById('turnstile-container').style.display = 'none';
    document.getElementById('full-page').style.display = 'block';
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
                lBadge.content = '😎 Voting is open 😎';
                lBadge.classList.add('status-unlocked');
                lBadge.classList.remove('status-locked');
            } else {
                lBadge.content = '🚫 Voting is locked 🚫';
                lBadge.classList.remove('status-unlocked');
                lBadge.classList.add('status-locked');
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
}

function updateQandA() {
    const questionEl = document.getElementById('question');
    const optionEls = [
        document.getElementById('option-0'),
        document.getElementById('option-1'),
        document.getElementById('option-2'),
        document.getElementById('option-3')
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
// 4.b Admin UI Updates
// ==========================================
function updateAdminUI() {
    const lockBtn = document.getElementById('toggle-lock-btn');
    const hideBtn = document.getElementById('toggle-hide-btn');
    
    if (lockBtn) {
        if (pollIsLocked) {
            lockBtn.className = 'action-btn btn-success';
            lockBtn.innerText = '🔓 Unlock Voting';
        } else {
            lockBtn.className = 'action-btn btn-danger';
            lockBtn.innerText = '🔒 Lock Voting';
        }
    } 
    
    if (hideBtn) {
        if (pollIsHidden) {
            hideBtn.className = 'action-btn btn-success';
            hideBtn.innerText = '👁️ Show Results';
        } else {
            hideBtn.className = 'action-btn btn-danger';
            hideBtn.innerText = '🙈 Hide Results';
        }
    }

    const loginUI = document.getElementById('admin-login-ui');
    const controlsUI = document.getElementById('adminDash');
    
    if (loginUI && controlsUI) {
        if (isAdmin) {
            loginUI.style.display = 'none';
            controlsUI.style.display = 'flex';
        } else {
            loginUI.style.display = 'flex';
            controlsUI.style.display = 'none';
        }
    }

    const superAdminEl = document.getElementById('superAdminControls');
    if (superAdminEl && isSuperAdmin) {
        superAdminEl.style.display = 'block';
        loadAdminList();
    } else if (superAdminEl) {
        superAdminEl.style.display = 'none';
    }
}


// copy current option text into the admin edit fields
function updateAdminOptionInputs() {
    const titleEl = document.getElementById('editTitle');
    if (titleEl) {
        titleEl.value = question;
        titleEl.placeholder = question;
    }
    ['editOption0','editOption1','editOption2','editOption3'].forEach((id, idx) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = options[idx] || '';
            el.placeholder = options[idx] || el.placeholder || '';
        }
    });
}

async function loadAdminList() {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/functions/v1/get-users-with-roles`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        const result = await response.json();

        if (!response.ok || result.error) {
            console.error("Error fetching users:", result.error);
            return;
        }

        const adminList = document.getElementById("adminList");
        if (!adminList) return;

        // Clear existing list
        adminList.innerHTML = "";

        result.users.forEach(user => {
            const li = document.createElement("li");

            const role = user.role ? user.role : "user";
            li.textContent = `${user.email} — ${role}`;

            adminList.appendChild(li);
        });

    } catch (err) {
        console.error("Error loading admin list:", err);
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'block';
    }
}

// ==========================================
// 5. User Actions
// 
// 5.a Voting
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
        updateVoteUI();
        showToast("Vote cast successfully!");
    } catch (error) {
        console.error("Voting error:", error);
        showToast("Error casting vote.");
    }
}

// ==========================================
// 5.b Admin Actions
// ==========================================

window.loginUser = async function() {
    const email = document.getElementById('admin-email').value;
    const pass = document.getElementById('admin-pass').value;

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
        currentSession = data.session; // <-- store the session directly
        showToast("Admin logged in successfully.");
        fetchInitialData();
    } catch (error) {
        showToast("Login failed: " + error.message);
        token = null;
    }
    await checkRole();
    updateAdminUI();
}

window.logoutUser = async function() {
    try {
        await supabaseC.auth.signOut();
        isAdmin = false;
        currentUser = null;
        const emailField = document.getElementById('admin-email');
        const passField = document.getElementById('admin-pass');
        if (emailField) emailField.value = '';
        if (passField) passField.value = '';
        showToast("Admin logged out.");
        updateAdminUI();
    } catch (error) {
        console.log("Logout error:", error);
        showToast("Error logging out.");
    }
}

window.toggleLock = async function() {
    if (!isAdmin || !currentUser) return;
    try {
        const { error } = await supabaseC
            .from('poll_config')
            .update({ is_locked: !pollIsLocked })
            .eq('id', 'main');
            
        if (error) throw error;
        showToast("Status updated successfully!");
    } catch (error) {
        showToast("Error updating status.");
    }
}

window.toggleHide = async function() {
    if (!isAdmin || !currentUser) return;
    try {
        const { error } = await supabaseC
            .from('poll_config')
            .update({ results_hidden: !pollIsHidden })
            .eq('id', 'main');
            
        if (error) throw error;
        showToast("Status updated successfully!");
    } catch (error) {
        showToast("Error updating status.");
    }
}

window.resetPoll = async function() {
    if (!isAdmin || !currentUser) return;
    try {
        const { error: deleteError } = await supabaseC
            .from('votes')
            .delete()
            .neq('user_id', '00000000-0000-0000-0000-000000000000');
            
        if (deleteError) throw deleteError;

        const { error: unlockError } = await supabaseC
            .from('poll_config')
            .update({ is_locked: false })
            .eq('id', 'main');
            
        if (unlockError) throw unlockError;

        showToast("Poll reset successfully!");
    } catch (error) {
        showToast("Error resetting poll.");
    }
}

window.updateOptions =  async function(optionsIn) {
    if (!isAdmin) return showToast("Not an admin.");
    try {
        const { error } = await supabaseC
            .from('poll_config')
            .update({ question: document.getElementById(optionsIn[0]).value, option0: document.getElementById(optionsIn[1]).value, option1: document.getElementById(optionsIn[2]).value, option2: document.getElementById(optionsIn[3]).value, option3: document.getElementById(optionsIn[4]).value })
            .eq('id', 'main');

        if (error) throw error;

        updateAdminUI();
        showToast("Options updated successfully!");
    } catch (error) {
        console.error("Option update error:", error);
        showToast("Error updating options.");
    }
}

// ==========================================
// 5.c Super Admin Actions
// ==========================================

window.addAdmin = async function(elementId) {
    if (!isAdmin) return showToast("Not an admin.");
    const email = document.getElementById(elementId).value;

    if (!email) return showToast("Please enter an email.");

    inviteUser(supabaseC,email);
}

async function inviteUser(supabaseC, email) {
    if (!currentSession) {
        showToast("You must be logged in to invite users.");
        return { success: false };
    }

    const response = await fetch(
        'https://ntzxejhhxtzdyyeqbfpn.supabaseC.co/functions/v1/invite-user',
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentSession.access_token}`, // <-- use stored session
            },
            body: JSON.stringify({ email }),
        }
    );

    const result = await response.json();
    if (!response.ok) {
        showToast(result.error ?? "Invite failed.");
        return { success: false, error: result.error ?? "Invite failed." };
    }

    showToast(`Invite sent to ${email}!`);
    return { success: true, user: result.user };
}

