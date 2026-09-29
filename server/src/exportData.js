'use strict';
// Admin download of the data worth keeping when the free Render database expires.
// Passwords, session tokens, and third-party tokens are never included.
const db = require('./db');
const audit = require('./audit');
const privacy = require('./privacy');

const SECRET_KEY = /^(api[-_]?key|token|token_enc|access_token|refresh_token|password|password_hash|secret|authorization)$/i;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      if (SECRET_KEY.test(key)) return;
      out[key] = scrub(value[key]);
    });
    return out;
  }
  return value;
}

function quote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return quote(value.toISOString()) + '::timestamptz';
  if (typeof value === 'object') return quote(JSON.stringify(scrub(value))) + '::jsonb';
  return quote(value);
}

function insert(table, columns, row) {
  const values = columns.map((column) => sqlValue(row[column]));
  return 'INSERT INTO ' + table + ' (' + columns.join(', ') + ') VALUES (' + values.join(', ') + ');\n';
}

async function snapshot(user, businessId) {
  const params = businessId ? [businessId] : [];
  const onlyBiz = businessId ? 'WHERE id = $1' : '';
  const onlyChild = businessId ? 'WHERE business_id = $1' : '';
  const onlyAudit = businessId ? 'WHERE a.business_id = $1' : '';
  const [businesses, setup, phones, assistants, integrations, calls, bookings, activity, forwarding, ringFirst, portRequests, demoRequests] = await Promise.all([
    db.query(
      `SELECT id, slug, name, category, city, timezone, status, pilot, subdomain, profile, receptionist, created_at, updated_at
       FROM businesses ${onlyBiz} ORDER BY id`, params
    ),
    db.query(
      `SELECT business_id, step_key, status, detail, owner, is_next, data, updated_at
       FROM business_setup ${onlyChild} ORDER BY business_id, step_key`, params
    ),
    db.query(
      `SELECT id, business_id, e164, provider, twilio_sid, vapi_phone_number_id, sms_enabled, status, created_at
       FROM phone_numbers ${onlyChild} ORDER BY id`, params
    ),
    db.query(
      `SELECT business_id, vapi_assistant_id, config, published_at, updated_at
       FROM assistants ${onlyChild} ORDER BY business_id`, params
    ),
    db.query(
      `SELECT id, business_id, provider, account_label, handle, profile_url, external_id, status, meta, created_at, updated_at
       FROM integrations ${onlyChild} ORDER BY id`, params
    ),
    db.query(
      `SELECT id, business_id, vapi_call_id, direction, from_number, to_number, status, started_at, ended_at,
              duration_sec, ended_reason, outcome, summary, caller_name, caller_email, caller_business, call_type,
              booking_confirmed, booked_start, answered, structured, recording_url, created_at
       FROM calls ${onlyChild} ORDER BY id`, params
    ),
    db.query(
      `SELECT id, business_id, call_id, starts_at, ends_at, customer, phone, email, service, source, status, google_event_id, calcom_uid, timezone, created_at, updated_at
       FROM bookings ${onlyChild} ORDER BY id`, params
    ),
    db.query(
      `SELECT a.id, a.created_at, a.action, a.detail, a.business_id, b.slug AS business_slug, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN businesses b ON b.id = a.business_id
       LEFT JOIN users u ON u.id = a.user_id
       ${onlyAudit}
       ORDER BY a.id`, params
    ),
    db.query('SELECT * FROM phone_forwarding ' + onlyChild + ' ORDER BY business_id', params),
    db.query('SELECT id, business_id, label, e164, position FROM ring_first_numbers ' + onlyChild + ' ORDER BY id', params),
    db.query(
      `SELECT id, business_id, business_number, contact_name, contact_phone, carrier, notes, status, created_by, created_at
       FROM port_requests ${onlyChild} ORDER BY id`, params
    ),
    db.query(
      businessId
        ? 'SELECT id FROM demo_requests WHERE false'
        : `SELECT id, name, business_name, phone, email, business_type, preferred_time, message, plan, extra,
              source_page, user_agent, ip_hash, status, created_at, updated_at
           FROM demo_requests ORDER BY id`
    )
  ]);

  const byBusiness = (rows, key) => {
    const map = {};
    rows.forEach((row) => {
      const id = row[key];
      if (!map[id]) map[id] = [];
      map[id].push(scrub(row));
    });
    return map;
  };
  const setupBy = byBusiness(setup.rows, 'business_id');
  const phonesBy = byBusiness(phones.rows, 'business_id');
  const integrationsBy = byBusiness(integrations.rows, 'business_id');
  const forwardingBy = {};
  forwarding.rows.forEach((row) => { forwardingBy[row.business_id] = scrub(row); });
  const ringBy = byBusiness(ringFirst.rows, 'business_id');
  const portBy = byBusiness(portRequests.rows, 'business_id');
  const assistantsBy = {};
  assistants.rows.forEach((row) => { assistantsBy[row.business_id] = scrub(row); });

  const grants = await privacy.activeGrantSet();
  const revealed = new Set();
  function keep(businessId) {
    if (!privacy.allows(user, businessId, grants)) return false;
    if (privacy.isReceptwise(user)) revealed.add(Number(businessId));
    return true;
  }
  const callsOut = calls.rows.map((row) => scrub(keep(row.business_id) ? row : privacy.scrubCustomerFields(row, 'call')));
  const bookingsOut = bookings.rows.map((row) => scrub(keep(row.business_id) ? row : privacy.scrubCustomerFields(row, 'booking')));
  const activityOut = activity.rows.map((row) => scrub(
    row.business_id && !keep(row.business_id) ? privacy.scrubCustomerFields(row, 'audit') : row
  ));
  if (privacy.isReceptwise(user)) {
    for (const id of revealed) await privacy.noteView(user, id, 'export');
  }

  const clients = businesses.rows.map((row) => {
    const client = scrub(row);
    client.setup = setupBy[row.id] || [];
    client.phoneNumbers = phonesBy[row.id] || [];
    client.assistant = assistantsBy[row.id] || null;
    client.integrations = integrationsBy[row.id] || [];
    client.forwarding = forwardingBy[row.id] || null;
    client.ringFirst = ringBy[row.id] || [];
    client.portRequests = portBy[row.id] || [];
    return client;
  });
  const settings = businesses.rows.map((row) => ({
    businessId: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    receptionist: scrub(row.receptionist || {})
  }));

  return {
    exportedAt: new Date().toISOString(),
    product: 'ReceptWise',
    note: 'Clients, receptionist settings, calls, bookings, demo requests, and activity. Passwords, session tokens, and third-party tokens are omitted. Caller and customer details are omitted unless that business has turned on Receptwise support access. Use pg_dump for a full database backup.',
    clients,
    settings,
    calls: callsOut,
    bookings: bookingsOut,
    demoRequests: demoRequests.rows.map(scrub),
    activity: activityOut
  };
}

function toSql(data) {
  let sql = '-- ReceptWise data export ' + data.exportedAt + '\n';
  sql += '-- ' + data.note + '\n';
  sql += '-- Apply after migrations have created the tables. This file does not restore sign-in or connected-account tokens.\n';
  sql += 'BEGIN;\n';
  data.clients.forEach((client) => {
    sql += insert('businesses', ['id', 'slug', 'name', 'category', 'city', 'timezone', 'status', 'pilot', 'subdomain', 'profile', 'receptionist', 'created_at', 'updated_at'], client);
    (client.setup || []).forEach((step) => { sql += insert('business_setup', ['business_id', 'step_key', 'status', 'detail', 'owner', 'is_next', 'data', 'updated_at'], step); });
    (client.phoneNumbers || []).forEach((phone) => {
      sql += insert('phone_numbers', ['id', 'business_id', 'e164', 'provider', 'twilio_sid', 'vapi_phone_number_id', 'sms_enabled', 'status', 'created_at'], phone);
    });
    if (client.assistant && client.assistant.vapi_assistant_id) {
      sql += insert('assistants', ['business_id', 'vapi_assistant_id', 'config', 'published_at', 'updated_at'], client.assistant);
    }
    (client.integrations || []).forEach((item) => {
      sql += insert('integrations', ['id', 'business_id', 'provider', 'account_label', 'handle', 'profile_url', 'external_id', 'status', 'meta', 'created_at', 'updated_at'], item);
    });
    if (client.forwarding) {
      sql += insert('phone_forwarding', ['business_id', 'mode', 'carrier', 'rings', 'business_number', 'forward_to', 'status', 'transfer_number', 'hours', 'after_hours', 'ai_enabled', 'updated_at'], client.forwarding);
    }
    (client.ringFirst || []).forEach((item) => {
      sql += insert('ring_first_numbers', ['id', 'business_id', 'label', 'e164', 'position'], item);
    });
    (client.portRequests || []).forEach((item) => {
      sql += insert('port_requests', ['id', 'business_id', 'business_number', 'contact_name', 'contact_phone', 'carrier', 'notes', 'status', 'created_by', 'created_at'], item);
    });
  });
  data.calls.forEach((call) => {
    sql += insert('calls', ['id', 'business_id', 'vapi_call_id', 'direction', 'from_number', 'to_number', 'status', 'started_at', 'ended_at', 'duration_sec', 'ended_reason', 'outcome', 'summary', 'caller_name', 'caller_email', 'caller_business', 'call_type', 'booking_confirmed', 'booked_start', 'answered', 'structured', 'recording_url', 'created_at'], call);
  });
  data.bookings.forEach((booking) => {
    sql += insert('bookings', ['id', 'business_id', 'call_id', 'starts_at', 'ends_at', 'customer', 'phone', 'email', 'service', 'source', 'status', 'google_event_id', 'calcom_uid', 'timezone', 'created_at', 'updated_at'], booking);
  });
  (data.demoRequests || []).forEach((lead) => {
    sql += insert('demo_requests', ['id', 'name', 'business_name', 'phone', 'email', 'business_type', 'preferred_time', 'message', 'plan', 'extra', 'source_page', 'user_agent', 'ip_hash', 'status', 'created_at', 'updated_at'], lead);
  });
  data.activity.forEach((item) => {
    sql += insert('audit_log', ['id', 'created_at', 'action', 'detail', 'business_id'], {
      id: item.id,
      created_at: item.created_at,
      action: item.action,
      detail: item.detail || {},
      business_id: item.business_id
    });
  });
  ['businesses', 'phone_numbers', 'calls', 'bookings', 'integrations', 'audit_log', 'ring_first_numbers', 'port_requests', 'demo_requests'].forEach((table) => {
    sql += "SELECT setval('" + table + "_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM " + table + '), 1));\n';
  });
  sql += 'COMMIT;\n';
  return sql;
}

async function send(req, res) {
  const format = String((req.query && req.query.format) || 'json').toLowerCase();
  if (format !== 'json' && format !== 'sql') {
    const err = new Error('Use format=json or format=sql.');
    err.status = 400;
    throw err;
  }
  const portal = req.customerPortal && req.customerPortal.business;
  const data = await snapshot(req.user, portal ? portal.id : null);
  await audit.record(req.user.id, null, 'data.export', { format });
  const day = data.exportedAt.slice(0, 10);
  res.set('Cache-Control', 'no-store');
  if (format === 'sql') {
    res.set('Content-Type', 'application/sql; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="receptwise-export-' + day + '.sql"');
    res.send(toSql(data));
    return;
  }
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="receptwise-export-' + day + '.json"');
  res.send(JSON.stringify(data, null, 2));
}

module.exports = { snapshot, toSql, send, scrub };
