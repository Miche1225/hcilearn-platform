// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/authGuard');

// TAMA: I-import ang sendLoginNotification function mula sa mailer.js
const { sendLoginNotification, sendSignupNotification } = require('../utils/mailer');

// At least 8 characters, and NOT made up of only one type of character
// (rejects all-digits like "12345678", all-lowercase like "abcdefgh", or
// all-uppercase like "ABCDEFGH"). A mix like "October062004" is allowed —
// no special character required.
function isValidPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false;
  if (/^[a-z]+$/.test(password)) return false;
  if (/^[A-Z]+$/.test(password)) return false;
  if (/^[0-9]+$/.test(password)) return false;
  return true;
}

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function issueSession(res, userId) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, COOKIE_OPTIONS);
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    yearSection: row.year_section,
    program: row.program,
    email: row.email,
    studentId: row.student_id,
    profilePhoto: row.profile_photo,
  };
}

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { fullName, yearSection, program, email, studentId, password } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email and password are required.' });
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and not all letters or all numbers.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const insert = await pool.query(
      `INSERT INTO users (full_name, year_section, program, email, student_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        fullName.trim(),
        yearSection ? yearSection.trim() : null,
        program ? program.trim() : null,
        normalizedEmail,
        studentId ? studentId.trim() : null,
        passwordHash,
      ]
    );

    const userId = insert.rows[0].id;

    // Set up empty progress rows so later lookups never have to guess.
    await pool.query('INSERT INTO case_study_progress (user_id) VALUES ($1)', [userId]);
    await pool.query('INSERT INTO study_card_progress (user_id) VALUES ($1)', [userId]);
    await pool.query('INSERT INTO lesson_progress (user_id) VALUES ($1)', [userId]);

    issueSession(res, userId);

    // ==========================================
    // EMAIL NOTIFICATION TRIGGER (SIGNUP)
    // ==========================================
    // Fire-and-forget: don't make the user wait for the email to send, and
    // never fail the signup itself if the email can't be sent.
    sendSignupNotification(normalizedEmail, fullName.trim());
    // ==========================================

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    issueSession(res, user.id);

    // ==========================================
    // EMAIL NOTIFICATION TRIGGER
    // ==========================================
    // Fire-and-forget: don't make the user wait for the email to send, and
    // never fail the login itself if the email can't be sent.
    sendLoginNotification(user.email, user.full_name);
    // ==========================================

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;