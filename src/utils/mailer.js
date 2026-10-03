// src/utils/mailer.js

/*
    Sends HCILearn notification emails:

    - Signup notification
    - Login notification
    - Password reset email

    IMPORTANT:
    The database does NOT need to store the plaintext email.
    The email address is supplied only for the current request.

    The email greeting uses FIRST NAME only.
*/

require('dotenv').config();

const nodemailer =
    require('nodemailer');


const APP_NAME =
    'HCILearn';


let smtpTransport =
    null;


let warnedNoConfig =
    false;


/* =========================================================
   HELPERS
   ========================================================= */


/*
    Escape HTML characters.
*/
function esc(value) {

    return String(
        value == null
            ? ''
            : value
    ).replace(
        /[&<>"']/g,
        (c) => ({

            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'

        }[c])
    );
}


/*
    Philippine time.
*/
function manilaTime() {

    return new Date().toLocaleString(
        'en-PH',
        {
            timeZone: 'Asia/Manila',
            dateStyle: 'medium',
            timeStyle: 'short'
        }
    );
}


/*
    Get email provider.
*/
function getProvider() {

    const from =
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER;


    if (
        process.env.BREVO_API_KEY &&
        from
    ) {

        return 'brevo';
    }


    if (
        process.env.EMAIL_USER &&
        process.env.EMAIL_PASS
    ) {

        return 'smtp';
    }


    return null;
}


/*
    Sender email.
*/
function senderAddress() {

    return (
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER
    );
}


/*
    Gmail SMTP transport.
*/
function getSmtpTransport() {

    if (smtpTransport) {

        return smtpTransport;
    }


    smtpTransport =
        nodemailer.createTransport({

            host:
                'smtp.gmail.com',

            port:
                465,

            secure:
                true,

            auth: {

                user:
                    process.env.EMAIL_USER,

                pass:
                    String(
                        process.env.EMAIL_PASS
                    ).replace(
                        /\s+/g,
                        ''
                    )

            },

            connectionTimeout:
                15000,

            greetingTimeout:
                15000,

            socketTimeout:
                20000

        });


    return smtpTransport;
}


/*
    Send through Brevo.
*/
async function sendViaBrevo({
    to,
    subject,
    text,
    html
}) {

    const res =
        await fetch(
            'https://api.brevo.com/v3/smtp/email',
            {

                method:
                    'POST',

                headers: {

                    accept:
                        'application/json',

                    'content-type':
                        'application/json',

                    'api-key':
                        process.env.BREVO_API_KEY

                },

                body:
                    JSON.stringify({

                        sender: {

                            name:
                                APP_NAME,

                            email:
                                senderAddress()

                        },

                        to: [
                            {
                                email: to
                            }
                        ],

                        subject,

                        textContent:
                            text,

                        htmlContent:
                            html

                    })

            }
        );


    if (!res.ok) {

        throw new Error(
            `Brevo API ${res.status}: ${await res.text()}`
        );
    }
}


/*
    Core mail sender.

    Never throws to the route.
*/
async function sendMail({
    to,
    subject,
    text,
    html,
    label
}) {

    const provider =
        getProvider();


    if (!provider) {

        if (!warnedNoConfig) {

            console.warn(
                'Email is disabled. Set EMAIL_USER + EMAIL_PASS or BREVO_API_KEY + EMAIL_FROM.'
            );

            warnedNoConfig =
                true;
        }


        return false;
    }


    try {

        if (
            provider === 'brevo'
        ) {

            await sendViaBrevo({

                to,
                subject,
                text,
                html

            });

        } else {

            await getSmtpTransport()
                .sendMail({

                    from:
                        `"${APP_NAME}" <${process.env.EMAIL_USER}>`,

                    to,

                    subject,

                    text,

                    html

                });
        }


        console.log(
            `✅ ${label} email sent to ${to} via ${provider}`
        );


        return true;

    } catch (err) {

        console.error(

            `❌ Failed to send ${label} email to ${to} via ${provider}:`,

            err.message

        );


        if (
            provider === 'smtp' &&
            /timeout|ETIMEDOUT|ECONNREFUSED|ESOCKET/i
                .test(err.message)
        ) {

            console.error(
                'Hint: Render Free may block SMTP. Use BREVO_API_KEY + EMAIL_FROM.'
            );
        }


        return false;
    }
}


/*
    Shared email HTML layout.
*/
function layout(
    title,
    bodyHtml
) {

    return (

        `<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #333; border: 1px solid #e5e5e5; border-radius: 8px;">` +

        `<h2 style="color: #2c3e50; margin-top: 0;">${esc(title)}</h2>` +

        bodyHtml +

        `<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0 12px;">` +

        `<p style="font-size: 12px; color: #888; margin: 0;">— ${APP_NAME} Team</p>` +

        `</div>`

    );
}


/* =========================================================
   SIGNUP EMAIL
   ========================================================= */


/*
    Send after successful signup.

    SECOND PARAMETER = firstName
*/
function sendSignupNotification(
    toEmail,
    firstName
) {

    const name =
        firstName || 'there';


    const when =
        manilaTime();


    return sendMail({

        label:
            'signup',

        to:
            toEmail,

        subject:
            `Welcome to ${APP_NAME} — your account was created`,

        text:

            `Hi ${name},\n\n` +

            `You just signed up for ${APP_NAME} using this email address (${toEmail}) on ${when} (Philippine time).\n\n` +

            `If this was you, welcome aboard! You can now log in and start learning.\n` +

            `If you did NOT create this account, please ignore this email or reply to let us know.\n\n` +

            `— ${APP_NAME}`,

        html:
            layout(

                `Welcome to ${APP_NAME}!`,

                `<p>Hi <strong>${esc(name)}</strong>,</p>` +

                `<p>You just signed up for <strong>${APP_NAME}</strong> using this email address ` +

                `(<strong>${esc(toEmail)}</strong>) on <strong>${esc(when)}</strong> (Philippine time).</p>` +

                `<p>If this was you, welcome aboard! You can now log in and start learning.</p>` +

                `<p>If you did <strong>NOT</strong> create this account, you can safely ignore this email.</p>`

            )

    });
}


/* =========================================================
   LOGIN EMAIL
   ========================================================= */


/*
    Send after successful login.

    SECOND PARAMETER = firstName
*/
function sendLoginNotification(
    toEmail,
    firstName
) {

    const name =
        firstName || 'there';


    const when =
        manilaTime();


    return sendMail({

        label:
            'login notification',

        to:
            toEmail,

        subject:
            `Security Alert: New login to your ${APP_NAME} account`,

        text:

            `Hi ${name},\n\n` +

            `We noticed a new login to your ${APP_NAME} account on ${when} (Philippine time).\n\n` +

            `If this was you, no action is needed.\n` +

            `If you did NOT log in, please change your password right away.\n\n` +

            `— ${APP_NAME}`,

        html:
            layout(

                `${APP_NAME} Security Notification`,

                `<p>Hi <strong>${esc(name)}</strong>,</p>` +

                `<p>We noticed a new login to your <strong>${APP_NAME}</strong> account ` +

                `on <strong>${esc(when)}</strong> (Philippine time).</p>` +

                `<p>If this was you, no action is needed.<br>` +

                `If you did <strong>NOT</strong> log in, please change your password right away.</p>`

            )

    });
}


/* =========================================================
   PASSWORD RESET EMAIL
   ========================================================= */


/*
    Send when user requests Forgot Password.

    SECOND PARAMETER = firstName
*/
function sendPasswordResetEmail(
    toEmail,
    firstName,
    resetLink,
    minutesValid
) {

    const name =
        firstName || 'there';


    return sendMail({

        label:
            'password reset',

        to:
            toEmail,

        subject:
            `Reset your ${APP_NAME} password`,

        text:

            `Hi ${name},\n\n` +

            `We received a request to reset the password for your ${APP_NAME} account.\n\n` +

            `Open this link to choose a new password (valid for ${minutesValid} minutes):\n` +

            `${resetLink}\n\n` +

            `If you did NOT request this, you can ignore this email — your password will stay the same.\n\n` +

            `— ${APP_NAME}`,

        html:
            layout(

                'Reset your password',

                `<p>Hi <strong>${esc(name)}</strong>,</p>` +

                `<p>We received a request to reset the password for your <strong>${APP_NAME}</strong> account.</p>` +

                `<p style="text-align: center; margin: 28px 0;">` +

                `<a href="${esc(resetLink)}" style="background: #007bff; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">` +

                `Reset Password` +

                `</a></p>` +

                `<p style="font-size: 13px; color: #555;">` +

                `This link is valid for <strong>${minutesValid} minutes</strong> and can only be used once. ` +

                `If the button doesn't work, copy and paste this link into your browser:<br>` +

                `<span style="word-break: break-all;">${esc(resetLink)}</span>` +

                `</p>` +

                `<p>If you did <strong>NOT</strong> request this, you can ignore this email — your password will stay the same.</p>`

            )

    });
}


/* =========================================================
   EXPORT
   ========================================================= */

module.exports = {

    sendSignupNotification,

    sendLoginNotification,

    sendPasswordResetEmail

};