// =====================================================================
// nav.js — shared top navigation bar, rendered once and reused across
// every page (dashboard.html, rooms.html, holidays.html, ...).
//
// USAGE: replace the entire <nav class="navbar ...">...</nav> block in
// a page with a single empty mount point:
//
//   <div id="navMount"></div>
//
// then include this script BEFORE auth.js:
//
//   <script src="../assets/js/nav.js"></script>
//   <script src="../assets/js/auth.js"></script>
//
// auth.js still owns showing/hiding [data-admin-only] elements, the
// role badge, user name, and avatar — this file only owns the nav
// markup and which link gets the "active" class.
// =====================================================================

(function () {
  // Central source of truth for every top-level nav link. Add a page
  // here once and every page picks it up automatically — no more
  // copy-pasting the <li> into three separate HTML files.
  const NAV_LINKS = [
    { href: 'dashboard.html', label: 'Calendar',    adminOnly: true },
    { href: 'rooms.html',     label: 'Rooms',    adminOnly: true },
    { href: 'holidays.html',  label: 'Holidays', adminOnly: true }
  ];

  function currentPage() {
    return location.pathname.split('/').pop() || 'dashboard.html';
  }

  function renderNav() {
    const mount = document.getElementById('navMount');
    if (!mount) return; // page hasn't been migrated to the shared nav yet

    const page = currentPage();

    const linksHtml = NAV_LINKS.map((link) => {
      const isActive = link.href === page;
      const adminAttr = link.adminOnly ? ' data-admin-only style="display:none;"' : '';
      return `<li class="nav-item"${adminAttr}><a class="nav-link app-link${isActive ? ' active' : ''}" href="${link.href}">${link.label}</a></li>`;
    }).join('');

    mount.outerHTML = `
<nav class="navbar navbar-expand-md app-nav">
  <div class="container-fluid" style="max-width:1180px; margin:0 auto;">
    <a class="navbar-brand" href="dashboard.html">
      <span class="mark">R</span> Roombook
    </a>
    <div class="d-flex align-items-center gap-3 order-md-3">
      <span class="role-badge" id="roleBadge" style="display: none;">Member</span>
      <div class="d-flex align-items-center gap-2">
        <span class="mark" id="userAvatar" style="display: none; background:var(--ink);">?</span>
        <span id="userName" style="font-size:0.9rem; font-weight:600;"></span>
      </div>
      <button class="btn btn-sm btn-outline-secondary" id="logoutBtn">Log out</button>
    </div>
    <button class="navbar-toggler order-md-2" type="button" data-bs-toggle="collapse" data-bs-target="#navLinks">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse order-md-2" id="navLinks">
      <ul class="navbar-nav me-auto mb-2 mb-md-0 ms-md-4">
        ${linksHtml}
      </ul>
    </div>
  </div>
</nav>`.trim();
  }

  // Registered before auth.js's own DOMContentLoaded listener (as long
  // as this <script> tag appears earlier in the HTML), so the nav
  // markup — including the [data-admin-only] <li> elements — exists in
  // the DOM before auth.js runs its role-based show/hide pass.
  document.addEventListener('DOMContentLoaded', renderNav);
})();
