# HCILearn — Backend & Database

This is the backend + database that plugs into the HCILearn front-end you
already built, so the whole site actually works: accounts are real, logins
are checked against a database, and progress on videos, the lesson, case
studies and study cards is saved per-user instead of resetting on refresh.

## What's inside

- **Node.js + Express** server that serves your existing HTML/CSS pages
  *and* a small JSON API.
- **SQLite** database (via `better-sqlite3`) — a single file, no database
  server to install or configure. Perfect for a school project.
- **bcrypt** password hashing — passwords are never stored in plain text.
- **JWT stored in an httpOnly cookie** for login sessions (no separate
  session table needed).

```
hcilearn/
├── server.js              # entry point
├── package.json
├── .env.example            # copy to .env
├── data/                    # hcilearn.db is created here automatically
├── src/
│   ├── db.js                # creates all tables on first run
│   ├── middleware/authGuard.js
│   └── routes/
│       ├── auth.js          # signup, login, logout, /me
│       ├── account.js       # get/update profile, photo upload
│       └── progress.js      # dashboard stats, videos, lesson, case studies, study cards
└── public/                  # your front-end, lightly patched to call the API
    ├── login.html, signup.html, Dashboard.html, Account.html, ...
    ├── js/api.js             # shared fetch helper used by every page
    └── uploads/              # profile photos land here
```

## 1. Install

You'll need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd hcilearn
npm install
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to any long random string (this signs the
login sessions).

## 2. Run it

```bash
npm start
```

Then open **http://localhost:3000** in your browser. You'll land on the
login page — click "Sign Up" to create the first account. The database
file is created automatically at `data/hcilearn.db` the first time you run
the server, so there's nothing to set up by hand.

For development, `npm run dev` restarts the server automatically when you
edit a file.

## 3. How the pieces fit together

### Accounts
- `signup.html` → `POST /api/auth/signup` creates a user (password is
  hashed with bcrypt) and logs them straight in.
- `login.html` → `POST /api/auth/login` checks the email/password and sets
  a secure, httpOnly cookie.
- Every other page calls `requireAuth()` (from `public/js/api.js`) on load,
  which pings `GET /api/auth/me` — if there's no valid session it bounces
  the visitor back to `login.html`.
- `Dashboard.html`'s "Log out" button calls `POST /api/auth/logout`, which
  clears the cookie.

### Account page
- Loads the signed-in user's real profile into the form fields.
- Saving calls `PUT /api/account`. Leave the password field blank to keep
  the current password.
- Choosing a new profile photo uploads it immediately to
  `POST /api/account/photo` (stored in `public/uploads/`).

### Progress tracking (this is the part that was missing entirely before)
- **Watch Video**: the player page loads the YouTube IFrame API and calls
  `POST /api/progress/videos/watch` automatically when a video finishes
  (there's also a manual "Mark as Watched" button as a fallback). Watched
  videos get a green "Watched" badge back on the video list.
- **Read Lesson**: a "Mark Lesson as Completed" button at the bottom saves
  completion via `POST /api/progress/lesson/complete`.
- **Case Studies**: previously the unlocked level and solved scenarios
  lived only in a JavaScript variable, so refreshing the page reset all 50
  scenarios back to locked. Now `GET /api/progress/case-studies` loads your
  real unlocked level + solved list on page load, and every correct answer
  is saved with `POST /api/progress/case-studies/submit`.
- **Study Cards**: same fix as Case Studies, for the 11 lessons —
  `GET/POST /api/progress/study-cards...`.
- **Dashboard**: `GET /api/progress/summary` powers the welcome banner, the
  overall progress ring, the three stat counters, and the "Recent
  Activities" list (pulled from an activity log that every completed
  action writes to).

## 4. API reference

All endpoints are prefixed with `/api` and (except signup/login) require
the login cookie, which the browser sends automatically thanks to
`credentials: 'include'` in `public/js/api.js`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | Create an account `{fullName, yearSection, program, email, studentId, password}` |
| POST | `/auth/login` | `{email, password}` |
| POST | `/auth/logout` | Clears the session cookie |
| GET | `/auth/me` | Current logged-in user |
| GET | `/account` | Current profile |
| PUT | `/account` | Update profile fields / password |
| POST | `/account/photo` | Multipart upload, field name `photo` |
| GET | `/progress/summary` | Dashboard stats + recent activity |
| GET | `/progress/case-studies` | `{unlockedLevel, solvedIds}` |
| POST | `/progress/case-studies/submit` | `{scenarioId, correct}` |
| GET | `/progress/study-cards` | `{unlockedLesson, completedIds}` |
| POST | `/progress/study-cards/complete` | `{lessonId}` |
| GET | `/progress/videos` | List of watched videos |
| POST | `/progress/videos/watch` | `{videoId, title}` |
| GET | `/progress/lesson` | `{completed, completedAt}` |
| POST | `/progress/lesson/complete` | Marks the lesson page as read |

## 5. Database schema

Six tables, created automatically by `src/db.js`:

- `users` — profile + hashed password
- `case_study_progress` — one row per user: unlocked level (1–50) + JSON array of solved scenario ids
- `study_card_progress` — one row per user: unlocked lesson (1–11) + JSON array of mastered lesson ids
- `lesson_progress` — one row per user: whether the Read Lesson page is completed
- `video_progress` — one row per (user, video) that's been watched
- `activity_log` — feeds the Dashboard's "Recent Activities" list

## 6. Notes & next steps

- The database file lives in `data/hcilearn.db`. Delete it (with the
  server stopped) to start completely fresh.
- If you ever deploy this somewhere real, set `NODE_ENV=production` in
  `.env` so cookies are marked `secure` (HTTPS only), and put a real random
  string in `JWT_SECRET`.
- Everything runs on plain HTTP on localhost by default, which is fine for
  local development and demos.

## Email notifications

| Event | Email sent to the user |
|-------|------------------------|
| Sign up | "Welcome — your account was created" |
| Log in | "Security alert: new login" |
| Forgot password | Reset link (valid 30 min, single use) |
| Password reset done | "Your password was changed" |

Forgot-password flow: `login.html` → `POST /api/auth/forgot-password` → email with
`update-password.html?token=...` → `POST /api/auth/reset-password`.
Set `APP_URL`, and either `EMAIL_USER`/`EMAIL_PASS` (Gmail App Password) or
`BREVO_API_KEY`/`EMAIL_FROM` — see `.env.example`.
