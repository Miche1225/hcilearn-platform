// src/middleware/adminGuard.js
//
// Admins are the users whose email is listed in ADMIN_EMAILS (comma
// separated) in the environment. Emails are only stored as hashes, so each
// listed email is hashed the same way and compared. Nobody can make
// themselves an admin from the website.
//
// Use after requireAuth:  router.use(requireAuth, requireAdmin);

const { pool } = require('../db');
const { hashEmail } = require('../utils/emailSecurity');

let adminHashes = null;

function getAdminHashes() {
  if (!adminHashes) {
    adminHashes = new Set(
      String(process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean)
        .map(hashEmail)
    );
  }
  return adminHashes;
}

function isAdminEmailHash(emailHash) {
  return !!emailHash && getAdminHashes().has(emailHash);
}

async function requireAdmin(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT email_hash FROM users WHERE id = $1', [req.userId]);
    if (!rows[0] || !isAdminEmailHash(rows[0].email_hash)) {
      return res.status(403).json({ error: 'Admins only.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin, isAdminEmailHash };
