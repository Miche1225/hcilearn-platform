// src/routes/bookmarks.js
// Saved lesson topics and videos, each with an optional personal note.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { getContent } = require('../contentStore');

const router = express.Router();
router.use(requireAuth);

const MAX_BOOKMARKS = 300;
const MAX_TITLE_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

function toClient(row) {
  return {
    id: row.id,
    kind: row.kind,
    itemKey: row.item_key,
    title: row.title,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Checks the item is published and returns its title (always taken from the
// server's content, never from the browser), or null if invalid.
async function resolveTitle(kind, itemKey) {
  if (typeof itemKey !== 'string') return null;
  const content = await getContent();
  if (kind === 'video') return content.videoTitles.get(itemKey) || null;
  if (kind === 'lesson') {
    const topic = content.topicByKey.get(itemKey);
    return topic ? topic.title.slice(0, MAX_TITLE_LENGTH) : null;
  }
  return null;
}

// GET /api/bookmarks
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bookmarks WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.userId]
    );
    res.json({ bookmarks: rows.map(toClient) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/bookmarks  { kind, itemKey, title, note? }
// Saves the item (or updates it). The note is only changed when sent.
router.put('/', async (req, res, next) => {
  try {
    const { kind, itemKey, note } = req.body || {};
    const finalTitle = await resolveTitle(kind, itemKey);
    if (!finalTitle) {
      return res.status(400).json({ error: 'Invalid item.' });
    }
    if (note !== undefined && typeof note !== 'string') {
      return res.status(400).json({ error: 'Invalid note.' });
    }
    if (typeof note === 'string' && note.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ error: `Notes can be up to ${MAX_NOTE_LENGTH} characters.` });
    }

    const existing = await pool.query(
      'SELECT id FROM bookmarks WHERE user_id = $1 AND kind = $2 AND item_key = $3',
      [req.userId, kind, itemKey]
    );
    if (!existing.rows[0]) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM bookmarks WHERE user_id = $1', [req.userId]);
      if (rows[0].n >= MAX_BOOKMARKS) {
        return res.status(400).json({ error: `You can save up to ${MAX_BOOKMARKS} items. Remove some first.` });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO bookmarks (user_id, kind, item_key, title, note)
       VALUES ($1, $2, $3, $4, COALESCE($5, ''))
       ON CONFLICT (user_id, kind, item_key)
       DO UPDATE SET title = EXCLUDED.title,
                     note = COALESCE($5, bookmarks.note),
                     updated_at = NOW()
       RETURNING *`,
      [req.userId, kind, itemKey, finalTitle, typeof note === 'string' ? note.trim() : null]
    );
    res.json({ bookmark: toClient(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/bookmarks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid bookmark.' });
    }
    await pool.query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2', [id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
