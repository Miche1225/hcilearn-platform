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
