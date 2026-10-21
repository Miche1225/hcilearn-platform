// scripts/build-search-index.js
//
// Builds public/search-index.json for Quick Search from the content that is
// written into the pages (lesson topics, videos, case studies, study cards)
// plus the HCI glossary in scripts/glossary.json. Run it after changing any
// of that content:
//
//     npm run build:search
//
// "node scripts/build-search-index.js --check" only reports whether the
// index is up to date (used by npm test) and doesn't write anything.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'search-index.json');

const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8').replace(/\r\n/g, '\n');

const SNIPPET_LENGTH = 140;
const SEARCH_TEXT_LENGTH = 700;

// ---------- Helpers ----------
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function clip(text, length) {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return cut.slice(0, cut.lastIndexOf(' ') > length * 0.6 ? cut.lastIndexOf(' ') : length).trim() + '…';
}

const stripLetter = (option) => option.replace(/^[A-D][.)]\s*/, '');

// Finds "const NAME = <literal>" in a page script and evaluates the literal.
// The literals are plain data written in this project, so this is safe.
function extractLiteral(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${name}`);
  let i = start + marker.length;
  const open = source[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let quote = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) break;
  }
  return new Function(`return ${source.slice(start + marker.length, i + 1)};`)();
}

// ---------- Collect ----------
const items = [];

// Lesson topics (ReadLesson.html accordion items, numbered 1..N in page order)
const lessonHtml = read('ReadLesson.html');
const topicBlocks = lessonHtml.split('<div class="accordion-item">').slice(1);
const topics = topicBlocks.map((block, index) => {
  const buttonMatch = /<button class="accordion-button">([\s\S]*?)<\/button>/.exec(block);
  const title = htmlToText(buttonMatch ? buttonMatch[1] : '');
  const contentStart = block.indexOf('<div class="accordion-content">');
  const body = htmlToText(contentStart === -1 ? '' : block.slice(contentStart));
  return { number: index + 1, title, body };
});
for (const t of topics) {
  items.push({
    type: 'topic',
    title: t.title,
    meta: `Topic ${t.number}`,
    snippet: clip(t.body, SNIPPET_LENGTH),
    text: clip(t.body, SEARCH_TEXT_LENGTH),
    url: `ReadLesson.html#topic-${t.number}`,
  });
}

// Videos
const videoHtml = read('WatchVideo.html');
const videoTopics = extractLiteral(videoHtml, 'TOPICS');
extractLiteral(videoHtml, 'VIDEOS').forEach((v, index) => {
  items.push({
    type: 'video',
    title: v.title,
    meta: `Lesson ${index + 1} · ${videoTopics[v.topic] ? videoTopics[v.topic].label : 'Video'} · ${v.duration}`,
    snippet: '',
    text: videoTopics[v.topic] ? videoTopics[v.topic].label : '',
    url: `WatchVideo-Player.html?video=${encodeURIComponent(v.id)}&title=${encodeURIComponent(v.title)}`,
  });
});

// Case studies
const caseHtml = read('CaseStudies.html');
Object.entries(extractLiteral(caseHtml, 'scenariosData')).forEach(([id, s]) => {
  items.push({
    type: 'case',
    title: s.question,
    meta: `Scenario ${id}`,
    snippet: clip(s.text, SNIPPET_LENGTH),
    text: `${s.text} ${s.options.map(stripLetter).join(' ')}`,
    url: `CaseStudies.html#scenario-${id}`,
  });
});

// Study cards (each question links to its deck)
const cardHtml = read('StudyCards.html');
const lessonInfo = extractLiteral(cardHtml, 'LESSON_INFO');
Object.entries(extractLiteral(cardHtml, 'reviewerData')).forEach(([lesson, questions]) => {
  const deckTitle = lessonInfo[lesson] ? lessonInfo[lesson].title : `Lesson ${lesson}`;
  questions.forEach(q => {
    items.push({
      type: 'card',
      title: q.question,
      meta: `Study Cards · Lesson ${lesson}: ${deckTitle}`,
      snippet: '',
      text: `${deckTitle} ${q.options.map(stripLetter).join(' ')}`,
      url: `StudyCards.html#deck-${lesson}`,
    });
  });
});

// Glossary ("topic" = the lesson topic number it links to, if any)
const glossary = JSON.parse(fs.readFileSync(path.join(__dirname, 'glossary.json'), 'utf8'));
for (const g of glossary) {
  const topic = g.topic ? topics[g.topic - 1] : null;
  if (g.topic && !topic) throw new Error(`Glossary "${g.term}" points to missing topic ${g.topic}`);
  items.push({
    type: 'term',
    title: g.term,
    meta: topic ? `Glossary · see Topic ${topic.number}: ${topic.title}` : 'Glossary',
    snippet: g.definition,
    text: g.definition,
    url: topic ? `ReadLesson.html#topic-${topic.number}` : '',
  });
}

const output = JSON.stringify({ version: 1, items }) + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== output) {
    console.error('public/search-index.json is out of date. Run "npm run build:search" and commit the result.');
    process.exit(1);
  }
  console.log('public/search-index.json is up to date.');
} else {
  fs.writeFileSync(OUT, output);
  const counts = items.reduce((acc, item) => ({ ...acc, [item.type]: (acc[item.type] || 0) + 1 }), {});
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${(output.length / 1024).toFixed(1)} KB):`, counts);
}
