// src/contentVersions.js
// Publish history: a snapshot of the published content after every publish
// or rollback, so the admin can go back to an earlier version.
const { pool } = require('./db');

const KEEP_VERSIONS = 60; // older snapshots are pruned

// JSON compare that ignores key order
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : JSON.stringify(v);

const itemId = (i) => `${i.kind}:${i.key}`;

// Everything students see right now
async function currentSnapshot(db = pool) {
  const { rows } = await db.query(
    'SELECT kind, key, parent_key, published FROM content_items WHERE published IS NOT NULL ORDER BY kind, key'
  );
  return rows.map(r => ({ kind: r.kind, key: r.key, parentKey: r.parent_key, data: r.published }));
}

async function saveVersion(db, instructorId, summary) {
  const snapshot = await currentSnapshot(db);
  const { rows } = await db.query(
    'INSERT INTO content_versions (instructor_id, summary, snapshot, item_count) VALUES ($1, $2, $3::jsonb, $4) RETURNING id',
    [instructorId, summary, JSON.stringify(snapshot), snapshot.length]
  );
  const { rows: old } = await db.query('SELECT id FROM content_versions ORDER BY id DESC OFFSET $1', [KEEP_VERSIONS]);
  for (const r of old) await db.query('DELETE FROM content_versions WHERE id = $1', [r.id]);
  return rows[0].id;
}

// The first time history is used, remember the content as it is now
async function ensureBaseline(db = pool) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM content_versions');
  if (rows[0].n > 0) return;
  const { rows: live } = await db.query('SELECT COUNT(*)::int AS n FROM content_items WHERE published IS NOT NULL');
  if (live[0].n > 0) await saveVersion(db, null, 'Starting content');
}

async function listVersions() {
  await ensureBaseline();
  const { rows } = await pool.query(
    `SELECT v.id, v.summary, v.item_count, v.created_at, i.full_name AS instructor_name
     FROM content_versions v LEFT JOIN instructors i ON i.id = v.instructor_id
     ORDER BY v.id DESC`
  );
  return rows.map((r, index) => ({
    id: r.id, summary: r.summary, itemCount: r.item_count, createdAt: r.created_at,
    by: r.instructor_name || (r.summary === 'Starting content' ? 'System' : '(removed instructor)'),
    isCurrent: index === 0,
  }));
}

async function getSnapshot(id, db = pool) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const { rows } = await db.query('SELECT snapshot FROM content_versions WHERE id = $1', [n]);
  return rows[0] ? rows[0].snapshot : null;
}

// What going back to `target` would do to what students see now
function diff(target, current) {
  const now = new Map(current.map(i => [itemId(i), i]));
  const then = new Map(target.map(i => [itemId(i), i]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, item] of then) {
    if (!now.has(id)) added++;
    else if (canon(now.get(id).data) !== canon(item.data)) changed++;
  }
  for (const id of now.keys()) if (!then.has(id)) removed++;
  return { added, removed, changed };
}

module.exports = { canon, currentSnapshot, saveVersion, ensureBaseline, listVersions, getSnapshot, diff };
