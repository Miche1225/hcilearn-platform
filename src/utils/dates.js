// src/utils/dates.js
// Dates as YYYY-MM-DD strings in Philippine time (every user is a UEP
// student), plus the study streak maths. Used by the gamify and admin routes.

const TIME_ZONE = 'Asia/Manila';

function todayLocal() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// DATE values from Postgres: node-pg gives a Date at local midnight
// (so use the local parts), other drivers may give a string.
function toYmd(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function weekdayLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// Active days (newest first) -> current and longest streak
function computeStreaks(activeDays, today) {
  const set = new Set(activeDays);

  // The streak stays alive until the end of today, so start from
  // yesterday if nothing has been done yet today.
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of [...activeDays].sort()) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest: Math.max(longest, current), activeToday: set.has(today) };
}

module.exports = { TIME_ZONE, todayLocal, addDays, toYmd, weekdayLabel, computeStreaks };
