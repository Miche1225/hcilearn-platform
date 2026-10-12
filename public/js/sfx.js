// public/js/sfx.js
// Sound effects for quizzes (Case Studies + Study Cards).
//
// Walang audio files na kailangan: lahat ng tunog ay ginagawa ng browser gamit
// ang Web Audio API, kaya gumagana kahit offline at walang copyright issue.
//
// Usage:   HCISfx.play('correct' | 'wrong' | 'levelUp' | 'mastered')
// May maliit na mute button (kanang-itaas) na naaalala ng browser.

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
    C6: 1046.50, E6: 1318.51, G6: 1567.98
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
    }
  };

  function play(name) {
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
      if (!muted) play('correct'); // short preview so the user knows it's on
    });

    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton);
  } else {
    mountButton();
  }

  window.HCISfx = { play: play, isMuted: function () { return muted; } };
})();
