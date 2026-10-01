// src/utils/emailSecurity.js

const crypto = require('crypto');


/*
    The email hash uses a dedicated server-side secret.

    IMPORTANT:
    Keep EMAIL_HASH_SECRET the same after users have been created.
    Changing the secret changes every email hash and existing users
    would no longer be found by email.
*/
function getEmailHashSecret() {

    const secret =
        process.env.EMAIL_HASH_SECRET;

    if (
        !secret ||
        secret.length < 32
    ) {

        throw new Error(
            'EMAIL_HASH_SECRET is required and must be at least 32 characters long.'
        );
    }

    return secret;
}


/*
    Normalize email before hashing.

    Example:

    JUAN@GMAIL.COM
    Juan@gmail.com
    juan@gmail.com

    all become:

    juan@gmail.com
*/
function normalizeEmail(email) {

    return String(email || '')
        .trim()
        .toLowerCase();
}


/*
    Create a deterministic HMAC-SHA256 hash.

    The raw email is NOT stored in the users table.
*/
function hashEmail(email) {

    return crypto
        .createHmac(
            'sha256',
            getEmailHashSecret()
        )
        .update(
            normalizeEmail(email),
            'utf8'
        )
        .digest('hex');
}


module.exports = {
    normalizeEmail,
    hashEmail
};