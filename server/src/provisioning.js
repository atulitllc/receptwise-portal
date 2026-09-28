'use strict';
// Orchestrates Twilio + Vapi for one business. Every function here is inert (throws
// NotConfiguredError -> HTTP 409 with the missing env var names) until keys are set.
const db = require('./db');
const config = require('./config');
const twilio = require('./integrations/twilio');
const vapi = require('./integrations/vapi');
const businesses = require('./businesses');
const calls = require('./calls');

function webhookUrl() {
  return config.appBaseUrl ? config.appBaseUrl + '/webhooks/vapi' : '';
}

async function getAssistantRow(bizId) {
  const { rows } = await db.query('SELECT * FROM assistants WHERE business_id = $1', [bizId]);
  return rows[0] || null;
}
async function getPhoneRow(bizId) {
  const { rows } = await db.query('SELECT * FROM phone_numbers WHERE business_id = $1 AND status = \'active\' ORDER BY id DESC LIMIT 1', [bizId]);
  return rows[0] || null;
}

// Create or update the Vapi assistant from the saved profile ("Publish" on the Receptionist tab).
async function publishAssistant(biz, userId) {
  vapi.assertConfigured();
  const payload = vapi.assistantPayload(biz, { serverUrl: webhookUrl() });
  const existing = await getAssistantRow(biz.id);
  const result = existing && existing.vapi_assistant_id
    ? await vapi.updateAssistant(existing.vapi_assistant_id, payload)
    : await vapi.createAssistant(payload);
  await db.query(
    `INSERT INTO assistants (business_id, vapi_assistant_id, config, published_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (business_id) DO UPDATE SET vapi_assistant_id = EXCLUDED.vapi_assistant_id, config = EXCLUDED.config, published_at = now(), updated_at = now()`,
    [biz.id, result.id, payload]
  );
  const phone = await getPhoneRow(biz.id);
  if (phone && phone.vapi_phone_number_id && (!existing || existing.vapi_assistant_id !== result.id)) {
    await vapi.attachAssistantToNumber(phone.vapi_phone_number_id, result.id);
  }
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1,$2,$3,$4)',
    [userId || null, biz.id, 'assistant.publish', { assistantId: result.id }]);
  return { assistantId: result.id, voiceSet: Boolean(config.vapi.voiceId), calendarTools: config.vapi.calendarToolIds.length };
}

async function searchNumbers(areaCode) {
  const codes = areaCode ? [areaCode] : config.twilio.defaultAreaCodes;
  for (const code of codes) {
    const found = await twilio.searchLocalNumbers({ areaCode: code, limit: 5 });
    if (found.length) return found;
  }
  return [];
}

// Buys a Twilio local number (spends $1.15/mo), imports it into Vapi, and attaches the assistant.
async function provisionNumber(biz, { e164, areaCode } = {}, userId) {
  twilio.assertConfigured();
  vapi.assertConfigured();
  const existing = await getPhoneRow(biz.id);
  if (existing) { const e = new Error('This business already has an AI number: ' + existing.e164); e.status = 409; throw e; }
  let chosen = e164;
  if (!chosen) {
    const found = await searchNumbers(areaCode);
    if (!found.length) { const e = new Error('No local numbers available for those area codes.'); e.status = 404; throw e; }
    chosen = found[0].e164;
  }
  let assistant = await getAssistantRow(biz.id);
  if (!assistant || !assistant.vapi_assistant_id) {
    await publishAssistant(biz, userId);
    assistant = await getAssistantRow(biz.id);
  }
  const bought = await twilio.buyNumber(chosen, 'ReceptWise · ' + biz.name);
  const imported = await vapi.importTwilioNumber({
    e164: bought.e164, assistantId: assistant.vapi_assistant_id, name: biz.name, serverUrl: webhookUrl()
  });
  await db.query(
    `INSERT INTO phone_numbers (business_id, e164, provider, twilio_sid, vapi_phone_number_id, sms_enabled)
     VALUES ($1, $2, 'twilio', $3, $4, $5)`,
    [biz.id, bought.e164, bought.sid, imported.id, config.smsEnabled]
  );
  await businesses.setStep(biz.id, 'number', 'connected', businesses.prettyPhone(bought.e164) + ' is active on the voice provider.', { e164: bought.e164 });
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1,$2,$3,$4)',
    [userId || null, biz.id, 'number.provision', { e164: bought.e164, twilioSid: bought.sid, vapiPhoneNumberId: imported.id }]);
  return { e164: bought.e164, pretty: businesses.prettyPhone(bought.e164) };
}

async function testCall(biz, to, userId) {
  vapi.assertConfigured();
  const dest = vapi.toE164(to);
  if (!dest) { const e = new Error('Enter a valid US phone number to call.'); e.status = 400; throw e; }
  const assistant = await getAssistantRow(biz.id);
  const phone = await getPhoneRow(biz.id);
  if (!assistant || !phone || !phone.vapi_phone_number_id) {
    const e = new Error('Publish the receptionist and get an AI number first.'); e.status = 409; throw e;
  }
  const result = await vapi.placeTestCall({ assistantId: assistant.vapi_assistant_id, phoneNumberId: phone.vapi_phone_number_id, to: dest });
  await businesses.setStep(biz.id, 'test', 'pending', 'Test call placed to ' + businesses.prettyPhone(dest) + '. Waiting for it to finish.', {});
  await db.query('INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1,$2,$3,$4)',
    [userId || null, biz.id, 'call.test', { to: dest, callId: result.id }]);
  return { callId: result.id };
}

// Pulls recent calls from Vapi (backfills webhooks missed while the free server was asleep).
async function syncCalls(biz) {
  vapi.assertConfigured();
  const assistant = await getAssistantRow(biz.id);
  if (!assistant || !assistant.vapi_assistant_id) return { synced: 0 };
  const list = await vapi.listCalls({ assistantId: assistant.vapi_assistant_id, limit: 100 });
  const items = Array.isArray(list) ? list : (list.results || list.data || []);
  for (const c of items) await calls.upsertCall(c, null);
  return { synced: items.length };
}

function status() {
  return {
    twilio: config.twilio.configured,
    vapi: config.vapi.configured,
    voiceId: Boolean(config.vapi.voiceId),
    calendarTools: config.vapi.calendarToolIds.length,
    webhookUrl: webhookUrl(),
    webhookSecret: Boolean(config.vapi.webhookSecret),
    transferNumber: Boolean(config.transferToNumber),
    smsEnabled: config.smsEnabled
  };
}

module.exports = { publishAssistant, provisionNumber, searchNumbers, testCall, syncCalls, status, webhookUrl };
