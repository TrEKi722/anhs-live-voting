// ==========================================
// ANHS Live Voting - Admin Script
// ==========================================

// ==========================================
// 4.b Admin UI Updates
// ==========================================
function updateAdminUI() {
    updateCupsAdminUI();
    if (typeof updateNGAdminUI === 'function') updateNGAdminUI();
    if (typeof updateYBAdminUI === 'function') updateYBAdminUI();
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

    const adminDash = document.getElementById('adminDash');
    if (adminDash) {
        adminDash.style.display = isAdmin ? 'flex' : 'none';
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

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none'; // FIX: was 'none ' (trailing space) which prevented closing
    }
}

// ==========================================
// 4.c Super Admin UI Updates
// ==========================================
async function loadAdminList() {
    try {
        const response = await fetch(
            `https://ntzxejhhxtzdyyeqbfpn.supabase.co/functions/v1/get-users-with-roles`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${currentSession.access_token}`,
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

        adminList.innerHTML = "";

        const admins = result.users.filter(u => u.role === "admin" || u.role === "super_admin");

        if (admins.length === 0) {
            adminList.innerHTML = "<li>No admins found.</li>";
            return;
        }

        admins.forEach(user => {
            const li = document.createElement("li");
            li.textContent = `${user.email} — ${user.role}`;
            adminList.appendChild(li);
        });

    } catch (err) {
        console.error("Error loading admin list:", err);
    }
}

// ==========================================
// Cups Admin
// ==========================================

function updateCupsAdminUI() {
    const startBtn = document.getElementById('cups-start-btn');
    const endBtn = document.getElementById('cups-end-btn');
    if (!startBtn) return;
    if (cupsIsActive) {
        startBtn.style.display = 'none';
        endBtn.style.display = 'inline-block';
    } else {
        startBtn.style.display = 'inline-block';
        endBtn.style.display = 'none';
    }
}

window.cupsStartRound = async function(option) {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('hats_config')
            .update({ correct_option: option, is_active: true })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Cups round started!");
    } catch (e) {
        showToast("Error starting round.");
    }
}

window.cupsEndRound = async function() {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('hats_config')
            .update({ is_active: false })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Round ended.");
    } catch (e) {
        showToast("Error ending round.");
    }
}

window.cupsReset = async function() {
    if (!isAdmin) return;
    try {
        const { error: delErr } = await supabaseC
            .from('hats_presses')
            .delete()
            .neq('user_id', '00000000-0000-0000-0000-000000000000');
        if (delErr) throw delErr;

        const { error: cfgErr } = await supabaseC
            .from('hats_config')
            .update({ correct_option: null, is_active: false })
            .eq('id', 'main');
        if (cfgErr) throw cfgErr;

        showToast("Cups round reset!");
    } catch (e) {
        showToast("Error resetting cups.");
    }
}

// ==========================================
// 5. User Actions
//
// 5.b Admin Actions
// ==========================================

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

window.updateOptions = async function(optionsIn) {
    if (!isAdmin) return showToast("Not an admin.");
    try {
        const { error } = await supabaseC
            .from('poll_config')
            .update({
                question: document.getElementById(optionsIn[0]).value,
                option0: document.getElementById(optionsIn[1]).value,
                option1: document.getElementById(optionsIn[2]).value,
                option2: document.getElementById(optionsIn[3]).value,
                option3: document.getElementById(optionsIn[4]).value
            })
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

window.editRole = async function(emailElementId, roleElementId) {
    if (!isSuperAdmin) return showToast("Not a super admin.");
    const email = document.getElementById(emailElementId).value;
    const role = document.getElementById(roleElementId).value;

    if (!email) return showToast("Please enter an email.");
    if (!role) return showToast("Please choose a role.");

    try {
        const response = await fetch(
            'https://ntzxejhhxtzdyyeqbfpn.supabase.co/functions/v1/edit-role',
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${currentSession.access_token}`,
                },
                body: JSON.stringify({ email, role }),
            }
        );

        const result = await response.json();
        if (!response.ok) {
            showToast(result.error ?? "Role update failed.");
            return;
        }

        showToast(`Updated ${email} to role ${role}!`);
        loadAdminList();
    } catch (err) {
        console.error("Error updating role:", err);
        showToast("Error updating role. Check console.");
    }
}

window.addAdmin = async function(emailElementId, roleElementId) {
    if (!isSuperAdmin) return showToast("Not a super admin.");
    const email = document.getElementById(emailElementId).value;
    const role = document.getElementById(roleElementId).value;

    if (!email) return showToast("Please enter an email.");
    if (!role) return showToast("Please choose a role.");

    await inviteUser(email, role);
    loadAdminList();
}

async function inviteUser(email, role) {
    if (!currentUser || !currentSession) {
        console.error("Invite error: No authenticated user or session.");
        showToast("You must be logged in to invite users.");
        return { success: false };
    }

    const response = await fetch(
        'https://ntzxejhhxtzdyyeqbfpn.supabase.co/functions/v1/invite-user',
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentSession.access_token}`,
            },
            body: JSON.stringify({ email, role }),
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

window.removeAdmin = async function(emailElementId) {
    const email = document.getElementById(emailElementId).value;

    if (!isSuperAdmin) return showToast("Not a super admin.");
    if (!email) return showToast("Please enter an email.");

    try {
        const response = await fetch(
            'https://ntzxejhhxtzdyyeqbfpn.supabase.co/functions/v1/delete-user',
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${currentSession.access_token}`,
                },
                body: JSON.stringify({ email }),
            }
        );

        const result = await response.json();
        if (!response.ok) {
            showToast(result.error ?? "Remove failed.");
            return;
        }

        showToast(`${email} has been deleted`);
        loadAdminList();
    } catch (err) {
        console.error("Error removing admin:", err);
        showToast("Error removing admin. Check console.");
    }
}

// ==========================================
// Name Game Admin
// ==========================================

function updateNGAdminUI() {
    const startBtn = document.getElementById('ng-start-btn');
    const setup = document.getElementById('ng-setup');
    if (!startBtn) return;

    // Populate set select if empty
    const select = document.getElementById('ng-set-select');
    if (select && select.options.length === 0 && typeof NAME_GAME_SETS !== 'undefined') {
        Object.entries(NAME_GAME_SETS).forEach(([key, set]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = set.name;
            select.appendChild(opt);
        });
    }

    // Pre-fill durations from current config
    const durationInput = document.getElementById('ng-duration-input');
    if (durationInput && ngDurationSeconds) {
        durationInput.value = ngDurationSeconds;
    }
    const memorizeDurationInput = document.getElementById('ng-memorize-duration-input');
    if (memorizeDurationInput && ngMemorizeDurationSeconds) {
        memorizeDurationInput.value = ngMemorizeDurationSeconds;
    }

    if (ngIsActive) {
        startBtn.style.display = 'none';
        if (setup) setup.style.opacity = '0.5';
    } else {
        startBtn.style.display = 'inline-block';
        if (setup) setup.style.opacity = '1';
    }
}

// Called when admin clicks "Start Round" to populate the confirm modal
window.ngPrepareStart = function() {
    const select = document.getElementById('ng-set-select');
    const durationInput = document.getElementById('ng-duration-input');
    const memorizeDurationInput = document.getElementById('ng-memorize-duration-input');
    if (!select?.value) return;
    const setKey = select.value;
    const recallDuration = parseInt(durationInput?.value) || 30;
    const memorizeDuration = parseInt(memorizeDurationInput?.value) || 10;
    const imageCount = NAME_GAME_SETS[setKey]?.images?.length ?? 0;
    const confirmText = document.getElementById('ng-start-confirm-text');
    if (confirmText) {
        confirmText.textContent = `Set: "${NAME_GAME_SETS[setKey].name}" · ${imageCount} images · Memorize: ${memorizeDuration}s · Recall: ${recallDuration}s`;
    }
}

window.ngStartRound = async function() {
    if (!isAdmin) return;
    const select = document.getElementById('ng-set-select');
    const durationInput = document.getElementById('ng-duration-input');
    const memorizeDurationInput = document.getElementById('ng-memorize-duration-input');
    if (!select || !select.value) return showToast("Please select an image set.");

    const setKey = select.value;
    const duration = parseInt(durationInput?.value) || 30;
    const memorizeDuration = parseInt(memorizeDurationInput?.value) || 10;
    const imageCount = NAME_GAME_SETS[setKey]?.images?.length ?? 0;
    if (imageCount === 0) return showToast("Selected set has no images.");

    // Fisher-Yates shuffle
    const indices = Array.from({ length: imageCount }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    try {
        const { error } = await supabaseC
            .from('name_game_config')
            .update({
                is_active: true,
                image_set: setKey,
                image_order: indices,
                round_duration_seconds: duration,
                memorize_duration_seconds: memorizeDuration,
                round_start_time: new Date().toISOString(),
                round_end_time: null
            })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Name Game round started!");
    } catch (e) {
        showToast("Error starting round.");
    }
}


// ==========================================
// Yearbook Admin
// ==========================================

function updateYBAdminUI() {
    const startBtn = document.getElementById('yb-start-btn');
    const revealBtn = document.getElementById('yb-reveal-btn');
    const resetBtn = document.getElementById('yb-reset-btn');
    if (!startBtn) return;

    if (ybPhase === 'waiting') {
        startBtn.style.display = 'inline-block';
        revealBtn.style.display = 'none';
        resetBtn.style.display = 'none';
    } else if (ybPhase === 'guessing') {
        startBtn.style.display = 'none';
        revealBtn.style.display = 'inline-block';
        resetBtn.style.display = 'inline-block';
    } else if (ybPhase === 'reveal') {
        startBtn.style.display = 'inline-block';
        revealBtn.style.display = 'none';
        resetBtn.style.display = 'inline-block';
    }

    // Populate teacher select if empty
    const select = document.getElementById('yb-teacher-select');
    if (select && select.options.length <= 1 && typeof YEARBOOK_TEACHERS !== 'undefined') {
        select.innerHTML = '<option value="">— Pick a teacher —</option>';
        YEARBOOK_TEACHERS.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            select.appendChild(opt);
        });
    }

    // Show current round info
    const infoEl = document.getElementById('yb-round-info');
    if (infoEl) {
        if (ybTeacherIndex !== null && window.YEARBOOK_TEACHERS) {
            const teacher = YEARBOOK_TEACHERS[ybTeacherIndex];
            infoEl.textContent = `Current: ${teacher?.name || '?'} — Phase: ${ybPhase}`;
        } else {
            infoEl.textContent = 'No active round.';
        }
    }
}

window.ybStartRound = async function() {
    if (!isAdmin) return;
    const select = document.getElementById('yb-teacher-select');
    const teacherIdx = parseInt(select?.value);
    if (isNaN(teacherIdx)) return showToast("Please select a teacher.");
    if (!window.YEARBOOK_TEACHERS || !YEARBOOK_TEACHERS[teacherIdx]) return showToast("Invalid teacher.");

    // Pick 3 unique decoys
    const allIndices = YEARBOOK_TEACHERS.map(t => t.id).filter(i => i !== teacherIdx);
    for (let i = allIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
    }
    const decoys = allIndices.slice(0, 3);
    const options = [teacherIdx, ...decoys];
    // Shuffle options so correct isn't always first
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }

    const newRoundId = (ybRoundId || 0) + 1;

    try {
        const { error } = await supabaseC
            .from('yearbook_config')
            .update({
                phase: 'guessing',
                teacher_index: teacherIdx,
                option_indices: options,
                round_id: newRoundId
            })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Yearbook round started!");
    } catch (e) {
        console.error(e);
        showToast("Error starting round.");
    }
}

window.ybReveal = async function() {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('yearbook_config')
            .update({ phase: 'reveal' })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Answer revealed!");
    } catch (e) {
        showToast("Error revealing answer.");
    }
}

window.ybResetRound = async function() {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('yearbook_config')
            .update({ phase: 'waiting', teacher_index: null, option_indices: null })
            .eq('id', 'main');
        if (error) throw error;
        showToast("Round reset.");
    } catch (e) {
        showToast("Error resetting round.");
    }
}

window.ybResetScores = async function() {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('yearbook_scores')
            .delete()
            .neq('user_id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        showToast("Scores cleared!");
    } catch (e) {
        showToast("Error clearing scores.");
    }
}

window.ngReset = async function() {
    if (!isAdmin) return;
    try {
        const { error: scoresErr } = await supabaseC
            .from('name_game_scores')
            .delete()
            .neq('user_id', '00000000-0000-0000-0000-000000000000');
        if (scoresErr) throw scoresErr;

        const { error: cfgErr } = await supabaseC
            .from('name_game_config')
            .update({ is_active: false, image_set: null, image_order: null, round_start_time: null, round_end_time: null, memorize_duration_seconds: null })
            .eq('id', 'main');
        if (cfgErr) throw cfgErr;

        showToast("Name Game reset!");
    } catch (e) {
        showToast("Error resetting Name Game.");
    }
}