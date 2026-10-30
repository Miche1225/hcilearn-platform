// src/middleware/adminGuard.js
//
// Admin session for the Admin Dashboard. Separate from student sessions:
// its own cookie, its own table (admin, which holds the one admin account),
// and a shorter lifetime. A student cookie can never open the admin pages,
// and the admin cookie is never accepted as a student login.
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { JWT_SECRET, IS_PRODUCTION } = require('./authGuard');

const COOKIE_NAME = 'admin_token';
const SESSION_HOURS = 8;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: SESSION_HOURS * 60 * 60 * 1000,
};

function issueAdminSession(res, adminRowId, sessionVersion = 0) {
  const token = jwt.sign(
    { kind: 'admin', adminRowId, sv: sessionVersion },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` }
  );
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearAdminSession(res) {
  const { maxAge, ...options } = COOKIE_OPTIONS;
  res.clearCookie(COOKIE_NAME, options);
}

// Sets req.admin = { id, adminId, fullName } or answers 401.
async function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Admin login required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  if (payload.kind !== 'admin' || !Number.isInteger(payload.adminRowId)) {
    return res.status(401).json({ error: 'Admin login required.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, admin_id, full_name, session_version FROM admin WHERE id = $1',
      [payload.adminRowId]
    );
    if (!rows[0] || rows[0].session_version !== (payload.sv || 0)) {
      clearAdminSession(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.admin = { id: rows[0].id, adminId: rows[0].admin_id, fullName: rows[0].full_name };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin, issueAdminSession, clearAdminSession };
