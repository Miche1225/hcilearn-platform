# HCILearn

An HCI 2 study hub for UEP IT students. Students sign up, watch video
lessons, read the course material, solve case-study scenarios and drill
flashcards, and their progress is saved to their account.

## Features

| Page | What it does |
|---|---|
| **Login / Sign up** | Accounts with hashed passwords, "remember me", and forgot-password by email |
| **Dashboard** | Overall progress ring, per-module stats, "up next" suggestion and recent activity |
| **Watch Video** | YouTube lessons with search and filters; a video is marked watched automatically when it ends, and resumes where you left off |
| **Read Lesson** | Learning objectives, outline and expandable lessons with search and "jump to lesson"; any topic can be saved with a note |
| **Case Studies** | 50 scenarios that unlock one at a time as you answer correctly, plus "Review mistakes" |
| **Study Cards** | 11 flashcard decks; wrong answers come back until the deck is mastered, plus a "Review my mistakes" deck |
| **Saved** | Bookmarked topics and videos with personal notes; search, filter, edit and remove |
| **Account** | Edit profile, upload a photo, change password, delete account |

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
│   │   ├── authGuard.js      # session cookie check
│   │   └── rateLimit.js      # in-memory rate limiter
│   ├── routes/
│   │   ├── auth.js           # signup, login, logout, forgot/reset password, /me
│   │   ├── account.js        # profile, photo upload, delete account
│   │   ├── progress.js       # dashboard summary, per-module progress, video positions, mistakes
│   │   └── bookmarks.js      # saved topics/videos + notes
│   ├── content.js            # course content the server validates against (videos, totals)
│   └── utils/                # mailer, password rules, email hashing
├── scripts/
│   ├── build-dark-css.js     # generates public/dark.css from style.css
│   └── dark-manual.css       # hand-written dark mode fixes
└── public/                   # front-end pages
    ├── style.css             # shared stylesheet for every page
    ├── dark.css              # dark mode (generated, don't edit by hand)
    └── js/
        ├── api.js            # fetch helper, auth check, sidebar
        ├── theme.js          # light/dark mode switch
        ├── bookmarks.js      # bookmarks + note dialog
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

## Database

`src/db.js` creates these tables on first run (`CREATE TABLE IF NOT EXISTS`):

- `users`: profile, hashed password, hashed email, session version
- `case_study_progress`, `study_card_progress`, `lesson_progress`, `video_progress`: per-user progress
- `password_resets`: one-time reset tokens
- `activity_log`: feeds "Recent Activities" on the Dashboard
- `video_positions`: where each user stopped in each video
- `mistakes`: questions answered wrong, for "Review my mistakes"
- `bookmarks`: saved topics/videos with notes

## Security

- Passwords hashed with bcrypt; emails stored with an HMAC hash for lookup
- Rate limits on signup, login, forgot/reset password and password changes
- Changing or resetting a password signs out every other session
- httpOnly, `SameSite` cookies (`Secure` in production)
- Photo uploads checked for type and size before going to Cloudinary

## Deployment

The app is set up for **Render** (web service) + **Supabase** (database) +
**Cloudinary** (photos), all on free plans. Step-by-step instructions are in
[DEPLOY-GUIDE.md](DEPLOY-GUIDE.md).
