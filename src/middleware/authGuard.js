// src/middleware/authGuard.js
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { notifyPresence } = require('../presence');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Never fall back to a built-in secret in production: anyone who knows it
// could create a valid login cookie for any account.
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET is required in production and must be at least 32 characters long.');
}

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Using an insecure development secret.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Login cookie: not readable by JavaScript, only sent over HTTPS in production.
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Creates the user's login session (cookie) for the given session version.
function issueSession(res, userId, sessionVersion = 0) {
  const token = jwt.sign(
    { userId, sv: sessionVersion },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
  res.cookie('token', token, COOKIE_OPTIONS);
}

function clearSession(res) {
  const { maxAge, ...options } = COOKIE_OPTIONS;
  res.clearCookie('token', options);
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  try {
    // The cookie is only valid while its session version matches the user's
    // current one (it changes when the password is changed or reset).
    const { rows } = await pool.query(
      'SELECT session_version, disabled_at FROM users WHERE id = $1',
      [payload.userId]
    );

    if (!rows[0] || rows[0].session_version !== (payload.sv || 0) || rows[0].disabled_at) {
      clearSession(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.userId = payload.userId;
    req.sessionVersion = rows[0].session_version;
    // Remember the student opened the system (at most every 20 seconds;
    // open pages check in every 30 seconds). If they were offline, tell open
    // Admin Dashboards right away. Skipped for 5 s after a logout so a
    // request still in flight can't make a logged-out student look online.
    // Not awaited: a failed update must never block the page.
    pool.query(
      `WITH before AS (SELECT last_seen_at, signed_out_at, left_at, hidden_at FROM users WHERE id = $1)
       UPDATE users u SET last_seen_at = NOW()
       FROM before b
       WHERE u.id = $1
         AND (b.signed_out_at IS NULL OR b.signed_out_at < NOW() - INTERVAL '5 seconds')
         AND (b.last_seen_at IS NULL OR b.last_seen_at < NOW() - INTERVAL '20 seconds'
              OR b.signed_out_at >= b.last_seen_at OR b.left_at >= b.last_seen_at
              OR b.hidden_at >= b.last_seen_at)
       RETURNING (b.last_seen_at IS NULL OR b.last_seen_at < NOW() - INTERVAL '75 seconds'
                  OR b.signed_out_at >= b.last_seen_at OR b.left_at >= b.last_seen_at
                  OR b.hidden_at >= b.last_seen_at) AS came_online`,
      [payload.userId]
    ).then(({ rows: r }) => { if (r[0] && r[0].came_online) notifyPresence(); })
      .catch(err => console.error('Could not save last_seen_at:', err.message));
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, issueSession, clearSession, JWT_SECRET, IS_PRODUCTION };
