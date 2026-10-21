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

  // The toggle is an on/off switch: on = dark mode
  function renderButton(btn) {
    var dark = current() === 'dark';
    var knobIcon = dark ? 'fa-moon' : 'fa-sun';
    var track = '<span class="theme-switch" aria-hidden="true">' +
      '<span class="theme-switch-knob"><i class="fa-solid ' + knobIcon + '"></i></span></span>';
    if (btn.classList.contains('nav-item')) {
      btn.innerHTML = '<i class="fa-solid fa-moon"></i> <span class="nav-text">Dark mode</span>' + track;
    } else {
      btn.innerHTML = '<i class="fa-solid fa-sun theme-fab-sun" aria-hidden="true"></i>' +
        '<i class="fa-solid fa-moon theme-fab-moon" aria-hidden="true"></i>' + track;
    }
    btn.classList.toggle('is-on', dark);
    btn.setAttribute('aria-checked', dark ? 'true' : 'false');
    btn.title = dark ? 'Dark mode is on' : 'Dark mode is off';
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
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', 'Dark mode');

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
