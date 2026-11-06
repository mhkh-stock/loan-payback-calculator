// Loan Payback Calculator — shared header behaviour (one file, every page).
// The header markup is static HTML in each page; this file only wires it up:
//   - kebab (⋮) menu: toggle, close on selection / outside tap / Escape
//   - current-page highlight (aria-current="page") on matching links
'use strict';
(function () {
  var btn = document.getElementById('menuBtn');
  var menu = document.getElementById('overflowMenu');
  if (!btn || !menu) return;

  function closeMenu(restoreFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus();
  }
  function openMenu() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var first = menu.querySelector('a[role="menuitem"]');
    if (first) first.focus();
  }
  btn.addEventListener('click', function () {
    if (menu.hidden) openMenu(); else closeMenu(false);
  });
  // Choosing anything in the menu closes it.
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeMenu(false);
  });
  // A tap outside the menu closes it.
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu(false);
  });
  // Escape closes it and returns focus to the button.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu(true);
  });

  // Highlight the current page's link, where it is in the header.
  var path = window.location.pathname;
  document.querySelectorAll('.topbar a[href]').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === path || (path === '/' && href === '/')) a.setAttribute('aria-current', 'page');
  });
})();
