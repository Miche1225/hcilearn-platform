// scripts/build-dark-css.js
//
// Builds public/dark.css (dark mode) from the light styles, so dark mode
// keeps working when style.css changes. Run it after editing style.css:
//
//     npm run build:dark
//
// "node scripts/build-dark-css.js --check" only reports whether dark.css is
// up to date (used by npm test / CI) and doesn't write anything.
//
// How it works: every rule that sets a colour is copied under
// :root[data-theme="dark"] with its colours flipped:
//   - light backgrounds / borders become dark surfaces (same hue)
//   - dark text becomes light text (same hue)
//   - vivid brand colours, dark hero banners and see-through glows stay as-is
// Hand-written fixes live in scripts/dark-manual.css and are added at the end.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'dark.css');

const PREFIX = ':root[data-theme="dark"]';
// Classes that api.js / theme.js put on <html> itself
const ROOT_CLASSES = ['sidebar-collapsed', 'menu-open', 'theme-switching'];

const TEXT_PROPS = new Set(['color', 'caret-color', 'fill', 'stroke', 'text-decoration-color', '-webkit-text-fill-color']);
// All background-* longhands too: re-emitting the "background" shorthand would
// otherwise reset background-clip/size/position set by the same rule.
const SURFACE_PROPS = /^(background(-[\w-]+)?|-webkit-background-clip|box-shadow|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|scrollbar-color|--[\w-]+)$/;

// ---------- Colour helpers ----------
const NAMED = { white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128] };

function parseColor(token) {
  token = token.toLowerCase();
  if (NAMED[token]) return { rgb: NAMED[token], a: 1 };
  if (token[0] === '#') {
    let h = token.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, a };
  }
  const m = /rgba?\(([^)]+)\)/.exec(token);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

// Plain greys get a hint of the theme's purple so dark mode feels on-brand
function fmt(h, s, l, a, tint = 0.14) {
  if (s < 0.05) { h = 250; s = tint; }
  const hsl = `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  return a < 1 ? `hsl(${hsl} / ${+a.toFixed(3)})` : `hsl(${hsl})`;
}

// Light surface -> dark surface. Returns null to keep the colour.
function darkSurface(c) {
  const [h, s, l] = rgbToHsl(c.rgb);
  if (c.a < 0.35) return null;                 // faint glows/overlays look fine on dark
  if (l <= 0.6) return null;                    // already dark or a brand colour
  if (s > 0.6 && l < 0.85) return null;         // vivid colour (yellow, mint, sky...)
  const nl = 0.17 + (1 - l) * 0.6;              // white -> 17%, light tints a bit lighter
  return fmt(h, Math.min(s, 0.45), nl, c.a);
}

// Dark text -> light text. Returns null to keep the colour.
function lightText(c) {
  const [h, s, l] = rgbToHsl(c.rgb);
  if (l >= 0.6) return null;
  const nl = 0.96 - l * 0.55;                   // #111 -> 93%, #666 -> 74%
  return fmt(h, Math.min(s, 0.75), nl, c.a, 0.12);
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|gray|grey)\b/g;
const hasColor = (value) => new RegExp(COLOR_RE.source).test(value);

// Replaces colours in a value, skipping url(...) parts.
function mapValue(value, fn) {
  let changed = false;
  const out = value.split(/(url\([^)]*\))/).map(part => {
    if (part.startsWith('url(')) return part;
    return part.replace(COLOR_RE, token => {
      const c = parseColor(token);
      if (!c) return token;
      const next = fn(c);
      if (next) { changed = true; return next; }
      return token;
    });
  }).join('');
  return changed ? out : null;
}

// ---------- Tiny CSS parser (enough for this project's stylesheet) ----------
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// End of a statement at-rule (@import ...;). Semicolons inside quotes or
// url(...) don't count, e.g. the font URL "...wght@400;600;700&display=swap".
function statementEnd(css, from) {
  let quote = null, depth = 0;
  for (let k = from; k < css.length; k++) {
    const ch = css[k];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) return k;
  }
  return -1;
}

function parseBlocks(css) {
  const nodes = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    // Statement at-rules like @import ...;
    if (css.slice(i, open).trim().startsWith('@')) {
      const semi = statementEnd(css, i);
      if (semi !== -1 && semi < open) {
        i = semi + 1;
        continue;
      }
    }
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      nodes.push({ type: 'at', prelude, children: parseBlocks(body) });
    } else if (!prelude.startsWith('@')) {
      nodes.push({ type: 'rule', selector: prelude, body });
    }
    i = j;
  }
  return nodes;
}

function splitDecls(body) {
  const decls = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ';' && depth === 0) || i === body.length) {
      const text = body.slice(start, i).trim();
      if (text) {
        const colon = text.indexOf(':');
        if (colon > 0) decls.push({ prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim() });
      }
      start = i + 1;
    }
  }
  return decls;
}

// Splits "a, b:is(c, d)" into ["a", "b:is(c, d)"] (commas inside brackets stay)
function splitSelectors(sel) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '(') depth++;
    else if (sel[i] === ')') depth--;
    else if (sel[i] === ',' && depth === 0) {
      parts.push(sel.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(sel.slice(start));
  return parts;
}

function prefixSelector(sel) {
  return splitSelectors(sel).map(s => {
    s = s.trim();
    if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, PREFIX);
    for (const cls of ROOT_CLASSES) {
      if (s.startsWith('.' + cls)) return PREFIX + s;
    }
    return `${PREFIX} ${s}`;
  }).join(',\n');
}

function convertRule(node) {
  const decls = splitDecls(node.body);
  const out = [];

  // If the rule keeps a vivid/dark background, its dark text must stay dark
  // (a bright literal colour, or a theme variable like var(--fun-sun)).
  const keepsColouredBg = decls.some(d => {
    if (!/^background(-color)?$/.test(d.prop) || mapValue(d.value, darkSurface)) return false;
    if (/var\(--fun-/.test(d.value)) return true;
    return (d.value.match(COLOR_RE) || []).some(t => { const c = parseColor(t); return c && c.a >= 0.35 && rgbToHsl(c.rgb)[2] > 0.45; });
  });

  // Every colour declaration is copied (changed or not) so the dark rules
  // cascade exactly like the light ones. Otherwise a flipped base rule
  // (".btn") would beat an unchanged state rule (".btn.active").
  for (const { prop, value } of decls) {
    let mapped = null;
    if (TEXT_PROPS.has(prop)) {
      if (!keepsColouredBg) mapped = mapValue(value, lightText);
    } else if (SURFACE_PROPS.test(prop)) {
      mapped = mapValue(value, darkSurface);
    } else {
      continue;
    }
    out.push(`    ${prop}: ${mapped || value};`);
  }
  if (!out.length) return '';
  return `${prefixSelector(node.selector)} {\n${out.join('\n')}\n}\n`;
}

function convert(nodes) {
  let css = '';
  for (const node of nodes) {
    if (node.type === 'rule') {
      css += convertRule(node);
    } else {
      const inner = convert(node.children);
      if (inner) css += `${node.prelude} {\n${inner.replace(/^/gm, '    ').trimEnd()}\n}\n`;
    }
  }
  return css;
}

// ---------- Build ----------
// Line endings are normalised so Windows and Linux checkouts give the same output
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const sources = [
  { name: 'style.css', css: read(path.join(PUBLIC, 'style.css')) },
];
// Page-level <style> blocks (e.g. update-password.html)
for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
  const html = read(path.join(PUBLIC, file));
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  if (blocks.length) sources.push({ name: file, css: blocks.join('\n') });
}

let output = `/* ==========================================================
   DARK MODE - generated by scripts/build-dark-css.js
   Do not edit by hand: change style.css or scripts/dark-manual.css,
   then run "npm run build:dark".
   ========================================================== */\n\n`;

for (const src of sources) {
  output += `/* ---------- from ${src.name} ---------- */\n`;
  output += convert(parseBlocks(stripComments(src.css))) + '\n';
}

output += '/* ---------- hand-written fixes (scripts/dark-manual.css) ---------- */\n';
output += read(path.join(__dirname, 'dark-manual.css'));

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? read(OUT) : '';
  if (current !== output) {
    console.error('public/dark.css is out of date. Run "npm run build:dark" and commit the result.');
    process.exit(1);
  }
  console.log('public/dark.css is up to date.');
} else {
  fs.writeFileSync(OUT, output);
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${(output.length / 1024).toFixed(1)} KB)`);
}
