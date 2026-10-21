// public/js/bookmarks.js
// Bookmarks + notes for lesson topics and videos (needs js/api.js).
//
//   await HCIBookmarks.load();                     // fetch the user's bookmarks once
//   HCIBookmarks.get('video', 'uB9LaBIAcRs');       // bookmark or undefined
//   await HCIBookmarks.toggle('lesson', '12', 'Personas');
//   await HCIBookmarks.editNote('lesson', '12', 'Personas');   // opens the note dialog
//
// kind is 'lesson' (itemKey = topic number) or 'video' (itemKey = YouTube id).

const HCIBookmarks = (function () {
  'use strict';

  const MAX_NOTE = 2000;
  const items = new Map(); // "kind:itemKey" -> bookmark
  let loading = null;

  const keyOf = (kind, itemKey) => `${kind}:${itemKey}`;

  function load() {
    if (!loading) {
      loading = api.get('/bookmarks')
        .then(({ bookmarks }) => {
          items.clear();
          bookmarks.forEach(b => items.set(keyOf(b.kind, b.itemKey), b));
          return items;
        })
        .catch(err => {
          loading = null;
          throw err;
        });
    }
    return loading;
  }

  function get(kind, itemKey) {
    return items.get(keyOf(kind, itemKey));
  }

  function all() {
    return [...items.values()];
  }

  async function save(kind, itemKey, title, note) {
    const body = { kind, itemKey, title };
    if (note !== undefined) body.note = note;
    const { bookmark } = await api.put('/bookmarks', body);
    items.set(keyOf(kind, itemKey), bookmark);
    return bookmark;
  }

  async function remove(kind, itemKey) {
    const existing = get(kind, itemKey);
    if (!existing) return;
    await api.del(`/bookmarks/${existing.id}`);
    items.delete(keyOf(kind, itemKey));
  }

  // Saves if not saved yet, removes otherwise. Resolves with the new state.
  async function toggle(kind, itemKey, title) {
    if (get(kind, itemKey)) {
      await remove(kind, itemKey);
      return false;
    }
    await save(kind, itemKey, title);
    return true;
  }

  // Opens the note dialog for an item (saving it if needed).
  // Resolves with the bookmark, or null if cancelled.
  async function editNote(kind, itemKey, title) {
    const existing = get(kind, itemKey);
    const note = await noteDialog({ title, note: existing ? existing.note : '' });
    if (note === null) return null;
    const bookmark = await save(kind, itemKey, title, note);
    // Notes count toward the "Note Taker" badge
    if (typeof HCIGamify !== 'undefined' && bookmark.note) HCIGamify.check();
    return bookmark;
  }

  // Note editor (same look as confirmDialog). Resolves with the text or null.
  function noteDialog({ title = '', note = '' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-card note-card" role="dialog" aria-modal="true" aria-labelledby="noteTitle">
          <div class="confirm-icon"><i class="fa-solid fa-pen-to-square"></i></div>
          <h3 id="noteTitle">My note</h3>
          <p class="note-subject"></p>
          <textarea class="note-input" rows="6" maxlength="${MAX_NOTE}" aria-label="Note"
            placeholder="Write anything that helps you remember this..."></textarea>
          <small class="note-count"></small>
          <div class="confirm-actions">
            <button type="button" class="confirm-btn confirm-cancel">Cancel</button>
            <button type="button" class="confirm-btn confirm-ok">Save note</button>
          </div>
        </div>`;

      const textarea = overlay.querySelector('.note-input');
      const count = overlay.querySelector('.note-count');
      const cancelBtn = overlay.querySelector('.confirm-cancel');
      const okBtn = overlay.querySelector('.confirm-ok');
      overlay.querySelector('.note-subject').textContent = title;
      textarea.value = note;

      const updateCount = () => { count.textContent = `${textarea.value.length} / ${MAX_NOTE}`; };
      textarea.addEventListener('input', updateCount);
      updateCount();

      const previousFocus = document.activeElement;

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('is-open');
        setTimeout(() => overlay.remove(), 200);
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(textarea.value);
        // Keep Tab focus inside the dialog
        if (e.key === 'Tab') {
          const focusables = [textarea, cancelBtn, okBtn];
          const i = focusables.indexOf(document.activeElement);
          e.preventDefault();
          focusables[(i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length].focus();
        }
      }

      cancelBtn.addEventListener('click', () => close(null));
      okBtn.addEventListener('click', () => close(textarea.value));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('is-open'));
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  // Small pop-up message at the bottom of the screen
  function toast(message, icon = 'fa-bookmark') {
    const el = document.createElement('div');
    el.className = 'hci-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<i class="fa-solid ${icon}"></i> <span></span>`;
    el.querySelector('span').textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-open'));
    setTimeout(() => {
      el.classList.remove('is-open');
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  return { load, get, all, save, remove, toggle, editNote, noteDialog, toast };
})();
