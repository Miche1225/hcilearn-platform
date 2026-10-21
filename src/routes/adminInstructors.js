// src/routes/adminInstructors.js
// Instructor accounts, managed by the main admin (mounted at /api/admin/instructors).
// Roles: 'admin' sees and manages everything; 'instructor' sees only the
// sections assigned here. There is always at least one admin.
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireInstructor, requireAdminRole } = require('../middleware/instructorGuard');
const { isValidPassword, PASSWORD_RULES_MESSAGE } = require('../utils/passwords');

const router = express.Router();
router.use(requireInstructor, requireAdminRole);

class InputError extends Error {}
const fail = (message) => { throw new InputError(message); };
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    next(err);
  }
};

async function audit(instructorRowId, action, details) {
  await pool.query(
    'INSERT INTO instructor_audit_log (instructor_id, action, details) VALUES ($1, $2, $3)',
    [instructorRowId, action, details]
  );
}

function cleanName(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > 120) fail('Give the instructor\'s name (up to 120 characters).');
  return v;
}

function cleanRole(value) {
  if (value !== 'admin' && value !== 'instructor') fail('Pick a role.');
  return value;
}

function cleanSections(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) fail('Invalid sections.');
  const seen = new Set();
  return value.map(s => {
    const program = typeof (s && s.program) === 'string' ? s.program.trim() : '';
    const yearSection = typeof (s && s.yearSection) === 'string' ? s.yearSection.trim() : '';
    if (!program || !yearSection || program.length > 120 || yearSection.length > 120) fail('Each section needs a program and a year/section.');
    return { program, yearSection };
  }).filter(s => {
    const k = `${s.program}|${s.yearSection}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function setSections(db, instructorRowId, sections) {
  await db.query('DELETE FROM instructor_sections WHERE instructor_id = $1', [instructorRowId]);
  for (const s of sections) {
    await db.query(
      'INSERT INTO instructor_sections (instructor_id, program, year_section) VALUES ($1, $2, $3)',
      [instructorRowId, s.program, s.yearSection]
    );
  }
}

async function getInstructor(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) fail('Invalid instructor.');
  const { rows } = await pool.query('SELECT * FROM instructors WHERE id = $1', [n]);
  if (!rows[0]) fail('Instructor not found.');
  return rows[0];
}

async function adminCount() {
  return (await pool.query("SELECT COUNT(*)::int AS n FROM instructors WHERE role = 'admin'")).rows[0].n;
}

// GET /api/admin/instructors — instructors + the sections students are in
router.get('/', handle(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, instructor_id, full_name, role, created_at, last_login_at FROM instructors ORDER BY full_name'
  );
  const { rows: secRows } = await pool.query('SELECT instructor_id, program, year_section FROM instructor_sections ORDER BY program, year_section');
  const { rows: available } = await pool.query(
    `SELECT program, year_section, COUNT(*)::int AS students FROM users
     WHERE program IS NOT NULL AND year_section IS NOT NULL AND program <> '' AND year_section <> ''
     GROUP BY program, year_section ORDER BY program, year_section`
  );
  res.json({
    me: req.instructor.id,
    instructors: rows.map(r => ({
      id: r.id, instructorId: r.instructor_id, fullName: r.full_name, role: r.role,
      createdAt: r.created_at, lastLoginAt: r.last_login_at,
      sections: secRows.filter(s => s.instructor_id === r.id).map(s => ({ program: s.program, yearSection: s.year_section })),
    })),
    availableSections: available.map(a => ({ program: a.program, yearSection: a.year_section, students: a.students })),
  });
}));

// POST /api/admin/instructors  { instructorId, fullName, password, role, sections }
router.post('/', handle(async (req, res) => {
  const body = req.body || {};
  const instructorId = typeof body.instructorId === 'string' ? body.instructorId.trim() : '';
  if (!/^[A-Za-z0-9-]{3,40}$/.test(instructorId)) fail('Instructor ID: 3-40 letters, numbers or dashes.');
  const fullName = cleanName(body.fullName);
  const role = cleanRole(body.role || 'instructor');
  const sections = cleanSections(body.sections);
  if (!isValidPassword(body.password)) fail(PASSWORD_RULES_MESSAGE);

  const taken = await pool.query('SELECT 1 FROM instructors WHERE instructor_id = $1', [instructorId]);
  if (taken.rows.length) fail(`Instructor ID ${instructorId} is already used.`);

  const { rows } = await pool.query(
    'INSERT INTO instructors (instructor_id, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [instructorId, fullName, await bcrypt.hash(body.password, 12), role]
  );
  await setSections(pool, rows[0].id, sections);
  await audit(req.instructor.id, 'add_instructor', `${fullName} (ID ${instructorId}, ${role})`);
  res.json({ id: rows[0].id });
}));

// PUT /api/admin/instructors/:id  { fullName, role, sections }
router.put('/:id', handle(async (req, res) => {
  const target = await getInstructor(req.params.id);
  const body = req.body || {};
  const fullName = cleanName(body.fullName);
  const role = cleanRole(body.role);
  const sections = cleanSections(body.sections);
  if (target.role === 'admin' && role !== 'admin' && await adminCount() <= 1) {
    fail('There must be at least one main admin. Make someone else an admin first.');
  }

  await pool.query('UPDATE instructors SET full_name = $1, role = $2 WHERE id = $3', [fullName, role, target.id]);
  await setSections(pool, target.id, sections);
  await audit(req.instructor.id, 'update_instructor', `${fullName} (ID ${target.instructor_id}, ${role}, ${sections.length} section${sections.length === 1 ? '' : 's'})`);
  res.json({ ok: true });
}));

// POST /api/admin/instructors/:id/password  { password } — also logs them out everywhere
router.post('/:id/password', handle(async (req, res) => {
  const target = await getInstructor(req.params.id);
  const { password } = req.body || {};
  if (!isValidPassword(password)) fail(PASSWORD_RULES_MESSAGE);
  await pool.query(
    'UPDATE instructors SET password_hash = $1, session_version = session_version + 1 WHERE id = $2',
    [await bcrypt.hash(password, 12), target.id]
  );
  await audit(req.instructor.id, 'reset_instructor_password', `${target.full_name} (ID ${target.instructor_id})`);
  res.json({ ok: true });
}));

// DELETE /api/admin/instructors/:id
router.delete('/:id', handle(async (req, res) => {
  const target = await getInstructor(req.params.id);
  if (target.id === req.instructor.id) fail('You can\'t remove your own account.');
  if (target.role === 'admin' && await adminCount() <= 1) fail('There must be at least one main admin.');
  await pool.query('DELETE FROM instructors WHERE id = $1', [target.id]);
  await audit(req.instructor.id, 'remove_instructor', `${target.full_name} (ID ${target.instructor_id})`);
  res.json({ ok: true });
}));

module.exports = router;
