'use strict';
// Phone & forwarding for one business. A later per-customer portal can set
// req.businessScope = { businessId } and these routes will refuse every other business.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const twilio = require('./integrations/twilio');
const catalog = require('../../assets/forwarding');

const STATUSES = ['not_set_up', 'pending_test', 'verified'];
const MODES = ['conditional', 'ported'];
const CARRIER_MAP = {
  verizon: 'verizon',
  'att-mobile': 'att',
  'att-landline': 'att',
  att: 'att',
  tmobile: 'tmobile',
  comcast: 'comcast',
  spectrum: 'spectrum',
  ringcentral: 'ringcentral',
  other: 'other'
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertScope(scope, biz) {
  if (!scope || scope.businessId == null || scope.businessId === '') return;
  if (Number(scope.businessId) !== Number(biz.id)) throw httpError(404, 'Business not found.');
}

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function derive(profile, assignedE164) {
  const phone = (profile && profile.phone) || {};
  const mode = phone.mode === 'port' || phone.mode === 'new' ? 'ported' : 'conditional';
  return {
    mode,
    carrier: CARRIER_MAP[phone.carrier] || '',
    rings: 4,
    businessNumber: catalog.formatPhone(phone.businessNumber),
    forwardTo: catalog.formatPhone(assignedE164),
    status: 'not_set_up',
    transferNumber: catalog.formatPhone(profile && profile.transfer),
    hours: {},
    afterHours: 'ai_immediate',
    aiEnabled: true,
    ringFirst: [],
    portRequests: [],
    stored: false
  };
}

async function loadRow(businessId) {
  const { rows } = await db.query('SELECT * FROM phone_forwarding WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

async function loadChildren(businessId) {
  const [rings, ports] = await Promise.all([
    db.query('SELECT label, e164, position FROM ring_first_numbers WHERE business_id = $1 ORDER BY position, id', [businessId]),
    db.query(
      `SELECT id, business_number, contact_name, contact_phone, carrier, notes, status, created_at
       FROM port_requests WHERE business_id = $1 ORDER BY id DESC LIMIT 20`,
      [businessId]
    )
  ]);
  return { rings: rings.rows, ports: ports.rows };
}

function present(row, children, assignedE164) {
  const forwardTo = assignedE164 || row.forward_to || '';
  return {
    mode: row.mode,
    carrier: row.carrier || '',
    rings: row.rings,
    ringSeconds: row.rings * 5,
    businessNumber: catalog.formatPhone(row.business_number),
    forwardTo: catalog.formatPhone(forwardTo),
    status: row.status,
    transferNumber: catalog.formatPhone(row.transfer_number),
    hours: row.hours || {},
    afterHours: row.after_hours || 'ai_immediate',
    aiEnabled: row.ai_enabled !== false,
    ringFirst: (children.rings || []).map((item) => ({
      label: item.label || '',
      number: catalog.formatPhone(item.e164)
    })),
    portRequests: (children.ports || []).map((item) => ({
      id: Number(item.id),
      businessNumber: catalog.formatPhone(item.business_number),
      contactName: item.contact_name || '',
      contactPhone: catalog.formatPhone(item.contact_phone),
      carrier: item.carrier || '',
      notes: item.notes || '',
      status: item.status,
      createdAt: item.created_at
    })),
    stored: true
  };
}

async function presentFor(biz, phoneRow) {
  const assigned = phoneRow && phoneRow.e164 ? phoneRow.e164 : '';
  const row = await loadRow(biz.id);
  if (!row) return derive(biz.profile, assigned);
  const children = await loadChildren(biz.id);
  return present(row, children, assigned);
}

function normalizeInput(body, existing) {
  const src = body || {};
  const mode = MODES.includes(src.mode) ? src.mode : existing.mode;
  const carrier = catalog.CARRIERS.some((c) => c.id === src.carrier) ? src.carrier : (src.carrier === '' ? '' : existing.carrier);
  const rings = src.rings == null || src.rings === '' ? existing.rings : catalog.ringsToSeconds(src.rings) / 5;
  const businessNumber = src.businessNumber == null ? existing.businessNumber : catalog.toE164(src.businessNumber);
  if (src.businessNumber && !businessNumber) throw httpError(400, 'Enter a valid business phone number.');
  const transferNumber = src.transferNumber == null ? existing.transferNumber : catalog.toE164(src.transferNumber);
  if (src.transferNumber && !transferNumber) throw httpError(400, 'Enter a valid transfer-to-human number, or leave it blank.');
  const status = STATUSES.includes(src.status) ? src.status : existing.status;
  const aiEnabled = src.aiEnabled == null ? existing.aiEnabled !== false : Boolean(src.aiEnabled);
  const hours = src.hours == null ? (existing.hours || {}) : catalog.normalizeHours(src.hours);
  const ringFirst = Array.isArray(src.ringFirst) ? src.ringFirst : null;
  return { mode, carrier, rings, businessNumber, transferNumber, status, aiEnabled, hours, ringFirst };
}

async function writeChecklist(businessId, status) {
  const detail = status === 'verified'
    ? 'Forwarding is verified.'
    : status === 'pending_test'
      ? 'Forwarding is waiting on a test.'
      : 'Forwarding is not turned on yet.';
  const stepStatus = status === 'verified' ? 'connected' : status === 'pending_test' ? 'action' : 'pending';
  await db.query(
    `INSERT INTO business_setup (business_id, step_key, status, detail, owner, updated_at)
     VALUES ($1, 'forwarding', $2, $3, 'Client', now())
     ON CONFLICT (business_id, step_key) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, owner = 'Client', updated_at = now()`,
    [businessId, stepStatus, detail]
  );
}

async function save(biz, body, userId) {
  const phone = await db.query(
    'SELECT e164 FROM phone_numbers WHERE business_id = $1 AND status = \'active\' ORDER BY id DESC LIMIT 1',
    [biz.id]
  );
  const assigned = phone.rows[0] ? phone.rows[0].e164 : '';
  const existingRow = await loadRow(biz.id);
  const existing = existingRow
    ? present(existingRow, { rings: [], ports: [] }, assigned)
    : derive(biz.profile, assigned);
  existing.businessNumber = existingRow ? existingRow.business_number : existing.businessNumber;
  existing.transferNumber = existingRow ? existingRow.transfer_number : existing.transferNumber;
  const next = normalizeInput(body, existing);
  const forwardTo = assigned || (existingRow && existingRow.forward_to) || '';

  await db.tx(async (c) => {
    await c.query(
      `INSERT INTO phone_forwarding
         (business_id, mode, carrier, rings, business_number, forward_to, status, transfer_number, hours, after_hours, ai_enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai_immediate', $10, now())
       ON CONFLICT (business_id) DO UPDATE SET
         mode = EXCLUDED.mode, carrier = EXCLUDED.carrier, rings = EXCLUDED.rings,
         business_number = EXCLUDED.business_number, forward_to = EXCLUDED.forward_to,
         status = EXCLUDED.status, transfer_number = EXCLUDED.transfer_number,
         hours = EXCLUDED.hours, after_hours = 'ai_immediate', ai_enabled = EXCLUDED.ai_enabled, updated_at = now()`,
      [biz.id, next.mode, next.carrier || '', next.rings, next.businessNumber || '', forwardTo,
        next.status, next.transferNumber || '', JSON.stringify(next.hours), next.aiEnabled]
    );
    if (next.ringFirst) {
      await c.query('DELETE FROM ring_first_numbers WHERE business_id = $1', [biz.id]);
      let position = 0;
      for (const item of next.ringFirst) {
        const e164 = catalog.toE164(item && (item.number || item.e164));
        if (!e164) continue;
        await c.query(
          'INSERT INTO ring_first_numbers (business_id, label, e164, position) VALUES ($1, $2, $3, $4)',
          [biz.id, clip(item.label, 40), e164, position]
        );
        position += 1;
        if (position >= 5) break;
      }
    }
    const profile = Object.assign({}, biz.profile || {});
    const phoneProfile = Object.assign({}, profile.phone || {});
    delete phoneProfile.aiNumber;
    phoneProfile.mode = next.mode === 'ported' ? 'port' : 'forward';
    phoneProfile.carrier = next.carrier || '';
    phoneProfile.forwardType = 'missed';
    phoneProfile.businessNumber = catalog.formatPhone(next.businessNumber);
    profile.phone = phoneProfile;
    profile.transfer = next.transferNumber ? catalog.formatPhone(next.transferNumber) : (profile.transfer || '');
    const receptionist = Object.assign({}, biz.receptionist || {});
    if (next.transferNumber || srcHas(body, 'transferNumber')) receptionist.transferNumber = next.transferNumber || '';
    await c.query('UPDATE businesses SET profile = $2, receptionist = $3, updated_at = now() WHERE id = $1',
      [biz.id, JSON.stringify(profile), JSON.stringify(receptionist)]);
    await c.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
      [userId || null, biz.id, 'phone.forwarding.save', { mode: next.mode, carrier: next.carrier, rings: next.rings, status: next.status }]);
  });
  await writeChecklist(biz.id, next.status);
  return presentFor(biz, assigned ? { e164: assigned } : null);
}

function srcHas(body, key) {
  return body && Object.prototype.hasOwnProperty.call(body, key);
}

async function setStatus(biz, status, detail) {
  const row = await loadRow(biz.id);
  if (!row) {
    await save(biz, { mode: 'conditional', status: status }, null);
  } else {
    await db.query('UPDATE phone_forwarding SET status = $2, updated_at = now() WHERE business_id = $1', [biz.id, status]);
  }
  await writeChecklist(biz.id, status);
  if (detail) {
    await db.query('UPDATE business_setup SET detail = $3, updated_at = now() WHERE business_id = $1 AND step_key = $2',
      [biz.id, 'forwarding', detail]);
  }
}

async function testForwarding(biz, user, body) {
  const phone = await db.query(
    'SELECT e164 FROM phone_numbers WHERE business_id = $1 AND status = \'active\' ORDER BY id DESC LIMIT 1',
    [biz.id]
  );
  const assigned = phone.rows[0] ? phone.rows[0].e164 : '';
  const current = await presentFor(biz, assigned ? { e164: assigned } : null);
  const row = await loadRow(biz.id);
  const businessNumber = row ? row.business_number : catalog.toE164(current.businessNumber);
  const forwardTo = assigned || (row && row.forward_to) || '';
  const admin = user && user.role === 'admin';
  const confirm = !!(body && body.confirm === true);
  if (admin && current.mode === 'conditional' && !confirm) {
    throw httpError(400, 'Confirm the test call before it is placed.');
  }
  const canCall = admin && confirm && current.mode === 'conditional' && config.twilio.configured
    && businessNumber && forwardTo && businessNumber !== forwardTo;
  if (!canCall) {
    if (!row) await save(biz, { mode: current.mode || 'conditional', status: 'not_set_up' }, user && user.id);
    await setStatus(biz, 'pending_test', 'Pending a manual test. No call was placed.');
    await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
      [user && user.id || null, biz.id, 'phone.forwarding.test', { placed: false }]);
    return { placed: false, manual: true, forwarding: await presentFor(biz, assigned ? { e164: assigned } : null) };
  }
  const result = await twilio.placeCall({
    from: forwardTo,
    to: businessNumber,
    twiml: '<Response><Say>This is a ReceptWise forwarding test. You can hang up.</Say></Response>'
  });
  await setStatus(biz, 'pending_test', 'Test call placed to the business number. Confirm that it rang, then mark forwarding verified.');
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [user.id, biz.id, 'phone.forwarding.test', { placed: true, to: businessNumber, from: forwardTo, callSid: result.sid }]);
  return {
    placed: true,
    callSid: result.sid,
    forwarding: await presentFor(biz, { e164: assigned })
  };
}

async function requestPort(biz, body, userId) {
  const src = body || {};
  const businessNumber = catalog.toE164(src.businessNumber);
  if (!businessNumber) throw httpError(400, 'Enter the phone number to port.');
  const { rows } = await db.query(
    `INSERT INTO port_requests (business_id, business_number, contact_name, contact_phone, carrier, notes, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7) RETURNING *`,
    [biz.id, businessNumber, clip(src.contactName, 80), catalog.toE164(src.contactPhone), clip(src.carrier, 40), clip(src.notes, 500), userId || null]
  );
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [userId || null, biz.id, 'phone.port.request', { businessNumber, status: 'requested' }]);
  const item = rows[0];
  return {
    id: Number(item.id),
    businessNumber: catalog.formatPhone(item.business_number),
    contactName: item.contact_name,
    contactPhone: catalog.formatPhone(item.contact_phone),
    carrier: item.carrier,
    notes: item.notes,
    status: item.status,
    createdAt: item.created_at
  };
}

async function setupForCall(e164) {
  if (!e164) return null;
  const { rows } = await db.query(
    `SELECT b.timezone, f.mode, f.rings, f.hours, f.after_hours, f.ai_enabled
     FROM phone_numbers p
     JOIN businesses b ON b.id = p.business_id
     LEFT JOIN phone_forwarding f ON f.business_id = p.business_id
     WHERE p.e164 = $1 AND p.status = 'active' AND b.status <> 'archived'
     ORDER BY p.id DESC LIMIT 1`,
    [e164]
  );
  const row = rows[0];
  if (!row || !row.mode) return null;
  const rings = await db.query(
    `SELECT e164 FROM ring_first_numbers WHERE business_id = (
       SELECT business_id FROM phone_numbers WHERE e164 = $1 AND status = 'active' ORDER BY id DESC LIMIT 1
     ) ORDER BY position, id`,
    [e164]
  );
  return {
    timeZone: row.timezone || 'America/New_York',
    setup: {
      mode: row.mode,
      rings: row.rings,
      hours: row.hours || {},
      afterHours: row.after_hours,
      aiEnabled: row.ai_enabled !== false,
      ringFirst: rings.rows.map((item) => ({ e164: item.e164 }))
    }
  };
}

function requestUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return proto + '://' + req.get('host') + req.originalUrl;
}

async function handleVoice(req) {
  if (!config.twilio.authToken) throw httpError(409, 'Twilio is not connected yet. Missing: TWILIO_AUTH_TOKEN.');
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const expected = catalog.twilioSignature(requestUrl(req), params, config.twilio.authToken);
  const got = String(req.get('x-twilio-signature') || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(403, 'Invalid Twilio signature.');
  const called = await setupForCall(catalog.toE164(params.To || ''));
  const result = catalog.inboundTwiml(called && called.setup, {
    now: new Date(),
    timeZone: called ? called.timeZone : 'America/New_York',
    dialStatus: params.DialCallStatus || '',
    actionUrl: config.appBaseUrl ? config.appBaseUrl + '/webhooks/twilio/voice?step=dial' : ''
  });
  return result.twiml;
}

module.exports = {
  assertScope, presentFor, save, testForwarding, requestPort, handleVoice, derive
};
