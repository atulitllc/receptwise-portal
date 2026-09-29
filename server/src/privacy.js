'use strict';
// Receptwise staff see counts and line health. Call and booking details stay hidden
// until the business owner turns on support access. That grant expires.
const db = require('./db');
const audit = require('./audit');

const DEFAULT_HOURS = 72;
const MAX_HOURS = 168;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isReceptwise(user) {
  return !!(user && (user.role === 'admin' || user.role === 'team'));
}

function isBusinessUser(user) {
  return !!(user && (user.role === 'owner' || user.role === 'staff') && user.businessId != null);
}

function allows(user, businessId, grants) {
  if (isBusinessUser(user)) return Number(user.businessId) === Number(businessId);
  if (isReceptwise(user)) return grants.has(Number(businessId));
  return false;
}

function hiddenLabel(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'cancelled') return 'Cancelled – details hidden';
  if (text === 'completed') return 'Completed – details hidden';
  return 'Booked – details hidden';
}

function redactAppointment(item) {
  return {
    id: item.id,
    businessId: item.businessId,
    businessName: item.businessName,
    timezone: item.timezone,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    customer: hiddenLabel(item.status),
    phone: '',
    email: '',
    service: '',
    source: item.source || '',
    status: item.status,
    callId: null,
    callHref: null,
    redacted: true
  };
}

function redactCallUi(call) {
  return {
    time: call.time || '',
    from: 'Details hidden',
    duration: call.duration || '',
    outcome: call.outcome || '',
    flag: '',
    summary: '',
    lines: [],
    recordingUrl: '',
    redacted: true
  };
}

function redactBooking(booking) {
  return Object.assign({}, booking, {
    customer: hiddenLabel(booking.status),
    phone: '',
    email: '',
    service: '',
    redacted: true
  });
}

function redactMetricCall(call) {
  return {
    id: call.id,
    time: call.time,
    from: '',
    callerName: '',
    callerBusiness: '',
    duration: call.duration,
    durationSec: call.durationSec,
    outcome: call.outcome || '',
    summary: '',
    recordingUrl: '',
    bookingConfirmed: call.bookingConfirmed === true,
    businessId: call.businessId,
    businessName: call.businessName,
    redacted: true
  };
}

function redactActivity(item) {
  const kind = item.kind || '';
  let text = 'Activity · details hidden';
  if (kind === 'call') text = 'Call · details hidden';
  else if (kind === 'booking' || kind === 'appointment.create') text = 'Booked – details hidden';
  else if (kind === 'appointment.cancel') text = 'Cancelled – details hidden';
  else if (kind === 'appointment.update') text = 'Updated an appointment · details hidden';
  else if (String(kind).indexOf('trello.card') === 0) text = 'Updated a card · details hidden';
  else return item;
  return Object.assign({}, item, { text: text, redacted: true });
}

function presentGrant(row) {
  if (!row || !row.enabled || !row.expires_at) return { enabled: false, active: false, expiresAt: null };
  const expiresAt = new Date(row.expires_at).toISOString();
  const active = new Date(row.expires_at).getTime() > Date.now();
  return { enabled: active, active: active, expiresAt: active ? expiresAt : null };
}

async function activeGrantSet() {
  const { rows } = await db.query(
    'SELECT business_id FROM support_access WHERE enabled AND expires_at > now()'
  );
  return new Set(rows.map((row) => Number(row.business_id)));
}

async function supportRow(businessId) {
  const { rows } = await db.query('SELECT * FROM support_access WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

async function supportMap(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await db.query('SELECT * FROM support_access WHERE business_id = ANY($1::bigint[])', [ids]);
  rows.forEach((row) => map.set(Number(row.business_id), row));
  return map;
}

async function noteView(user, businessId, what) {
  if (!isReceptwise(user)) return;
  await audit.record(user.id, businessId, 'support.view', { what: what });
}

function scrubCustomerFields(row, kind) {
  const copy = Object.assign({}, row);
  if (kind === 'call') {
    copy.from_number = null;
    copy.to_number = null;
    copy.summary = null;
    copy.caller_name = null;
    copy.caller_email = null;
    copy.caller_business = null;
    copy.recording_url = null;
    copy.structured = null;
  } else if (kind === 'booking') {
    copy.customer = null;
    copy.phone = null;
    copy.email = null;
  } else if (kind === 'audit') {
    const detail = Object.assign({}, copy.detail || {});
    delete detail.caller;
    delete detail.customer;
    delete detail.phone;
    delete detail.email;
    delete detail.callerName;
    copy.detail = detail;
  }
  return copy;
}

async function setAccess(biz, user, body) {
  if (!user || user.role !== 'owner' || Number(user.businessId) !== Number(biz.id)) {
    throw httpError(403, 'Only the business owner can change support access.');
  }
  const enabled = !!(body && body.enabled);
  if (!enabled) {
    await db.query(
      `INSERT INTO support_access (business_id, enabled, expires_at, granted_by, updated_at)
       VALUES ($1, false, NULL, $2, now())
       ON CONFLICT (business_id) DO UPDATE SET enabled = false, expires_at = NULL, granted_by = $2, updated_at = now()`,
      [biz.id, user.id]
    );
    await audit.record(user.id, biz.id, 'support.revoke', {});
    return presentGrant(await supportRow(biz.id));
  }
  let hours = DEFAULT_HOURS;
  if (body.hours != null && body.hours !== '') {
    hours = Number(body.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
      throw httpError(400, 'Choose between 1 and 168 hours. The default is 72.');
    }
  }
  const expires = new Date(Date.now() + hours * 3600 * 1000);
  await db.query(
    `INSERT INTO support_access (business_id, enabled, expires_at, granted_by, updated_at)
     VALUES ($1, true, $2, $3, now())
     ON CONFLICT (business_id) DO UPDATE SET enabled = true, expires_at = $2, granted_by = $3, updated_at = now()`,
    [biz.id, expires, user.id]
  );
  await audit.record(user.id, biz.id, 'support.grant', { hours: hours, expiresAt: expires.toISOString() });
  return presentGrant(await supportRow(biz.id));
}

module.exports = {
  DEFAULT_HOURS,
  isReceptwise,
  isBusinessUser,
  allows,
  hiddenLabel,
  redactAppointment,
  redactCallUi,
  redactBooking,
  redactMetricCall,
  redactActivity,
  presentGrant,
  activeGrantSet,
  supportRow,
  supportMap,
  noteView,
  scrubCustomerFields,
  setAccess
};
