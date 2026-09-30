// src/utils/mailer.js
// Sends HCILearn's notification emails:
//   - sendSignupNotification        (new account created)
//   - sendLoginNotification         (new login)
//   - sendPasswordResetEmail        (forgot password link)
//   - sendPasswordChangedNotification (password was changed)
//
// Two ways to send (checked in this order):
//   1) BREVO_API_KEY set  -> sends over HTTPS (works on Render FREE, which
//                            blocks SMTP ports 25/465/587).
//   2) EMAIL_USER + EMAIL_PASS set -> Gmail SMTP with an App Password
//                            (works locally and on paid hosts).
//
// Every send function is fire-and-forget safe: it NEVER throws, it only logs.

require('dotenv').config();
const nodemailer = require('nodemailer');

const APP_NAME = 'HCILearn';
let smtpTransport = null;
let warnedNoConfig = false;

// ---------- helpers ----------
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function manilaTime() {
  return new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getProvider() {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (process.env.BREVO_API_KEY && from) return 'brevo';
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) return 'smtp';
  return null;
}

function senderAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER;
}

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  smtpTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      // Google shows App Passwords as "abcd efgh ijkl mnop" - strip the spaces.
      pass: String(process.env.EMAIL_PASS).replace(/\s+/g, ''),
    },
    // Fail fast instead of hanging forever if the host blocks SMTP.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return smtpTransport;
}

async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: APP_NAME, email: senderAddress() },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Brevo API ${res.status}: ${await res.text()}`);
  }
}

// Core sender. Returns true/false, never throws.
async function sendMail({ to, subject, text, html, label }) {
  const provider = getProvider();
  if (!provider) {
    if (!warnedNoConfig) {
      console.warn(
        'Email is disabled: set EMAIL_USER + EMAIL_PASS (Gmail App Password) ' +
        'or BREVO_API_KEY + EMAIL_FROM in your environment variables.'
      );
      warnedNoConfig = true;
    }
    return false;
  }

  try {
    if (provider === 'brevo') {
      await sendViaBrevo({ to, subject, text, html });
    } else {
      await getSmtpTransport().sendMail({
        from: `"${APP_NAME}" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html,
      });
    }
    console.log(`✅ ${label} email sent to ${to} (via ${provider})`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send ${label} email to ${to} (via ${provider}):`, err.message);
    if (provider === 'smtp' && /timeout|ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(err.message)) {
      console.error(
        '   Hint: your host may block SMTP ports (Render free tier does). ' +
        'Set BREVO_API_KEY + EMAIL_FROM to send over HTTPS instead.'
      );
    }
    return false;
  }
}

// Shared HTML layout
function layout(title, bodyHtml) {
  return (
    `<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #333; border: 1px solid #e5e5e5; border-radius: 8px;">` +
    `<h2 style="color: #2c3e50; margin-top: 0;">${esc(title)}</h2>` +
    bodyHtml +
    `<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0 12px;">` +
    `<p style="font-size: 12px; color: #888; margin: 0;">— ${APP_NAME} Team</p>` +
    `</div>`
  );
}

// ---------- public API ----------

// Sent right after a successful signup.
function sendSignupNotification(toEmail, fullName) {
  const name = fullName || 'there';
  const when = manilaTime();
  return sendMail({
    label: 'signup',
    to: toEmail,
    subject: `Welcome to ${APP_NAME} — your account was created`,
    text:
      `Hi ${name},\n\n` +
      `You just signed up for ${APP_NAME} using this email address (${toEmail}) on ${when} (Philippine time).\n\n` +
      `If this was you, welcome aboard! You can now log in and start learning.\n` +
      `If you did NOT create this account, please ignore this email or reply to let us know.\n\n` +
      `— ${APP_NAME}`,
    html: layout(
      `Welcome to ${APP_NAME}!`,
      `<p>Hi <strong>${esc(name)}</strong>,</p>` +
      `<p>You just signed up for <strong>${APP_NAME}</strong> using this email address ` +
      `(<strong>${esc(toEmail)}</strong>) on <strong>${esc(when)}</strong> (Philippine time).</p>` +
      `<p>If this was you, welcome aboard! You can now log in and start learning.</p>` +
      `<p>If you did <strong>NOT</strong> create this account, you can safely ignore this email.</p>`
    ),
  });
}

// Sent on every successful login.
function sendLoginNotification(toEmail, fullName) {
  const name = fullName || 'there';
  const when = manilaTime();
  return sendMail({
    label: 'login notification',
    to: toEmail,
    subject: `Security Alert: New login to your ${APP_NAME} account`,
    text:
      `Hi ${name},\n\n` +
      `We noticed a new login to your ${APP_NAME} account (${toEmail}) on ${when} (Philippine time).\n\n` +
      `If this was you, no action is needed.\n` +
      `If you did NOT log in, please change your password right away.\n\n` +
      `— ${APP_NAME}`,
    html: layout(
      `${APP_NAME} Security Notification`,
      `<p>Hi <strong>${esc(name)}</strong>,</p>` +
      `<p>We noticed a new login to your <strong>${APP_NAME}</strong> account ` +
      `(<strong>${esc(toEmail)}</strong>) on <strong>${esc(when)}</strong> (Philippine time).</p>` +
      `<p>If this was you, no action is needed.<br>` +
      `If you did <strong>NOT</strong> log in, please change your password right away.</p>`
    ),
  });
}

// Sent when someone uses "Forgot Password".
function sendPasswordResetEmail(toEmail, fullName, resetLink, minutesValid) {
  const name = fullName || 'there';
  return sendMail({
    label: 'password reset',
    to: toEmail,
    subject: `Reset your ${APP_NAME} password`,
    text:
      `Hi ${name},\n\n` +
      `We received a request to reset the password for your ${APP_NAME} account (${toEmail}).\n\n` +
      `Open this link to choose a new password (valid for ${minutesValid} minutes):\n${resetLink}\n\n` +
      `If you did NOT request this, you can ignore this email — your password will stay the same.\n\n` +
      `— ${APP_NAME}`,
    html: layout(
      'Reset your password',
      `<p>Hi <strong>${esc(name)}</strong>,</p>` +
      `<p>We received a request to reset the password for your <strong>${APP_NAME}</strong> account ` +
      `(<strong>${esc(toEmail)}</strong>).</p>` +
      `<p style="text-align: center; margin: 28px 0;">` +
      `<a href="${esc(resetLink)}" style="background: #007bff; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Reset Password</a></p>` +
      `<p style="font-size: 13px; color: #555;">This link is valid for <strong>${minutesValid} minutes</strong> and can only be used once. ` +
      `If the button doesn't work, copy and paste this link into your browser:<br>` +
      `<span style="word-break: break-all;">${esc(resetLink)}</span></p>` +
      `<p>If you did <strong>NOT</strong> request this, you can ignore this email — your password will stay the same.</p>`
    ),
  });
}

// Sent after the password was actually changed via the reset link.
function sendPasswordChangedNotification(toEmail, fullName) {
  const name = fullName || 'there';
  const when = manilaTime();
  return sendMail({
    label: 'password changed',
    to: toEmail,
    subject: `Your ${APP_NAME} password was changed`,
    text:
      `Hi ${name},\n\n` +
      `The password for your ${APP_NAME} account (${toEmail}) was changed on ${when} (Philippine time).\n\n` +
      `If this was you, no action is needed.\n` +
      `If you did NOT do this, please reset your password again immediately.\n\n` +
      `— ${APP_NAME}`,
    html: layout(
      'Your password was changed',
      `<p>Hi <strong>${esc(name)}</strong>,</p>` +
      `<p>The password for your <strong>${APP_NAME}</strong> account (<strong>${esc(toEmail)}</strong>) ` +
      `was changed on <strong>${esc(when)}</strong> (Philippine time).</p>` +
      `<p>If this was you, no action is needed.<br>` +
      `If you did <strong>NOT</strong> do this, please reset your password again immediately.</p>`
    ),
  });
}

module.exports = {
  sendSignupNotification,
  sendLoginNotification,
  sendPasswordResetEmail,
  sendPasswordChangedNotification,
};
