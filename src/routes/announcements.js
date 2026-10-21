// src/routes/announcements.js
// Active announcements from instructors, shown on the student Dashboard.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { todayLocal } = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

// GET /api/announcements — newest first; ones past their end date are hidden
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at, i.full_name AS instructor_name
       FROM announcements a LEFT JOIN instructors i ON i.id = a.instructor_id
       WHERE a.ends_on IS NULL OR a.ends_on >= $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 5`,
      [todayLocal()]
    );
    res.json({
      announcements: rows.map(r => ({
        id: r.id, title: r.title, body: r.body, createdAt: r.created_at, by: r.instructor_name || 'Your instructor',
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
