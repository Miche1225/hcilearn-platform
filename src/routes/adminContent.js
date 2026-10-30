// src/routes/adminContent.js
// Content editor for the main admin (mounted at /api/admin/content).
// Edits only change the draft; students see nothing until "Publish".
// Every publish / rollback is saved in content_versions (publish history).
//
// Item status (from draft vs published):
//   new       draft only (never published)
//   changed   both, different
//   deleted   published only (removed in the draft)
//   live      both, the same
const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/adminGuard');
const { invalidate, VIDEO_TOPICS } = require('../contentStore');
const versions = require('../contentVersions');

const router = express.Router();
// Content is shared by every student, so only the main admin edits it
router.use(requireAdmin);

const KINDS = ['video', 'module', 'topic', 'case', 'deck', 'card'];
const PARENT_KIND = { topic: 'module', card: 'deck' };
const CHILD_KIND = { module: 'topic', deck: 'card' };
const DECK_COLORS = ['video-icon', 'check-icon', 'book-icon', 'read-icon', 'case-icon'];

class InputError extends Error {}
const fail = (message) => { throw new InputError(message); };

// ---------- Validation ----------
function text(value, label, { max, required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) fail(`${label} is required.`);
  if (v.length > max) fail(`${label} can be up to ${max} characters.`);
  return v;
}

function icon(value, label = 'Icon', required = true) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v && !required) return '';
  if (!/^fa-[a-z0-9-]{1,40}$/.test(v)) fail(`${label} must be a Font Awesome name like "fa-book".`);
  return v;
}

function choices(data) {
  if (!Array.isArray(data.options) || data.options.length !== 4) fail('Give exactly 4 answer choices.');
  const options = data.options.map((o, i) => text(o, `Choice ${'ABCD'[i]}`, { max: 300 }));
  const answer = Number(data.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) fail('Pick the correct answer.');
  return { options, answer };
}

// Accepts an 11-character id or any usual YouTube link
function youtubeId(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  const m = /^[A-Za-z0-9_-]{11}$/.exec(v)
    || /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/.exec(v);
  if (!m) fail('Paste a YouTube link or video ID.');
  return m[1] || m[0];
}

// Returns the cleaned data for a kind (without position)
function validate(kind, data) {
  if (!data || typeof data !== 'object') fail('Missing data.');
  switch (kind) {
    case 'video': {
      const topic = String(data.topic || '');
      if (!VIDEO_TOPICS.some(t => t.key === topic)) fail('Pick a topic.');
      const duration = typeof data.duration === 'string' ? data.duration.trim() : '';
      if (duration && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(duration)) fail('Duration looks like 13:35 or 1:02:10.');
      return { title: text(data.title, 'Title', { max: 200 }), topic, duration };
    }
    case 'module':
      return { title: text(data.title, 'Title', { max: 120 }), icon: icon(data.icon) };
    case 'deck': {
      const color = String(data.color || '');
      if (!DECK_COLORS.includes(color)) fail('Pick a color.');
      return { title: text(data.title, 'Title', { max: 120 }), icon: icon(data.icon), color };
    }
    case 'topic': {
      if (!Array.isArray(data.sections) || !data.sections.length) fail('Add at least one section.');
      if (data.sections.length > 40) fail('A topic can have up to 40 sections.');
      const sections = data.sections.map((s, i) => ({
        icon: icon(s && s.icon, `Section ${i + 1} icon`, false),
        heading: text(s && s.heading, `Section ${i + 1} heading`, { max: 150, required: false }),
        body: text(s && s.body, `Section ${i + 1} text`, { max: 6000 }),
      }));
      return { title: text(data.title, 'Title', { max: 200 }), sections };
    }
    case 'case':
      return {
        text: text(data.text, 'Scenario', { max: 2000 }),
        question: text(data.question, 'Question', { max: 400 }),
        ...choices(data),
      };
    case 'card':
      return { question: text(data.question, 'Question', { max: 400 }), ...choices(data) };
    default:
      return fail('Unknown content type.');
  }
}

// ---------- Helpers ----------
const { canon } = versions;

function statusOf(row) {
  if (row.draft && !row.published) return 'new';
  if (!row.draft && row.published) return 'deleted';
  return canon(row.draft) === canon(row.published) ? 'live' : 'changed';
}

const toClient = (row) => ({
  id: row.id, kind: row.kind, key: row.key, parentKey: row.parent_key,
  draft: row.draft, published: row.published, status: statusOf(row),
});

async function getRow(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) fail('Invalid item.');
  const { rows } = await pool.query('SELECT * FROM content_items WHERE id = $1', [n]);
  if (!rows[0] || (!rows[0].draft && !rows[0].published)) fail('Item not found.');
  return rows[0];
}

async function audit(adminRowId, action, details) {
  await pool.query(
    'INSERT INTO admin_audit_log (admin_id, action, details) VALUES ($1, $2, $3)',
    [adminRowId, action, details]
  );
}

// New permanent key. Numbers are never reused (deleted items keep theirs).
async function newKey(kind, parentKey, data) {
  const { rows } = await pool.query('SELECT key FROM content_items WHERE kind = $1', [kind]);
  if (kind === 'video') return data.youtubeId;
  if (kind === 'card') {
    const prefix = `${parentKey}-`;
    const used = rows.map(r => r.key).filter(k => k.startsWith(prefix)).map(k => Number(k.slice(prefix.length)));
    return `${prefix}${used.length ? Math.max(...used) + 1 : 0}`;
  }
  const used = rows.map(r => Number(r.key)).filter(Number.isFinite);
  return String(used.length ? Math.max(...used) + 1 : 1);
}

async function nextPosition(kind, parentKey) {
  const { rows } = await pool.query(
    'SELECT draft FROM content_items WHERE kind = $1 AND draft IS NOT NULL AND (parent_key = $2 OR ($2::text IS NULL AND parent_key IS NULL))',
    [kind, parentKey]
  );
  return rows.reduce((max, r) => Math.max(max, Number(r.draft.position) || 0), 0) + 1;
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    next(err);
  }
};

// ---------- Routes ----------

// GET /api/admin/content — every item with its draft and published version
router.get('/', handle(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM content_items WHERE draft IS NOT NULL OR published IS NOT NULL ORDER BY id'
  );
  const items = rows.map(toClient);
  res.json({
    videoTopics: VIDEO_TOPICS,
    deckColors: DECK_COLORS,
    items,
    pending: items.filter(i => i.status !== 'live').length,
  });
}));

// POST /api/admin/content  { kind, parentKey?, data }
router.post('/', handle(async (req, res) => {
  const { kind, parentKey = null, data } = req.body || {};
  if (!KINDS.includes(kind)) fail('Unknown content type.');
  const clean = validate(kind, data);

  let parent = null;
  if (PARENT_KIND[kind]) {
    const { rows } = await pool.query(
      'SELECT key FROM content_items WHERE kind = $1 AND key = $2 AND draft IS NOT NULL',
      [PARENT_KIND[kind], String(parentKey)]
    );
    if (!rows[0]) fail(kind === 'topic' ? 'Pick a lesson for this topic.' : 'Pick a deck for this card.');
    parent = rows[0].key;
  }

  const extra = kind === 'video' ? { youtubeId: youtubeId(data.youtubeId) } : {};
  const key = await newKey(kind, parent, extra);
  const draft = { ...clean, position: await nextPosition(kind, parent) };

  const existing = (await pool.query('SELECT * FROM content_items WHERE kind = $1 AND key = $2', [kind, key])).rows[0];
  let row;
  if (existing) {
    // Only videos can collide (same YouTube video added again)
    if (existing.draft) fail('This video is already in the list.');
    row = (await pool.query(
      'UPDATE content_items SET draft = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *',
      [JSON.stringify(draft), existing.id]
    )).rows[0];
  } else {
    row = (await pool.query(
      'INSERT INTO content_items (kind, key, parent_key, draft) VALUES ($1, $2, $3, $4::jsonb) RETURNING *',
      [kind, key, parent, JSON.stringify(draft)]
    )).rows[0];
  }
  res.json({ item: toClient(row) });
}));

// PUT /api/admin/content/:id  { data }
router.put('/:id', handle(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row.draft) fail('Restore this item before editing it.');
  const draft = { ...validate(row.kind, (req.body || {}).data), position: row.draft.position };
  const updated = (await pool.query(
    'UPDATE content_items SET draft = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *',
    [JSON.stringify(draft), row.id]
  )).rows[0];
  res.json({ item: toClient(updated) });
}));

// DELETE /api/admin/content/:id — removes from the draft (lessons/decks take their topics/cards along)
router.delete('/:id', handle(async (req, res) => {
  const row = await getRow(req.params.id);
  const targets = [row];
  if (CHILD_KIND[row.kind]) {
    const { rows } = await pool.query('SELECT * FROM content_items WHERE kind = $1 AND parent_key = $2', [CHILD_KIND[row.kind], row.key]);
    targets.push(...rows);
  }
  for (const t of targets) {
    if (!t.published) await pool.query('DELETE FROM content_items WHERE id = $1', [t.id]); // never live: just drop it
    else await pool.query('UPDATE content_items SET draft = NULL, updated_at = NOW() WHERE id = $1', [t.id]);
  }
  res.json({ ok: true });
}));

// POST /api/admin/content/:id/restore — back to the published version
router.post('/:id/restore', handle(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row.published) fail('This item was never published, so there is nothing to go back to.');
  await pool.query('UPDATE content_items SET draft = published, updated_at = NOW() WHERE id = $1', [row.id]);
  // Restoring a lesson/deck brings back its removed topics/cards too
  if (CHILD_KIND[row.kind] && !row.draft) {
    await pool.query(
      'UPDATE content_items SET draft = published, updated_at = NOW() WHERE kind = $1 AND parent_key = $2 AND draft IS NULL AND published IS NOT NULL',
      [CHILD_KIND[row.kind], row.key]
    );
  }
  res.json({ ok: true });
}));

// POST /api/admin/content/reorder  { ids: [...] } — new order for items of one list
router.post('/reorder', handle(async (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000) fail('Invalid order.');
  const rows = [];
  for (const id of ids) rows.push(await getRow(id));
  const first = rows[0];
  if (rows.some(r => r.kind !== first.kind || r.parent_key !== first.parent_key || !r.draft)) {
    fail('Items must be from the same list.');
  }
  for (const [index, r] of rows.entries()) {
    await pool.query(
      'UPDATE content_items SET draft = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify({ ...r.draft, position: index + 1 }), r.id]
    );
  }
  res.json({ ok: true });
}));

// POST /api/admin/content/publish — make the draft live for students
router.post('/publish', handle(async (req, res) => {
  await versions.ensureBaseline(); // so there is a version to go back to
  const { rows } = await pool.query('SELECT * FROM content_items WHERE draft IS NOT NULL OR published IS NOT NULL');
  const pending = rows.filter(r => statusOf(r) !== 'live');
  if (!pending.length) return res.json({ published: 0 });
  const counts = pending.reduce((acc, r) => ({ ...acc, [statusOf(r)]: (acc[statusOf(r)] || 0) + 1 }), {});
  const summary = ['new', 'changed', 'deleted'].filter(k => counts[k]).map(k => `${counts[k]} ${k === 'new' ? 'added' : k === 'changed' ? 'edited' : 'removed'}`).join(', ');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of pending) {
      await client.query('UPDATE content_items SET published = draft, updated_at = NOW() WHERE id = $1', [r.id]);
    }
    await versions.saveVersion(client, req.admin.id, summary);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  invalidate();
  await audit(req.admin.id, 'publish_content', summary);
  res.json({ published: pending.length, summary });
}));

// POST /api/admin/content/discard — throw away all unpublished changes
router.post('/discard', handle(async (req, res) => {
  await pool.query('DELETE FROM content_items WHERE published IS NULL');
  const { rows } = await pool.query('SELECT * FROM content_items WHERE published IS NOT NULL');
  for (const r of rows.filter(row => statusOf(row) !== 'live')) {
    await pool.query('UPDATE content_items SET draft = published, updated_at = NOW() WHERE id = $1', [r.id]);
  }
  await audit(req.admin.id, 'discard_content', '');
  res.json({ ok: true });
}));

// ---------- Publish history ----------

// GET /api/admin/content/versions
router.get('/versions', handle(async (req, res) => {
  res.json({ versions: await versions.listVersions() });
}));

// GET /api/admin/content/versions/:id/preview — what a rollback would change
router.get('/versions/:id/preview', handle(async (req, res) => {
  const target = await versions.getSnapshot(req.params.id);
  if (!target) fail('Version not found.');
  const { rows } = await pool.query('SELECT * FROM content_items WHERE draft IS NOT NULL OR published IS NOT NULL');
  res.json({
    ...versions.diff(target, await versions.currentSnapshot()),
    pendingDrafts: rows.filter(r => statusOf(r) !== 'live').length,
  });
}));

// POST /api/admin/content/versions/:id/rollback — make that version live again
// (unpublished drafts are replaced). Saved as a new version, so it can be undone.
router.post('/versions/:id/rollback', handle(async (req, res) => {
  await versions.ensureBaseline();
  const id = Number(req.params.id);
  const target = await versions.getSnapshot(id);
  if (!target) fail('Version not found.');
  const wanted = new Map(target.map(i => [`${i.kind}:${i.key}`, i]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, kind, key FROM content_items');
    const existing = new Set();
    for (const r of rows) {
      const item = wanted.get(`${r.kind}:${r.key}`);
      existing.add(`${r.kind}:${r.key}`);
      await client.query(
        'UPDATE content_items SET draft = $1::jsonb, published = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [item ? JSON.stringify(item.data) : null, r.id]
      );
    }
    for (const [k, item] of wanted) {
      if (existing.has(k)) continue;
      await client.query(
        'INSERT INTO content_items (kind, key, parent_key, draft, published) VALUES ($1, $2, $3, $4::jsonb, $4::jsonb)',
        [item.kind, item.key, item.parentKey || null, JSON.stringify(item.data)]
      );
    }
    await versions.saveVersion(client, req.admin.id, `Rolled back to version #${id}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  invalidate();
  await audit(req.admin.id, 'rollback_content', `version #${id}`);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.validate = validate; // for tests
