'use strict';
// Stores the calendar choice. The Cal.com API key goes in integrations.token_enc.
// Availability and booking live in businessCalendar.js.
const db = require('./db');
const config = require('./config');
const cryptoBox = require('./cryptoBox');
const audit = require('./audit');

const PROVIDERS = new Set(['google', 'microsoft', 'calcom', 'square', 'vagaro', 'fresha', 'booksy', 'none']);

function providerId(choice) {
  const raw = String(choice || '').trim();
  if (raw === 'cal' || raw === 'calcom') return 'calcom';
  return PROVIDERS.has(raw) ? raw : '';
}

// Profile shape: { provider, calcomEventTypeId }. Never includes the API key.
function calendarFromInput(input) {
  const body = input || {};
  const wizard = body.wizard && typeof body.wizard === 'object' ? body.wizard : {};
  const nested = body.calendar && typeof body.calendar === 'object' ? body.calendar : null;
  const choice = (nested && nested.provider) || body.provider || wizard.calendar || '';
  const eventRaw = nested && nested.calcomEventTypeId != null
    ? nested.calcomEventTypeId
    : (body.calcomEventTypeId != null ? body.calcomEventTypeId : wizard.calcomEventTypeId);
  const provider = providerId(choice);
  if (!provider) return null;
  const out = { provider };
  if (provider === 'calcom' && eventRaw != null) out.calcomEventTypeId = String(eventRaw).trim().slice(0, 200);
  return out;
}

function scrubWizard(wizard) {
  if (!wizard || typeof wizard !== 'object') return wizard || null;
  const copy = Object.assign({}, wizard);
  delete copy.calcomApiKey;
  delete copy.apiKey;
  delete copy.calcomDemoKey;
  return copy;
}

async function keySaved(businessId) {
  const { rows } = await db.query(
    `SELECT 1 FROM integrations WHERE business_id = $1 AND provider = 'calcom' AND coalesce(token_enc, '') <> ''`,
    [businessId]
  );
  return rows.length > 0;
}

async function saveConnection(biz, input, userId) {
  const calendar = calendarFromInput(input);
  if (!calendar) {
    const err = new Error('Choose a calendar provider.');
    err.status = 400;
    throw err;
  }
  const apiKey = String((input && (input.apiKey || input.calcomApiKey)) || '').trim();
  if (apiKey && calendar.provider !== 'calcom') {
    const err = new Error('An API key is only stored for Cal.com.');
    err.status = 400;
    throw err;
  }
  if (apiKey && apiKey.length < 8) {
    const err = new Error('Paste the Cal.com API key.');
    err.status = 400;
    throw err;
  }
  if (apiKey && !config.tokenKey) {
    const err = new Error('TOKEN_ENCRYPTION_KEY is not set, so the Cal.com API key cannot be stored.');
    err.status = 409;
    err.code = 'NOT_CONFIGURED';
    err.missing = ['TOKEN_ENCRYPTION_KEY'];
    throw err;
  }

  if (calendar.provider === 'calcom' && calendar.calcomEventTypeId == null) {
    const previous = biz.profile && biz.profile.calendar;
    calendar.calcomEventTypeId = previous && previous.provider === 'calcom'
      ? String(previous.calcomEventTypeId || '')
      : '';
  }
  const profile = Object.assign({}, biz.profile || {}, { calendar });
  if (profile.wizard) profile.wizard = scrubWizard(profile.wizard);
  const { rows } = await db.query(
    'UPDATE businesses SET profile = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [biz.id, profile]
  );
  if (calendar.provider === 'calcom') {
    const existing = await db.query(
      `SELECT meta FROM integrations WHERE business_id = $1 AND provider = 'calcom'`,
      [biz.id]
    );
    const previous = existing.rows[0] && existing.rows[0].meta && typeof existing.rows[0].meta === 'object'
      ? existing.rows[0].meta : {};
    const meta = {
      eventTypeId: calendar.calcomEventTypeId || ''
    };
    const title = input.eventTypeTitle != null ? String(input.eventTypeTitle).trim().slice(0, 200) : (previous.eventTypeTitle || '');
    const length = input.lengthInMinutes != null && input.lengthInMinutes !== ''
      ? Number(input.lengthInMinutes)
      : Number(previous.lengthInMinutes);
    if (title) meta.eventTypeTitle = title;
    if (Number.isFinite(length) && length > 0) meta.lengthInMinutes = length;
    const status = /^\d+$/.test(meta.eventTypeId) ? 'connected' : 'saved';
    if (apiKey) {
      const tokenEnc = cryptoBox.encrypt(apiKey);
      await db.query(
        `INSERT INTO integrations (business_id, provider, account_label, token_enc, status, meta, updated_at)
         VALUES ($1, 'calcom', '', $2, $3, $4::jsonb, now())
         ON CONFLICT (business_id, provider) DO UPDATE SET
           token_enc = EXCLUDED.token_enc,
           status = EXCLUDED.status,
           meta = EXCLUDED.meta,
           updated_at = now()`,
        [biz.id, tokenEnc, status, JSON.stringify(meta)]
      );
      await audit.record(userId, biz.id, 'calendar.calcom_key', { provider: 'calcom' });
    } else if (existing.rows[0]) {
      await db.query(
        `UPDATE integrations SET meta = $2::jsonb, status = $3, updated_at = now()
         WHERE business_id = $1 AND provider = 'calcom'`,
        [biz.id, JSON.stringify(meta), status]
      );
    }
  }
  return { biz: rows[0], calendar, calcomKeySaved: await keySaved(biz.id) };
}

module.exports = { providerId, calendarFromInput, scrubWizard, keySaved, saveConnection };
