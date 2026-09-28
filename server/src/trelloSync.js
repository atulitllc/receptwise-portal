'use strict';
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const cryptoBox = require('./cryptoBox');
const audit = require('./audit');
const businesses = require('./businesses');
const trello = require('./integrations/trello');

const ID = /^[a-f0-9]{24}$/i;
const SECRET = /^[A-Za-z0-9]{16,128}$/;

function parseMeta(value) {
  if (!value) return {};
  if (typeof value === 'object') return Object.assign({}, value);
  try { return JSON.parse(value); } catch (e) { return {}; }
}

function rulesFrom(meta) {
  const rules = meta.rules || {};
  return {
    booking: rules.booking !== false,
    missedCall: rules.missedCall !== false
  };
}

function bad(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function notConfigured() {
  const err = new Error('Trello is not connected. Paste an API key and token, or set TRELLO_API_KEY and TRELLO_TOKEN.');
  err.status = 409;
  err.code = 'NOT_CONFIGURED';
  err.missing = ['TRELLO_API_KEY', 'TRELLO_TOKEN'];
  return err;
}

async function getRow(businessId) {
  const { rows } = await db.query(
    'SELECT token_enc, status, account_label, meta FROM integrations WHERE business_id = $1 AND provider = $2',
    [businessId, 'trello']
  );
  return rows[0] || null;
}

function publicView(row, envOn) {
  const meta = row ? parseMeta(row.meta) : {};
  const saved = Boolean(row && row.token_enc);
  const source = saved ? 'saved' : (envOn ? 'env' : null);
  const configured = Boolean(source);
  const tested = Boolean(meta.memberName);
  let status = 'not_connected';
  let statusLabel = 'Not connected';
  if (configured && tested) {
    status = 'connected';
    statusLabel = 'Connected';
  } else if (saved) {
    status = 'saved';
    statusLabel = 'Key saved';
  } else if (envOn) {
    status = 'saved';
    statusLabel = 'Server key set';
  }
  return {
    configured,
    source,
    encryption: Boolean(config.tokenKey),
    status,
    statusLabel,
    memberName: meta.memberName || '',
    memberUsername: meta.memberUsername || '',
    boardId: meta.boardId || '',
    boardName: meta.boardName || '',
    listId: meta.listId || '',
    listName: meta.listName || '',
    rules: rulesFrom(meta),
    hasList: Boolean(meta.listId)
  };
}

async function publicStatus(businessId) {
  const row = await getRow(businessId);
  return publicView(row, Boolean(config.trello.apiKey && config.trello.token));
}

async function resolveCredentials(businessId) {
  const row = await getRow(businessId);
  if (row && row.token_enc) {
    let parsed;
    try { parsed = JSON.parse(cryptoBox.decrypt(row.token_enc)); } catch (e) {
      throw bad('Stored Trello credentials could not be read. Save the key and token again.', 409);
    }
    if (parsed && parsed.apiKey && parsed.token) return { apiKey: parsed.apiKey, token: parsed.token, source: 'saved' };
  }
  if (config.trello.apiKey && config.trello.token) {
    return { apiKey: config.trello.apiKey, token: config.trello.token, source: 'env' };
  }
  return null;
}

async function requireCredentials(businessId) {
  const creds = await resolveCredentials(businessId);
  if (!creds) throw notConfigured();
  return creds;
}

async function writeRow(businessId, fields) {
  const meta = JSON.stringify(fields.meta || {});
  await db.query(
    `INSERT INTO integrations (business_id, provider, account_label, token_enc, status, meta, updated_at)
     VALUES ($1, 'trello', $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (business_id, provider) DO UPDATE SET
       account_label = EXCLUDED.account_label,
       token_enc = EXCLUDED.token_enc,
       status = EXCLUDED.status,
       meta = EXCLUDED.meta,
       updated_at = now()`,
    [businessId, fields.accountLabel || '', fields.tokenEnc, fields.status, meta]
  );
}

function cleanSecret(value, label) {
  const secret = String(value || '').trim();
  if (!SECRET.test(secret)) throw bad(label + ' should be the value Trello showed, with no spaces.');
  return secret;
}

async function saveCredentials(biz, input, userId) {
  if (!config.tokenKey) {
    const err = new Error('TOKEN_ENCRYPTION_KEY is not set, so the Trello key cannot be stored.');
    err.status = 409;
    err.code = 'NOT_CONFIGURED';
    err.missing = ['TOKEN_ENCRYPTION_KEY'];
    throw err;
  }
  const apiKey = cleanSecret(input && input.apiKey, 'API key');
  const token = cleanSecret(input && input.token, 'Token');
  const existing = await getRow(biz.id);
  const meta = parseMeta(existing && existing.meta);
  delete meta.memberName;
  delete meta.memberUsername;
  await writeRow(biz.id, {
    accountLabel: '',
    tokenEnc: cryptoBox.encrypt(JSON.stringify({ apiKey, token })),
    status: 'saved',
    meta
  });
  await audit.record(userId, biz.id, 'trello.credentials_saved', {});
  return publicStatus(biz.id);
}

async function removeCredentials(biz, userId) {
  const existing = await getRow(biz.id);
  if (!existing || !existing.token_enc) return publicStatus(biz.id);
  const meta = parseMeta(existing.meta);
  delete meta.memberName;
  delete meta.memberUsername;
  await db.query(
    `UPDATE integrations SET token_enc = NULL, account_label = '', status = 'not_connected', meta = $2::jsonb, updated_at = now()
     WHERE business_id = $1 AND provider = 'trello'`,
    [biz.id, JSON.stringify(meta)]
  );
  await audit.record(userId, biz.id, 'trello.credentials_removed', {});
  return publicStatus(biz.id);
}

async function testConnection(biz, userId) {
  const creds = await requireCredentials(biz.id);
  const me = await trello.member(creds);
  const existing = await getRow(biz.id);
  const meta = parseMeta(existing && existing.meta);
  meta.memberName = String(me.fullName || me.username || 'Trello member').slice(0, 120);
  meta.memberUsername = String(me.username || '').slice(0, 80);
  await writeRow(biz.id, {
    accountLabel: meta.memberName,
    tokenEnc: existing && existing.token_enc ? existing.token_enc : null,
    status: 'connected',
    meta
  });
  await audit.record(userId, biz.id, 'trello.tested', { memberName: meta.memberName });
  return publicStatus(biz.id);
}

function openItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item && item.id && !item.closed).map((item) => ({
    id: String(item.id),
    name: String(item.name || 'Untitled')
  }));
}

async function listBoards(biz) {
  const creds = await requireCredentials(biz.id);
  return { boards: openItems(await trello.boards(creds)) };
}

async function listLists(biz, boardId) {
  if (!ID.test(String(boardId || ''))) throw bad('Choose a Trello board.');
  const creds = await requireCredentials(biz.id);
  return { lists: openItems(await trello.lists(creds, boardId)) };
}

async function saveDestination(biz, input, userId) {
  const creds = await requireCredentials(biz.id);
  const boardId = String((input && input.boardId) || '');
  const listId = String((input && input.listId) || '');
  if (!ID.test(boardId) || !ID.test(listId)) throw bad('Choose a board and a list.');
  const boards = openItems(await trello.boards(creds));
  const board = boards.find((item) => item.id === boardId);
  if (!board) throw bad('That board is not on this Trello account.');
  const lists = openItems(await trello.lists(creds, boardId));
  const list = lists.find((item) => item.id === listId);
  if (!list) throw bad('That list is not on the chosen board.');
  const rulesIn = (input && input.rules) || {};
  const existing = await getRow(biz.id);
  const meta = parseMeta(existing && existing.meta);
  meta.boardId = board.id;
  meta.boardName = board.name;
  meta.listId = list.id;
  meta.listName = list.name;
  meta.rules = {
    booking: Boolean(rulesIn.booking),
    missedCall: Boolean(rulesIn.missedCall)
  };
  await writeRow(biz.id, {
    accountLabel: meta.memberName || (existing && existing.account_label) || '',
    tokenEnc: existing && existing.token_enc ? existing.token_enc : null,
    status: meta.memberName ? 'connected' : ((existing && existing.status) || 'saved'),
    meta
  });
  await audit.record(userId, biz.id, 'trello.rules', {
    boardName: board.name,
    listName: list.name,
    booking: meta.rules.booking,
    missedCall: meta.rules.missedCall
  });
  return publicStatus(biz.id);
}

function formatTime(value, tz) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}

function buildCard(input) {
  const kindLabel = input.kind === 'booking' ? 'Booking' : 'Missed call';
  const caller = input.callerName || 'Unknown caller';
  const lines = [
    'Caller: ' + caller,
    'Phone: ' + (input.phone || 'Unknown'),
    'Business: ' + (input.business || 'Unknown'),
    'Time: ' + (input.timeLabel || 'Unknown'),
    'Summary: ' + (input.summary || 'No summary.')
  ];
  if (input.callUrl) lines.push('', 'Open this call: ' + input.callUrl);
  else if (input.callId) lines.push('', 'Call id: ' + input.callId);
  return { name: (kindLabel + ' · ' + caller).slice(0, 200), desc: lines.join('\n') };
}

function callLink(vapiCallId) {
  if (!vapiCallId) return '';
  const path = '/dashboard.html?call=' + encodeURIComponent(vapiCallId);
  return config.appBaseUrl ? config.appBaseUrl + path : '';
}

function displayPhone(call) {
  const structured = call.structured && typeof call.structured === 'object' ? call.structured : {};
  const raw = structured.phone || (call.direction === 'outbound' ? call.to_number : call.from_number) || '';
  return businesses.prettyPhone(raw) || raw || 'Unknown';
}

function fingerprint(card) {
  return crypto.createHash('sha256').update(card.name + '\n' + card.desc).digest('hex');
}

async function ensureCard(business, call, kind, creds, listId) {
  const when = kind === 'booking' ? (call.booked_start || call.started_at) : (call.started_at || call.created_at);
  const card = buildCard({
    kind,
    callerName: call.caller_name || '',
    phone: displayPhone(call),
    business: call.caller_business || business.name,
    timeLabel: formatTime(when, business.timezone),
    summary: call.summary || '',
    callUrl: callLink(call.vapi_call_id),
    callId: call.vapi_call_id
  });
  const digest = fingerprint(card);
  const existing = await db.query(
    'SELECT id, trello_card_id, fingerprint FROM trello_cards WHERE business_id = $1 AND call_id = $2 AND event_kind = $3',
    [business.id, call.id, kind]
  );
  const prior = existing.rows[0];
  if (prior && prior.fingerprint === digest) return { skipped: true };
  if (prior && kind !== 'booking') return { skipped: true };
  if (prior) {
    await trello.updateCard(creds, prior.trello_card_id, card);
    await db.query('UPDATE trello_cards SET fingerprint = $2, updated_at = now() WHERE id = $1', [prior.id, digest]);
    await audit.record(null, business.id, 'trello.card_updated', {
      event: kind,
      cardId: prior.trello_card_id,
      callId: call.vapi_call_id,
      caller: call.caller_name || ''
    });
    return { updated: true, cardId: prior.trello_card_id };
  }
  const created = await trello.createCard(creds, { idList: listId, name: card.name, desc: card.desc });
  const inserted = await db.query(
    `INSERT INTO trello_cards (business_id, call_id, event_kind, trello_card_id, fingerprint)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, call_id, event_kind) DO NOTHING
     RETURNING id`,
    [business.id, call.id, kind, String(created.id || ''), digest]
  );
  if (!inserted.rows[0]) return { skipped: true };
  await audit.record(null, business.id, 'trello.card_created', {
    event: kind,
    cardId: String(created.id || ''),
    callId: call.vapi_call_id,
    caller: call.caller_name || ''
  });
  return { created: true, cardId: String(created.id || '') };
}

async function syncOne(call) {
  if (!call || !call.business_id || !call.id) return { skipped: true };
  const creds = await resolveCredentials(call.business_id);
  if (!creds) return { skipped: true };
  const row = await getRow(call.business_id);
  const meta = parseMeta(row && row.meta);
  if (!meta.listId) return { skipped: true };
  const rules = rulesFrom(meta);
  const { rows } = await db.query('SELECT id, name, slug, timezone FROM businesses WHERE id = $1', [call.business_id]);
  const business = rows[0];
  if (!business) return { skipped: true };
  const results = [];
  if (call.outcome === 'Booked' && rules.booking) results.push(await ensureCard(business, call, 'booking', creds, meta.listId));
  if (call.outcome === 'Missed' && rules.missedCall) results.push(await ensureCard(business, call, 'missed_call', creds, meta.listId));
  return { results };
}

async function onCallStored(call) {
  try {
    return await syncOne(call);
  } catch (err) {
    console.error('Trello card sync failed:', trello.redact(err && err.message));
    return { error: true };
  }
}

module.exports = {
  publicStatus,
  saveCredentials,
  removeCredentials,
  testConnection,
  listBoards,
  listLists,
  saveDestination,
  onCallStored,
  buildCard,
  authorizeUrl: trello.authorizeUrl
};
