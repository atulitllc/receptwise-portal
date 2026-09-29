'use strict';
// Portal appointments. Reads bookings derived from calls, and lets an admin add or change one here.
// Nothing in this module writes to an external calendar. A later per-customer host can set
// req.businessScope = { businessId } and these queries will not widen past that business.
const db = require('./db');
const businesses = require('./businesses');
const calls = require('./calls');
const audit = require('./audit');
const privacy = require('./privacy');

const STATUSES = ['Confirmed', 'Cancelled', 'Completed'];

function fail(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  return STATUSES.find((status) => status.toLowerCase() === text) || '';
}

function parseInstant(value, label) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw fail(label + ' is not a valid date.');
  return date.toISOString();
}

async function businessFromScope(scope) {
  if (!scope || scope.businessId == null || scope.businessId === '') return null;
  const { rows } = await db.query(
    'SELECT * FROM businesses WHERE id = $1 AND status <> \'archived\'',
    [scope.businessId]
  );
  if (!rows[0]) throw fail('Business not found.', 404);
  return rows[0];
}

// `slug` empty or "all" means every business, unless a host scope forces one.
async function resolveBusiness(slug, scope) {
  const forced = await businessFromScope(scope);
  const wanted = String(slug || '').trim();
  if (forced) {
    if (wanted && wanted !== 'all' && wanted !== forced.slug) throw fail('Business not found.', 404);
    return forced;
  }
  if (!wanted || wanted === 'all') return null;
  const biz = await businesses.getBySlug(wanted);
  if (!biz) throw fail('Business not found.', 404);
  return biz;
}

function toAppointment(row) {
  const tz = row.booking_timezone || row.business_timezone || 'America/New_York';
  const callPhone = row.direction === 'outbound' ? row.to_number : row.from_number;
  const phone = businesses.prettyPhone(row.phone) || businesses.prettyPhone(callPhone) || row.phone || callPhone || '';
  const callId = row.vapi_call_id || null;
  return {
    id: Number(row.id),
    businessId: row.slug,
    businessName: row.business_name,
    timezone: tz,
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    customer: row.customer || '',
    phone: phone || '',
    email: row.email || '',
    service: row.service || '',
    source: row.source || 'Phone',
    status: row.status || 'Confirmed',
    callId,
    callHref: callId ? 'dashboard.html?call=' + encodeURIComponent(callId) : null
  };
}

const SELECT = `
  SELECT k.id, k.business_id, k.call_id, k.starts_at, k.ends_at, k.customer, k.phone, k.email,
         k.service, k.source, k.status, k.timezone AS booking_timezone,
         b.slug, b.name AS business_name, b.timezone AS business_timezone,
         c.vapi_call_id, c.direction, c.from_number, c.to_number
  FROM bookings k
  JOIN businesses b ON b.id = k.business_id
  LEFT JOIN calls c ON c.id = k.call_id`;

async function list({ businessId, from, to, includeUnscheduled, user }) {
  const params = [];
  const where = ["b.status <> 'archived'"];
  if (businessId) {
    params.push(businessId);
    where.push('k.business_id = $' + params.length);
  }
  const ranged = [];
  if (from) {
    params.push(from);
    ranged.push('k.starts_at >= $' + params.length);
  }
  if (to) {
    params.push(to);
    ranged.push('k.starts_at < $' + params.length);
  }
  if (ranged.length) {
    const windowSql = ranged.join(' AND ');
    where.push(includeUnscheduled ? '(k.starts_at IS NULL OR (' + windowSql + '))' : '(' + windowSql + ')');
  }
  params.push(500);
  const { rows } = await db.query(
    SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY k.starts_at NULLS LAST, k.id LIMIT $' + params.length,
    params
  );
  const items = rows.map(toAppointment);
  const grants = await privacy.activeGrantSet();
  const revealed = new Set();
  const out = items.map((item, index) => {
    const id = rows[index].business_id;
    if (privacy.allows(user, id, grants)) {
      revealed.add(Number(id));
      return item;
    }
    return privacy.redactAppointment(item);
  });
  if (privacy.isReceptwise(user)) {
    for (const id of revealed) await privacy.noteView(user, id, 'appointments');
  }
  return out;
}

async function assertCanWrite(user, businessId) {
  if (!privacy.isReceptwise(user)) return;
  const grants = await privacy.activeGrantSet();
  if (!privacy.allows(user, businessId, grants)) {
    throw fail('Receptwise support access is off for this business.', 403);
  }
}

async function getById(id) {
  const { rows } = await db.query(SELECT + ' WHERE k.id = $1', [id]);
  return rows[0] ? toAppointment(rows[0]) : null;
}

function normalize(input, biz, creating) {
  const body = input || {};
  let customer;
  if (body.customer !== undefined || creating) {
    customer = clip(body.customer, 200);
    if (!customer) throw fail('Customer name is required.');
  }
  const zone = String(body.timeZone || body.timezone || '').trim() || biz.timezone || 'America/New_York';
  let startsAt;
  if (body.startsAt !== undefined || creating) {
    if (body.startsAt == null || String(body.startsAt).trim() === '') throw fail('Start time is required.');
    startsAt = calls.zonedInstant(body.startsAt, zone);
    if (!startsAt) throw fail('Start time is not a valid date.');
  }
  let endsAt;
  if (body.endsAt !== undefined) {
    if (body.endsAt == null || String(body.endsAt).trim() === '') endsAt = null;
    else {
      endsAt = calls.zonedInstant(body.endsAt, zone);
      if (!endsAt) throw fail('End time is not a valid date.');
    }
  }
  const startForOrder = startsAt;
  const endForOrder = endsAt;
  if (startForOrder && endForOrder && new Date(endForOrder) < new Date(startForOrder)) {
    throw fail('End time is before the start time.');
  }
  let status;
  if (body.status !== undefined || creating) {
    status = cleanStatus(body.status || (creating ? 'Confirmed' : ''));
    if (!status) throw fail('Status must be Confirmed, Cancelled, or Completed.');
  }
  return {
    customer,
    phone: body.phone === undefined ? undefined : (clip(body.phone, 40) || null),
    email: body.email === undefined ? undefined : (clip(body.email, 200) || null),
    service: body.service === undefined ? undefined : clip(body.service, 200),
    startsAt,
    endsAt,
    timeZone: zone,
    status
  };
}

async function create(biz, input, userId, user) {
  await assertCanWrite(user, biz.id);
  const fields = normalize(input, biz, true);
  const { rows } = await db.query(
    `INSERT INTO bookings (business_id, call_id, starts_at, ends_at, customer, phone, email, service, timezone, source, status, portal_edited)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, 'Portal', $9, true)
     RETURNING id`,
    [biz.id, fields.startsAt, fields.endsAt || null, fields.customer, fields.phone, fields.email,
      fields.service || '', biz.timezone || fields.timeZone, fields.status]
  );
  await audit.record(userId, biz.id, 'appointment.create', { id: Number(rows[0].id), customer: fields.customer });
  return getById(rows[0].id);
}

async function update(id, input, userId, scope, user) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 1) throw fail('Appointment not found.', 404);
  const { rows } = await db.query(
    'SELECT k.*, b.slug, b.timezone AS business_timezone FROM bookings k JOIN businesses b ON b.id = k.business_id WHERE k.id = $1',
    [numeric]
  );
  const existing = rows[0];
  if (!existing) throw fail('Appointment not found.', 404);
  const forced = await businessFromScope(scope);
  if (forced && Number(existing.business_id) !== Number(forced.id)) throw fail('Appointment not found.', 404);
  await assertCanWrite(user, existing.business_id);
  const biz = forced || { id: existing.business_id, timezone: existing.business_timezone, slug: existing.slug };
  const fields = normalize(input, biz, false);
  const sets = ['portal_edited = true', 'updated_at = now()'];
  const params = [numeric];
  function add(column, value) {
    if (value === undefined) return;
    params.push(value);
    sets.push(column + ' = $' + params.length);
  }
  add('customer', fields.customer);
  add('phone', fields.phone);
  add('email', fields.email);
  add('service', fields.service);
  add('starts_at', fields.startsAt);
  add('ends_at', fields.endsAt);
  add('status', fields.status);
  if (fields.startsAt || fields.timeZone) add('timezone', biz.timezone || fields.timeZone);
  const nextStatus = fields.status || existing.status;
  const start = fields.startsAt || (existing.starts_at ? new Date(existing.starts_at).toISOString() : null);
  const end = fields.endsAt === undefined ? (existing.ends_at ? new Date(existing.ends_at).toISOString() : null) : fields.endsAt;
  if (start && end && new Date(end) < new Date(start)) throw fail('End time is before the start time.');
  await db.query('UPDATE bookings SET ' + sets.join(', ') + ' WHERE id = $1', params);
  const action = nextStatus === 'Cancelled' && existing.status !== 'Cancelled' ? 'appointment.cancel' : 'appointment.update';
  await audit.record(userId, existing.business_id, action, {
    id: numeric,
    customer: fields.customer || existing.customer || ''
  });
  return getById(numeric);
}

module.exports = {
  resolveBusiness,
  parseInstant,
  list,
  create,
  update,
  toAppointment
};
