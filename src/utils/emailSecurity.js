// src/utils/emailSecurity.js

const crypto = require('crypto');

/*
    Gets the secret key used for the email HMAC.

    EMAIL_HASH_SECRET is preferred.

    JWT_SECRET is used only as a fallback so an older
    configuration can still work.
*/
function getEmailHashSecret() {

    const secret =
        process.env.EMAIL_HASH_SECRET ||
        process.env.JWT_SECRET;

    if (!secret || secret.length < 16) {

        throw new Error(
            'EMAIL_HASH_SECRET (or a strong JWT_SECRET fallback) is required.'
        );
    }

    return secret;
}


/*
    Normalizes the email.

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
    Creates a secure HMAC-SHA256 hash.

    The same Gmail address will always produce
    the same hash when the same secret is used.

    Example:

    user@gmail.com
        ↓
    HMAC-SHA256
        ↓
    64-character hash
*/
function hashEmail(email) {

    return crypto
        .createHmac(
            'sha256',
            getEmailHashSecret()
        )
        .update(
            normalizeEmail(email)
        )
        .digest('hex');
}


module.exports = {
    normalizeEmail,
    hashEmail
};