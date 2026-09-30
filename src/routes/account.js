// src/routes/account.js

const express = require('express');
const bcrypt = require('bcryptjs');

const {
    pool
} = require('../db');

const {
    requireAuth
} = require('../middleware/authGuard');

const {
    normalizeEmail,
    hashEmail
} = require('../utils/emailSecurity');

const cloudinary =
    require('cloudinary').v2;

const multer =
    require('multer');

const streamifier =
    require('streamifier');


/*
    Cloudinary configuration.
*/
cloudinary.config({

    cloud_name:
        process.env.CLOUDINARY_CLOUD_NAME,

    api_key:
        process.env.CLOUDINARY_API_KEY,

    api_secret:
        process.env.CLOUDINARY_API_SECRET

});


const router =
    express.Router();


/*
    Image upload configuration.
*/
const upload =
    multer({

        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                3 * 1024 * 1024
        },

        fileFilter:
            (req, file, cb) => {

                if (
                    !file.mimetype.startsWith(
                        'image/'
                    )
                ) {

                    return cb(
                        new Error(
                            'Only image files are allowed.'
                        )
                    );
                }

                cb(null, true);
            }

    });


/*
    Upload profile photo to Cloudinary.
*/
function uploadToCloudinary(
    buffer,
    userId
) {

    return new Promise(
        (resolve, reject) => {

            const uploadStream =
                cloudinary
                    .uploader
                    .upload_stream(

                        {
                            folder:
                                'hcilearn/profile_photos',

                            public_id:
                                `user${userId}`,

                            overwrite:
                                true
                        },

                        (err, result) => {

                            if (err)
                                reject(err);

                            else
                                resolve(result);
                        }
                    );


            streamifier
                .createReadStream(buffer)
                .pipe(uploadStream);
        }
    );
}


/*
    User data returned to frontend.
*/
function publicUser(row) {

    return {

        id:
            row.id,

        fullName:
            row.full_name,

        yearSection:
            row.year_section,

        program:
            row.program,

        email:
            row.email,

        studentId:
            row.student_id,

        profilePhoto:
            row.profile_photo

    };
}


/* =========================================================
   GET ACCOUNT
   ========================================================= */

router.get(
    '/',
    requireAuth,
    async (req, res, next) => {

        try {

            const {
                rows
            } = await pool.query(

                'SELECT * FROM users WHERE id = $1',

                [req.userId]
            );


            if (!rows[0]) {

                return res.status(404).json({

                    error:
                        'User not found.'

                });
            }


            res.json({

                user:
                    publicUser(rows[0])

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   UPDATE ACCOUNT
   ========================================================= */

router.put(
    '/',
    requireAuth,
    async (req, res, next) => {

        try {

            const {

                fullName,

                yearSection,

                program,

                email,

                studentId,

                password

            } = req.body || {};


            /*
                Get current account.
            */
            const {
                rows
            } = await pool.query(

                'SELECT * FROM users WHERE id = $1',

                [req.userId]
            );


            const user =
                rows[0];


            if (!user) {

                return res.status(404).json({

                    error:
                        'User not found.'

                });
            }


            /*
                Normalize new email.

                If no new email was entered,
                keep current email.
            */
            const normalizedEmail =
                email
                    ? normalizeEmail(email)
                    : user.email;


            /*
                Check whether the email
                belongs to another account.
            */
            if (
                email &&
                normalizedEmail !== user.email
            ) {

                const clash =
                    await pool.query(

                        `SELECT id

                         FROM users

                         WHERE email_hash = $1

                         AND id != $2`,

                        [
                            hashEmail(
                                normalizedEmail
                            ),

                            req.userId
                        ]
                    );


                if (
                    clash.rows.length > 0
                ) {

                    return res.status(409).json({

                        error:
                            'That email is already in use.'

                    });
                }
            }


            /*
                Password validation.
            */
            if (
                password &&
                password.length > 0 &&
                password.length < 6
            ) {

                return res.status(400).json({

                    error:
                        'Password must be at least 6 characters.'

                });
            }


            /*
                Create new password hash
                when password is changed.
            */
            const newPasswordHash =

                password &&
                password.length >= 6

                    ? bcrypt.hashSync(
                        password,
                        10
                    )

                    : user.password_hash;


            /*
                Update account.
            */
            const {
                rows: updatedRows
            } = await pool.query(

                `UPDATE users SET

                    full_name = $1,

                    year_section = $2,

                    program = $3,

                    email = $4,

                    email_hash = $5,

                    student_id = $6,

                    password_hash = $7

                 WHERE id = $8

                 RETURNING *`,

                [

                    fullName
                        ? fullName.trim()
                        : user.full_name,

                    yearSection !== undefined
                        ? yearSection
                        : user.year_section,

                    program !== undefined
                        ? program
                        : user.program,

                    normalizedEmail,

                    hashEmail(
                        normalizedEmail
                    ),

                    studentId !== undefined
                        ? studentId
                        : user.student_id,

                    newPasswordHash,

                    req.userId
                ]
            );


            res.json({

                user:
                    publicUser(
                        updatedRows[0]
                    )

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   UPLOAD PROFILE PHOTO
   ========================================================= */

router.post(
    '/photo',
    requireAuth,
    upload.single('photo'),
    async (req, res, next) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    error:
                        'No file uploaded.'

                });
            }


            const result =
                await uploadToCloudinary(

                    req.file.buffer,

                    req.userId
                );


            const url =
                result.secure_url;


            await pool.query(

                `UPDATE users
                 SET profile_photo = $1
                 WHERE id = $2`,

                [
                    url,

                    req.userId
                ]
            );


            res.json({

                profilePhoto:
                    url

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   DELETE ACCOUNT
   ========================================================= */

router.delete(
    '/',
    requireAuth,
    async (req, res, next) => {

        try {

            /*
                Delete user.

                ON DELETE CASCADE will remove
                related progress records.
            */
            await pool.query(

                'DELETE FROM users WHERE id = $1',

                [req.userId]
            );


            /*
                Remove login cookie.
            */
            res.clearCookie('token');


            res.json({

                ok: true

            });

        } catch (err) {

            next(err);
        }
    }
);


module.exports = router;