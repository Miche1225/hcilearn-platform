// src/middleware/instructorGuard.js
//
// Instructor sessions for the Admin Dashboard. Separate from student
// sessions: their own cookie, their own table (instructors), and a shorter
// lifetime. A student cookie can never open the admin pages, and an
// instructor cookie is never accepted as a student login.
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { JWT_SECRET, IS_PRODUCTION } = require('./authGuard');

const COOKIE_NAME = 'instructor_token';
const SESSION_HOURS = 8;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: SESSION_HOURS * 60 * 60 * 1000,
};

function issueInstructorSession(res, instructorRowId, sessionVersion = 0) {
  const token = jwt.sign(
    { kind: 'instructor', instructorId: instructorRowId, sv: sessionVersion },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` }
  );
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearInstructorSession(res) {
  const { maxAge, ...options } = COOKIE_OPTIONS;
  res.clearCookie(COOKIE_NAME, options);
}

// Sets req.instructor = { id, instructorId, fullName } or answers 401.
async function requireInstructor(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Instructor login required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  if (payload.kind !== 'instructor' || !Number.isInteger(payload.instructorId)) {
    return res.status(401).json({ error: 'Instructor login required.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, instructor_id, full_name, session_version FROM instructors WHERE id = $1',
      [payload.instructorId]
    );
    if (!rows[0] || rows[0].session_version !== (payload.sv || 0)) {
      clearInstructorSession(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.instructor = { id: rows[0].id, instructorId: rows[0].instructor_id, fullName: rows[0].full_name };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireInstructor, issueInstructorSession, clearInstructorSession };
