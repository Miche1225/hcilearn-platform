// public/js/gamify.js
// Study streak, daily goal and badges (needs js/api.js; js/sfx.js for confetti).
//
//   HCIGamify.record('answer', true);   // answered a question (right/wrong)
//   HCIGamify.record('perfect');        // finished a deck without a mistake
//   HCIGamify.record('video');          // finished a video
//   HCIGamify.record('read');           // opened a lesson topic
//   HCIGamify.record('cleared');        // cleared a mistake in review
//   HCIGamify.check();                  // after saving other progress (solved, mastered, notes)
//   HCIGamify.celebrate(newBadges);     // show pop-ups for badges from /gamify/summary
//
// Pages can listen for updates: document.addEventListener('hci:gamify', e => e.detail)

const HCIGamify = (function () {
  'use strict';

  const queue = [];
  let showing = false;

  function handle(result) {
    if (!result) return result;
    if (result.justMetGoal && result.today) {
      queue.push({
        icon: 'fa-bullseye', color: 'mint',
        title: 'Daily goal reached!',
        name: `${result.today.correct} correct answers today`,
        description: 'Come back tomorrow to keep your streak going.',
        confetti: 90,
      });
    }
    (result.newBadges || []).forEach(badge => queue.push({
      icon: badge.icon, color: badge.color,
      title: 'Badge unlocked!',
      name: badge.name,
      description: badge.description,
      confetti: 120,
    }));
    showNext();
    document.dispatchEvent(new CustomEvent('hci:gamify', { detail: result }));
    return result;
  }

  // Never let streak/badge saving break a quiz
  // Correct answers in a row (any quiz page, this browser tab)
  const COMBO_KEY = 'hcilearn_combo';
  function nextCombo(correct) {
    let n = 0;
    try { n = Number(sessionStorage.getItem(COMBO_KEY)) || 0; } catch (e) { /* storage blocked */ }
    n = correct ? n + 1 : 0;
    try { sessionStorage.setItem(COMBO_KEY, String(n)); } catch (e) { /* storage blocked */ }
    return n;
  }

  function record(type, correct) {
    const body = { type };
    if (type === 'answer') {
      body.correct = !!correct;
      body.combo = nextCombo(!!correct);
    }
    return api.post('/gamify/activity', body).then(handle).catch(() => null);
  }

  function check() {
    return api.post('/gamify/check').then(handle).catch(() => null);
  }

  function celebrate(newBadges) {
    handle({ newBadges });
  }

  // One pop-up at a time
  function showNext() {
    if (showing || !queue.length) return;
    showing = true;
    const item = queue.shift();

    const el = document.createElement('div');
    el.className = `badge-pop badge-${item.color}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="badge-pop-icon"><i class="fa-solid ${item.icon}"></i></div>
      <div class="badge-pop-text">
        <small></small>
        <strong></strong>
        <span></span>
      </div>
      <button type="button" class="badge-pop-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>`;
    el.querySelector('small').textContent = item.title;
    el.querySelector('strong').textContent = item.name;
    el.querySelector('span').textContent = item.description;
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add('is-open'));
    if (window.HCISfx && HCISfx.confetti) {
      try { HCISfx.confetti(item.confetti); } catch (e) { /* ignore */ }
    }

    let timer = null;
    const close = () => {
      clearTimeout(timer);
      el.classList.remove('is-open');
      setTimeout(() => {
        el.remove();
        showing = false;
        showNext();
      }, 300);
    };
    el.querySelector('.badge-pop-close').addEventListener('click', close);
    timer = setTimeout(close, 4200);
  }

  return { record, check, celebrate, show: handle };
})();
