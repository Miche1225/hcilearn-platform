// src/routes/auth.js

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const { pool } = require('../db');

const {
    requireAuth,
    issueSession,
    clearSession,
    IS_PRODUCTION
} = require('../middleware/authGuard');

const { rateLimit } = require('../middleware/rateLimit');

const {
    isValidPassword,
    PASSWORD_RULES_MESSAGE
} = require('../utils/passwords');

const {
    normalizeEmail,
    hashEmail,
    encryptEmail
} = require('../utils/emailSecurity');

const {
    sendSignupNotification,
    sendLoginNotification,
    sendPasswordResetEmail,
} = require('../utils/mailer');

const EMAIL_REGEX =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_TOKEN_MINUTES = 30;

const RESET_COOLDOWN_SECONDS = 60;

const STUDENT_ID_REGEX = /^\d{6}$/;

// Maximum lengths for text fields (stops huge values being stored)
const MAX_NAME = 60;
const MAX_PROGRAM = 80;
const MAX_EMAIL = 254;

// Same reply whether or not the email is registered, so nobody can use
// "Forgot password" to find out who has an account.
const FORGOT_PASSWORD_REPLY =
    'If that email is registered, a password reset link has been sent. Please check your inbox.';

// Used when the email isn't registered so the login check takes about the
// same time either way (no timing hint that an account exists).
const DUMMY_PASSWORD_HASH =
    bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);


/* ---------------------------------------------------------
   Rate limits (per IP address, plus per email for login)
   --------------------------------------------------------- */

const MINUTE = 60 * 1000;

const loginLimiter = rateLimit({
    windowMs: 15 * MINUTE,
    max: 10,
    keyFn: (req) => `login:${req.ip}:${String((req.body && req.body.email) || '').trim().toLowerCase()}`,
    message: 'Too many login attempts. Please wait 15 minutes and try again.'
});

const loginIpLimiter = rateLimit({
    windowMs: 15 * MINUTE,
    max: 50,
    keyFn: (req) => `login-ip:${req.ip}`,
    message: 'Too many login attempts. Please wait 15 minutes and try again.'
});

const signupLimiter = rateLimit({
    windowMs: 60 * MINUTE,
    max: 10,
    keyFn: (req) => `signup:${req.ip}`,
    message: 'Too many sign-up attempts. Please try again later.'
});

const forgotLimiter = rateLimit({
    windowMs: 15 * MINUTE,
    max: 5,
    keyFn: (req) => `forgot:${req.ip}`,
    message: 'Too many reset requests. Please wait 15 minutes and try again.'
});

const resetLimiter = rateLimit({
    windowMs: 15 * MINUTE,
    max: 10,
    keyFn: (req) => `reset:${req.ip}`,
    message: 'Too many attempts. Please wait 15 minutes and try again.'
});


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

    /*
        In production the reset link must come from APP_URL. Building it
        from the request's Host header would let someone send reset emails
        that point to their own website.
    */
    if (IS_PRODUCTION) {

        throw new Error('APP_URL must be set in production.');
    }

    return `${req.protocol}://${req.get('host')}`;
}


/*
    Allowed year choices. Only 1st and 2nd year IT take HCI.
    (Existing 3rd/4th year accounts keep working.)
*/
const VALID_YEARS =
    new Set([
        '1st Year',
        '2nd Year'
    ]);


/*
    Allowed section choices: A to Z, so a big incoming
    batch never runs out of sections.
*/
const VALID_SECTIONS =
    new Set(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    );


const router =
    express.Router();


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
    signupLimiter,
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
                Check lengths.
            */
            const cleanProgram =
                program ? String(program).trim() : '';

            if (
                cleanFirstName.length > MAX_NAME ||
                cleanLastName.length > MAX_NAME ||
                cleanProgram.length > MAX_PROGRAM ||
                String(email).length > MAX_EMAIL
            ) {

                return res.status(400).json({

                    error:
                        'One of the fields is too long.'

                });
            }


            /*
                Check student ID (exactly 6 digits).
            */
            const cleanStudentId =
                studentId ? String(studentId).trim() : '';

            if (
                cleanStudentId &&
                !STUDENT_ID_REGEX.test(cleanStudentId)
            ) {

                return res.status(400).json({

                    error:
                        'Student ID must contain exactly 6 digits.'

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
                        PASSWORD_RULES_MESSAGE

                });
            }


            /*
                Create HMAC hash of email.

                The real email is NOT stored in users.
                It is only used during this request
                to send the signup notification.
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
                await bcrypt.hash(
                    password,
                    10
                );


            /*
                Combine first and last name.
            */
            const fullName =
                `${cleanFirstName} ${cleanLastName}`;


            /*
                Combine year and section.
            */
            const yearSection =
                `${cleanYear} - Section ${cleanSection}`;


            /*
                Insert account.

                NOTE:
                There is NO email column here.
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
                        email_hash,
                        student_id,
                        password_hash,
                        email_enc
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

                        cleanProgram || null,

                        emailHash,

                        cleanStudentId || null,

                        passwordHash,

                        encryptEmail(normalizedEmail)
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
                userId,
                0
            );


            /*
                Get user information.
            */
            const {
                rows
            } = await pool.query(

                'SELECT * FROM users WHERE id = $1',

                [userId]
            );


            /*
                Send signup email to the email
                supplied in the current request.

                It is not stored in users.
            */
            sendSignupNotification(
                normalizedEmail,
                rows[0].first_name
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
    loginIpLimiter,
    loginLimiter,
    async (req, res, next) => {

        try {

            const {
                email,
                password
            } = req.body || {};


            if (
                !email ||
                !password ||
                typeof password !== 'string'
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

                When the email isn't registered we still compare against a
                dummy hash, so the reply takes the same time either way.
            */
            const passwordOk =
                await bcrypt.compare(
                    password,
                    user ? user.password_hash : DUMMY_PASSWORD_HASH
                );

            if (
                !user ||
                !passwordOk
            ) {

                return res.status(401).json({

                    error:
                        'Invalid email or password.'

                });
            }


            /*
                Deactivated by the admin (checked after the password,
                so it does not reveal which accounts exist).
            */
            if (user.disabled_at) {
                return res.status(403).json({
                    error:
                        'This account has been deactivated. Please contact the admin.'
                });
            }


            /*
                Login session.
            */
            issueSession(
                res,
                user.id,
                user.session_version
            );


            /*
                Keep the encrypted email current (older accounts only
                get one here) so the admin can send reminders.
            */
            await pool.query(
                'UPDATE users SET email_enc = $1 WHERE id = $2',
                [encryptEmail(normalizedEmail), user.id]
            );


            /*
                Login notification.

                Email comes from the current request
                instead of the database.
            */
            sendLoginNotification(
                normalizedEmail,
                user.first_name
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
    forgotLimiter,
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
                Search using the HMAC email hash.

                The plaintext email is only kept in the
                current request and is not stored in users.
            */
            const {
                rows
            } = await pool.query(

                `SELECT
                    id,
                    first_name

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

                Same reply as a real request, so this can't be used to
                check which emails have accounts.
            */
            if (!user) {

                return res.json({

                    ok: true,

                    message:
                        FORGOT_PASSWORD_REPLY

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
                Recently requested a reset: don't send another email,
                but reply the same way (no hint that the account exists).
            */
            if (
                recent.rows.length > 0
            ) {

                return res.json({

                    ok: true,

                    message:
                        FORGOT_PASSWORD_REPLY

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

                The email comes from the current request,
                not from the database.
            */
            sendPasswordResetEmail(

                email,

                user.first_name,

                link,

                RESET_TOKEN_MINUTES

            );


            /*
                SUCCESS RESPONSE
            */
            return res.json({

                ok: true,

                message:
                    FORGOT_PASSWORD_REPLY

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
    resetLimiter,
    async (req, res, next) => {

        try {

            const {
                token,
                password
            } = req.body || {};


            if (
                !token ||
                typeof token !== 'string' ||
                !/^[a-f0-9]{64}$/.test(token)
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
                        PASSWORD_RULES_MESSAGE

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
                    u.full_name

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
                await bcrypt.hash(
                    password,
                    10
                );


            /*
                Save the new password and bump the session version,
                which logs out every device still using the old password.
            */
            await pool.query(

                `UPDATE users
                 SET password_hash = $1,
                     session_version = session_version + 1
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

        clearSession(res);

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