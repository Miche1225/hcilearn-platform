// public/js/richtext.js
// Lesson topic text format (used by Read Lesson and the admin editor).
// Safe by design: everything is escaped, only these marks become HTML:
//
//   Paragraphs are separated by a blank line.
//   - A line starting with "- " is a bullet point
//   > A line starting with "> " is a grey "example" note
//   **bold**   *italic*   (write \* for a real asterisk)

const HCIRichText = (function () {
  'use strict';

  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(text) {
    // Protect escaped characters, then turn **x** / *x* into tags
    let html = escapeHtml(text)
      .replace(/\\\\/g, '\u0002')
      .replace(/\\\*/g, '\u0001');
    html = html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
    return html.replace(/\u0001/g, '*').replace(/\u0002/g, '\\');
  }

  function render(body) {
    const out = [];
    const blocks = String(body || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
      let list = [];
      let para = [];
      const flushList = () => { if (list.length) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; } };
      const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('- ')) { flushPara(); list.push(t.slice(2)); }
        else if (t.startsWith('> ')) {
          flushList(); flushPara();
          out.push(`<p class="rt-note"><i class="fa-solid fa-arrow-right"></i> ${inline(t.slice(2))}</p>`);
        } else { flushList(); para.push(t); }
      }
      flushList();
      flushPara();
    }
    return out.join('');
  }

  const safeIcon = (icon) => (/^fa-[a-z0-9-]+$/.test(icon || '') ? icon : 'fa-circle-info');

  // One lesson section: a card with icon + heading, or plain text when there's no heading
  function renderSection(section) {
    if (!section.heading) return `<div class="rt-loose">${render(section.body)}</div>`;
    return `<div class="sub-card">
        <div class="sub-card-title"><i class="fa-solid ${safeIcon(section.icon)}"></i><h4>${escapeHtml(section.heading)}</h4></div>
        ${render(section.body)}
      </div>`;
  }

  return { render, renderSection, safeIcon, escapeHtml };
})();

if (typeof module !== 'undefined') module.exports = HCIRichText;
