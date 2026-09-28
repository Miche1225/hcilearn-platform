// src/routes/account.js
const express = require('express');
const multer = require('multer');
const streamifier = require('streamifier');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Files are held in memory just long enough to stream them to Cloudinary —
// nothing touches the server's local (ephemeral) disk anymore.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

function uploadToCloudinary(buffer, userId) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'hcilearn/profile_photos', public_id: `user${userId}`, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    yearSection: row.year_section,
    program: row.program,
    email: row.email,
    studentId: row.student_id,
    profilePhoto: row.profile_photo,
  };
}

// GET /api/account
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/account  (profile fields; password optional)
router.put('/', requireAuth, async (req, res, next) => {
  try {
    const { fullName, yearSection, program, email, studentId, password } = req.body || {};

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (email && email.toLowerCase().trim() !== user.email) {
      const clash = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [
        email.toLowerCase().trim(),
        req.userId,
      ]);
      if (clash.rows.length > 0) return res.status(409).json({ error: 'That email is already in use.' });
    }

    if (password && password.length > 0 && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const newPasswordHash = password && password.length >= 6
      ? bcrypt.hashSync(password, 10)
      : user.password_hash;

    const { rows: updatedRows } = await pool.query(
      `UPDATE users SET
         full_name = $1, year_section = $2, program = $3, email = $4, student_id = $5, password_hash = $6
       WHERE id = $7 RETURNING *`,
      [
        fullName ? fullName.trim() : user.full_name,
        yearSection !== undefined ? yearSection : user.year_section,
        program !== undefined ? program : user.program,
        email ? email.toLowerCase().trim() : user.email,
        studentId !== undefined ? studentId : user.student_id,
        newPasswordHash,
        req.userId,
      ]
    );

    res.json({ user: publicUser(updatedRows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/account/photo  (multipart/form-data, field name "photo")
router.post('/photo', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const result = await uploadToCloudinary(req.file.buffer, req.userId);
    const url = result.secure_url;

    await pool.query('UPDATE users SET profile_photo = $1 WHERE id = $2', [url, req.userId]);

    res.json({ profilePhoto: url });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/account
router.delete('/', requireAuth, async (req, res, next) => {
  try {
    // Buburahin ang user. Dahil may ON DELETE CASCADE ang database,
    // awtomatikong mabubura ang lahat ng progress tables nila.
    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);

    // Tanggalin ang login session cookie
    res.clearCookie('token');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
