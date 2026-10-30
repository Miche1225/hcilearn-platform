// scripts/admin.js
//
// Manage the one admin account for the Admin Dashboard (uses DATABASE_URL from .env).
// HCILearn has exactly one admin account; there are no other staff accounts.
//
//   npm run admin -- create --id 122524 --name "Juan Dela Cruz"
//   npm run admin -- reset-password
//   npm run admin -- rename --name "New Name"
//   npm run admin -- change-id --id 654321
//   npm run admin -- show
//
// The password is typed when asked (hidden), so it never ends up in code,
// .env or your terminal history. For automation you can set the
// ADMIN_PASSWORD environment variable instead.
// Resetting the password logs the admin out everywhere.

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool, ready } = require('../src/db');
const { isValidPassword, PASSWORD_RULES_MESSAGE } = require('../src/utils/passwords');

const args = process.argv.slice(2);
const command = args[0];
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1].trim() : '';
};
const ID_RULE = /^[A-Za-z0-9-]{3,40}$/;

function usage() {
  console.log(`Usage:
  npm run admin -- create --id <admin ID> --name "<full name>"
  npm run admin -- reset-password
  npm run admin -- rename --name "<full name>"
  npm run admin -- change-id --id <new admin ID>
  npm run admin -- show`);
}

// Reads a line without showing what is typed
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text);
      else if (text === '\r\n' || text === '\n') rl.output.write(text);
      else rl.output.write('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function getPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal, or set ADMIN_PASSWORD.');
  const first = await askHidden('Password: ');
  const second = await askHidden('Type it again: ');
  if (first !== second) throw new Error('The passwords did not match.');
  return first;
}

async function main() {
  if (!['create', 'reset-password', 'rename', 'change-id', 'show'].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  await ready;
  const { rows } = await pool.query('SELECT * FROM admin LIMIT 1');
  const admin = rows[0];

  if (command === 'show') {
    if (!admin) console.log('No admin account yet. Create it with: npm run admin -- create --id <ID> --name "<name>"');
    else console.log(`Admin ID ${admin.admin_id}\t${admin.full_name}\tlast login: ${admin.last_login_at ? admin.last_login_at.toISOString() : 'never'}`);
    return;
  }

  if (command === 'create') {
    if (admin) throw new Error(`The admin account already exists (ID ${admin.admin_id}). There can only be one. Use reset-password, rename or change-id.`);
    const id = option('id');
    const name = option('name');
    if (!ID_RULE.test(id)) throw new Error('Give an Admin ID with --id (3-40 letters, numbers or dashes).');
    if (!name) throw new Error('Give the admin\'s name with --name "Full Name".');
    const password = await getPassword();
    if (!isValidPassword(password)) throw new Error(PASSWORD_RULES_MESSAGE);
    await pool.query(
      'INSERT INTO admin (admin_id, full_name, password_hash) VALUES ($1, $2, $3)',
      [id, name, await bcrypt.hash(password, 12)]
    );
    console.log(`Created the admin account for ${name} (ID ${id}).`);
    return;
  }

  if (!admin) throw new Error('No admin account yet. Create it first with: npm run admin -- create --id <ID> --name "<name>"');

  if (command === 'reset-password') {
    const password = await getPassword();
    if (!isValidPassword(password)) throw new Error(PASSWORD_RULES_MESSAGE);
    await pool.query(
      'UPDATE admin SET password_hash = $1, session_version = session_version + 1 WHERE id = $2',
      [await bcrypt.hash(password, 12), admin.id]
    );
    console.log('Admin password changed. The admin was logged out everywhere.');
  } else if (command === 'rename') {
    const name = option('name');
    if (!name) throw new Error('Give the new name with --name "Full Name".');
    await pool.query('UPDATE admin SET full_name = $1 WHERE id = $2', [name, admin.id]);
    console.log(`Admin renamed to ${name}.`);
  } else if (command === 'change-id') {
    const id = option('id');
    if (!ID_RULE.test(id)) throw new Error('Give the new Admin ID with --id (3-40 letters, numbers or dashes).');
    await pool.query('UPDATE admin SET admin_id = $1, session_version = session_version + 1 WHERE id = $2', [id, admin.id]);
    console.log(`Admin ID changed to ${id}. Log in again with the new ID.`);
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
