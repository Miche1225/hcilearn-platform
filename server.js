// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { ready } = require('./src/db'); // resolves once Postgres tables exist

const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/account');
const progressRoutes = require('./src/routes/progress');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

// ----- API -----
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/progress', progressRoutes);

// ----- Static front-end -----
app.use(express.static(path.join(__dirname, 'public')));

// Anything not matched by the API or a static file falls back to the login page.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ----- Error handler (e.g. multer file-size/type errors) -----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

ready.then(() => {
  app.listen(PORT, () => {
    console.log(`HCILearn server running at http://localhost:${PORT}`);
  });
});
