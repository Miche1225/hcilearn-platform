// src/db.js
// Connects to a hosted Postgres database (Supabase / Neon / any Postgres
// connection string works) instead of a local SQLite file, so the data
// survives server restarts, redeploys, and free-tier "sleep" cycles.

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it to your Supabase/Neon connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase/Neon require SSL; this works for both without needing a local CA file.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      full_name       TEXT NOT NULL,
      year_section    TEXT,
      program         TEXT,
      email           TEXT NOT NULL UNIQUE,
      student_id      TEXT,
      password_hash   TEXT NOT NULL,
      profile_photo   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- One row per user: how far they've gotten in the 50 Case Study scenarios
    CREATE TABLE IF NOT EXISTS case_study_progress (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      unlocked_level  INTEGER NOT NULL DEFAULT 1,
      solved_ids      TEXT NOT NULL DEFAULT '[]'
    );

    -- One row per user: how far they've gotten in the 11 Study Card lessons
    CREATE TABLE IF NOT EXISTS study_card_progress (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      unlocked_lesson INTEGER NOT NULL DEFAULT 1,
      completed_ids   TEXT NOT NULL DEFAULT '[]'
    );

    -- One row per user: whether the Read Lesson page has been completed
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      completed       INTEGER NOT NULL DEFAULT 0,
      completed_at    TIMESTAMPTZ
    );

    -- One row per video a user has finished watching
    CREATE TABLE IF NOT EXISTS video_progress (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id        TEXT NOT NULL,
      title           TEXT,
      watched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, video_id)
    );

    -- One-time "forgot password" tokens. Only a SHA-256 hash of the token is
    -- stored, so a database leak can't be used to reset anyone's password.
    CREATE TABLE IF NOT EXISTS password_resets (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash      TEXT NOT NULL UNIQUE,
      expires_at      TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Feed for the Dashboard's "Recent Activities" card
    CREATE TABLE IF NOT EXISTS activity_log (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type            TEXT NOT NULL,
      description     TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// Run once at startup; server.js awaits this before accepting requests.
const ready = init().catch((err) => {
  console.error('Failed to initialize database schema:', err);
  process.exit(1);
});

module.exports = { pool, ready };
