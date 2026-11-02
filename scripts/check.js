// scripts/check.js
//
// Quick checks run by "npm test". No database or
// extra packages needed:
//   1. every .js file in the project parses
//   2. every inline <script> in public/*.html parses
//   3. public/dark.css is up to date with style.css

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads']);
let failures = 0;

function fail(message) {
  failures++;
  console.error(`  FAIL ${message}`);
}

function listFiles(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(path.join(dir, entry.name), ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// 1. JavaScript files
const jsFiles = listFiles(ROOT, '.js');
console.log(`Checking ${jsFiles.length} JavaScript files...`);
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${path.relative(ROOT, file)}\n${result.stderr}`);
}

// 2. Inline scripts in the pages (parsed only, never run)
const htmlFiles = listFiles(path.join(ROOT, 'public'), '.html');
let inlineCount = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    inlineCount++;
    try {
      new Function(match[1]); // eslint-disable-line no-new-func
    } catch (err) {
      fail(`${path.relative(ROOT, file)} inline script #${inlineCount}: ${err.message}`);
    }
  }
}
console.log(`Checked ${inlineCount} inline scripts in ${htmlFiles.length} pages.`);

// 3. Generated dark mode CSS is up to date
for (const script of ['build-dark-css.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), '--check'], { encoding: 'utf8' });
  if (result.status !== 0) fail(result.stderr.trim() || `${script} --check failed`);
  else console.log(result.stdout.trim());
}

// 4. Streak maths (dates.js has no database, so it can run here)
const { addDays, computeStreaks } = require('../src/utils/dates');
const expect = (label, actual, wanted) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)}`);
};
expect('addDays across a month end', addDays('2026-02-27', 2), '2026-03-01');
expect('addDays across a year end', addDays('2026-12-31', 1), '2027-01-01');
expect('streak still alive before studying today',
  computeStreaks(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-02'),
  { current: 3, longest: 3, activeToday: false });
expect('streak broken by a missed day',
  computeStreaks(['2026-03-05', '2026-03-03', '2026-03-02'], '2026-03-05'),
  { current: 1, longest: 2, activeToday: true });
expect('no study days', computeStreaks([], '2026-03-05'), { current: 0, longest: 0, activeToday: false });
console.log('Checked the streak maths.');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
