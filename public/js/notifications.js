// public/js/notifications.js
// Notification bell for students (needs js/api.js): shows announcements from
// the admin, a red count for unread ones, and a pop-up when a new one
// arrives. Checks again every minute while the page is open.

(function () {
  'use strict';

  const CHECK_EVERY_MS = 60 * 1000;
  const POPPED_KEY = 'hcilearn_popped_announcements'; // ids already shown as a pop-up

  let bell = null;
  let panel = null;
  let items = [];
  let unread = 0;
  let timer = null;

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} day${s < 2 * 86400 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const popped = () => {
    try { return JSON.parse(localStorage.getItem(POPPED_KEY) || '[]'); } catch (e) { return []; }
  };
  const remember = (ids) => {
    try { localStorage.setItem(POPPED_KEY, JSON.stringify([...new Set([...popped(), ...ids])].slice(-100))); } catch (e) { /* storage blocked */ }
  };

  // ---------- Bell ----------
  function renderBell() {
    if (!bell) return;
    const badge = bell.querySelector('.notif-count');
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : unread;
    const label = unread ? `Notifications, ${unread} new` : 'Notifications';
    bell.setAttribute('aria-label', label);
    bell.title = label;
    bell.classList.toggle('has-unread', unread > 0);
  }

  function renderPanel() {
    if (!panel) return;
    const list = panel.querySelector('.notif-list');
    list.innerHTML = items.length ? items.map(a => `
      <div class="notif-item${a.unread ? ' is-unread' : ''}">
        <span class="notif-icon"><i class="fa-solid fa-bullhorn"></i></span>
        <div class="notif-text">
          <strong>${esc(a.title)}${a.unread ? ' <span class="notif-new">New</span>' : ''}</strong>
          ${a.body ? `<p>${esc(a.body)}</p>` : ''}
          <small>${esc(a.by)} · ${timeAgo(a.createdAt)}</small>
        </div>
      </div>`).join('')
      : '<p class="notif-empty"><i class="fa-regular fa-bell-slash"></i> No announcements right now.</p>';
  }

  function openPanel() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'notif-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Notifications');
      panel.innerHTML = `
        <div class="notif-head"><b><i class="fa-solid fa-bell"></i> Notifications</b>
          <button type="button" class="qs-close notif-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="notif-list"></div>`;
      panel.querySelector('.notif-close').addEventListener('click', closePanel);
      document.body.appendChild(panel);
    }
    renderPanel();
    panel.classList.add('is-open');
    bell.setAttribute('aria-expanded', 'true');
    panel.querySelector('.notif-close').focus();

    // Opening = read. Keep the "New" tags visible until the panel is closed.
    if (unread) {
      unread = 0;
      renderBell();
      remember(items.map(a => a.id));
      api.post('/announcements/seen').catch(() => {});
    }
  }

  function closePanel() {
    if (!panel || !panel.classList.contains('is-open')) return;
    panel.classList.remove('is-open');
    bell.setAttribute('aria-expanded', 'false');
    items = items.map(a => ({ ...a, unread: false }));
    bell.focus();
  }

  // ---------- Pop-up for a newly arrived announcement ----------
  function popUp(a, more) {
    const el = document.createElement('div');
    el.className = 'notif-pop';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <span class="notif-icon"><i class="fa-solid fa-bullhorn"></i></span>
      <div class="notif-text">
        <small>New announcement${more ? ` (+${more} more)` : ''}</small>
        <strong>${esc(a.title)}</strong>
      </div>
      <button type="button" class="tool-btn notif-view">View</button>
      <button type="button" class="notif-pop-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-open'));

    const close = () => {
      el.classList.remove('is-open');
      setTimeout(() => el.remove(), 300);
    };
    // stopPropagation: otherwise this same click reaches the "click outside
    // closes the panel" listener and the panel shuts right after opening
    el.querySelector('.notif-view').addEventListener('click', (e) => { e.stopPropagation(); close(); openPanel(); });
    el.querySelector('.notif-pop-close').addEventListener('click', close);
    setTimeout(close, 9000);
  }

  // ---------- Data ----------
  async function check() {
    let data;
    try {
      data = await api.get('/announcements');
    } catch (e) {
      return; // not logged in / offline: try again later
    }
    items = data.announcements;
    unread = data.unreadCount;
    renderBell();
    if (panel && panel.classList.contains('is-open')) renderPanel();

    const already = popped();
    const fresh = items.filter(a => a.unread && !already.includes(a.id));
    if (fresh.length) {
      remember(fresh.map(a => a.id));
      popUp(fresh[0], fresh.length - 1);
    }
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === 'visible') check(); }, CHECK_EVERY_MS);
  }

  // ---------- Mount ----------
  function mount() {
    const userBox = document.querySelector('.sidebar-user');
    if (!userBox || userBox.querySelector('.notif-bell')) return;

    bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'sidebar-logout notif-bell';
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.innerHTML = '<i class="fa-solid fa-bell"></i><span class="notif-count" hidden></span>';
    userBox.insertBefore(bell, userBox.querySelector('.sidebar-logout'));
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      panel && panel.classList.contains('is-open') ? closePanel() : openPanel();
    });

    document.addEventListener('click', (e) => {
      if (panel && panel.classList.contains('is-open') && !panel.contains(e.target) && !bell.contains(e.target)
          && !e.target.closest('.notif-pop')) closePanel();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });

    check();
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.HCINotifications = { open: openPanel, check };
})();
