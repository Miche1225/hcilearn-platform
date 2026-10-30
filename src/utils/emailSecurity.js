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


/*
    Reversible copy of the email, so the admin can send
    reminders to inactive students. AES-256-GCM with a key
    derived from the same secret (so it must not change either).

    Stored as iv.tag.ciphertext (base64).
*/
function emailKey() {

    return crypto
        .createHash('sha256')
        .update('email-encrypt:' + getEmailHashSecret())
        .digest();
}


function encryptEmail(email) {

    const iv =
        crypto.randomBytes(12);

    const cipher =
        crypto.createCipheriv('aes-256-gcm', emailKey(), iv);

    const data =
        Buffer.concat([
            cipher.update(normalizeEmail(email), 'utf8'),
            cipher.final()
        ]);

    return [iv, cipher.getAuthTag(), data]
        .map(b => b.toString('base64'))
        .join('.');
}


function decryptEmail(stored) {

    const [iv, tag, data] =
        String(stored).split('.').map(p => Buffer.from(p, 'base64'));

    const decipher =
        crypto.createDecipheriv('aes-256-gcm', emailKey(), iv);

    decipher.setAuthTag(tag);

    return Buffer.concat([
        decipher.update(data),
        decipher.final()
    ]).toString('utf8');
}


module.exports = {
    normalizeEmail,
    hashEmail,
    encryptEmail,
    decryptEmail
};