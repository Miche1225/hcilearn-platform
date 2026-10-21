// src/routes/instructor.js
// Instructor login / logout for the Admin Dashboard (Instructor ID + password).
// Accounts are created with "npm run instructor -- add" (scripts/instructor.js).
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { rateLimit } = require('../middleware/rateLimit');
const {
  requireInstructor,
  issueInstructorSession,
  clearInstructorSession,
} = require('../middleware/instructorGuard');

const router = express.Router();
const MINUTE = 60 * 1000;

// Same reply time whether or not the ID exists
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const loginLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 8,
  keyFn: (req) => `instructor:${req.ip}:${String((req.body && req.body.instructorId) || '').trim()}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

const loginIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 30,
  keyFn: (req) => `instructor-ip:${req.ip}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

const publicInstructor = (row) => ({ instructorId: row.instructor_id, fullName: row.full_name });

// POST /api/instructor/login  { instructorId, password }
router.post('/login', loginIpLimiter, loginLimiter, async (req, res, next) => {
  try {
    const { instructorId, password } = req.body || {};
    const id = typeof instructorId === 'string' ? instructorId.trim() : '';
    if (!id || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Instructor ID and password are required.' });
    }

    const { rows } = await pool.query('SELECT * FROM instructors WHERE instructor_id = $1', [id]);
    const instructor = rows[0];
    const passwordOk = await bcrypt.compare(password, instructor ? instructor.password_hash : DUMMY_PASSWORD_HASH);
    if (!instructor || !passwordOk) {
      return res.status(401).json({ error: 'Invalid instructor ID or password.' });
    }

    await pool.query('UPDATE instructors SET last_login_at = NOW() WHERE id = $1', [instructor.id]);
    issueInstructorSession(res, instructor.id, instructor.session_version);
    res.json({ instructor: publicInstructor(instructor) });
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/logout
router.post('/logout', (req, res) => {
  clearInstructorSession(res);
  res.json({ ok: true });
});

// GET /api/instructor/me
router.get('/me', requireInstructor, (req, res) => {
  res.json({ instructor: { instructorId: req.instructor.instructorId, fullName: req.instructor.fullName } });
});

module.exports = router;
