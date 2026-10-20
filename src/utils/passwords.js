// src/utils/passwords.js
//
// One set of password rules for sign up, reset and account changes.

// bcrypt only uses the first 72 bytes of a password, so longer ones are
// rejected instead of being silently cut off.
const MAX_PASSWORD_BYTES = 72;

const PASSWORD_RULES_MESSAGE =
    'Password must be 8–72 characters and not all letters or all numbers.';

/*
    Password rules:

    - At least 8 characters (at most 72 bytes)
    - Cannot be only lowercase letters
    - Cannot be only uppercase letters
    - Cannot be only numbers
*/
function isValidPassword(password) {

    if (typeof password !== 'string' || password.length < 8)
        return false;

    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES)
        return false;

    if (/^[a-z]+$/.test(password))
        return false;

    if (/^[A-Z]+$/.test(password))
        return false;

    if (/^[0-9]+$/.test(password))
        return false;

    return true;
}

module.exports = { isValidPassword, PASSWORD_RULES_MESSAGE };
