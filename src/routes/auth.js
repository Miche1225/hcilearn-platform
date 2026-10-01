// src/routes/auth.js

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool } = require('../db');

const {
    requireAuth,
    JWT_SECRET
} = require('../middleware/authGuard');

const {
    normalizeEmail,
    hashEmail
} = require('../utils/emailSecurity');

const {
    sendSignupNotification,
    sendLoginNotification,
    sendPasswordResetEmail,
    sendPasswordChangedNotification
} = require('../utils/mailer');

const EMAIL_REGEX =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_TOKEN_MINUTES = 30;

const RESET_COOLDOWN_SECONDS = 60;


/*
    SHA-256 for password reset tokens.

    Only the hash of the token is stored in
    the database.
*/
function sha256(value) {

    return crypto
        .createHash('sha256')
        .update(value)
        .digest('hex');
}


/*
    Gets the website URL used inside password
    reset emails.
*/
function getBaseUrl(req) {

    if (process.env.APP_URL) {

        return process.env.APP_URL
            .replace(/\/+$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
}


/*
    Password rules:

    - At least 8 characters
    - Cannot be only lowercase letters
    - Cannot be only uppercase letters
    - Cannot be only numbers
*/
function isValidPassword(password) {

    if (
        typeof password !== 'string' ||
        password.length < 8
    ) {
        return false;
    }

    if (/^[a-z]+$/.test(password))
        return false;

    if (/^[A-Z]+$/.test(password))
        return false;

    if (/^[0-9]+$/.test(password))
        return false;

    return true;
}


/*
    Allowed year choices.
*/
const VALID_YEARS =
    new Set([
        '1st Year',
        '2nd Year',
        '3rd Year',
        '4th Year'
    ]);


/*
    Allowed section choices.
*/
const VALID_SECTIONS =
    new Set([
        'A',
        'B',
        'C',
        'D'
    ]);


const router =
    express.Router();


/*
    Cookie settings.
*/
const COOKIE_OPTIONS = {

    httpOnly: true,

    sameSite: 'lax',

    secure:
        process.env.NODE_ENV === 'production',

    maxAge:
        7 * 24 * 60 * 60 * 1000
};


/*
    Creates the user's login session.
*/
function issueSession(res, userId) {

    const token =
        jwt.sign(
            { userId },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

    res.cookie(
        'token',
        token,
        COOKIE_OPTIONS
    );
}


/*
    Controls what user information is
    returned to the frontend.
*/
function publicUser(row) {

    return {

        id: row.id,

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
   SIGN UP
   ========================================================= */

router.post(
    '/signup',
    async (req, res, next) => {

        try {

            const {

                firstName,

                lastName,

                year,

                section,

                program,

                email,

                studentId,

                password

            } = req.body || {};


            /*
                Required fields.
            */
            if (
                !firstName ||
                !lastName ||
                !year ||
                !section ||
                !email ||
                !password
            ) {

                return res.status(400).json({

                    error:
                        'First name, last name, year, section, email and password are required.'

                });
            }


            /*
                Clean user input.
            */
            const cleanFirstName =
                String(firstName).trim();

            const cleanLastName =
                String(lastName).trim();

            const cleanYear =
                String(year).trim();

            const cleanSection =
                String(section)
                    .trim()
                    .toUpperCase();


            /*
                Check names.
            */
            if (
                !cleanFirstName ||
                !cleanLastName
            ) {

                return res.status(400).json({

                    error:
                        'Please enter both your first name and last name.'

                });
            }


            /*
                Check year.
            */
            if (
                !VALID_YEARS.has(cleanYear)
            ) {

                return res.status(400).json({

                    error:
                        'Please select a valid year.'

                });
            }


            /*
                Check section.
            */
            if (
                !VALID_SECTIONS.has(cleanSection)
            ) {

                return res.status(400).json({

                    error:
                        'Please select a valid section.'

                });
            }


            /*
                Normalize Gmail/email.
            */
            const normalizedEmail =
                normalizeEmail(email);


            /*
                Check email format.
            */
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


            /*
                Check password.
            */
            if (
                !isValidPassword(password)
            ) {

                return res.status(400).json({

                    error:
                        'Password must be at least 8 characters and not all letters or all numbers.'

                });
            }


            /*
                Create HMAC hash of email.

                The real email can still be used
                for sending notifications.

                The hash is used for account lookup.
            */
            const emailHash =
                hashEmail(
                    normalizedEmail
                );


            /*
                Check if email already exists.
            */
            const existing =
                await pool.query(
                    'SELECT id FROM users WHERE email_hash = $1',
                    [emailHash]
                );


            if (
                existing.rows.length > 0
            ) {

                return res.status(409).json({

                    error:
                        'An account with that email already exists.'

                });
            }


            /*
                Hash password with bcrypt.
            */
            const passwordHash =
                bcrypt.hashSync(
                    password,
                    10
                );


            /*
                Combine first and last name.

                Example:

                Juan
                Dela Cruz

                becomes:

                Juan Dela Cruz
            */
            const fullName =
                `${cleanFirstName} ${cleanLastName}`;


            /*
                Combine year and section.

                Example:

                3rd Year + A

                becomes:

                3rd Year - Section A
            */
            const yearSection =
                `${cleanYear} - Section ${cleanSection}`;


            /*
                Insert account.
            */
            const insert =
                await pool.query(

                    `INSERT INTO users
                    (
                        full_name,
                        first_name,
                        last_name,
                        year_section,
                        program,
                        email,
                        email_hash,
                        student_id,
                        password_hash
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9
                    )

                    RETURNING id`,

                    [

                        fullName,

                        cleanFirstName,

                        cleanLastName,

                        yearSection,

                        program
                            ? String(program).trim()
                            : null,

                        normalizedEmail,

                        emailHash,

                        studentId
                            ? String(studentId).trim()
                            : null,

                        passwordHash
                    ]
                );


            const userId =
                insert.rows[0].id;


            /*
                Create progress records.
            */
            await pool.query(
                'INSERT INTO case_study_progress (user_id) VALUES ($1)',
                [userId]
            );

            await pool.query(
                'INSERT INTO study_card_progress (user_id) VALUES ($1)',
                [userId]
            );

            await pool.query(
                'INSERT INTO lesson_progress (user_id) VALUES ($1)',
                [userId]
            );


            /*
                Log the user in immediately.
            */
            issueSession(
                res,
                userId
            );


            /*
                Get complete user information.
            */
            const {
                rows
            } = await pool.query(

                'SELECT * FROM users WHERE id = $1',

                [userId]
            );


            /*
                Send signup email.

                This does not block signup.
            */
            sendSignupNotification(
                rows[0].email,
                rows[0].full_name
            );


            res.status(201).json({

                user:
                    publicUser(rows[0])

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   LOGIN
   ========================================================= */

router.post(
    '/login',
    async (req, res, next) => {

        try {

            const {
                email,
                password
            } = req.body || {};


            if (
                !email ||
                !password
            ) {

                return res.status(400).json({

                    error:
                        'Email and password are required.'

                });
            }


            const normalizedEmail =
                normalizeEmail(email);


            /*
                Find account using HMAC email hash.
            */
            const {
                rows
            } = await pool.query(

                `SELECT *
                 FROM users
                 WHERE email_hash = $1`,

                [
                    hashEmail(
                        normalizedEmail
                    )
                ]
            );


            const user =
                rows[0];


            /*
                Check password.
            */
            if (
                !user ||
                !bcrypt.compareSync(
                    password,
                    user.password_hash
                )
            ) {

                return res.status(401).json({

                    error:
                        'Invalid email or password.'

                });
            }


            /*
                Login session.
            */
            issueSession(
                res,
                user.id
            );


            /*
                Login notification.
            */
            sendLoginNotification(
                user.email,
                user.full_name
            );


            res.json({

                user:
                    publicUser(user)

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   FORGOT PASSWORD
   ========================================================= */

router.post(
    '/forgot-password',
    async (req, res, next) => {

        try {

            const email =
                normalizeEmail(
                    (req.body &&
                        req.body.email) ||
                    ''
                );


            /*
                Validate email format.
            */
            if (
                !EMAIL_REGEX.test(email)
            ) {

                return res.status(400).json({

                    error:
                        'Please enter a valid email address.'

                });
            }


            /*
                Search using email HMAC.

                The original email is still stored
                in the account so the system can
                send password reset messages.
            */
            const {
                rows
            } = await pool.query(

                `SELECT
                    id,
                    full_name,
                    email

                 FROM users

                 WHERE email_hash = $1`,

                [
                    hashEmail(email)
                ]
            );


            const user =
                rows[0];


            /*
                EMAIL NOT REGISTERED
            */
            if (!user) {

                return res.status(404).json({

                    error:
                        'This email is not registered.'

                });
            }


            /*
                Prevent reset email spam.
            */
            const recent =
                await pool.query(

                    `SELECT 1

                     FROM password_resets

                     WHERE user_id = $1

                     AND created_at >

                     NOW() -

                     ($2 || ' seconds')::interval`,

                    [

                        user.id,

                        String(
                            RESET_COOLDOWN_SECONDS
                        )

                    ]
                );


            /*
                Recently requested a reset.
            */
            if (
                recent.rows.length > 0
            ) {

                return res.status(429).json({

                    error:
                        'A password reset link was recently sent. Please wait before requesting another one.'

                });
            }


            /*
                Generate random reset token.
            */
            const token =
                crypto
                    .randomBytes(32)
                    .toString('hex');


            /*
                Delete old reset tokens.
            */
            await pool.query(

                'DELETE FROM password_resets WHERE user_id = $1',

                [
                    user.id
                ]
            );


            /*
                Store only SHA-256 hash
                of reset token.
            */
            await pool.query(

                `INSERT INTO password_resets
                (
                    user_id,
                    token_hash,
                    expires_at
                )

                VALUES
                (
                    $1,
                    $2,
                    NOW() +
                    ($3 || ' minutes')::interval
                )`,

                [

                    user.id,

                    sha256(token),

                    String(
                        RESET_TOKEN_MINUTES
                    )

                ]
            );


            /*
                Create reset link.
            */
            const link =
                `${getBaseUrl(req)}/update-password.html?token=${token}`;


            /*
                Send reset email.
            */
            sendPasswordResetEmail(

                user.email,

                user.full_name,

                link,

                RESET_TOKEN_MINUTES

            );


            /*
                SUCCESS RESPONSE
            */
            return res.json({

                ok: true,

                message:
                    'Password reset link sent. Please check your email.'

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   RESET PASSWORD
   ========================================================= */

router.post(
    '/reset-password',
    async (req, res, next) => {

        try {

            const {
                token,
                password
            } = req.body || {};


            if (
                !token ||
                typeof token !== 'string'
            ) {

                return res.status(400).json({

                    error:
                        'Reset link is missing or invalid. Please request a new one.'

                });
            }


            if (
                !isValidPassword(password)
            ) {

                return res.status(400).json({

                    error:
                        'Password must be at least 8 characters and not all letters or all numbers.'

                });
            }


            /*
                Search reset token using
                SHA-256 hash.
            */
            const {
                rows
            } = await pool.query(

                `SELECT
                    u.id AS user_id,
                    u.full_name,
                    u.email

                 FROM password_resets pr

                 JOIN users u
                 ON u.id = pr.user_id

                 WHERE pr.token_hash = $1

                 AND pr.expires_at > NOW()`,

                [
                    sha256(token)
                ]
            );


            const match =
                rows[0];


            if (!match) {

                return res.status(400).json({

                    error:
                        'This reset link is invalid or has expired. Please request a new one.'

                });
            }


            /*
                Hash new password.
            */
            const newPasswordHash =
                bcrypt.hashSync(
                    password,
                    10
                );


            await pool.query(

                `UPDATE users
                 SET password_hash = $1
                 WHERE id = $2`,

                [
                    newPasswordHash,

                    match.user_id
                ]
            );


            /*
                Make reset link single-use.
            */
            await pool.query(

                `DELETE FROM password_resets
                 WHERE user_id = $1`,

                [
                    match.user_id
                ]
            );


            /*
                Notify account owner.
            */
            sendPasswordChangedNotification(

                match.email,

                match.full_name

            );


            res.json({

                ok: true,

                message:
                    'Password updated. You can now log in.'

            });

        } catch (err) {

            next(err);
        }
    }
);


/* =========================================================
   LOGOUT
   ========================================================= */

router.post(
    '/logout',
    (req, res) => {

        res.clearCookie(
            'token',
            COOKIE_OPTIONS
        );

        res.json({
            ok: true
        });
    }
);


/* =========================================================
   CURRENT USER
   ========================================================= */

router.get(
    '/me',
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


module.exports = router;