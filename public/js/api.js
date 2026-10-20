// public/js/api.js
// Small shared helper so every page talks to the backend the same way.

const API_BASE = '/api';

async function apiRequest(method, url, body) {
  const opts = {
    method,
    credentials: 'include', // send the httpOnly auth cookie
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no JSON body */ }
  if (!res.ok) {
    const message = (data && data.error) ? data.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

const api = {
  get: (url) => apiRequest('GET', url),
  post: (url, body) => apiRequest('POST', url, body),
  put: (url, body) => apiRequest('PUT', url, body),
};

// Call at the top of every protected page. Redirects to login if the
// session cookie is missing/expired; otherwise resolves with the user.
async function requireAuth() {
  try {
    const { user } = await api.get('/auth/me');
    renderSidebarUser(user);
    return user;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}

async function logout() {
  try { await api.post('/auth/logout'); } catch (e) { /* ignore */ }
  window.location.href = 'login.html';
}

// Fills the profile card at the bottom of the sidebar (if the page has one).
function renderSidebarUser(user) {
  if (!user) return;

  const fill = () => {
    const nameEl = document.getElementById('sidebarName');
    if (!nameEl) return;

    nameEl.textContent = user.fullName || 'My Account';
    const meta = [user.program, user.yearSection].filter(Boolean).join(' · ');
    document.getElementById('sidebarMeta').textContent = meta || 'View profile';

    const avatar = document.getElementById('sidebarAvatar');
    const initials = (user.fullName || '')
      .split(' ').filter(Boolean).slice(0, 2)
      .map(n => n[0].toUpperCase()).join('');
    if (initials) avatar.textContent = initials;

    if (user.profilePhoto) {
      const img = new Image();
      img.alt = '';
      img.onload = () => { avatar.textContent = ''; avatar.appendChild(img); };
      img.src = user.profilePhoto;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fill);
  } else {
    fill();
  }
}

// Sidebar collapse (desktop): icons-only mode, remembered in this browser.
(function setupSidebarCollapse() {
  const KEY = 'sidebarCollapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }

  // Apply right away (on <html>) so the menu doesn't flash open on load
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);

  const init = () => {
    const sidebar = document.querySelector('.sidebar');
    const header = sidebar && sidebar.querySelector('.sidebar-header');
    if (!header) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-collapse-btn';
    btn.innerHTML = '<i class="fa-solid fa-angles-left"></i>';
    header.appendChild(btn);

    const apply = () => {
      document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
      const label = collapsed ? 'Expand menu' : 'Collapse menu';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      // Show item names as tooltips only while collapsed
      sidebar.querySelectorAll('.nav-item').forEach(item => {
        const text = item.querySelector('.nav-text');
        if (collapsed && text) item.title = text.textContent.trim();
        else item.removeAttribute('title');
      });
    };

    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { /* storage blocked */ }
      apply();
    });

    apply();
    setupMobileMenu(sidebar, header);
  };

  // Phone: hamburger button that slides the menu in as a drawer.
  function setupMobileMenu(sidebar, header) {
    const nav = sidebar.querySelector('.sidebar-nav');
    if (!nav) return;
    nav.id = nav.id || 'sidebarNav';

    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'sidebar-burger';
    burger.setAttribute('aria-label', 'Open menu');
    burger.setAttribute('aria-controls', nav.id);
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<i class="fa-solid fa-bars"></i>';
    header.prepend(burger);

    const drawerHead = document.createElement('div');
    drawerHead.className = 'drawer-head';
    drawerHead.innerHTML = `
      <span class="drawer-brand"><img src="favicon.svg" alt=""> HCILearn</span>
      <button type="button" class="drawer-close" aria-label="Close menu"><i class="fa-solid fa-xmark"></i></button>`;
    nav.prepend(drawerHead);

    // Inside the sidebar so it layers between the top bar and the drawer
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    sidebar.appendChild(backdrop);

    const setOpen = (open) => {
      document.documentElement.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      if (open) {
        const current = nav.querySelector('.nav-item.active') || nav.querySelector('.nav-item');
        if (current) current.focus();
      } else if (nav.contains(document.activeElement)) {
        burger.focus();
      }
    };

    burger.addEventListener('click', () => setOpen(true));
    drawerHead.querySelector('.drawer-close').addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    nav.addEventListener('click', (e) => { if (e.target.closest('.nav-item')) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.documentElement.classList.contains('menu-open')) setOpen(false);
    });
    // Close it if the screen becomes desktop-sized (e.g. rotating a tablet)
    window.matchMedia('(min-width: 769px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Any element with data-logout (e.g. the sidebar log-out button) asks first.
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-logout]');
  if (!trigger) return;
  e.preventDefault();
  confirmDialog({
    title: 'Log out?',
    message: "Your progress is saved. You'll need to log in again to continue learning.",
    confirmText: 'Log out',
    cancelText: 'Stay',
    icon: 'fa-arrow-right-from-bracket',
    danger: true,
    onConfirm: logout,
  });
});

// Styled replacement for window.confirm(). Resolves true/false.
// options: { title, message, confirmText, cancelText, icon, danger, onConfirm }
// If onConfirm is given, the confirm button shows a spinner while it runs.
function confirmDialog(options = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    icon = 'fa-circle-question',
    danger = false,
    onConfirm = null,
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-card${danger ? ' is-danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
        <div class="confirm-icon"><i class="fa-solid ${icon}"></i></div>
        <h3 id="confirmTitle"></h3>
        <p id="confirmMessage"></p>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-cancel"></button>
          <button type="button" class="confirm-btn confirm-ok"></button>
        </div>
      </div>`;

    overlay.querySelector('#confirmTitle').textContent = title;
    overlay.querySelector('#confirmMessage').textContent = message;

    const cancelBtn = overlay.querySelector('.confirm-cancel');
    const okBtn = overlay.querySelector('.confirm-ok');
    cancelBtn.textContent = cancelText;
    okBtn.textContent = confirmText;

    const previousFocus = document.activeElement;
    let busy = false;

    function close(result) {
      if (busy) return;
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 200);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') close(false);
      // Keep Tab focus inside the dialog
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancelBtn ? okBtn : cancelBtn).focus();
      }
    }

    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);

    okBtn.addEventListener('click', async () => {
      if (!onConfirm) return close(true);
      busy = true;
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      okBtn.innerHTML = `<span class="btn-spinner"></span> ${okBtn.textContent}`;
      try {
        await onConfirm();
      } finally {
        busy = false;
        close(true);
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    cancelBtn.focus();
  });
}
