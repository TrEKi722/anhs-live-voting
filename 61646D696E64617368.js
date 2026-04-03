// ==========================================
// ANHS Live Voting - Admin Script
// ==========================================

// ==========================================
// 4.b Admin UI Updates
// ==========================================
function updateAdminUI() {
    updateHatsAdminUI();
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
        if (isAdmin) {
            adminDash.style.display = 'flex';
            adminDash.style.flexDirection = 'row-reverse';
        } else {
            adminDash.style.display = 'none';
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
// Hats Admin
// ==========================================

function updateHatsAdminUI() {
    const btn = document.getElementById('hats-toggle-btn');
    if (!btn) return;
    if (hatsIsActive) {
        btn.className = 'action-btn btn-danger';
        btn.innerText = 'Deactivate Round';
    } else {
        btn.className = 'action-btn btn-primary';
        btn.innerText = 'Activate Round';
    }
}

window.hatsToggleActive = async function() {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('hats_config')
            .update({ is_active: !hatsIsActive })
            .eq('id', 'main');
        if (error) throw error;
        showToast(hatsIsActive ? "Round deactivated." : "Round activated!");
    } catch (e) {
        showToast("Error toggling round.");
    }
}

window.hatsReveal = async function(option) {
    if (!isAdmin) return;
    try {
        const { error } = await supabaseC
            .from('hats_config')
            .update({ correct_option: option, is_active: false })
            .eq('id', 'main');
        if (error) throw error;
        showToast(`Answer revealed: button ${option}!`);
    } catch (e) {
        showToast("Error revealing answer.");
    }
}

window.hatsReset = async function() {
    if (!isAdmin) return;
    try {
        const { error: delErr } = await supabaseC
            .from('hats_presses')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');
        if (delErr) throw delErr;

        const { error: cfgErr } = await supabaseC
            .from('hats_config')
            .update({ correct_option: null, is_active: false })
            .eq('id', 'main');
        if (cfgErr) throw cfgErr;

        showToast("Hats round reset!");
    } catch (e) {
        showToast("Error resetting hats.");
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