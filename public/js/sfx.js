// public/js/sfx.js
// Sound effects for quizzes (Case Studies + Study Cards).
//
// Walang audio files na kailangan: lahat ng tunog ay ginagawa ng browser gamit
// ang Web Audio API, kaya gumagana kahit offline at walang copyright issue.
//
// Usage:   HCISfx.play('correct' | 'wrong' | 'levelUp' | 'mastered')            (Case Studies)
//          HCISfx.play('cardCorrect' | 'cardWrong' | 'cardMastered')             (Study Cards)
// May maliit na mute button (kanang-itaas) sa Case Studies at Study Cards
// na naaalala ng browser. Sa ibang pages, confetti lang ang ginagamit.

(function () {
  'use strict';

  var STORAGE_KEY = 'hcilearn_sound_muted';
  var MASTER_VOLUME = 0.6;

  var ctx = null;
  var master = null;
  var muted = false;

  try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* storage blocked */ }

  // Browsers only allow audio after a user gesture. play() is always called from
  // a click handler (Submit button), so creating/resuming the context here is safe.
  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One note: oscillator -> envelope -> master.
  function tone(o) {
    var c = getCtx();
    if (!c) return;

    var t0 = c.currentTime + (o.start || 0);
    var dur = o.dur || 0.2;
    var vol = o.vol == null ? 0.25 : o.vol;

    var osc = c.createOscillator();
    var gain = c.createGain();

    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);

    // Quick attack + smooth decay avoids clicks/pops.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Note frequencies (Hz)
  var N = {
    G4: 392.00, C5: 523.25, E5: 659.25, G5: 783.99,
    A5: 880.00, B5: 987.77, C6: 1046.50, D6: 1174.66,
    E6: 1318.51, G6: 1567.98
  };

  var SOUNDS = {
    // Tamang sagot: bright "ding-ding-ding"
    correct: function () {
      tone({ freq: N.C5, start: 0.00, dur: 0.16, type: 'triangle', vol: 0.28 });
      tone({ freq: N.E5, start: 0.09, dur: 0.16, type: 'triangle', vol: 0.28 });
      tone({ freq: N.G5, start: 0.18, dur: 0.16, type: 'triangle', vol: 0.28 });
      tone({ freq: N.C6, start: 0.27, dur: 0.38, type: 'triangle', vol: 0.30 });
    },

    // Maling sagot: low, short "bonk-bonk" (hindi nakakagulat/nakakainis)
    wrong: function () {
      tone({ freq: 233, slideTo: 196, start: 0.00, dur: 0.20, type: 'square', vol: 0.12 });
      tone({ freq: 175, slideTo: 131, start: 0.18, dur: 0.30, type: 'square', vol: 0.12 });
    },

    // Unang beses na na-solve ang scenario (nag-unlock ng susunod): mas malaking reward
    levelUp: function () {
      tone({ freq: N.C5, start: 0.00, dur: 0.14, type: 'triangle', vol: 0.28 });
      tone({ freq: N.E5, start: 0.08, dur: 0.14, type: 'triangle', vol: 0.28 });
      tone({ freq: N.G5, start: 0.16, dur: 0.14, type: 'triangle', vol: 0.28 });
      tone({ freq: N.C6, start: 0.24, dur: 0.14, type: 'triangle', vol: 0.28 });
      tone({ freq: N.E6, start: 0.32, dur: 0.14, type: 'triangle', vol: 0.26 });
      // sparkle chord
      tone({ freq: N.G5, start: 0.42, dur: 0.55, type: 'sine', vol: 0.16 });
      tone({ freq: N.C6, start: 0.42, dur: 0.55, type: 'sine', vol: 0.16 });
      tone({ freq: N.G6, start: 0.42, dur: 0.55, type: 'sine', vol: 0.14 });
    },

    // Na-master ang buong lesson: fanfare
    mastered: function () {
      tone({ freq: N.G4, start: 0.00, dur: 0.12, type: 'square', vol: 0.10 });
      tone({ freq: N.C5, start: 0.11, dur: 0.12, type: 'square', vol: 0.10 });
      tone({ freq: N.E5, start: 0.22, dur: 0.12, type: 'square', vol: 0.10 });
      tone({ freq: N.G5, start: 0.33, dur: 0.16, type: 'square', vol: 0.10 });
      // sustained victory chord
      tone({ freq: N.C5, start: 0.50, dur: 0.85, type: 'triangle', vol: 0.20 });
      tone({ freq: N.E5, start: 0.50, dur: 0.85, type: 'triangle', vol: 0.20 });
      tone({ freq: N.G5, start: 0.50, dur: 0.85, type: 'triangle', vol: 0.20 });
      tone({ freq: N.C6, start: 0.50, dur: 0.85, type: 'triangle', vol: 0.18 });
    },

    // ---- Study Cards: sariling set ng tunog (softer, "card flip" + bell) ----

    // Tamang sagot: quick card "flip" swoosh tapos dalawang bell chime
    cardCorrect: function () {
      tone({ freq: 300, slideTo: 1200, start: 0.00, dur: 0.10, type: 'sine', vol: 0.18 });
      tone({ freq: N.A5, start: 0.10, dur: 0.30, type: 'sine', vol: 0.26 });
      tone({ freq: N.E6, start: 0.20, dur: 0.45, type: 'sine', vol: 0.22 });
    },

    // Maling sagot: soft "bloop" pababa (sine, hindi buzzy)
    cardWrong: function () {
      tone({ freq: 440, slideTo: 260, start: 0.00, dur: 0.22, type: 'sine', vol: 0.24 });
      tone({ freq: 330, slideTo: 196, start: 0.20, dur: 0.30, type: 'sine', vol: 0.20 });
    },

    // Na-master ang deck: shuffle swooshes + music-box melody
    cardMastered: function () {
      tone({ freq: 300, slideTo: 1200, start: 0.00, dur: 0.08, type: 'sine', vol: 0.14 });
      tone({ freq: 300, slideTo: 1200, start: 0.09, dur: 0.08, type: 'sine', vol: 0.14 });
      tone({ freq: N.G5, start: 0.22, dur: 0.22, type: 'sine', vol: 0.24 });
      tone({ freq: N.B5, start: 0.34, dur: 0.22, type: 'sine', vol: 0.24 });
      tone({ freq: N.D6, start: 0.46, dur: 0.22, type: 'sine', vol: 0.24 });
      tone({ freq: N.G6, start: 0.58, dur: 0.70, type: 'sine', vol: 0.22 });
      tone({ freq: N.D6, start: 0.58, dur: 0.70, type: 'triangle', vol: 0.12 });
      tone({ freq: N.B5, start: 0.58, dur: 0.70, type: 'triangle', vol: 0.12 });
    }
  };

  // ---------- Confetti (visual reward, shown even when muted) ----------
  var CONFETTI_COLORS = ['#ff6fa5', '#ff8a5c', '#ffc93c', '#3fcf9b', '#4fb3ff', '#7b5cff'];
  var CONFETTI_AMOUNT = { correct: 40, levelUp: 80, mastered: 140, cardCorrect: 40, cardMastered: 140 };

  function confetti(amount) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !document.body || !Element.prototype.animate) return;

    var originX = window.innerWidth / 2;
    var originY = window.innerHeight * 0.45;

    for (var i = 0; i < amount; i++) {
      var piece = document.createElement('span');
      var size = 6 + Math.random() * 7;
      piece.setAttribute('aria-hidden', 'true');
      piece.style.cssText = [
        'position:fixed', 'left:' + originX + 'px', 'top:' + originY + 'px',
        'width:' + size + 'px', 'height:' + (size * (Math.random() < 0.5 ? 1 : 0.45)) + 'px',
        'background:' + CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        'border-radius:' + (Math.random() < 0.35 ? '50%' : '2px'),
        'pointer-events:none', 'z-index:10000'
      ].join(';');
      document.body.appendChild(piece);

      // Shoot outward and up, then fall with gravity
      var angle = Math.random() * Math.PI * 2;
      var power = 120 + Math.random() * 260;
      var dx = Math.cos(angle) * power;
      var dy = Math.sin(angle) * power - 160;
      var spin = (Math.random() - 0.5) * 1080;
      var duration = 1100 + Math.random() * 900;

      var anim = piece.animate([
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) rotate(' + spin / 2 + 'deg)', opacity: 1, offset: 0.45 },
        { transform: 'translate(calc(-50% + ' + dx * 1.3 + 'px), calc(-50% + ' + (dy + 420) + 'px)) rotate(' + spin + 'deg)', opacity: 0 }
      ], { duration: duration, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' });

      anim.onfinish = (function (el) { return function () { el.remove(); }; })(piece);
    }
  }

  function play(name) {
    if (CONFETTI_AMOUNT[name]) {
      try { confetti(CONFETTI_AMOUNT[name]); } catch (e) { /* visuals must never break the quiz */ }
    }
    if (muted) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    try { fn(); } catch (e) { /* sound must never break the quiz */ }
  }

  // ---------- Mute button ----------
  function setMuted(value) {
    muted = value;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function renderButtonState(btn) {
    btn.innerHTML = muted
      ? '<i class="fa-solid fa-volume-xmark"></i>'
      : '<i class="fa-solid fa-volume-high"></i>';
    btn.title = muted ? 'Sound off (click to turn on)' : 'Sound on (click to mute)';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  function mountButton() {
    if (document.getElementById('sfxToggle')) return;
    // Other pages load this file only for the confetti (badge pop-ups)
    if (!document.body.matches('.case-page, .study-page')) return;

    var btn = document.createElement('button');
    btn.id = 'sfxToggle';
    btn.type = 'button';
    btn.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:9999',
      'width:42px', 'height:42px', 'border-radius:50%',
      'border:1px solid #d0d7e2', 'background:#fff', 'color:#4a658a',
      'font-size:17px', 'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.12)',
      'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');

    renderButtonState(btn);

    btn.addEventListener('click', function () {
      setMuted(!muted);
      renderButtonState(btn);
      // Short preview so the user knows it's on (sound only, no confetti).
      // Study Cards previews its own "correct" sound.
      if (!muted) {
        var preview = document.body.classList.contains('study-page') ? SOUNDS.cardCorrect : SOUNDS.correct;
        try { preview(); } catch (e) { /* ignore */ }
      }
    });

    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton);
  } else {
    mountButton();
  }

  window.HCISfx = { play: play, confetti: confetti, isMuted: function () { return muted; } };
})();
