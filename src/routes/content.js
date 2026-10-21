// src/routes/content.js
// Published course content for the student pages, and the Quick Search index.
// Course material is not private (it used to be written into the pages), so
// these routes don't need a login.
const express = require('express');
const { getContent, VIDEO_TOPICS } = require('../contentStore');
const glossary = require('../glossary.json');

const router = express.Router();

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));

// GET /api/content/videos
router.get('/videos', async (req, res, next) => {
  try {
    const { videos } = await getContent();
    res.json({
      topics: VIDEO_TOPICS,
      videos: videos.map(v => pick(v, ['key', 'title', 'topic', 'duration'])),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/content/lessons
router.get('/lessons', async (req, res, next) => {
  try {
    const { modules } = await getContent();
    res.json({
      modules: modules.map(m => ({
        ...pick(m, ['key', 'title', 'icon']),
        topics: m.topics.map(t => pick(t, ['key', 'number', 'title', 'sections'])),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/content/case-studies
router.get('/case-studies', async (req, res, next) => {
  try {
    const { cases } = await getContent();
    res.json({ scenarios: cases.map(c => ({ ...pick(c, ['number', 'text', 'question', 'options', 'answer']), key: Number(c.key) })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/content/study-cards
router.get('/study-cards', async (req, res, next) => {
  try {
    const { decks } = await getContent();
    res.json({
      decks: decks.map(d => ({
        ...pick(d, ['number', 'title', 'icon', 'color']),
        key: Number(d.key),
        cards: d.cards.map(c => pick(c, ['key', 'question', 'options', 'answer'])),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Quick Search index ----------
const SNIPPET_LENGTH = 140;
const SEARCH_TEXT_LENGTH = 700;

// Lesson text format -> plain text
const plain = (body) => String(body || '')
  .replace(/^\s*[->]\s+/gm, '')
  .replace(/\\\*/g, '\u0001')
  .replace(/\*+/g, '')
  .replace(/\u0001/g, '*')
  .replace(/\s+/g, ' ')
  .trim();

function clip(text, length) {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(' ');
  return (space > length * 0.6 ? cut.slice(0, space) : cut).trim() + '…';
}

const indexCache = new WeakMap(); // catalog -> built index

function buildIndex(content) {
  const items = [];
  const topicLabels = new Map(VIDEO_TOPICS.map(t => [t.key, t.label]));

  for (const t of content.topics) {
    const body = t.sections.map(s => `${s.heading} ${plain(s.body)}`).join(' ').replace(/\s+/g, ' ').trim();
    items.push({
      type: 'topic', key: t.key, title: t.title, meta: `Topic ${t.number}`,
      snippet: clip(body, SNIPPET_LENGTH), text: clip(body, SEARCH_TEXT_LENGTH),
      url: `ReadLesson.html#topic-${t.key}`,
    });
  }

  content.videos.forEach((v, index) => {
    const label = topicLabels.get(v.topic) || 'Video';
    items.push({
      type: 'video', key: v.key, title: v.title,
      meta: `Lesson ${index + 1} · ${label}${v.duration ? ` · ${v.duration}` : ''}`,
      snippet: '', text: label,
      url: `WatchVideo-Player.html?video=${encodeURIComponent(v.key)}&title=${encodeURIComponent(v.title)}`,
    });
  });

  for (const c of content.cases) {
    items.push({
      type: 'case', key: String(c.key), title: c.question, meta: `Scenario ${c.number}`,
      snippet: clip(c.text, SNIPPET_LENGTH), text: `${c.text} ${c.options.join(' ')}`,
      url: `CaseStudies.html#scenario-${c.key}`,
    });
  }

  for (const d of content.decks) {
    for (const card of d.cards) {
      items.push({
        type: 'card', key: card.key, title: card.question,
        meta: `Study Cards · Lesson ${d.number}: ${d.title}`,
        snippet: '', text: `${d.title} ${card.options.join(' ')}`,
        url: `StudyCards.html#deck-${d.key}`,
      });
    }
  }

  // Glossary ("topic" = the lesson topic key it links to, if still published)
  for (const g of glossary) {
    const topic = g.topic ? content.topicByKey.get(String(g.topic)) : null;
    items.push({
      type: 'term', title: g.term,
      meta: topic ? `Glossary · see Topic ${topic.number}: ${topic.title}` : 'Glossary',
      snippet: g.definition, text: g.definition,
      url: topic ? `ReadLesson.html#topic-${topic.key}` : '',
    });
  }
  return { version: 2, items };
}

// GET /api/content/search-index
router.get('/search-index', async (req, res, next) => {
  try {
    const content = await getContent();
    if (!indexCache.has(content)) indexCache.set(content, buildIndex(content));
    res.json(indexCache.get(content));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
