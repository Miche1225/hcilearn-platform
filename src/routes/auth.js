// src/routes/auth.js
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/authGuard');

const {
  sendSignupNotification,
  sendLoginNotification,
  sendPasswordResetEmail,
  sendPasswordChangedNotification,
} = require('../utils/mailer');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_MINUTES = 30;
const RESET_COOLDOWN_SECONDS = 60;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Base URL used inside the reset email. Set APP_URL in production
// (e.g. https://hcilearn-platform.onrender.com); falls back to the request host.
function getBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

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

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

    // Fire-and-forget: tell the person (at their real inbox) that this email
    // was just used to sign up. Never blocks or fails the signup itself.
    sendSignupNotification(rows[0].email, rows[0].full_name);

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

// POST /api/auth/forgot-password  { email }
// Always answers with the same message whether or not the email exists, so
// nobody can use this form to find out who has an account.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const generic = {
      ok: true,
      message: 'If that email is registered, a password reset link has been sent. Please check your inbox (and spam folder).',
    };

    const { rows } = await pool.query(
      'SELECT id, full_name, email FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];
    if (!user) return res.json(generic);

    // Simple anti-spam: one reset email per account per minute.
    const recent = await pool.query(
      `SELECT 1 FROM password_resets
       WHERE user_id = $1 AND created_at > NOW() - ($2 || ' seconds')::interval`,
      [user.id, String(RESET_COOLDOWN_SECONDS)]
    );
    if (recent.rows.length > 0) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');

    // Only the newest link works: clear older ones, store the hash of the new one.
    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [user.id, sha256(token), String(RESET_TOKEN_MINUTES)]
    );

    const link = `${getBaseUrl(req)}/update-password.html?token=${token}`;

    // Fire-and-forget (also keeps response time identical for unknown emails).
    sendPasswordResetEmail(user.email, user.full_name, link, RESET_TOKEN_MINUTES);

    res.json(generic);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Reset link is missing or invalid. Please request a new one.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and not all letters or all numbers.',
      });
    }

    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.full_name, u.email
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = $1 AND pr.expires_at > NOW()`,
      [sha256(token)]
    );
    const match = rows[0];
    if (!match) {
      return res.status(400).json({
        error: 'This reset link is invalid or has expired. Please request a new one.',
      });
    }

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      bcrypt.hashSync(password, 10),
      match.user_id,
    ]);
    // The link is single-use: remove every outstanding token for this user.
    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [match.user_id]);

    // Let the owner know their password changed.
    sendPasswordChangedNotification(match.email, match.full_name);

    res.json({ ok: true, message: 'Password updated. You can now log in.' });
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