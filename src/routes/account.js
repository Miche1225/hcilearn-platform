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


const EMAIL_REGEX =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STUDENT_ID_REGEX =
    /^\d{6}$/;


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
                    !file.mimetype.startsWith('image/')
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
    Only return information that is safe for the frontend.

    The plaintext email and email_hash are NOT returned.
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

                `SELECT
                    id,
                    full_name,
                    year_section,
                    program,
                    student_id,
                    profile_photo

                 FROM public.users

                 WHERE id = $1`,

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

                `SELECT
                    id,
                    full_name,
                    year_section,
                    program,
                    email_hash,
                    student_id,
                    password_hash,
                    profile_photo

                 FROM public.users

                 WHERE id = $1`,

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


            /* =====================================================
               EMAIL UPDATE

               The database stores only email_hash.

               If email is blank/omitted, the existing hash stays.
               If a new email is supplied, its HMAC is stored.
               ===================================================== */

            let newEmailHash =
                user.email_hash;


            if (
                email !== undefined &&
                String(email).trim() !== ''
            ) {

                const normalizedEmail =
                    normalizeEmail(email);


                if (
                    !EMAIL_REGEX.test(
                        normalizedEmail
                    )
                ) {

                    return res.status(400).json({

                        error:
                            'Please enter a valid email address.'

                    });
                }


                const candidateEmailHash =
                    hashEmail(
                        normalizedEmail
                    );


                /*
                    Check if another account already uses it.
                */
                const clash =
                    await pool.query(

                        `SELECT id

                         FROM public.users

                         WHERE email_hash = $1

                         AND id != $2`,

                        [
                            candidateEmailHash,
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


                newEmailHash =
                    candidateEmailHash;
            }


            /* =====================================================
               STUDENT ID VALIDATION
               ===================================================== */

            const newStudentId =
                studentId !== undefined
                    ? String(studentId).trim()
                    : user.student_id;


            if (
                newStudentId &&
                !STUDENT_ID_REGEX.test(
                    newStudentId
                )
            ) {

                return res.status(400).json({

                    error:
                        'Student ID must contain exactly 6 digits.'

                });
            }


            /* =====================================================
               PASSWORD VALIDATION
               ===================================================== */

            if (
                password !== undefined &&
                String(password).length > 0 &&
                String(password).length < 8
            ) {

                return res.status(400).json({

                    error:
                        'Password must be at least 8 characters.'

                });
            }


            const newPasswordHash =
                password &&
                String(password).length >= 8
                    ? bcrypt.hashSync(
                        password,
                        10
                    )
                    : user.password_hash;


            /* =====================================================
               UPDATE ACCOUNT
               ===================================================== */

            const {
                rows: updatedRows
            } = await pool.query(

                `UPDATE public.users SET

                    full_name = $1,

                    year_section = $2,

                    program = $3,

                    email_hash = $4,

                    student_id = $5,

                    password_hash = $6

                 WHERE id = $7

                 RETURNING
                    id,
                    full_name,
                    year_section,
                    program,
                    student_id,
                    profile_photo`,

                [

                    fullName !== undefined &&
                    String(fullName).trim() !== ''
                        ? String(fullName).trim()
                        : user.full_name,

                    yearSection !== undefined
                        ? String(yearSection).trim()
                        : user.year_section,

                    program !== undefined
                        ? String(program).trim()
                        : user.program,

                    newEmailHash,

                    newStudentId || null,

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

                `UPDATE public.users

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

            await pool.query(

                'DELETE FROM public.users WHERE id = $1',

                [req.userId]
            );


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