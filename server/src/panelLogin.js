'use strict';
// Business panel sign-in. The username is the email typed on the sign-in page.
// The password is write-only: it is hashed and never returned.
const bcrypt = require('bcryptjs');
const db = require('./db');
const audit = require('./audit');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 200) {
    throw fail(400, 'Enter the email they will type to sign in.');
  }
  return username;
}

function normalizePassword(value) {
  const password = String(value == null ? '' : value);
  if (password.length < 10) throw fail(400, 'Password must be at least 10 characters.');
  if (password.length > 200) throw fail(400, 'Password is too long.');
  return password;
}

// Owner first, then the earliest staff account. An active account wins over a disabled one.
async function findAccount(businessId) {
  const { rows } = await db.query(
    `SELECT id, email, role, disabled
     FROM users
     WHERE business_id = $1 AND role IN ('owner', 'staff')
     ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
              CASE WHEN NOT disabled THEN 0 ELSE 1 END,
              id
     LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

function presentAccount(account) {
  if (!account) return { username: '', role: '', hasLogin: false };
  return { username: account.email, role: account.role, hasLogin: true };
}

async function present(biz) {
  return presentAccount(await findAccount(biz.id));
}

async function save(biz, body, userId) {
  const username = normalizeUsername(body && body.username);
  const password = normalizePassword(body && body.password);
  const hash = await bcrypt.hash(password, 12);
  const existing = await findAccount(biz.id);
  let created = false;
  let role = 'owner';
  let accountId;

  if (!existing) {
    const owner = biz.profile && biz.profile.owner;
    const name = owner && owner.name ? String(owner.name).slice(0, 120) : '';
    const inserted = await db.query(
      `INSERT INTO users (email, name, role, password_hash, business_id)
       VALUES ($1, $2, 'owner', $3, $4)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id`,
      [username, name, hash, biz.id]
    );
    if (!inserted.rows[0]) throw fail(409, 'That username already has an account.');
    accountId = inserted.rows[0].id;
    created = true;
  } else {
    const clash = await db.query(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2',
      [username, existing.id]
    );
    if (clash.rows[0]) throw fail(409, 'That username already has an account.');
    await db.query(
      'UPDATE users SET email = $2, password_hash = $3, disabled = false WHERE id = $1',
      [existing.id, username, hash]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
    accountId = existing.id;
    role = existing.role;
  }

  await audit.record(userId, biz.id, 'panel.login.set', {
    accountId: Number(accountId),
    role,
    created
  });
  return { username, role, hasLogin: true, created };
}

module.exports = { present, save };
