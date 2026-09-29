'use strict';
// Per-business calendar: Google OAuth or Cal.com, plus the Vapi tool webhook.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const cryptoBox = require('./cryptoBox');
const google = require('./integrations/googleCalendar');
const calcom = require('./integrations/calcom');
const { NotConfiguredError, UpstreamError } = require('./integrations/errors');
const audit = require('./audit');
const businesses = require('./businesses');
const vapi = require('./integrations/vapi');
const time = require('./calendarTime');

const PROVIDER = 'google_calendar';
const STATE_TTL_MS = 15 * 60 * 1000;

function missingConfig() {
  const missing = [];
  if (!config.google.clientId) missing.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!config.google.clientSecret) missing.push('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!config.tokenKey) missing.push('TOKEN_ENCRYPTION_KEY');
  if (!config.appBaseUrl) missing.push('APP_BASE_URL');
  return missing;
}

function assertConfigured() {
  const missing = missingConfig();
  if (missing.length) throw new NotConfiguredError('Google Calendar', missing);
}

function redirectUri() {
  return config.appBaseUrl ? config.appBaseUrl + '/oauth/google/callback' : '';
}

function toolsUrl() {
  return config.appBaseUrl ? config.appBaseUrl + '/webhooks/vapi/tools' : '';
}

function sharedDemo() {
  return config.vapi.calendarToolIds.length > 0;
}

async function loadRow(businessId) {
  const { rows } = await db.query(
    'SELECT * FROM integrations WHERE business_id = $1 AND provider = $2',
    [businessId, PROVIDER]
  );
  return rows[0] || null;
}

function readToken(row) {
  if (!row || !row.token_enc) return null;
  try {
    const parsed = JSON.parse(cryptoBox.decrypt(row.token_enc));
    if (!parsed || !parsed.refreshToken) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function metaOf(row) {
  if (!row || !row.meta) return {};
  if (typeof row.meta === 'string') {
    try { return JSON.parse(row.meta); } catch (e) { return {}; }
  }
  return row.meta;
}

function isConnected(row) {
  return Boolean(row && row.external_id && readToken(row));
}

async function loadCalRow(businessId) {
  const { rows } = await db.query(
    'SELECT * FROM integrations WHERE business_id = $1 AND provider = $2',
    [businessId, 'calcom']
  );
  return rows[0] || null;
}

function readCalKey(row) {
  if (!row || !row.token_enc) return '';
  try {
    const plain = cryptoBox.decrypt(row.token_enc);
    return plain && plain.length >= 8 ? plain : '';
  } catch (e) {
    return '';
  }
}

function profileCalendar(biz) {
  const calendar = biz && biz.profile && biz.profile.calendar;
  return calendar && typeof calendar === 'object' ? calendar : {};
}

function eventTypeIdOf(biz, row) {
  const fromProfile = String(profileCalendar(biz).calcomEventTypeId || '').trim();
  if (fromProfile) return fromProfile;
  return String((metaOf(row).eventTypeId || '')).trim();
}

function calcomReady(biz, row) {
  if (!row) return false;
  if (!readCalKey(row)) return false;
  return /^\d+$/.test(eventTypeIdOf(biz, row));
}

async function calendarMode(biz) {
  if (!biz || !toolsUrl()) return '';
  const choice = profileCalendar(biz).provider || '';
  if (choice === 'calcom') {
    const row = await loadCalRow(biz.id);
    return calcomReady(biz, row) ? 'calcom' : '';
  }
  if (choice === 'google' || choice === '') {
    const row = await loadRow(biz.id);
    if (isConnected(row)) return 'google';
  }
  return '';
}

async function hasOwnCalendar(businessId) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  return Boolean(await calendarMode(rows[0]));
}

function publicView(row, extra) {
  const missing = missingConfig();
  const token = readToken(row);
  const meta = metaOf(row);
  const connected = isConnected(row) && missing.length === 0;
  const body = {
    configured: missing.length === 0,
    missing,
    connected,
    authorized: Boolean(token) && missing.length === 0,
    calendarId: connected ? row.external_id : '',
    calendarName: connected ? (row.account_label || meta.calendarSummary || '') : '',
    email: meta.email || '',
    sharedDemo: !connected && sharedDemo(),
    warning: (!connected && sharedDemo()) ? 'Using the shared demo calendar' : ''
  };
  return Object.assign(body, extra || {});
}

async function accessTokenFor(row) {
  const stored = readToken(row);
  if (!stored) {
    const err = new Error('Google Calendar is not connected.');
    err.status = 409;
    throw err;
  }
  let token;
  try {
    token = await google.refreshAccessToken({
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      refreshToken: stored.refreshToken
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      const wrapped = new Error('Google Calendar needs to be connected again.');
      wrapped.status = 409;
      throw wrapped;
    }
    throw err;
  }
  if (!token || !token.access_token) {
    const err = new Error('Google did not return an access token.');
    err.status = 502;
    throw err;
  }
  return token.access_token;
}

function calcomPublic(biz, row) {
  const meta = metaOf(row);
  const eventTypeId = eventTypeIdOf(biz, row);
  const keySaved = Boolean(readCalKey(row));
  const ready = calcomReady(biz, row);
  return {
    keySaved,
    eventTypeId,
    eventTypeTitle: meta.eventTypeTitle || '',
    lengthInMinutes: meta.lengthInMinutes || null,
    connected: ready
  };
}

async function status(biz) {
  const row = await loadRow(biz.id);
  const view = publicView(row);
  const calRow = await loadCalRow(biz.id);
  const cal = calcomPublic(biz, calRow);
  const mode = await calendarMode(biz);
  if (mode) {
    view.warning = '';
    view.sharedDemo = false;
  }
  view.provider = profileCalendar(biz).provider || (view.connected ? 'google' : '');
  view.active = mode;
  view.calcom = cal;
  if (!view.authorized) return Object.assign(view, { calendars: [] });
  try {
    const access = await accessTokenFor(row);
    const calendars = await google.listCalendars(access);
    return Object.assign(view, { calendars });
  } catch (err) {
    return Object.assign(view, {
      calendars: [],
      calendarsError: err.message || 'Could not list calendars.'
    });
  }
}

async function begin(biz, userId) {
  assertConfigured();
  const state = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + STATE_TTL_MS);
  await db.query(
    'INSERT INTO oauth_states (state, business_id, user_id, provider, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [state, biz.id, userId || null, PROVIDER, expires]
  );
  const url = google.authUrl({
    clientId: config.google.clientId,
    redirectUri: redirectUri(),
    state
  });
  return { url };
}

function emailFromCalendars(calendars) {
  const primary = (calendars || []).find((item) => item.primary) || (calendars || [])[0];
  if (!primary) return '';
  return String(primary.id || '').includes('@') ? primary.id : '';
}

async function finish(code, state) {
  assertConfigured();
  if (!code || !state) {
    const err = new Error('Missing code or state.');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    'DELETE FROM oauth_states WHERE state = $1 AND provider = $2 AND expires_at > now() RETURNING *',
    [state, PROVIDER]
  );
  const pending = rows[0];
  if (!pending) {
    const err = new Error('That connection attempt expired. Start it again.');
    err.status = 400;
    throw err;
  }
  const bizRow = await db.query('SELECT id, slug FROM businesses WHERE id = $1', [pending.business_id]);
  const slug = bizRow.rows[0] ? bizRow.rows[0].slug : '';
  let tokens;
  try {
    tokens = await google.exchangeCode({
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      code,
      redirectUri: redirectUri()
    });
  } catch (err) {
    err.slug = slug;
    throw err;
  }
  const existing = await loadRow(pending.business_id);
  let refreshToken = tokens && tokens.refresh_token;
  if (!refreshToken && existing) {
    const previous = readToken(existing);
    refreshToken = previous && previous.refreshToken;
  }
  if (!refreshToken) {
    const err = new Error('Google did not return a refresh token. Disconnect and connect again.');
    err.status = 502;
    err.slug = slug;
    throw err;
  }
  let email = '';
  if (tokens.access_token) {
    try {
      email = emailFromCalendars(await google.listCalendars(tokens.access_token));
    } catch (e) { /* listing can be retried from the business page */ }
  }
  const previousMeta = metaOf(existing);
  const meta = {
    email: email || previousMeta.email || '',
    calendarSummary: previousMeta.calendarSummary || ''
  };
  const tokenEnc = cryptoBox.encrypt(JSON.stringify({ refreshToken }));
  await db.query(
    `INSERT INTO integrations (business_id, provider, account_label, external_id, token_enc, status, scopes, meta, updated_at)
     VALUES ($1, $2, '', NULL, $3, 'authorized', $4, $5, now())
     ON CONFLICT (business_id, provider) DO UPDATE SET
       token_enc = EXCLUDED.token_enc,
       scopes = EXCLUDED.scopes,
       meta = EXCLUDED.meta,
       status = CASE
         WHEN integrations.external_id IS NOT NULL AND integrations.external_id <> '' THEN 'connected'
         ELSE 'authorized' END,
       updated_at = now()`,
    [pending.business_id, PROVIDER, tokenEnc, google.SCOPES.join(' '), JSON.stringify(meta)]
  );
  await audit.record(pending.user_id, pending.business_id, 'calendar.connect', { provider: PROVIDER });
  return { slug };
}

async function selectCalendar(biz, calendarId, userId) {
  assertConfigured();
  const id = String(calendarId || '').trim();
  if (!id || id.length > 300) {
    const err = new Error('Choose a calendar.');
    err.status = 400;
    throw err;
  }
  const row = await loadRow(biz.id);
  if (!readToken(row)) {
    const err = new Error('Connect Google Calendar before choosing a calendar.');
    err.status = 409;
    throw err;
  }
  const access = await accessTokenFor(row);
  const calendars = await google.listCalendars(access);
  const chosen = calendars.find((item) => item.id === id);
  if (!chosen) {
    const err = new Error('That calendar is not on this Google account.');
    err.status = 400;
    throw err;
  }
  const meta = Object.assign(metaOf(row), {
    calendarSummary: chosen.summary || chosen.id
  });
  if (!meta.email && String(chosen.id).includes('@')) meta.email = chosen.id;
  await db.query(
    `UPDATE integrations
     SET external_id = $3, account_label = $4, status = 'connected', meta = $5, updated_at = now()
     WHERE business_id = $1 AND provider = $2`,
    [biz.id, PROVIDER, chosen.id, chosen.summary || chosen.id, JSON.stringify(meta)]
  );
  await audit.record(userId, biz.id, 'calendar.select', { calendarId: chosen.id });
  const assistant = await syncAssistant(biz);
  const view = await status(biz);
  return Object.assign(view, assistant);
}

async function disconnect(biz, userId) {
  await db.query('DELETE FROM integrations WHERE business_id = $1 AND provider = $2', [biz.id, PROVIDER]);
  await audit.record(userId, biz.id, 'calendar.disconnect', { provider: PROVIDER });
  const assistant = await syncAssistant(biz);
  const view = publicView(null);
  return Object.assign(view, { calendars: [] }, assistant);
}

function toolName(tool) {
  return (tool && tool.function && tool.function.name) || (tool && tool.name) || '';
}

function isOwnCalendarTool(tool) {
  const url = tool && tool.server && tool.server.url;
  return Boolean(tool && tool.type === 'function' && typeof url === 'string' && url.indexOf('/webhooks/vapi/tools') !== -1);
}

function isCalendarFunction(tool) {
  if (!tool || tool.type !== 'function') return false;
  const name = toolName(tool);
  return name === 'check_availability' || name === 'book_appointment' || isOwnCalendarTool(tool);
}

// Swap calendar tools on the live assistant without dropping the settings prompt block.
function modelWithCalendarTools(current, desired, own) {
  const model = JSON.parse(JSON.stringify(current || {}));
  const kept = (model.tools || []).filter((tool) => !isCalendarFunction(tool));
  if (own) {
    model.tools = kept.concat((desired.tools || []).filter(isOwnCalendarTool));
    model.toolIds = [];
  } else {
    model.tools = kept;
    if (Object.prototype.hasOwnProperty.call(desired, 'toolIds')) model.toolIds = desired.toolIds;
    else delete model.toolIds;
  }
  const nextMessage = (desired.messages || []).find((message) => message.role === 'system');
  const currentMessage = (model.messages || []).find((message) => message.role === 'system');
  if (nextMessage && currentMessage && typeof currentMessage.content === 'string' && typeof nextMessage.content === 'string') {
    currentMessage.content = rewriteCalendarSentences(currentMessage.content, nextMessage.content);
  } else if (nextMessage && !currentMessage) {
    model.messages = (model.messages || []).concat([nextMessage]);
  }
  return model;
}

function rewriteCalendarSentences(current, desired) {
  const start = current.indexOf('Booking: you can book');
  const end = current.indexOf('Phone numbers:');
  const desiredStart = desired.indexOf('Booking: you can book');
  const desiredEnd = desired.indexOf('Phone numbers:');
  if (start === -1 || end === -1 || desiredStart === -1 || desiredEnd === -1 || end < start) return current;
  return current.slice(0, start) + desired.slice(desiredStart, desiredEnd) + current.slice(end);
}

async function syncAssistant(biz) {
  if (!config.vapi.configured) return { assistantUpdated: false };
  const { rows } = await db.query(
    'SELECT vapi_assistant_id, config FROM assistants WHERE business_id = $1',
    [biz.id]
  );
  const assistant = rows[0];
  if (!assistant || !assistant.vapi_assistant_id) return { assistantUpdated: false };
  const mode = await calendarMode(biz);
  const own = Boolean(mode);
  const payload = vapi.assistantPayload(biz, {
    serverUrl: webhookUrl(),
    ownCalendar: own,
    calendarProvider: mode,
    toolsUrl: toolsUrl()
  });
  let currentModel = null;
  try {
    const live = await vapi.getAssistant(assistant.vapi_assistant_id);
    currentModel = live && live.model;
  } catch (e) { /* fall back to the payload model */ }
  const model = currentModel
    ? modelWithCalendarTools(currentModel, payload.model, own)
    : payload.model;
  try {
    await vapi.updateAssistant(assistant.vapi_assistant_id, { model });
  } catch (err) {
    return { assistantUpdated: false, assistantError: err.message || 'The assistant could not be updated.' };
  }
  let stored = assistant.config;
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored); } catch (e) { stored = null; }
  }
  if (stored && typeof stored === 'object') {
    stored.model = stripToolSecrets(model);
    await db.query('UPDATE assistants SET config = $2, updated_at = now() WHERE business_id = $1',
      [biz.id, JSON.stringify(stored)]);
  }
  return { assistantUpdated: true };
}

function webhookUrl() {
  return config.appBaseUrl ? config.appBaseUrl + '/webhooks/vapi' : '';
}

function stripToolSecrets(model) {
  const copy = JSON.parse(JSON.stringify(model || {}));
  (copy.tools || []).forEach((tool) => {
    if (tool.server && tool.server.headers) delete tool.server.headers;
  });
  return copy;
}

function normalizeToolCall(tc) {
  if (!tc || typeof tc !== 'object') return null;
  const fn = tc.function || {};
  const name = tc.name || fn.name || '';
  const id = tc.id || tc.toolCallId || '';
  let args = tc.arguments != null ? tc.arguments : fn.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch (e) { args = {}; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  if (!name) return null;
  return { id, name, args };
}

function toolCallsFrom(body) {
  const msg = (body && body.message) || body || {};
  const raw = []
    .concat(Array.isArray(msg.toolCallList) ? msg.toolCallList : [])
    .concat(Array.isArray(msg.toolCalls) ? msg.toolCalls : [])
    .concat((Array.isArray(msg.toolWithToolCallList) ? msg.toolWithToolCallList : []).map((item) => (item && (item.toolCall || item)) || null));
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const call = normalizeToolCall(item);
    if (!call) return;
    const key = call.id || (call.name + JSON.stringify(call.args));
    if (seen.has(key)) return;
    seen.add(key);
    out.push(call);
  });
  return out;
}

async function businessFromMessage(body) {
  const msg = (body && body.message) || body || {};
  const call = msg.call || {};
  const assistant = call.assistant || msg.assistant || {};
  const meta = Object.assign({}, msg.metadata || {}, call.metadata || {}, assistant.metadata || {});
  const businessId = Number(meta.receptwiseBusinessId);
  if (businessId) {
    const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (rows[0]) return rows[0];
  }
  const assistantId = call.assistantId || assistant.id || null;
  if (assistantId) {
    const { rows } = await db.query(
      `SELECT b.* FROM businesses b
       JOIN assistants a ON a.business_id = b.id
       WHERE a.vapi_assistant_id = $1`,
      [assistantId]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

function callerEmail(args) {
  return time.cleanEmail(args.email || args.attendee || args.attendees);
}

function describeRange(start, end, timeZone) {
  const startLocal = time.localStamp(start, timeZone);
  const endLocal = time.localStamp(end, timeZone);
  return {
    timeZone,
    startLocal: startLocal.iso,
    endLocal: endLocal.iso,
    startLabel: startLocal.label,
    endLabel: endLocal.label
  };
}

function busyRanges(payload, calendarId, timeZone) {
  const bucket = payload && payload.calendars && (payload.calendars[calendarId] || Object.values(payload.calendars)[0]);
  const busy = (bucket && bucket.busy) || [];
  return busy.map((slot) => {
    const start = time.parseWhen(slot.start, timeZone);
    const end = time.parseWhen(slot.end, timeZone);
    if (!start || !end) return null;
    return { start, end, local: describeRange(start, end, timeZone) };
  }).filter(Boolean);
}

async function checkAvailability(biz, row, args) {
  const timeZone = businesses.tzFromLabel(biz.timezone);
  const start = time.parseWhen(args.startDateTime || args.start || args.start_time, timeZone);
  if (!start) {
    return { ok: false, error: 'Send startDateTime with an offset, for example 2026-10-06T10:00:00-04:00.' };
  }
  let end = time.parseWhen(args.endDateTime || args.end || args.end_time, timeZone);
  if (!end) end = time.addMinutes(start, 30);
  if (end <= start) {
    return { ok: false, error: 'endDateTime must be after startDateTime.' };
  }
  const access = await accessTokenFor(row);
  const payload = await google.freeBusy(access, {
    calendarId: row.external_id,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    timeZone
  });
  const busy = busyRanges(payload, row.external_id, timeZone);
  const conflict = busy.some((slot) => time.overlaps(start, end, slot.start, slot.end));
  return Object.assign({
    ok: true,
    free: !conflict,
    busy: busy.map((slot) => slot.local)
  }, describeRange(start, end, timeZone));
}

async function existingBooking(businessId, start, customer) {
  const { rows } = await db.query(
    `SELECT id, google_event_id, calcom_uid FROM bookings
     WHERE business_id = $1
       AND starts_at IS NOT DISTINCT FROM $2::timestamptz
       AND lower(coalesce(customer, '')) = lower($3)
     ORDER BY id
     LIMIT 1`,
    [businessId, start.toISOString(), customer]
  );
  return rows[0] || null;
}

async function bookAppointment(biz, row, args, vapiCallId) {
  const timeZone = businesses.tzFromLabel(biz.timezone);
  const name = time.clip(args.name || args.customerName || args.customer, 80);
  const phone = time.clip(args.phone || args.customerPhone || args.phoneNumber, 40);
  const email = callerEmail(args);
  const service = time.clip(args.service || args.summary, 80) || 'appointment';
  if (!name || !phone || !email) {
    return { ok: false, booked: false, error: 'name, phone, and email are required before booking.' };
  }
  const start = time.parseWhen(args.startDateTime || args.start || args.start_time, timeZone);
  if (!start) {
    return { ok: false, booked: false, error: 'Send startDateTime with an offset, for example 2026-10-06T10:00:00-04:00.' };
  }
  let end = time.parseWhen(args.endDateTime || args.end || args.end_time, timeZone);
  if (!end) end = time.addMinutes(start, 30);
  if (end <= start) {
    return { ok: false, booked: false, error: 'endDateTime must be after startDateTime.' };
  }
  const range = describeRange(start, end, timeZone);
  const existing = await existingBooking(biz.id, start, name);
  if (existing && existing.google_event_id) {
    return Object.assign({
      ok: true,
      booked: true,
      alreadyBooked: true,
      bookingId: Number(existing.id),
      eventId: existing.google_event_id
    }, range);
  }
  const access = await accessTokenFor(row);
  const payload = await google.freeBusy(access, {
    calendarId: row.external_id,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    timeZone
  });
  const busy = busyRanges(payload, row.external_id, timeZone).filter((slot) => time.overlaps(start, end, slot.start, slot.end));
  if (busy.length) {
    return Object.assign({
      ok: false,
      booked: false,
      free: false,
      conflict: true,
      busy: busy.map((slot) => slot.local)
    }, range);
  }
  const summary = time.eventTitle(biz.name, service, name, phone);
  const event = await google.createEvent(access, row.external_id, {
    summary,
    start: { dateTime: range.startLocal, timeZone },
    end: { dateTime: range.endLocal, timeZone },
    attendees: [{ email }]
  });
  const eventId = event && event.id ? String(event.id) : '';
  let callId = null;
  if (vapiCallId) {
    const found = await db.query('SELECT id FROM calls WHERE vapi_call_id = $1', [vapiCallId]);
    if (found.rows[0]) callId = found.rows[0].id;
  }
  let bookingId;
  if (existing) {
    const updated = await db.query(
      `UPDATE bookings
       SET ends_at = $2, phone = $3, email = $4, service = $5, google_event_id = $6, timezone = $7,
           call_id = coalesce(call_id, $8), status = 'Confirmed', updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [existing.id, end.toISOString(), phone, email, service, eventId, timeZone, callId]
    );
    bookingId = Number(updated.rows[0].id);
  } else {
    const inserted = await db.query(
      `INSERT INTO bookings (business_id, call_id, starts_at, ends_at, customer, phone, email, service, source, status, google_event_id, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Phone', 'Confirmed', $9, $10)
       RETURNING id`,
      [biz.id, callId, start.toISOString(), end.toISOString(), name, phone, email, service, eventId, timeZone]
    );
    bookingId = Number(inserted.rows[0].id);
  }
  await audit.record(null, biz.id, 'calendar.book', { bookingId, eventId });
  return Object.assign({
    ok: true,
    booked: true,
    bookingId,
    eventId,
    service,
    summary
  }, range);
}

function requestedRange(biz, args) {
  const timeZone = businesses.tzFromLabel(biz.timezone);
  const start = time.parseWhen(args.startDateTime || args.start || args.start_time, timeZone);
  if (!start) return { timeZone, error: 'Send startDateTime with an offset, for example 2026-10-06T10:00:00-04:00.' };
  let end = time.parseWhen(args.endDateTime || args.end || args.end_time, timeZone);
  if (!end) end = time.addMinutes(start, 30);
  if (end <= start) return { timeZone, error: 'endDateTime must be after startDateTime.' };
  return { timeZone, start, end };
}

function flattenSlots(slots, timeZone) {
  return (slots || []).map((slot) => {
    const start = time.parseWhen(slot.start, timeZone);
    const end = slot.end ? time.parseWhen(slot.end, timeZone) : null;
    if (!start) return null;
    return { start, end: end || time.addMinutes(start, 30), local: describeRange(start, end || time.addMinutes(start, 30), timeZone) };
  }).filter(Boolean);
}

function slotMatches(slots, start) {
  return slots.some((slot) => Math.abs(slot.start.getTime() - start.getTime()) < 60000);
}

async function calcomSlots(apiKey, eventTypeId, start, end, timeZone) {
  const slots = await calcom.getSlots(apiKey, {
    eventTypeId,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone
  });
  return flattenSlots(slots, timeZone);
}

async function checkCalcom(biz, row, args) {
  const range = requestedRange(biz, args);
  if (range.error) return { ok: false, error: range.error };
  const apiKey = readCalKey(row);
  const eventTypeId = eventTypeIdOf(biz, row);
  const slots = await calcomSlots(apiKey, eventTypeId, range.start, range.end, range.timeZone);
  const free = slotMatches(slots, range.start);
  return Object.assign({
    ok: true,
    free,
    slots: slots.map((slot) => slot.local)
  }, describeRange(range.start, range.end, range.timeZone));
}

async function bookCalcom(biz, row, args, vapiCallId) {
  const name = time.clip(args.name || args.customerName || args.customer, 80);
  const phone = time.clip(args.phone || args.customerPhone || args.phoneNumber, 40);
  const email = callerEmail(args);
  const service = time.clip(args.service || args.summary, 80) || 'appointment';
  if (!name || !phone || !email) {
    return { ok: false, booked: false, error: 'name, phone, and email are required before booking.' };
  }
  const length = Number(metaOf(row).lengthInMinutes) || 0;
  const range = requestedRange(biz, length ? Object.assign({}, args, { endDateTime: '' }) : args);
  if (range.error) return { ok: false, booked: false, error: range.error };
  const end = length ? time.addMinutes(range.start, length) : range.end;
  const described = describeRange(range.start, end, range.timeZone);
  const existing = await existingBooking(biz.id, range.start, name);
  if (existing && existing.calcom_uid) {
    return Object.assign({
      ok: true,
      booked: true,
      alreadyBooked: true,
      bookingId: Number(existing.id),
      uid: existing.calcom_uid
    }, described);
  }
  const apiKey = readCalKey(row);
  const eventTypeId = Number(eventTypeIdOf(biz, row));
  const open = await calcomSlots(apiKey, eventTypeId, range.start, end, range.timeZone);
  if (!slotMatches(open, range.start)) {
    return Object.assign({
      ok: false,
      booked: false,
      free: false,
      conflict: true,
      slots: open.map((slot) => slot.local)
    }, described);
  }
  const phoneE164 = vapi.toE164(phone);
  const attendee = { name, email, timeZone: range.timeZone, language: 'en' };
  if (phoneE164) attendee.phoneNumber = phoneE164;
  const body = {
    eventTypeId,
    start: range.start.toISOString(),
    attendee,
    metadata: {
      business: time.clip(biz.name, 500),
      phone: time.clip(phone, 500),
      businessId: String(biz.id)
    }
  };
  let booked;
  try {
    booked = await calcom.createBooking(apiKey, body);
  } catch (err) {
    if (!calcom.isSlotTaken(err)) throw err;
    const again = await calcomSlots(apiKey, eventTypeId, range.start, end, range.timeZone);
    return Object.assign({
      ok: false,
      booked: false,
      free: false,
      conflict: true,
      slotTaken: true,
      slots: again.map((slot) => slot.local)
    }, described);
  }
  const uid = booked && booked.uid ? String(booked.uid) : '';
  const confirmedStart = booked && booked.start ? time.parseWhen(booked.start, range.timeZone) : range.start;
  const confirmedEnd = booked && booked.end ? time.parseWhen(booked.end, range.timeZone) : end;
  const confirmed = describeRange(confirmedStart || range.start, confirmedEnd || end, range.timeZone);
  let callId = null;
  if (vapiCallId) {
    const found = await db.query('SELECT id FROM calls WHERE vapi_call_id = $1', [vapiCallId]);
    if (found.rows[0]) callId = found.rows[0].id;
  }
  let bookingId;
  if (existing) {
    const updated = await db.query(
      `UPDATE bookings
       SET ends_at = $2, phone = $3, email = $4, service = $5, calcom_uid = $6, timezone = $7,
           source = 'calcom', call_id = coalesce(call_id, $8), status = 'Confirmed', updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [existing.id, (confirmedEnd || end).toISOString(), phone, email, service, uid, range.timeZone, callId]
    );
    bookingId = Number(updated.rows[0].id);
  } else {
    const inserted = await db.query(
      `INSERT INTO bookings (business_id, call_id, starts_at, ends_at, customer, phone, email, service, source, status, calcom_uid, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'calcom', 'Confirmed', $9, $10)
       RETURNING id`,
      [biz.id, callId, (confirmedStart || range.start).toISOString(), (confirmedEnd || end).toISOString(), name, phone, email, service, uid, range.timeZone]
    );
    bookingId = Number(inserted.rows[0].id);
  }
  await audit.record(null, biz.id, 'calendar.book', { bookingId, uid, provider: 'calcom' });
  return Object.assign({
    ok: true,
    booked: true,
    bookingId,
    uid,
    service
  }, confirmed);
}

async function requireCalKey(biz) {
  const row = await loadCalRow(biz.id);
  const apiKey = readCalKey(row);
  if (!apiKey) {
    const err = new Error('Paste a Cal.com API key first.');
    err.status = 409;
    throw err;
  }
  return { row, apiKey };
}

async function listCalcomEventTypes(biz) {
  const { apiKey } = await requireCalKey(biz);
  const eventTypes = await calcom.listEventTypes(apiKey);
  return {
    eventTypes: eventTypes.map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      lengthInMinutes: item.lengthInMinutes
    }))
  };
}

async function testCalcom(biz) {
  const { row, apiKey } = await requireCalKey(biz);
  const listed = await calcom.listEventTypes(apiKey);
  const eventTypeId = eventTypeIdOf(biz, row);
  let slotCount = null;
  if (/^\d+$/.test(eventTypeId)) {
    const timeZone = businesses.tzFromLabel(biz.timezone);
    const start = new Date();
    const end = time.addMinutes(start, 24 * 60);
    const slots = await calcom.getSlots(apiKey, {
      eventTypeId,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone
    });
    slotCount = slots.length;
  }
  return {
    ok: true,
    eventTypeId,
    slotCount,
    eventTypes: listed.map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      lengthInMinutes: item.lengthInMinutes
    }))
  };
}

async function disconnectCalcom(biz, userId) {
  await db.query(`DELETE FROM integrations WHERE business_id = $1 AND provider = 'calcom'`, [biz.id]);
  const profile = Object.assign({}, biz.profile || {});
  const calendar = Object.assign({}, profileCalendar(biz));
  if (calendar.provider === 'calcom') calendar.calcomEventTypeId = '';
  profile.calendar = calendar;
  const { rows } = await db.query(
    'UPDATE businesses SET profile = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [biz.id, profile]
  );
  await audit.record(userId, biz.id, 'calendar.disconnect', { provider: 'calcom' });
  const assistant = await syncAssistant(rows[0] || biz);
  const view = await status(rows[0] || biz);
  return Object.assign(view, assistant);
}

function signaturesMatch(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

async function businessForCalcomPayload(payload) {
  const meta = (payload && payload.metadata) || {};
  const businessId = Number(meta.businessId || meta.receptwiseBusinessId);
  if (businessId) {
    const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (rows[0]) return rows[0];
  }
  const eventTypeId = payload && payload.eventTypeId != null ? String(payload.eventTypeId) : '';
  if (!eventTypeId) return null;
  const { rows } = await db.query(
    `SELECT b.* FROM businesses b
     JOIN integrations i ON i.business_id = b.id AND i.provider = 'calcom'
     WHERE i.meta->>'eventTypeId' = $1`,
    [eventTypeId]
  );
  return rows.length === 1 ? rows[0] : null;
}

async function applyCalcomWebhook(biz, trigger, payload) {
  const uid = time.clip(payload && payload.uid, 200);
  const previous = time.clip(payload && payload.rescheduleUid, 200);
  const start = payload && payload.startTime ? time.parseWhen(payload.startTime, 'UTC') : null;
  const end = payload && payload.endTime ? time.parseWhen(payload.endTime, 'UTC') : null;
  const attendee = (payload && payload.attendees && payload.attendees[0]) || {};
  const name = time.clip(attendee.name, 80);
  const email = time.cleanEmail(attendee.email);
  const phone = time.clip(payload && payload.metadata && payload.metadata.phone, 40);
  const service = time.clip((payload && (payload.eventTitle || payload.title)) || 'appointment', 80);
  const timeZone = businesses.tzFromLabel(biz.timezone);
  if (!uid) return { ok: true, ignored: true };
  if (trigger === 'BOOKING_CANCELLED') {
    await db.query(
      `UPDATE bookings SET status = 'Cancelled', updated_at = now()
       WHERE business_id = $1 AND calcom_uid = $2`,
      [biz.id, uid]
    );
    await audit.record(null, biz.id, 'calendar.calcom_webhook', { trigger, uid });
    return { ok: true };
  }
  const ids = [uid, previous].filter(Boolean);
  const found = await db.query(
    `SELECT id FROM bookings WHERE business_id = $1 AND calcom_uid = ANY($2::text[]) ORDER BY id LIMIT 1`,
    [biz.id, ids]
  );
  if (found.rows[0]) {
    await db.query(
      `UPDATE bookings
       SET calcom_uid = $2, starts_at = coalesce($3, starts_at), ends_at = coalesce($4, ends_at),
           status = 'Confirmed', source = 'calcom', updated_at = now()
       WHERE id = $1`,
      [found.rows[0].id, uid, start ? start.toISOString() : null, end ? end.toISOString() : null]
    );
    await audit.record(null, biz.id, 'calendar.calcom_webhook', { trigger, uid, bookingId: Number(found.rows[0].id) });
    return { ok: true, bookingId: Number(found.rows[0].id) };
  }
  if (trigger !== 'BOOKING_CREATED' && trigger !== 'BOOKING_RESCHEDULED') return { ok: true, ignored: true };
  const inserted = await db.query(
    `INSERT INTO bookings (business_id, starts_at, ends_at, customer, phone, email, service, source, status, calcom_uid, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'calcom', 'Confirmed', $8, $9)
     RETURNING id`,
    [biz.id, start ? start.toISOString() : null, end ? end.toISOString() : null, name, phone, email, service, uid, timeZone]
  );
  await audit.record(null, biz.id, 'calendar.calcom_webhook', { trigger, uid, bookingId: Number(inserted.rows[0].id) });
  return { ok: true, bookingId: Number(inserted.rows[0].id) };
}

async function handleCalcomWebhook(req) {
  const secret = config.calcom.webhookSecret;
  if (!secret) {
    const err = new Error('CALCOM_WEBHOOK_SECRET is not set.');
    err.status = 503;
    throw err;
  }
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const given = req.get('X-Cal-Signature-256') || '';
  if (!signaturesMatch(given, expected)) {
    const err = new Error('bad signature');
    err.status = 401;
    throw err;
  }
  const body = req.body || {};
  const trigger = String(body.triggerEvent || '');
  const payload = body.payload || {};
  if (!['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'].includes(trigger)) {
    return { ok: true, ignored: true };
  }
  const biz = await businessForCalcomPayload(payload);
  if (!biz) return { ok: true, ignored: true };
  return applyCalcomWebhook(biz, trigger, payload);
}

async function runTool(biz, call, vapiCallId) {
  const name = String(call.name || '');
  if (name !== 'check_availability' && name !== 'book_appointment') {
    return { ok: false, error: 'Unknown tool.' };
  }
  const mode = await calendarMode(biz);
  if (!mode) {
    return { ok: false, error: 'This business does not have its own calendar connected.' };
  }
  try {
    if (mode === 'calcom') {
      const row = await loadCalRow(biz.id);
      if (name === 'check_availability') return await checkCalcom(biz, row, call.args);
      return await bookCalcom(biz, row, call.args, vapiCallId);
    }
    const row = await loadRow(biz.id);
    if (name === 'check_availability') return await checkAvailability(biz, row, call.args);
    return await bookAppointment(biz, row, call.args, vapiCallId);
  } catch (err) {
    const safe = err.code === 'UPSTREAM'
      ? (mode === 'calcom' ? 'Cal.com could not complete that request.' : 'Google Calendar could not complete that request.')
      : (err.message || 'Calendar request failed.');
    return { ok: false, error: safe };
  }
}

async function handleToolRequest(body) {
  const calls = toolCallsFrom(body);
  const msg = (body && body.message) || {};
  const vapiCallId = msg.call && msg.call.id;
  const biz = await businessFromMessage(body);
  const results = [];
  for (const call of calls) {
    const result = biz
      ? await runTool(biz, call, vapiCallId)
      : { ok: false, error: 'This call is not linked to a business.' };
    results.push({ toolCallId: call.id, result: JSON.stringify(result) });
  }
  return { results };
}

module.exports = {
  PROVIDER,
  missingConfig,
  redirectUri,
  toolsUrl,
  hasOwnCalendar,
  calendarMode,
  status,
  begin,
  finish,
  selectCalendar,
  disconnect,
  listCalcomEventTypes,
  testCalcom,
  disconnectCalcom,
  handleCalcomWebhook,
  handleToolRequest,
  syncAssistant,
  publicView,
  stripToolSecrets
};
