'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set.');
    const local = /localhost|127\.0\.0\.1|\/var\/run/.test(config.databaseUrl);
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: local || /sslmode=disable/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
      max: 5
    });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  const client = await getPool().connect();
  try {
    // Test files and a second web process can boot together. The lock keeps one
    // of them from inserting the same migration name while the other is applying it.
    await client.query('SELECT pg_advisory_lock(804271)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      console.log('migrated', file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(804271)').catch(() => {});
    client.release();
  }
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { query, tx, migrate, close, getPool };
