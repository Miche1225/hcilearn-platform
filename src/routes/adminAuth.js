// src/routes/adminAuth.js
// Admin login / logout / password for the Admin Dashboard (Admin ID + password).
// There is only one admin account. It is created with
// "npm run admin -- create" (scripts/admin.js).
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { rateLimit } = require('../middleware/rateLimit');
const { isValidPassword, PASSWORD_RULES_MESSAGE } = require('../utils/passwords');
const { requireAdmin, issueAdminSession, clearAdminSession } = require('../middleware/adminGuard');

const router = express.Router();
const MINUTE = 60 * 1000;

// Same reply time whether or not the ID exists
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const loginLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 8,
  keyFn: (req) => `admin:${req.ip}:${String((req.body && req.body.adminId) || '').trim()}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

const loginIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 30,
  keyFn: (req) => `admin-ip:${req.ip}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

const publicAdmin = (row) => ({ adminId: row.admin_id, fullName: row.full_name });

// POST /api/admin/auth/login  { adminId, password }
router.post('/login', loginIpLimiter, loginLimiter, async (req, res, next) => {
  try {
    const { adminId, password } = req.body || {};
    const id = typeof adminId === 'string' ? adminId.trim() : '';
    if (!id || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Admin ID and password are required.' });
    }

    const { rows } = await pool.query('SELECT * FROM admin WHERE admin_id = $1', [id]);
    const admin = rows[0];
    const passwordOk = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_PASSWORD_HASH);
    if (!admin || !passwordOk) {
      return res.status(401).json({ error: 'Invalid admin ID or password.' });
    }

    await pool.query('UPDATE admin SET last_login_at = NOW() WHERE id = $1', [admin.id]);
    issueAdminSession(res, admin.id, admin.session_version);
    res.json({ admin: publicAdmin(admin) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/auth/logout
router.post('/logout', (req, res) => {
  clearAdminSession(res);
  res.json({ ok: true });
});

// GET /api/admin/auth/me
router.get('/me', requireAdmin, (req, res) => {
  const { adminId, fullName } = req.admin;
  res.json({ admin: { adminId, fullName } });
});

const passwordLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 10,
  keyFn: (req) => `admin-pw:${req.ip}`,
  message: 'Too many attempts. Please wait 15 minutes and try again.',
});

// POST /api/admin/auth/password  { currentPassword, newPassword }
// Logs out other devices; this one gets a fresh session.
router.post('/password', requireAdmin, passwordLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const { rows } = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.admin.id]);
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Your current password is not correct.' });
    }
    if (!isValidPassword(newPassword)) return res.status(400).json({ error: PASSWORD_RULES_MESSAGE });
    if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a password different from the current one.' });

    const { rows: updated } = await pool.query(
      'UPDATE admin SET password_hash = $1, session_version = session_version + 1 WHERE id = $2 RETURNING session_version',
      [await bcrypt.hash(newPassword, 12), req.admin.id]
    );
    issueAdminSession(res, req.admin.id, updated[0].session_version);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
