// scripts/instructor.js
//
// Manage instructor accounts for the Admin Dashboard (uses DATABASE_URL from .env).
//
//   npm run instructor -- add --id 122524 --name "Juan Dela Cruz" [--role admin]
//   npm run instructor -- set-role --id 122524 --role admin|instructor
//   npm run instructor -- reset-password --id 122524
//   npm run instructor -- rename --id 122524 --name "New Name"
//   npm run instructor -- remove --id 122524
//   npm run instructor -- list
//
// The password is typed when asked (hidden), so it never ends up in code,
// .env or your terminal history. For automation you can set the
// INSTRUCTOR_PASSWORD environment variable instead.
// Resetting a password logs that instructor out everywhere.

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

function usage() {
  console.log(`Usage:
  npm run instructor -- add --id <instructor ID> --name "<full name>" [--role admin]
  npm run instructor -- set-role --id <instructor ID> --role admin|instructor
  npm run instructor -- reset-password --id <instructor ID>
  npm run instructor -- rename --id <instructor ID> --name "<full name>"
  npm run instructor -- remove --id <instructor ID>
  npm run instructor -- list`);
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
  if (process.env.INSTRUCTOR_PASSWORD) return process.env.INSTRUCTOR_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal, or set INSTRUCTOR_PASSWORD.');
  const first = await askHidden('Password: ');
  const second = await askHidden('Type it again: ');
  if (first !== second) throw new Error('The passwords did not match.');
  return first;
}

async function findInstructor(id) {
  const { rows } = await pool.query('SELECT * FROM instructors WHERE instructor_id = $1', [id]);
  return rows[0];
}

async function main() {
  const id = option('id');
  const name = option('name');

  if (!['add', 'reset-password', 'rename', 'remove', 'list', 'set-role'].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (command !== 'list' && !/^[A-Za-z0-9-]{3,40}$/.test(id)) {
    throw new Error('Give an Instructor ID with --id (3-40 letters, numbers or dashes).');
  }

  await ready;

  if (command === 'list') {
    const { rows } = await pool.query('SELECT instructor_id, full_name, role, created_at, last_login_at FROM instructors ORDER BY full_name');
    if (!rows.length) console.log('No instructor accounts yet.');
    rows.forEach(r => console.log(`${r.instructor_id}\t${r.full_name}\t${r.role}\tlast login: ${r.last_login_at ? r.last_login_at.toISOString() : 'never'}`));
    return;
  }

  const existing = await findInstructor(id);

  if (command === 'add') {
    if (!name) throw new Error('Give the instructor\'s name with --name "Full Name".');
    if (existing) throw new Error(`Instructor ID ${id} already exists. Use reset-password or rename.`);
    const password = await getPassword();
    if (!isValidPassword(password)) throw new Error(PASSWORD_RULES_MESSAGE);
    // The very first account is always the main admin
    const { rows: admins } = await pool.query("SELECT COUNT(*)::int AS n FROM instructors WHERE role = 'admin'");
    const role = admins[0].n === 0 || option('role') === 'admin' ? 'admin' : 'instructor';
    await pool.query(
      'INSERT INTO instructors (instructor_id, full_name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, name, await bcrypt.hash(password, 12), role]
    );
    console.log(`Added ${role === 'admin' ? 'main admin' : 'instructor'} ${name} (ID ${id}).`);
    return;
  }

  if (!existing) throw new Error(`No instructor with ID ${id}.`);

  if (command === 'reset-password') {
    const password = await getPassword();
    if (!isValidPassword(password)) throw new Error(PASSWORD_RULES_MESSAGE);
    await pool.query(
      'UPDATE instructors SET password_hash = $1, session_version = session_version + 1 WHERE id = $2',
      [await bcrypt.hash(password, 12), existing.id]
    );
    console.log(`Password changed for ${existing.full_name} (ID ${id}). They were logged out everywhere.`);
  } else if (command === 'set-role') {
    const role = option('role');
    if (role !== 'admin' && role !== 'instructor') throw new Error('Give --role admin or --role instructor.');
    if (existing.role === 'admin' && role !== 'admin') {
      const { rows: admins } = await pool.query("SELECT COUNT(*)::int AS n FROM instructors WHERE role = 'admin'");
      if (admins[0].n <= 1) throw new Error('There must be at least one main admin.');
    }
    await pool.query('UPDATE instructors SET role = $1 WHERE id = $2', [role, existing.id]);
    console.log(`${existing.full_name} (ID ${id}) is now ${role === 'admin' ? 'a main admin' : 'an instructor'}.`);
  } else if (command === 'rename') {
    if (!name) throw new Error('Give the new name with --name "Full Name".');
    await pool.query('UPDATE instructors SET full_name = $1 WHERE id = $2', [name, existing.id]);
    console.log(`Renamed ID ${id} to ${name}.`);
  } else if (command === 'remove') {
    await pool.query('DELETE FROM instructors WHERE id = $1', [existing.id]);
    console.log(`Removed instructor ${existing.full_name} (ID ${id}). Their audit log entries are kept.`);
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
