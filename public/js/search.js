// public/js/search.js
// Quick Search: one search box over lesson topics, videos, case studies,
// study cards and the HCI glossary. Opens from the "Search" menu item,
// Ctrl+K / Cmd+K, or "/" (when not typing in a field).
//
// The data comes from search-index.json (built by scripts/build-search-index.js).

(function () {
  'use strict';

  const INDEX_URL = 'search-index.json?v=1';
  const MAX_PER_GROUP = 6;

  const GROUPS = [
    { type: 'term',  label: 'Glossary',      icon: 'fa-spell-check' },
    { type: 'topic', label: 'Lesson topics', icon: 'fa-book-open' },
    { type: 'video', label: 'Videos',        icon: 'fa-play' },
    { type: 'case',  label: 'Case studies',  icon: 'fa-folder' },
    { type: 'card',  label: 'Study cards',   icon: 'fa-clone' },
  ];
  const SUGGESTIONS = ["Fitts' law", 'Personas', 'WCAG', 'Mental model', 'Prototyping', 'Gestalt'];

  let items = null;
  let loading = null;
  let overlay = null;
  let input = null;
  let resultsEl = null;
  let options = [];   // rendered result elements, for arrow-key navigation
  let active = -1;
  let previousFocus = null;

  // ---------- Data ----------
  const normalize = (text) => text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();

  function loadIndex() {
    if (!loading) {
      loading = fetch(INDEX_URL)
        .then(res => {
          if (!res.ok) throw new Error('Could not load search');
          return res.json();
        })
        .then(data => {
          items = data.items.map(item => ({
            ...item,
            nTitle: normalize(item.title),
            nText: normalize(`${item.meta} ${item.text}`),
          }));
        })
        .catch(err => {
          loading = null;
          throw err;
        });
    }
    return loading;
  }

  function score(item, query, words) {
    // Every word must appear somewhere
    for (const w of words) {
      if (!item.nTitle.includes(w) && !item.nText.includes(w)) return 0;
    }
    let s = 1;
    if (item.nTitle === query) s += 200;
    else if (item.nTitle.startsWith(query)) s += 80;
    else if (item.nTitle.includes(query)) s += 50;
    for (const w of words) {
      if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(item.nTitle)) s += 12;
      else if (item.nTitle.includes(w)) s += 6;
      else s += 1;
    }
    if (item.type === 'term') s += 10;   // definitions are the most direct answer
    return s;
  }

  function search(raw) {
    const query = normalize(raw);
    if (!query) return [];
    const words = query.split(' ').filter(Boolean);
    return items
      .map(item => ({ item, s: score(item, query, words) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s);
  }

  // ---------- Rendering ----------
  const escapeHtml = (text) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function highlight(text, raw) {
    const words = raw.trim().split(/\s+/).filter(w => w.length > 1)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const safe = escapeHtml(text);
    if (!words.length) return safe;
    return safe.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>');
  }

  function render() {
    const raw = input.value;
    options = [];
    active = -1;

    if (!items) {
      resultsEl.innerHTML = '<p class="qs-status"><span class="btn-spinner"></span> Loading...</p>';
      return;
    }

    if (!raw.trim()) {
      resultsEl.innerHTML = `
        <div class="qs-empty">
          <p>Search lesson topics, videos, case studies, study cards and HCI terms.</p>
          <div class="qs-suggestions">${SUGGESTIONS.map(s => `<button type="button" class="qs-chip">${escapeHtml(s)}</button>`).join('')}</div>
        </div>`;
      resultsEl.querySelectorAll('.qs-chip').forEach(chip => chip.addEventListener('click', () => {
        input.value = chip.textContent;
        render();
        input.focus();
      }));
      return;
    }

    const results = search(raw);
    if (!results.length) {
      resultsEl.innerHTML = `<p class="qs-status"><i class="fa-regular fa-face-meh"></i> No results for “${escapeHtml(raw.trim())}”. Try another word.</p>`;
      return;
    }

    resultsEl.innerHTML = '';
    for (const group of GROUPS) {
      const groupResults = results.filter(r => r.item.type === group.type).slice(0, MAX_PER_GROUP);
      if (!groupResults.length) continue;

      const section = document.createElement('div');
      section.className = 'qs-group';
      section.innerHTML = `<h4><i class="fa-solid ${group.icon}"></i> ${group.label}</h4>`;

      for (const { item } of groupResults) {
        const el = document.createElement(item.url ? 'a' : 'div');
        el.className = `qs-result qs-${item.type}`;
        el.id = `qs-option-${options.length}`;
        el.setAttribute('role', 'option');
        if (item.url) el.href = item.url;
        el.innerHTML = `
          <span class="qs-icon"><i class="fa-solid ${group.icon}"></i></span>
          <span class="qs-body">
            <strong>${highlight(item.title, raw)}</strong>
            ${item.snippet ? `<span class="qs-snippet">${highlight(item.snippet, raw)}</span>` : ''}
            <small>${escapeHtml(item.meta)}</small>
          </span>
          ${item.url ? '<i class="fa-solid fa-arrow-right qs-go"></i>' : ''}`;
        el.addEventListener('mousemove', () => setActive(options.indexOf(el)));
        el.addEventListener('click', () => close(false));
        section.appendChild(el);
        options.push(el);
      }
      resultsEl.appendChild(section);
    }
    setActive(0);
  }

  function setActive(index) {
    if (!options.length) return;
    active = (index + options.length) % options.length;
    options.forEach((el, i) => el.classList.toggle('is-active', i === active));
    input.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  }

  // ---------- Open / close ----------
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'qs-overlay';
    overlay.innerHTML = `
      <div class="qs-panel" role="dialog" aria-modal="true" aria-label="Quick search">
        <div class="qs-input-row">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" class="qs-input" placeholder="Search HCILearn..." autocomplete="off" spellcheck="false"
                 role="combobox" aria-expanded="true" aria-controls="qsResults" aria-autocomplete="list">
          <button type="button" class="qs-close" aria-label="Close search" title="Close (Esc)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="qs-results" id="qsResults" role="listbox"></div>
        <div class="qs-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> to search anytime</span>
        </div>
      </div>`;
    input = overlay.querySelector('.qs-input');
    resultsEl = overlay.querySelector('.qs-results');

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      if (e.key === 'Enter' && options[active] && options[active].href) {
        e.preventDefault();
        const href = options[active].href;
        close(false);
        window.location.href = href;
      }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(true); });
    overlay.querySelector('.qs-close').addEventListener('click', () => close(true));
    document.body.appendChild(overlay);
  }

  function open() {
    if (!overlay) build();
    if (overlay.classList.contains('is-open')) return;
    previousFocus = document.activeElement;
    document.documentElement.classList.remove('menu-open'); // close the phone menu
    overlay.classList.add('is-open');
    input.value = '';
    render();
    input.focus();
    loadIndex()
      .then(render)
      .catch(() => {
        resultsEl.innerHTML = '<p class="qs-status"><i class="fa-solid fa-circle-exclamation"></i> Could not load search. Please check your connection.</p>';
      });
  }

  function close(restoreFocus) {
    if (!overlay || !overlay.classList.contains('is-open')) return;
    overlay.classList.remove('is-open');
    if (restoreFocus && previousFocus && previousFocus.focus) previousFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && overlay && overlay.classList.contains('is-open')) {
      close(true);
    }
  });

  // "Search" item at the top of the sidebar menu
  function mount() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-item search-trigger';
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> <span class="nav-text">Search</span> <kbd class="nav-kbd">Ctrl K</kbd>';
    btn.title = 'Search (Ctrl+K)';
    btn.addEventListener('click', open);
    const first = nav.querySelector('.nav-item');
    nav.insertBefore(btn, first);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.HCISearch = { open };
})();
