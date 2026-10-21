// public/js/theme.js
// Light / dark mode. Load this in <head> (before the page is drawn) so the
// right theme is applied without a white flash.
//
// The choice is remembered in this browser. Until the user picks one, the
// device setting (prefers-color-scheme) is followed.

(function () {
  'use strict';

  var KEY = 'hcilearn_theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function current() {
    var choice = saved();
    if (choice === 'dark' || choice === 'light') return choice;
    return media && media.matches ? 'dark' : 'light';
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#14122a' : '#0d3b75');
    document.querySelectorAll('[data-theme-toggle]').forEach(renderButton);
  }

  function renderButton(btn) {
    var dark = current() === 'dark';
    var label = dark ? 'Light mode' : 'Dark mode';
    var icon = dark ? 'fa-sun' : 'fa-moon';
    if (btn.classList.contains('nav-item')) {
      btn.innerHTML = '<i class="fa-solid ' + icon + '"></i> <span class="nav-text">' + label + '</span>';
    } else {
      btn.innerHTML = '<i class="fa-solid ' + icon + '"></i>';
    }
    btn.setAttribute('aria-label', 'Switch to ' + label.toLowerCase());
    btn.title = 'Switch to ' + label.toLowerCase();
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked */ }
    root.classList.add('theme-switching');
    apply(next);
    setTimeout(function () { root.classList.remove('theme-switching'); }, 350);
  }

  apply(current());

  // Follow the device setting while the user hasn't chosen
  if (media && media.addEventListener) {
    media.addEventListener('change', function () {
      if (!saved()) apply(current());
    });
  }

  // Toggle button: a menu item in the sidebar, or a floating button on
  // pages without one (login, sign up, reset password).
  function mount() {
    var nav = document.querySelector('.sidebar-nav');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-theme-toggle', '');

    if (nav) {
      btn.className = 'nav-item theme-toggle';
      nav.appendChild(btn);
    } else {
      btn.className = 'theme-fab';
      document.body.appendChild(btn);
    }

    btn.addEventListener('click', toggle);
    renderButton(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.HCITheme = { toggle: toggle, current: current };
})();
