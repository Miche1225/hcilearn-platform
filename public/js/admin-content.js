// public/js/admin-content.js
// "Content" tab of the Admin Dashboard: edit videos, lessons, case studies
// and study cards. Every change is a draft until "Publish" (needs js/api.js,
// js/richtext.js and confirmDialog from api.js).

const HCIContentEditor = (function () {
  'use strict';

  const TABS = [
    { id: 'video',  label: 'Videos',        icon: 'fa-play' },
    { id: 'lesson', label: 'Lessons',       icon: 'fa-book' },
    { id: 'case',   label: 'Case studies',  icon: 'fa-folder' },
    { id: 'deck',   label: 'Study cards',   icon: 'fa-clone' },
  ];
  const STATUS_LABEL = { new: 'New', changed: 'Edited', deleted: 'Removed' };
  const ICON_IDEAS = ['fa-book-open', 'fa-lightbulb', 'fa-brain', 'fa-users', 'fa-eye', 'fa-hand-pointer', 'fa-pen-ruler',
    'fa-universal-access', 'fa-scale-balanced', 'fa-face-smile', 'fa-robot', 'fa-vr-cardboard', 'fa-house-signal',
    'fa-desktop', 'fa-magnifying-glass', 'fa-bullseye', 'fa-layer-group', 'fa-shield-halved', 'fa-chart-line', 'fa-star'];

  let root = null;
  let data = { items: [], videoTopics: [], deckColors: [], pending: 0 };
  let tab = 'video';
  const open = new Set();          // expanded lessons / decks (keys)
  let onPendingChange = () => {};

  const esc = (t) => HCIRichText.escapeHtml(t == null ? '' : t);
  const view = (item) => item.draft || item.published;
  const byPos = (a, b) => (view(a).position - view(b).position) || a.id - b.id;
  const ofKind = (kind, parentKey) => data.items
    .filter(i => i.kind === kind && (parentKey === undefined || i.parentKey === parentKey))
    .sort(byPos);

  // ---------- Loading ----------
  async function load() {
    data = await api.get('/admin/content');
    onPendingChange(data.pending);
    render();
  }

  async function run(promise, okMessage) {
    try {
      await promise;
      if (okMessage) toast(okMessage);
    } catch (err) {
      toast(err.message, true);
    }
    await load();
  }

  function toast(message, isError) {
    const el = document.createElement('div');
    el.className = 'hci-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<i class="fa-solid ${isError ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i> <span></span>`;
    el.querySelector('span').textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-open'));
    setTimeout(() => { el.classList.remove('is-open'); setTimeout(() => el.remove(), 300); }, 2600);
  }

  // ---------- Rendering ----------
  function render() {
    const counts = {
      video: ofKind('video').filter(i => i.status !== 'live').length,
      lesson: data.items.filter(i => (i.kind === 'module' || i.kind === 'topic') && i.status !== 'live').length,
      case: ofKind('case').filter(i => i.status !== 'live').length,
      deck: data.items.filter(i => (i.kind === 'deck' || i.kind === 'card') && i.status !== 'live').length,
    };
    root.innerHTML = `
      <div class="ce-bar${data.pending ? ' has-changes' : ''}">
        <span class="ce-bar-text">${data.pending
          ? `<i class="fa-solid fa-pen-to-square"></i> <b>${data.pending}</b> unpublished change${data.pending === 1 ? '' : 's'}. Students won't see ${data.pending === 1 ? 'it' : 'them'} until you publish.`
          : '<i class="fa-solid fa-circle-check"></i> Everything is published. Students see exactly what is listed here.'}</span>
        <span class="ce-bar-actions">
          <button type="button" class="tool-btn" data-act="history"><i class="fa-solid fa-clock-rotate-left"></i> History</button>
          <button type="button" class="tool-btn" data-act="discard" ${data.pending ? '' : 'disabled'}><i class="fa-solid fa-rotate-left"></i> Discard changes</button>
          <button type="button" class="tool-btn ce-publish" data-act="publish" ${data.pending ? '' : 'disabled'}><i class="fa-solid fa-upload"></i> Publish</button>
        </span>
      </div>
      <div class="ce-tabs" role="tablist">
        ${TABS.map(t => `<button type="button" role="tab" class="ce-tab${t.id === tab ? ' active' : ''}" aria-selected="${t.id === tab}" data-tab="${t.id}">
          <i class="fa-solid ${t.icon}"></i> ${t.label}${counts[t.id] ? ` <span class="ce-dot">${counts[t.id]}</span>` : ''}</button>`).join('')}
      </div>
      <div class="ce-list">${tab === 'video' ? renderVideos() : tab === 'lesson' ? renderGroups('module', 'topic') : tab === 'case' ? renderCases() : renderGroups('deck', 'card')}</div>`;
  }

  function chip(item) {
    return STATUS_LABEL[item.status] ? `<span class="ce-chip is-${item.status}">${STATUS_LABEL[item.status]}</span>` : '';
  }

  function actions(item, siblings) {
    if (item.status === 'deleted') {
      return `<button type="button" class="ce-btn" data-act="restore" data-id="${item.id}"><i class="fa-solid fa-rotate-left"></i> Restore</button>`;
    }
    const live = siblings.filter(s => s.draft);
    const i = live.indexOf(item);
    return `
      <button type="button" class="ce-icon-btn" data-act="up" data-id="${item.id}" ${i <= 0 ? 'disabled' : ''} aria-label="Move up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" class="ce-icon-btn" data-act="down" data-id="${item.id}" ${i === live.length - 1 ? 'disabled' : ''} aria-label="Move down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
      ${item.status === 'changed' ? `<button type="button" class="ce-btn" data-act="restore" data-id="${item.id}" title="Go back to the published version"><i class="fa-solid fa-rotate-left"></i> Undo</button>` : ''}
      <button type="button" class="ce-btn" data-act="edit" data-id="${item.id}"><i class="fa-solid fa-pen"></i> Edit</button>
      <button type="button" class="ce-icon-btn is-danger" data-act="delete" data-id="${item.id}" aria-label="Remove" title="Remove"><i class="fa-solid fa-trash-can"></i></button>`;
  }

  function row(item, siblings, number, title, meta, extra = '') {
    return `<div class="ce-row is-${item.status}">
      <span class="ce-num">${number}</span>
      ${extra}
      <span class="ce-main"><strong>${esc(title)}</strong>${meta ? `<small>${meta}</small>` : ''}</span>
      ${chip(item)}
      <span class="ce-actions">${actions(item, siblings)}</span>
    </div>`;
  }

  const numberer = () => { let n = 0; return (item) => (item.draft ? ++n : '–'); };

  function renderVideos() {
    const list = ofKind('video');
    const next = numberer();
    const topics = new Map(data.videoTopics.map(t => [t.key, t.label]));
    return `<button type="button" class="tool-btn ce-add" data-act="add" data-kind="video"><i class="fa-solid fa-plus"></i> Add video</button>
      ${list.map(v => row(v, list, next(v), view(v).title,
        `${esc(topics.get(view(v).topic) || '')}${view(v).duration ? ` · ${esc(view(v).duration)}` : ''} · ${esc(v.key)}`,
        `<img class="ce-thumb" src="https://img.youtube.com/vi/${encodeURIComponent(v.key)}/default.jpg" alt="" loading="lazy">`)).join('')}`;
  }

  function renderCases() {
    const list = ofKind('case');
    const next = numberer();
    return `<button type="button" class="tool-btn ce-add" data-act="add" data-kind="case"><i class="fa-solid fa-plus"></i> Add case study</button>
      ${list.map(c => row(c, list, next(c), view(c).question, esc(view(c).text.slice(0, 120)) + (view(c).text.length > 120 ? '…' : ''))).join('')}`;
  }

  function renderGroups(groupKind, childKind) {
    const groups = ofKind(groupKind);
    const next = numberer();
    const addLabel = groupKind === 'module' ? 'Add lesson' : 'Add deck';
    const childLabel = childKind === 'topic' ? 'topic' : 'card';
    return `<button type="button" class="tool-btn ce-add" data-act="add" data-kind="${groupKind}"><i class="fa-solid fa-plus"></i> ${addLabel}</button>
      ${groups.map(g => {
        const children = ofKind(childKind, g.key);
        const isOpen = open.has(`${groupKind}:${g.key}`);
        const nextChild = numberer();
        const liveCount = children.filter(c => c.draft).length;
        return `<div class="ce-group${isOpen ? ' is-open' : ''}">
          ${row(g, groups, next(g), view(g).title, `${liveCount} ${childLabel}${liveCount === 1 ? '' : 's'}`,
            `<button type="button" class="ce-toggle" data-act="toggle" data-group="${groupKind}:${esc(g.key)}" aria-expanded="${isOpen}" aria-label="Show ${childLabel}s"><i class="fa-solid fa-chevron-right"></i></button>
             <span class="ce-group-icon"><i class="fa-solid ${HCIRichText.safeIcon(view(g).icon)}"></i></span>`)}
          ${isOpen ? `<div class="ce-children">
            ${g.draft ? `<button type="button" class="tool-btn ce-add is-small" data-act="add" data-kind="${childKind}" data-parent="${esc(g.key)}"><i class="fa-solid fa-plus"></i> Add ${childLabel}</button>` : ''}
            ${children.map(c => row(c, children, nextChild(c),
              childKind === 'topic' ? view(c).title : view(c).question,
              childKind === 'topic' ? `${view(c).sections.length} section${view(c).sections.length === 1 ? '' : 's'}` : esc(`Answer: ${view(c).options[view(c).answer]}`))).join('') || '<p class="admin-empty">Nothing here yet.</p>'}
          </div>` : ''}
        </div>`;
      }).join('')}`;
  }

  // ---------- Actions ----------
  async function handleClick(e) {
    const tabBtn = e.target.closest('.ce-tab');
    if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const item = data.items.find(i => i.id === Number(btn.dataset.id));

    if (act === 'toggle') {
      const key = btn.dataset.group;
      open.has(key) ? open.delete(key) : open.add(key);
      render();
      return;
    }
    if (act === 'add') return openEditor({ kind: btn.dataset.kind, parentKey: btn.dataset.parent || null });
    if (act === 'edit') return openEditor({ item });
    if (act === 'restore') return run(api.post(`/admin/content/${item.id}/restore`), 'Restored');
    if (act === 'up' || act === 'down') {
      const siblings = ofKind(item.kind, ['topic', 'card'].includes(item.kind) ? item.parentKey : undefined).filter(s => s.draft);
      const i = siblings.indexOf(item);
      const j = act === 'up' ? i - 1 : i + 1;
      [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
      return run(api.post('/admin/content/reorder', { ids: siblings.map(s => s.id) }));
    }
    if (act === 'delete') {
      const hasChildren = item.kind === 'module' || item.kind === 'deck';
      return confirmDialog({
        title: 'Remove this item?',
        message: `${hasChildren ? `Its ${item.kind === 'module' ? 'topics' : 'cards'} will be removed too. ` : ''}Students keep seeing it until you publish, and you can restore it before then.`,
        confirmText: 'Remove', icon: 'fa-trash-can', danger: true,
        onConfirm: () => run(api.del(`/admin/content/${item.id}`), 'Removed (not published yet)'),
      });
    }
    if (act === 'publish') {
      return confirmDialog({
        title: `Publish ${data.pending} change${data.pending === 1 ? '' : 's'}?`,
        message: 'Students will see the new content right away. Their progress on items you kept is not affected.',
        confirmText: 'Publish', icon: 'fa-upload',
        onConfirm: async () => {
          try {
            const r = await api.post('/admin/content/publish');
            toast(`Published: ${r.summary}`);
          } catch (err) { toast(err.message, true); }
          await load();
        },
      });
    }
    if (act === 'history') return openHistory();
    if (act === 'discard') {
      return confirmDialog({
        title: 'Discard all changes?',
        message: 'Every unpublished edit, addition and removal will be thrown away. This cannot be undone.',
        confirmText: 'Discard', icon: 'fa-rotate-left', danger: true,
        onConfirm: () => run(api.post('/admin/content/discard'), 'Changes discarded'),
      });
    }
  }

  // ---------- Publish history ----------
  async function openHistory() {
    const overlay = document.createElement('div');
    overlay.className = 'ce-overlay';
    overlay.innerHTML = `
      <div class="ce-modal" role="dialog" aria-modal="true" aria-labelledby="ceHistoryTitle">
        <div class="ce-modal-head">
          <div><h3 id="ceHistoryTitle">Publish history</h3><small>Every publish is saved. Roll back to make an older version live again.</small></div>
          <button type="button" class="qs-close" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ce-history"><p class="admin-loading"><span class="btn-spinner"></span> Loading...</p></div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    const close = () => {
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 200);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });

    const list = overlay.querySelector('.ce-history');
    try {
      const { versions } = await api.get('/admin/content/versions');
      list.innerHTML = versions.map(v => `
        <div class="ce-version${v.isCurrent ? ' is-current' : ''}">
          <span class="ce-version-num">#${v.id}</span>
          <span class="ce-main"><strong>${esc(v.summary || 'Published')}</strong>
            <small>${esc(v.by)} · ${new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${v.itemCount} items</small></span>
          ${v.isCurrent ? '<span class="ce-chip is-new">Live now</span>' : `<button type="button" class="ce-btn" data-rollback="${v.id}"><i class="fa-solid fa-clock-rotate-left"></i> Roll back</button>`}
        </div>`).join('');
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
    }

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-rollback]');
      if (!btn) return;
      const id = btn.dataset.rollback;
      let preview;
      try { preview = await api.get(`/admin/content/versions/${id}/preview`); }
      catch (err) { toast(err.message, true); return; }
      const parts = [
        preview.added && `${preview.added} item${preview.added === 1 ? '' : 's'} come back`,
        preview.removed && `${preview.removed} item${preview.removed === 1 ? '' : 's'} disappear`,
        preview.changed && `${preview.changed} item${preview.changed === 1 ? '' : 's'} change back`,
      ].filter(Boolean);
      close();
      confirmDialog({
        title: `Roll back to version #${id}?`,
        message: `${parts.length ? `Students will see: ${parts.join(', ')}.` : 'This version has the same content as now.'}${preview.pendingDrafts ? ` Your ${preview.pendingDrafts} unpublished change${preview.pendingDrafts === 1 ? '' : 's'} will be discarded.` : ''} You can roll forward again from the history.`,
        confirmText: 'Roll back', icon: 'fa-clock-rotate-left', danger: true,
        onConfirm: () => run(api.post(`/admin/content/versions/${id}/rollback`), `Rolled back to version #${id}`),
      });
    });
  }

  // ---------- Editor ----------
  const field = (label, input, hint = '') => `<label class="ce-field"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
  const inputBox = (name, value, attrs = '') => `<input type="text" name="${name}" value="${esc(value)}" ${attrs}>`;
  const textBox = (name, value, rows = 3, attrs = '') => `<textarea name="${name}" rows="${rows}" ${attrs}>${esc(value)}</textarea>`;
  const iconBox = (name, value) => `<span class="ce-icon-input"><i class="fa-solid ${HCIRichText.safeIcon(value)}"></i>${inputBox(name, value, 'placeholder="fa-book-open" list="ceIconIdeas"')}</span>`;

  function choiceFields(d) {
    return `<fieldset class="ce-choices"><legend>Answer choices <small>(pick the correct one)</small></legend>
      ${[0, 1, 2, 3].map(i => `<label class="ce-choice">
        <input type="radio" name="answer" value="${i}" ${d.answer === i ? 'checked' : ''} aria-label="Choice ${'ABCD'[i]} is correct">
        <b>${'ABCD'[i]}</b>${inputBox(`option${i}`, (d.options || [])[i] || '', `aria-label="Choice ${'ABCD'[i]}"`)}</label>`).join('')}
    </fieldset>`;
  }

  const SECTION_HELP = 'Blank line = new paragraph · "- " = bullet · "> " = example note · **bold** · *italic*';

  function sectionEditor(s, i) {
    return `<div class="ce-section" data-index="${i}">
      <div class="ce-section-head">
        <b>Section ${i + 1}</b>
        <span>
          <button type="button" class="ce-icon-btn" data-sec="up" aria-label="Move section up"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" class="ce-icon-btn" data-sec="down" aria-label="Move section down"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" class="ce-icon-btn is-danger" data-sec="remove" aria-label="Remove section"><i class="fa-solid fa-trash-can"></i></button>
        </span>
      </div>
      <div class="ce-row2">
        ${field('Icon', iconBox('s_icon', s.icon))}
        ${field('Heading <small>(leave empty for plain text)</small>', inputBox('s_heading', s.heading))}
      </div>
      ${field('Text', textBox('s_body', s.body, 5), SECTION_HELP)}
    </div>`;
  }

  function formFor(kind, d, isNew, item) {
    switch (kind) {
      case 'video':
        return (isNew ? field('YouTube link or video ID', inputBox('youtubeId', '', 'placeholder="https://www.youtube.com/watch?v=..." required'))
                      : field('YouTube video', `<input type="text" value="${esc(item.key)}" disabled>`))
          + field('Title', inputBox('title', d.title))
          + `<div class="ce-row2">${field('Topic', `<select name="topic">${data.videoTopics.map(t => `<option value="${esc(t.key)}" ${d.topic === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`)}
             ${field('Duration', inputBox('duration', d.duration, 'placeholder="13:35"'), 'Optional, shown on the thumbnail')}</div>`;
      case 'module':
        return field('Lesson title', inputBox('title', d.title)) + field('Icon', iconBox('icon', d.icon || 'fa-book-open'));
      case 'deck':
        return field('Deck title', inputBox('title', d.title))
          + `<div class="ce-row2">${field('Icon', iconBox('icon', d.icon || 'fa-clone'))}
             ${field('Color', `<select name="color">${data.deckColors.map(c => `<option value="${c}" ${d.color === c ? 'selected' : ''}>${c.replace('-icon', '')}</option>`).join('')}</select>`)}</div>`;
      case 'case':
        return field('Scenario', textBox('text', d.text, 4)) + field('Question', inputBox('question', d.question)) + choiceFields(d);
      case 'card':
        return field('Question', textBox('question', d.question, 2)) + choiceFields(d);
      case 'topic':
        return field('Topic title', inputBox('title', d.title))
          + `<div class="ce-topic-layout">
              <div class="ce-sections">${(d.sections || []).map(sectionEditor).join('')}
                <button type="button" class="tool-btn" data-sec="add"><i class="fa-solid fa-plus"></i> Add section</button></div>
              <div class="ce-preview"><b>Preview</b><div class="ce-preview-body accordion-content"></div></div>
            </div>`;
      default:
        return '';
    }
  }

  const KIND_NAMES = { video: 'video', module: 'lesson', topic: 'topic', case: 'case study', deck: 'deck', card: 'card' };
  const EMPTY = {
    video: { title: '', topic: 'intro', duration: '' },
    module: { title: '', icon: 'fa-book-open' },
    deck: { title: '', icon: 'fa-clone', color: 'video-icon' },
    case: { text: '', question: '', options: ['', '', '', ''], answer: 0 },
    card: { question: '', options: ['', '', '', ''], answer: 0 },
    topic: { title: '', sections: [{ icon: 'fa-book-open', heading: '', body: '' }] },
  };

  function readForm(form, kind) {
    const v = (name) => (form.elements[name] ? form.elements[name].value : '');
    switch (kind) {
      case 'video': return { youtubeId: v('youtubeId'), title: v('title'), topic: v('topic'), duration: v('duration') };
      case 'module': return { title: v('title'), icon: v('icon') };
      case 'deck': return { title: v('title'), icon: v('icon'), color: v('color') };
      case 'case':
      case 'card': {
        const checked = form.querySelector('input[name="answer"]:checked');
        const base = { question: v('question'), options: [0, 1, 2, 3].map(i => v(`option${i}`)), answer: checked ? Number(checked.value) : -1 };
        return kind === 'case' ? { text: v('text'), ...base } : base;
      }
      case 'topic': return { title: v('title'), sections: readSections(form) };
      default: return {};
    }
  }

  function readSections(form) {
    return [...form.querySelectorAll('.ce-section')].map(sec => ({
      icon: sec.querySelector('[name="s_icon"]').value.trim(),
      heading: sec.querySelector('[name="s_heading"]').value,
      body: sec.querySelector('[name="s_body"]').value,
    }));
  }

  function openEditor({ kind, parentKey = null, item = null }) {
    kind = item ? item.kind : kind;
    const isNew = !item;
    const d = JSON.parse(JSON.stringify(item ? item.draft : EMPTY[kind]));
    const parentTitle = (() => {
      const pk = item ? item.parentKey : parentKey;
      const p = pk && data.items.find(i => i.kind === (kind === 'topic' ? 'module' : 'deck') && i.key === pk);
      return p ? view(p).title : '';
    })();

    const overlay = document.createElement('div');
    overlay.className = 'ce-overlay';
    overlay.innerHTML = `
      <form class="ce-modal${kind === 'topic' ? ' is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="ceTitle" novalidate>
        <div class="ce-modal-head">
          <div><h3 id="ceTitle">${isNew ? 'Add' : 'Edit'} ${KIND_NAMES[kind]}</h3>${parentTitle ? `<small>in ${esc(parentTitle)}</small>` : ''}</div>
          <button type="button" class="qs-close" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ce-modal-body">${formFor(kind, d, isNew, item)}</div>
        <p class="ce-error" role="alert" hidden></p>
        <div class="ce-modal-foot">
          <small><i class="fa-solid fa-circle-info"></i> Saved as a draft. Students see it after you publish.</small>
          <span><button type="button" class="tool-btn" data-close>Cancel</button>
          <button type="submit" class="tool-btn ce-publish"><i class="fa-solid fa-floppy-disk"></i> Save draft</button></span>
        </div>
        <datalist id="ceIconIdeas">${ICON_IDEAS.map(i => `<option value="${i}">`).join('')}</datalist>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    requestAnimationFrame(() => overlay.classList.add('is-open'));

    const close = () => {
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 200);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });

    // Icon previews + topic preview
    const refreshPreview = () => {
      form.querySelectorAll('.ce-icon-input').forEach(box => {
        box.querySelector('i').className = `fa-solid ${HCIRichText.safeIcon(box.querySelector('input').value.trim())}`;
      });
      const preview = form.querySelector('.ce-preview-body');
      if (preview) preview.innerHTML = readSections(form).map(HCIRichText.renderSection).join('');
    };
    form.addEventListener('input', refreshPreview);
    refreshPreview();

    // Topic sections: add / move / remove
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sec]');
      if (!b) return;
      const sections = readSections(form);
      const sec = b.closest('.ce-section');
      const i = sec ? Number(sec.dataset.index) : -1;
      if (b.dataset.sec === 'add') sections.push({ icon: 'fa-book-open', heading: '', body: '' });
      if (b.dataset.sec === 'remove') sections.splice(i, 1);
      if (b.dataset.sec === 'up' && i > 0) [sections[i - 1], sections[i]] = [sections[i], sections[i - 1]];
      if (b.dataset.sec === 'down' && i < sections.length - 1) [sections[i + 1], sections[i]] = [sections[i], sections[i + 1]];
      form.querySelector('.ce-sections').innerHTML = sections.map(sectionEditor).join('')
        + '<button type="button" class="tool-btn" data-sec="add"><i class="fa-solid fa-plus"></i> Add section</button>';
      refreshPreview();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = form.querySelector('.ce-error');
      const saveBtn = form.querySelector('[type="submit"]');
      errorEl.hidden = true;
      saveBtn.disabled = true;
      try {
        const body = readForm(form, kind);
        if (isNew) await api.post('/admin/content', { kind, parentKey, data: body });
        else await api.put(`/admin/content/${item.id}`, { data: body });
        close();
        if (parentKey) open.add(`${kind === 'topic' ? 'module' : 'deck'}:${parentKey}`);
        toast(isNew ? 'Added as a draft' : 'Draft saved');
        await load();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        saveBtn.disabled = false;
      }
    });

    const first = form.querySelector('input:not([disabled]), textarea');
    if (first) first.focus();
  }

  function mount(element, { onPending } = {}) {
    root = element;
    if (onPending) onPendingChange = onPending;
    root.addEventListener('click', handleClick);
    root.innerHTML = '<p class="admin-loading"><span class="btn-spinner"></span> Loading content...</p>';
    return load().catch(err => {
      root.innerHTML = `<p class="admin-empty"><i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}</p>`;
    });
  }

  return { mount, reload: load };
})();
