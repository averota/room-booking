// Generic show/hide toggle for password fields.
// Works with any button that has class="password-toggle-btn" and a
// data-target attribute pointing to the id of the password input.
// Self-contained: does not touch auth/session logic.
(function () {
  document.querySelectorAll('.password-toggle-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';

      btn.classList.toggle('is-visible', !isVisible);
      btn.setAttribute('aria-pressed', String(!isVisible));
      btn.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    });
  });
})();
