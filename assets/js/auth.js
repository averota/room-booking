// =====================================================================
// Auth helpers shared by dashboard.html and rooms.html
// =====================================================================

/**
 * Ensures a logged-in session exists; if not, redirects to login.
 * Returns { session, profile } on success.
 */
async function requireSession() {
  let session, profile;

  try {
    const sessionResult = await sb.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) {
      window.location.href = '../index.html';
      return null;
    }
    session = sessionResult.data.session;

    const profileResult = await sb
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', session.user.id)
      .single();

    if (profileResult.error || !profileResult.data) {
      console.error('Could not load profile', profileResult.error);
      await sb.auth.signOut();
      showToast('Could not verify your account. Check your Supabase connection and try again.', 'danger');
      window.location.href = '../index.html';
      return null;
    }
    profile = profileResult.data;
  } catch (err) {
    // A thrown (not returned) error means the request never made it to
    // Supabase at all — usually a network/CORS problem, a browser
    // extension stripping headers, or a wrong project URL. Fail loudly
    // instead of leaving the page stuck with no feedback.
    console.error('Session check failed unexpectedly', err);
    showToast('Could not reach Supabase. Check your connection or the URL/key in supabaseClient.js.', 'danger');
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
