// src/utils/mailer.js
require('dotenv').config(); // Inilagay sa pinakataas para mabasa agad ang .env
const nodemailer = require('nodemailer');

let transporter = null;
let warnedOnce = false;

function getTransporter() {
  // Kung may transporter na, ito ang gagamitin
  if (transporter) return transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (!warnedOnce) {
      console.warn(
        'EMAIL_USER / EMAIL_PASS not set — login notification emails are disabled.'
      );
      warnedOnce = true;
    }
    return null;
  }

  const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

  return transporter;
}

// Fire-and-forget: callers should NOT await this in a way that blocks the
// login response. Any failure is logged, never thrown back to the caller.
async function sendLoginNotification(toEmail, fullName) {
  const t = getTransporter();
  if (!t) return;

  const when = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const name = fullName || 'there';

  try {
    await t.sendMail({
      from: `"HCILearn" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Security Alert: New login to your HCILearn account',
      text:
        `Hi ${name},\n\n` +
        `We noticed a new login to your HCILearn account (${toEmail}) on ${when} (Philippine time).\n\n` +
        `If this was you, no action is needed.\n` +
        `If you did NOT log in, please change your password right away.\n\n` +
        `— HCILearn`,
      html:
        `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">` +
        `<h2 style="color: #2c3e50;">HCILearn Security Notification</h2>` +
        `<p>Hi <strong>${name}</strong>,</p>` +
        `<p>We noticed a new login to your <strong>HCILearn</strong> account ` +
        `(<strong>${toEmail}</strong>) on <strong>${when}</strong> (Philippine time).</p>` +
        `<p>If this was you, no action is needed.<br>` +
        `If you did <strong>NOT</strong> log in, please change your password right away.</p>` +
        `<br><p>— HCILearn Team</p></div>`,
    });
    console.log('✅ Login notification email successfully sent to:', toEmail);
  } catch (err) {
    console.error('❌ Failed to send login notification email:', err.message);
  }
}

// Fire-and-forget: callers should NOT await this in a way that blocks the
// signup response. Any failure is logged, never thrown back to the caller.
async function sendSignupNotification(toEmail, fullName) {
  const t = getTransporter();
  if (!t) return;

  const when = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const name = fullName || 'there';

  try {
    await t.sendMail({
      from: `"HCILearn" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Welcome to HCILearn — your account was created',
      text:
        `Hi ${name},\n\n` +
        `Your HCILearn account (${toEmail}) was successfully created on ${when} (Philippine time).\n\n` +
        `If you did NOT create this account, please contact us right away.\n\n` +
        `— HCILearn`,
      html:
        `<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">` +
        `<h2 style="color: #2c3e50;">Welcome to HCILearn!</h2>` +
        `<p>Hi <strong>${name}</strong>,</p>` +
        `<p>Your <strong>HCILearn</strong> account (<strong>${toEmail}</strong>) was successfully ` +
        `created on <strong>${when}</strong> (Philippine time).</p>` +
        `<p>If you did <strong>NOT</strong> create this account, please contact us right away.</p>` +
        `<br><p>— HCILearn Team</p></div>`,
    });
    console.log('✅ Signup notification email successfully sent to:', toEmail);
  } catch (err) {
    console.error('❌ Failed to send signup notification email:', err.message);
  }
}

module.exports = { sendLoginNotification, sendSignupNotification };