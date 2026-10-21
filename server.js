// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { ready } = require('./src/db'); // resolves once Postgres tables exist

const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/account');
const progressRoutes = require('./src/routes/progress');
const bookmarkRoutes = require('./src/routes/bookmarks');
const gamifyRoutes = require('./src/routes/gamify');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy: makes req.protocol report https correctly.
app.set('trust proxy', 1);

// Don't advertise that the server runs Express
app.disable('x-powered-by');

// ----- Security headers (no extra packages) -----
app.use((req, res, next) => {
  // Browsers must not guess file types (stops some upload/script tricks)
  res.set('X-Content-Type-Options', 'nosniff');
  // Other websites can't show these pages inside a frame (clickjacking)
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  // Links to other sites only see our domain, never full URLs (e.g. reset tokens)
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Pages don't need camera/mic/location
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    // Always use HTTPS for this site from now on
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// API responses (user data) should never be cached
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// ----- API -----
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/gamify', gamifyRoutes);

// ----- Static front-end -----
app.use(express.static(path.join(__dirname, 'public')));

// Anything not matched by the API or a static file falls back to the login page.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ----- Error handler -----
// Expected problems (bad upload, too-large request, bad JSON) get a clear
// message. Anything else gets a generic reply so database/internal details
// are never shown to the browser; the full error is only in the server log.
app.use((err, req, res, next) => {
  console.error(err);

  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That image is too large. Please choose one under 3 MB.'
      : 'Upload failed. Please try another image.';
    return res.status(400).json({ error: message });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500 && err.message) {
    return res.status(status).json({ error: err.message });
  }

  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

ready.then(() => {
  app.listen(PORT, () => {
    console.log(`HCILearn server running at http://localhost:${PORT}`);
  });
});
