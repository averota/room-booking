// =====================================================================
// Auth helpers shared by dashboard.html and rooms.html
// =====================================================================

/**
 * Ensures a logged-in session exists; if not, redirects to login.
 * Returns { session, profile } on success.
 */
async function requireSession() {
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session) {
    window.location.href = '../index.html';
    return null;
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    console.error('Could not load profile', profileError);
    await sb.auth.signOut();
    window.location.href = '../index.html';
    return null;
  }

  return { session, profile, email: session.user.email };
}

function wireLogout(buttonEl) {
  if (!buttonEl) return;
  buttonEl.addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = '../index.html';
  });
}

/** Applies role-based visibility: elements with [data-admin-only] show only for admins. */
function applyRoleVisibility(role) {
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
}

function initials(nameOrEmail) {
  if (!nameOrEmail) return '?';
  const parts = nameOrEmail.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
