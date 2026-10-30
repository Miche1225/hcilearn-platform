# HCILearn

An HCI 2 study hub for UEP IT students. Students sign up, watch video
lessons, read the course material, solve case-study scenarios and drill
flashcards, and their progress is saved to their account.

## Features

| Page | What it does |
|---|---|
| **Login / Sign up** | Accounts with hashed passwords, "remember me", and forgot-password by email |
| **Dashboard** | Overall progress ring, per-module stats, "up next" suggestion, recent activity, study streak, daily goal and badges |
| **Watch Video** | YouTube lessons with search and filters; a video is marked watched automatically when it ends, and resumes where you left off |
| **Read Lesson** | Learning objectives, outline and expandable lessons with search and "jump to lesson"; any topic can be saved with a note |
| **Case Studies** | Scenarios that unlock one at a time as you answer correctly, plus "Review mistakes" |
| **Study Cards** | Flashcard decks; wrong answers come back until the deck is mastered, plus a "Review my mistakes" deck |
| **Saved** | Bookmarked topics and videos with personal notes; search, filter, edit and remove |
| **Admin** | For the one admin account (Admin ID + password via "Log in as admin"): class overview, student list with filters, per-student details and account actions, **content editor** with draft/publish and **publish history / roll back**, **announcements** (to everyone or chosen sections), CSV export and an audit log |
| **Account** | Badge collection with progress, edit profile, upload a photo, change password, delete account |

**Course content lives in the database.** Videos, lessons, case studies and
study cards are edited by the admin in the Admin Dashboard. Edits are
drafts until the admin presses **Publish**; then every student sees the
new content at once. Every publish is saved in a **publish history**, and
the admin can **roll back** to any earlier version (the rollback is
saved too, so it can be undone). Each item keeps a permanent key, so students' progress,
mistakes and bookmarks survive edits, reordering and additions.

**Notifications:** when the admin posts an announcement, students get a
pop-up on whatever page they are on (checked every minute) and a red count
on the **bell** in the sidebar. The bell lists the announcements meant for
their section; opening it marks them read (saved per account).

Every logged-in page has **Quick Search** (menu item, Ctrl+K or "/") over
lesson topics, videos, case studies, study cards and an HCI glossary.

**Study streak & daily goal:** answering questions, finishing videos and
opening lesson topics count as studying for the day (Philippine time).
Students pick a daily goal of 5–30 answered questions. **14 badges** unlock
for milestones, with a pop-up and confetti.

Quizzes have sound effects (with a mute button) and confetti on correct
answers. Every page has a **dark mode** (menu item, or the round button on
the login pages); it follows the device setting until the user picks one.
All animations turn off when the device has "reduce motion" enabled.

## Tech stack

- **Node.js + Express**: serves the pages in `public/` and a JSON API under `/api`
- **PostgreSQL** (Supabase or Neon) via `pg`: tables are created automatically on startup
- **Cloudinary**: profile photo storage
- **bcrypt + JWT** in an httpOnly cookie for login sessions
- **Nodemailer (Gmail) or Brevo API**: signup, login-alert and password-reset emails
- Plain HTML, CSS and JavaScript on the front end (the only build step is
  regenerating `dark.css`, see below)

## Project structure

```
hcilearn-platform/
├── server.js                 # entry point, security headers, static files
├── src/
│   ├── db.js                 # Postgres pool + table setup/migrations
│   ├── middleware/
│   │   ├── authGuard.js      # student session cookie check
│   │   ├── adminGuard.js     # admin session cookie check
│   │   └── rateLimit.js      # in-memory rate limiter
│   ├── routes/
│   │   ├── auth.js           # signup, login, logout, forgot/reset password, /me
│   │   ├── account.js        # profile, photo upload, delete account
│   │   ├── progress.js       # dashboard summary, per-module progress, video positions, mistakes
│   │   ├── bookmarks.js      # saved topics/videos + notes
│   │   ├── gamify.js         # study streak, daily goal, badges
│   │   ├── admin.js          # admin dashboard (progress, insights, CSV, audit log, student actions, announcements)
│   │   ├── adminContent.js   # content editor API (drafts, publish, discard, history, rollback)
│   │   ├── content.js        # published content for the student pages + Quick Search index
│   │   ├── announcements.js  # active announcements for students
│   │   └── adminAuth.js      # admin login / logout / password
│   ├── contentStore.js       # cached published content (refreshed on publish)
│   ├── contentVersions.js    # publish history snapshots
│   ├── seed/content.json     # original course content, loaded into an empty database once
│   ├── glossary.json         # HCI glossary terms for Quick Search
│   └── utils/                # mailer, password rules, email hashing, dates/streaks
├── scripts/
│   ├── build-dark-css.js     # generates public/dark.css from style.css
│   ├── dark-manual.css       # hand-written dark mode fixes
│   ├── admin.js              # npm run admin (create / manage the one admin account)
│   └── check.js              # npm test
└── public/                   # front-end pages
    ├── style.css             # shared stylesheet for every page
    ├── dark.css              # dark mode (generated, don't edit by hand)
    └── js/
        ├── api.js            # fetch helper, auth check, sidebar
        ├── theme.js          # light/dark mode switch
        ├── bookmarks.js      # bookmarks + note dialog
        ├── gamify.js         # reports activity, badge / goal pop-ups
        ├── search.js         # Quick Search window
        ├── notifications.js  # student notification bell + pop-ups
        ├── richtext.js       # lesson text format (shared by Read Lesson and the editor)
        ├── admin-content.js  # Admin Dashboard content editor
        └── sfx.js            # quiz sounds + confetti
```

## Running locally

You need [Node.js](https://nodejs.org) 18+ and a Postgres database (a free
[Supabase](https://supabase.com) project works).

```bash
npm install
cp .env.example .env    # then fill in the values
npm run dev             # restarts on file changes; use `npm start` otherwise
```

Open http://localhost:3000 and create an account. For local use, set
`NODE_ENV=development` and `APP_URL=http://localhost:3000` in `.env`.

### Dark mode CSS

`public/dark.css` is generated from `style.css`: light backgrounds become dark
surfaces and dark text becomes light, keeping each colour's hue. **After
changing `style.css`, run:**

```bash
npm run build:dark
```

For anything the generator gets wrong, add a rule to `scripts/dark-manual.css`
(it is appended to the end of `dark.css`) and run the command again.

### The admin account (Admin Dashboard)

HCILearn has **one admin account** and no other staff accounts. The admin
sees every student, edits and publishes content, posts announcements, and
can see and clear the activity log. The database allows only one row in the
`admin` table.

The admin is separate from students and logs in with an **Admin ID and
password** ("Log in as admin" on the login page, or `login.html#admin`). The
admin can change the password with the key button in the sidebar. The
account is created and managed from the terminal (uses `DATABASE_URL` in `.env`):

```bash
npm run admin -- create --id 122524 --name "Full Name"   # asks for the password; only works once
npm run admin -- reset-password                          # also logs the admin out everywhere
npm run admin -- rename --name "New Name"
npm run admin -- change-id --id 654321
npm run admin -- show
```

**Older databases:** if the database still has the old `instructors` tables,
the server converts it on start: it keeps the main admin account (or the
oldest one), removes the other instructor accounts and their sections, and
renames `instructors` → `admin` and `instructor_audit_log` → `admin_audit_log`.
Announcements, content history and the activity log are kept.

The password is typed when asked and stored only as a bcrypt hash, never in
code or `.env`.

### Course content and the topic text format

On the first start with an empty database, the original course content in
`src/seed/content.json` is loaded and published. After that, use the
**Content** tab of the Admin Dashboard. Lesson topics are made of sections
(icon, optional heading, text). The text supports:

- a blank line for a new paragraph
- `- ` at the start of a line for a bullet point
- `> ` at the start of a line for a grey "example" note
- `**bold**` and `*italic*`

Everything else is shown as plain text (no HTML), so it is safe to paste.

### Checks

```bash
npm test
```

Checks that every JavaScript file and inline page script parses, and that
`dark.css` is up to date. Run it before pushing.

## Environment variables

See [`.env.example`](.env.example) for the full list with comments.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `JWT_SECRET` | Yes (production) | Signs login cookies, 32+ characters |
| `EMAIL_HASH_SECRET` | Yes | Hashes emails for lookup, 32+ characters. **Never change it once users exist** |
| `APP_URL` | Yes (production) | Public site URL, used in password-reset links |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | For photos | Profile photo uploads |
| `EMAIL_USER`, `EMAIL_PASS` | For email (option A) | Gmail address + App Password |
| `BREVO_API_KEY`, `EMAIL_FROM` | For email (option B) | Needed on Render's free plan, which blocks SMTP |
| `NODE_ENV` | No | `production` enables secure cookies |
| `PORT` | No | Defaults to 3000 |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## API reference

All paths start with `/api`. Everything except signup, login, logout and
the password-reset routes requires the login cookie.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | Create an account |
| POST | `/auth/login` | Log in |
| POST | `/auth/logout` | Clear the session cookie |
| POST | `/auth/forgot-password` | Email a reset link (valid 30 min, single use) |
| POST | `/auth/reset-password` | Set a new password with the emailed token |
| GET | `/auth/me` | Current user |
| GET | `/account` | Current profile |
| PUT | `/account` | Update profile and/or password |
| POST | `/account/photo` | Upload a photo (field `photo`; JPEG/PNG/WebP/GIF, max 3 MB) |
| DELETE | `/account` | Delete the account and its progress |
| GET | `/progress/summary` | Dashboard stats + recent activity |
| GET | `/progress/case-studies` | Unlocked level + solved scenarios |
| POST | `/progress/case-studies/submit` | Save a correct answer |
| GET | `/progress/study-cards` | Unlocked lesson + completed decks |
| POST | `/progress/study-cards/complete` | Mark a deck as mastered |
| GET | `/progress/videos` | Watched videos + saved playback positions |
| POST | `/progress/videos/watch` | Mark a video as watched |
| GET | `/progress/lesson` | Lesson completion status |
| POST | `/progress/lesson/complete` | Mark the lesson as read |
| PUT | `/progress/videos/position` | Remember where the user stopped in a video |
| GET | `/progress/mistakes?source=` | Missed questions (`case_study` or `study_card`) |
| POST | `/progress/mistakes` | Record a wrong answer |
| POST | `/progress/mistakes/resolve` | Clear a mistake (answered right in review) |
| GET | `/bookmarks` | Saved topics and videos |
| PUT | `/bookmarks` | Save an item or update its note |
| DELETE | `/bookmarks/:id` | Remove a saved item |
| GET | `/gamify/summary` | Streak, today's goal progress, last 7 days, badges |
| POST | `/gamify/activity` | Record an answer / finished video / opened topic / cleared mistake |
| POST | `/gamify/check` | Award any badges earned from other progress |
| PUT | `/gamify/goal` | Change the daily goal (5, 10, 20 or 30) |
| POST | `/admin/auth/login` | Admin login (Admin ID + password) |
| POST | `/admin/auth/logout` | Admin log out |
| GET | `/admin/auth/me` | The admin account |
| GET | `/content/videos` · `/content/lessons` · `/content/case-studies` · `/content/study-cards` | Published course content (no login needed) |
| GET | `/content/search-index` | Quick Search data (published content + glossary) |
| GET | `/announcements` | Announcements for this student (with unread flags) |
| POST | `/announcements/seen` | Mark notifications as read |
| GET | `/admin/students` | *Admin:* every student with progress numbers |
| GET | `/admin/insights` | *Admin:* most-missed questions, least-watched videos |
| GET | `/admin/students/:id` | *Admin:* one student's details (recorded in the audit log) |
| GET | `/admin/export.csv` | *Admin:* progress CSV (recorded in the audit log) |
| POST | `/admin/students/:id/signout` · `/reset` · `/deactivate` · `/reactivate` | *Admin:* account actions (audited) |
| GET · POST · DELETE | `/admin/announcements` | *Admin:* list, post, delete announcements |
| GET · POST | `/admin/content` | *Admin:* all items (draft + published) / add an item |
| PUT · DELETE | `/admin/content/:id` | *Admin:* edit / remove (draft) |
| POST | `/admin/content/:id/restore` · `/reorder` | *Admin:* undo changes / new order |
| POST | `/admin/content/publish` · `/discard` | *Admin:* make drafts live / throw them away (audited) |
| GET | `/admin/content/versions` · `/versions/:id/preview` | *Admin:* publish history / what a rollback would change |
| POST | `/admin/content/versions/:id/rollback` | *Admin:* make an earlier version live again (audited) |
| POST | `/admin/auth/password` | Change the admin password |
| GET | `/admin/audit` | *Admin:* latest admin actions |

## Database

`src/db.js` creates these tables on first run (`CREATE TABLE IF NOT EXISTS`):

- `users`: profile, hashed password, hashed email, session version
- `case_study_progress`, `study_card_progress`, `lesson_progress`, `video_progress`: per-user progress
- `password_resets`: one-time reset tokens
- `activity_log`: feeds "Recent Activities" on the Dashboard
- `video_positions`: where each user stopped in each video
- `mistakes`: questions answered wrong, for "Review my mistakes"
- `bookmarks`: saved topics/videos with notes
- `daily_activity`: what each user did per day, for the streak, daily goal and badges
- `user_badges`: badges each user has earned (the goal itself is `users.daily_goal`)
- `admin`: the one admin account (Admin ID, name, password hash); only one row is allowed
- `admin_audit_log`: what the admin did on the Admin Dashboard (viewing, exporting, publishing, account actions)
- `content_items`: course content; each row has a permanent `key`, a `draft` and a `published` version
- `content_versions`: snapshot of the published content after every publish / rollback (last 60 kept)
- `announcements`: messages for the student Dashboard (optional end date, optional target sections)
- `users.disabled_at`: set when the admin deactivates an account
- `users.announcements_seen_at`: when the student last opened their notifications

## Security

- Passwords hashed with bcrypt; emails stored with an HMAC hash for lookup, plus an AES-256-GCM encrypted copy so the admin can email inactive students a reminder
- Rate limits on signup, login, forgot/reset password and password changes
- Changing or resetting a password signs out every other session
- httpOnly, `SameSite` cookies (`Secure` in production)
- Photo uploads checked for type and size before going to Cloudinary
- The admin has a separate account and its own 8-hour session cookie; a
  student login can never open the admin API. Admin logins are rate
  limited, and admin views and exports are written to an audit log.
  Exported CSV cells are escaped so they can't run as spreadsheet formulas

## Deployment

The app is set up for **Render** (web service) + **Supabase** (database) +
**Cloudinary** (photos), all on free plans. Step-by-step instructions are in
[DEPLOY-GUIDE.md](DEPLOY-GUIDE.md).

## Copyright

Copyright © 2026 Micheree Kian M. Grefiel.

All rights reserved. Unauthorized copying, modification, or distribution of this project's code without permission is prohibited.
