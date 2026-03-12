// ==========================================
// ANHS Live Voting - Combined Script
// ==========================================

// ==========================================
// 1. Initialization & Config
// ==========================================
const SUPABASE_URL = 'https://ntzxejhhxtzdyyeqbfpn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50enhlamhoeHR6ZHl5ZXFiZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQzMjMsImV4cCI6MjA4ODgzMDMyM30.0oh9mGajdP5tVibXjk5fp1acviBq-LUCkauE3m1c6_0';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State Variables
let currentUser = null;
let pollIsLocked = false;
let pollIsHidden = false;
let options = ["Loading...", "Loading...", "Loading...", "Loading..."];
let myVote = null;
let isAdmin = false;

// ==========================================
// 2. Authentication
// ==========================================
async function initAuth() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session) {
            currentUser = session.user;
            isAdmin = !!currentUser.email;
        } else {
            const { data, error } = await supabaseClient.auth.signInAnonymously();
            if (error) throw error;
            currentUser = data.user;
            isAdmin = false;
        }
        
        console.log("Authenticated as:", currentUser.id, isAdmin ? "(Admin)" : "(Voter)");
        fetchInitialData();
        setupRealtimeSubscriptions();
    } catch (error) {
        console.error("Auth error:", error);
        showToast("Authentication failed. Check console.");
    }
    updateAdminUI();
}

// ==========================================
// 3. Database Operations & Realtime
// ==========================================
async function fetchInitialData() {
    const { data: configData } = await supabaseClient
        .from('poll_config')
        .select('results_hidden, is_locked, results_hidden, option0, option1, option2, option3')
        .eq('id', 'main')
        .single();
    
    if (configData) {
        pollIsHidden = configData.results_hidden;
        pollIsLocked = configData.is_locked;
        options[0] = configData.option0 || options[0];
        options[1] = configData.option1 || options[1];
        options[2] = configData.option2 || options[2];
        options[3] = configData.option3 || options[3];
        // reflect values in admin edit inputs if visible
        updateAdminOptionInputs();
    }

    if (currentUser) {
        const { data: myVoteData } = await supabaseClient
            .from('votes')
            .select('option_index')
            .eq('user_id', currentUser.id)
            .single();
        
        myVote = myVoteData ? myVoteData.option_index : null;
    }

    updateVoteUI();
    updateAdminUI();
    fetchAndUpdateAllVotes();
}

async function fetchAndUpdateAllVotes() {
    const { data: votes, error } = await supabaseClient
        .from('votes')
        .select('option_index');

    if (error) {
        console.error("Error fetching votes:", error);
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

    updateProjectorUI(voteCounts, totalVotes);
}

function setupRealtimeSubscriptions() {
    supabaseClient
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
            if (payload.new && ( payload.new.option0 !== undefined || payload.new.option1 !== undefined || payload.new.option2 !== undefined || payload.new.option3 !== undefined )) {
                options[0] = payload.new.option0 || options[0];
                options[1] = payload.new.option1 || options[1];
                options[2] = payload.new.option2 || options[2];
                options[3] = payload.new.option3 || options[3];
                updateVoteUI();
                // option titles changed, refresh counts as well
                fetchAndUpdateAllVotes();
                updateAdminUI();                updateAdminOptionInputs();            }
        })
        .subscribe();

    supabaseClient
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
// 4. UI Update Functions
// ==========================================

// copy current option text into the admin edit fields
function updateAdminOptionInputs() {
    ['editOption0','editOption1','editOption2','editOption3'].forEach((id, idx) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = options[idx] || '';
            // also update placeholder so admin sees the current text when field is empty
            el.placeholder = options[idx] || el.placeholder || '';
        }
    });
}
function updateVoteUI() {
    const optionsE = [document.getElementById('option0'), document.getElementById('option1'), document.getElementById('option2'), document.getElementById('option3')];
    const badge = document.getElementById('vote-status-badge');
    const buttons = document.querySelectorAll('.vote-btn');

    if (badge) {
        if (pollIsLocked) {
            badge.className = 'status-badge status-locked';
            badge.innerText = '🔒 Voting is Locked';
        } else {
            badge.className = 'status-badge status-open';
            badge.innerText = '🟢 Voting is Open';
        }
    }

    if (pollIsHidden) {
        document.getElementById('resultGrid').classList.add('hidden');
        document.getElementById('hiddenGrid').classList.remove('hidden');
    } else {
        document.getElementById('resultGrid').classList.remove('hidden');
        document.getElementById('hiddenGrid').classList.add('hidden');
    }

    if (optionsE) {
        optionsE.forEach((opt, index) => {
            if (opt) opt.innerText = options[index];
        });
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

function updateProjectorUI(counts = [], total = 0) {
    // `counts` and `total` default so callers can invoke without data
    const total_count= document.getElementById('total-count');
    if (total_count) total_count.innerText = total;
    const optionsa = [document.getElementById('option0'), document.getElementById('option1'), document.getElementById('option2'), document.getElementById('option3')];
    const optionsb = [document.getElementById('option0b'), document.getElementById('option1b'), document.getElementById('option2b'), document.getElementById('option3b')];
    const badge = document.getElementById('vote-status-badge');

    if (badge) {
        if (pollIsLocked) {
            badge.className = 'status-badge status-locked';
            badge.innerText = '🔒 Voting is Locked';
        } else {
            badge.className = 'status-badge status-open';
            badge.innerText = '🟢 Voting is Open';
        }
    }

    if (window.location.pathname === '/wall') {
        if (pollIsHidden) {
            forEach(document.querySelectorAll('bar-group'), el => el.classList.add('hidden'));
            document.getElementById('hiddenText').style.display = 'block';
        } else {
            forEach(document.querySelectorAll('bar-group'), el => el.classList.remove('hidden'));
            document.getElementById('hiddenText').style.display = 'none';
        }
    }

    if (optionsa) {
        optionsa.forEach((opt, index) => {
            if (opt) opt.innerText = options[index];
        });
    }

    if (optionsb) {
        optionsb.forEach((opt, index) => {
            if (opt) opt.innerText = options[index];
        });
    }

    counts.forEach((count, index) => {
        const barElement = document.getElementById(`bar-${index}`);
        const pctElement = document.getElementById(`pct-${index}`);
        
        if (barElement && pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            barElement.style.width = `${percentage}%`;
            pctElement.innerText = `${percentage}% (${count})`;
        } else if (pctElement) {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
            pctElement.innerText = `${percentage}%`;
        }
    });
}

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
        if (pollIsLocked) {
            hideBtn.className = 'action-btn btn-success';
            hideBtn.innerText = '👁️ Show Results';
        } else {
            hideBtn.className = 'action-btn btn-danger';
            hideBtn.innerText = '🙈 Hide Results';
        }
    }

    const loginUI = document.getElementById('admin-login-ui');
    const controlsUI = document.getElementById('admin-controls-ui');
    
    if (loginUI && controlsUI) {
        if (isAdmin) {
            loginUI.style.display = 'none';
            controlsUI.style.display = 'flex';
        } else {
            loginUI.style.display = 'flex';
            controlsUI.style.display = 'none';
        }
    }
}

// ==========================================
// 5. User Actions
// ==========================================
window.castVote = async function(optionIndex) {
    if (!currentUser) return showToast("Not authenticated yet.");
    if (pollIsLocked) return showToast("Voting is currently locked.");
    if (myVote !== null) return showToast("You have already voted!");

    try {
        const { error } = await supabaseClient
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

window.loginAdmin = async function() {
    const email = document.getElementById('admin-email').value;
    const pass = document.getElementById('admin-pass').value;

    if (!email || !pass) return showToast("Please enter an email and password.");

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: pass
        });

        if (error) throw error;

        currentUser = data.user;
        isAdmin = true;
        showToast("Admin logged in successfully.");
        fetchInitialData();
    } catch (error) {
        showToast("Login failed: " + error.message);
    }
    updateAdminUI();
}

window.logoutAdmin = async function() {
    try {
        await supabaseClient.auth.signOut();
        isAdmin = false;
        currentUser = null;
        const emailField = document.getElementById('admin-email');
        const passField = document.getElementById('admin-pass');
        if (emailField) emailField.value = '';
        if (passField) passField.value = '';
        showToast("Admin logged out.");
        updateAdminUI();
    } catch (error) {
        showToast("Error logging out.");
    }
}

window.toggleLock = async function() {
    if (!isAdmin || !currentUser) return;
    try {
        const { error } = await supabaseClient
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
        const { error } = await supabaseClient
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
        const { error: deleteError } = await supabaseClient
            .from('votes')
            .delete()
            .neq('user_id', '00000000-0000-0000-0000-000000000000');
            
        if (deleteError) throw deleteError;

        const { error: unlockError } = await supabaseClient
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
        const { error } = await supabaseClient
            .from('poll_config')
            .update({option0: document.getElementById(optionsIn[0]).value, option1: document.getElementById(optionsIn[1]), option2: document.getElementById(optionsIn[2]), option3: document.getElementById(optionsIn[3])});
            
        if (error) throw error;

        updateAdminUI();
        showToast("Options updated successfully!");
    } catch (error) {
        console.error("Option update error:", error);
        showToast("Error updating options.");
    }
}

// ==========================================
// 6. Utilities
// ==========================================
function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

// ==========================================
// 7. Event Listeners
// ==========================================
document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const optionIndex = parseInt(btn.dataset.option);
        castVote(optionIndex);
    });
});

// ==========================================
// 8. Initialization
// ==========================================
initAuth();