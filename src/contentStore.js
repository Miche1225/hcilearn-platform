// src/contentStore.js
// The published course content (videos, lessons, case studies, study cards),
// read from content_items and cached in memory. The cache is cleared when an
// instructor publishes, so students always get the latest published version.
const { pool } = require('./db');
const seed = require('./seed/content.json');

// Fixed video categories (labels + icon colour class)
const VIDEO_TOPICS = seed.videoTopics;

let cache = null;
let loading = null;

const byPosition = (a, b) => (a.position - b.position) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true });

// Turns content_items rows into ordered lists. field = 'published' or 'draft'.
function buildCatalog(rows, field = 'published') {
  const list = (kind) => rows
    .filter(r => r.kind === kind && r[field])
    .map(r => ({ ...r[field], key: r.key, parentKey: r.parent_key }))
    .sort(byPosition);

  const modules = list('module');
  const moduleKeys = new Set(modules.map(m => m.key));
  const allTopics = list('topic').filter(t => moduleKeys.has(t.parentKey));
  let topicNumber = 0;
  for (const m of modules) {
    m.topics = allTopics.filter(t => t.parentKey === m.key);
    m.topics.forEach(t => { t.number = ++topicNumber; });
  }
  const topics = modules.flatMap(m => m.topics);

  const videos = list('video');
  const cases = list('case');
  cases.forEach((c, i) => { c.number = i + 1; });

  const decks = list('deck');
  const deckKeys = new Set(decks.map(d => d.key));
  const allCards = list('card').filter(c => deckKeys.has(c.parentKey));
  decks.forEach((d, i) => {
    d.number = i + 1;
    d.cards = allCards.filter(c => c.parentKey === d.key);
  });
  const cards = decks.flatMap(d => d.cards);

  return {
    modules, topics, videos, cases, decks, cards,
    // Lookups used to validate progress / bookmarks
    videoTitles: new Map(videos.map(v => [v.key, v.title])),
    topicByKey: new Map(topics.map(t => [t.key, t])),
    caseByKey: new Map(cases.map(c => [Number(c.key), c])),
    deckByKey: new Map(decks.map(d => [Number(d.key), d])),
    cardKeys: new Set(cards.map(c => c.key)),
    caseOrder: cases.map(c => Number(c.key)),
    deckOrder: decks.map(d => Number(d.key)),
    totals: { caseStudies: cases.length, decks: decks.length, videos: videos.length, topics: topics.length },
  };
}

async function load() {
  const { rows } = await pool.query(
    'SELECT kind, key, parent_key, published FROM content_items WHERE published IS NOT NULL'
  );
  return buildCatalog(rows, 'published');
}

// The published catalog (cached)
async function getContent() {
  if (cache) return cache;
  if (!loading) {
    loading = load()
      .then(c => { cache = c; return c; })
      .finally(() => { loading = null; });
  }
  return loading;
}

function invalidate() {
  cache = null;
}

// Unlocking rule shared by Case Studies and Study Cards: everything already
// done, plus the first not-done item in order. (Same as before, but works
// when instructors add or reorder items.)
function unlockedKeys(order, doneList) {
  const done = new Set(doneList.map(Number));
  const unlocked = [];
  for (const key of order) {
    unlocked.push(key);
    if (!done.has(key)) break;
  }
  for (const key of order) {
    if (done.has(key) && !unlocked.includes(key)) unlocked.push(key);
  }
  return unlocked;
}

module.exports = { getContent, invalidate, buildCatalog, unlockedKeys, VIDEO_TOPICS };
