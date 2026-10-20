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
