'use strict';
// Twilio REST (no SDK). Used only to search for and buy a local voice number.
// Messaging is never configured on purchased numbers while SMS_ENABLED=false (no A2P 10DLC yet).
const config = require('../config');
const { NotConfiguredError, UpstreamError } = require('./errors');

const API = 'https://api.twilio.com/2010-04-01';

function assertConfigured() {
  const missing = [];
  if (!config.twilio.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!config.twilio.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (missing.length) throw new NotConfiguredError('Twilio', missing);
}

async function call(method, path, form) {
  assertConfigured();
  const auth = Buffer.from(config.twilio.accountSid + ':' + config.twilio.authToken).toString('base64');
  const res = await fetch(API + '/Accounts/' + config.twilio.accountSid + path, {
    method,
    headers: {
      Authorization: 'Basic ' + auth,
      'User-Agent': config.userAgent,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  if (!res.ok) throw new UpstreamError('Twilio', res.status, body);
  return body;
}

async function searchLocalNumbers({ areaCode, inLocality, limit = 5 } = {}) {
  const params = new URLSearchParams({ VoiceEnabled: 'true', PageSize: String(limit) });
  if (areaCode) params.set('AreaCode', String(areaCode));
  if (inLocality) params.set('InLocality', inLocality);
  const body = await call('GET', '/AvailablePhoneNumbers/US/Local.json?' + params.toString());
  return (body.available_phone_numbers || []).map((n) => ({
    e164: n.phone_number,
    friendly: n.friendly_name,
    locality: n.locality,
    region: n.region
  }));
}

// Costs money ($1.15/mo for a US local number). Only called from an explicit admin action.
async function buyNumber(e164, friendlyName) {
  const body = await call('POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: e164,
    FriendlyName: (friendlyName || 'ReceptWise').slice(0, 64)
  });
  return { sid: body.sid, e164: body.phone_number };
}

async function findNumber(e164) {
  const params = new URLSearchParams({ PhoneNumber: e164, PageSize: '1' });
  const body = await call('GET', '/IncomingPhoneNumbers.json?' + params.toString());
  const n = (body.incoming_phone_numbers || [])[0];
  if (!n) return null;
  return { sid: n.sid, e164: n.phone_number, status: n.status || 'in-use', friendly: n.friendly_name || '' };
}

module.exports = { searchLocalNumbers, buyNumber, findNumber, assertConfigured };
