'use strict';
// Usage: DATABASE_URL=... node scripts/create-user.js email@example.com "Full Name" admin|team
// Prompts for the password on stdin (never pass it as an argument).
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/auth');

async function main() {
  const [email, name, role] = process.argv.slice(2);
  if (!email) throw new Error('usage: create-user.js <email> [name] [admin|team]');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await new Promise((r) => rl.question('Password (10+ chars): ', (a) => { rl.close(); r(a); }));
  await db.migrate();
  const u = await auth.createUser({ email, password, name, role: role || 'team' });
  console.log(u ? 'Created ' + u.email + ' (' + u.role + ')' : 'That email already exists.');
  await db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
