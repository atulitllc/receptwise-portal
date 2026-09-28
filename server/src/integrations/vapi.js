'use strict';
// Vapi REST (no SDK): assistants, imported Twilio numbers, outbound test calls, call listing.
// Approved pilot stack: GPT-4.1 + ElevenLabs voice + Deepgram Nova-3.
const config = require('../config');
const { NotConfiguredError, UpstreamError } = require('./errors');

function assertConfigured() {
  if (!config.vapi.apiKey) throw new NotConfiguredError('Vapi', ['VAPI_API_KEY']);
}

async function call(method, path, body) {
  assertConfigured();
  const res = await fetch(config.vapi.baseUrl + path, {
    method,
    headers: { Authorization: 'Bearer ' + config.vapi.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = text; }
  if (!res.ok) throw new UpstreamError('Vapi', res.status, data);
  return data;
}

function toE164(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (String(value || '').trim().startsWith('+') && d.length >= 8) return '+' + d;
  return '';
}

function list(items, fmt) {
  return (items || []).filter(Boolean).map(fmt).join('\n');
}

// Builds the receptionist's system prompt from the business profile stored in Postgres.
function systemPrompt(biz) {
  const p = biz.profile || {};
  const tz = biz.timezone || 'America/New_York';
  const services = list(p.services, (s) => '- ' + [s.name, s.length, s.price].filter(Boolean).join(' · '));
  const faqs = list(p.faqs, (f) => 'Q: ' + f.q + '\nA: ' + f.a);
  const canTransfer = p.capabilities ? p.capabilities.transfer !== false : true;
  const canBook = p.capabilities ? p.capabilities.book !== false : true;
  return [
    'You are the virtual receptionist for ' + biz.name + (biz.city ? ' in ' + biz.city : '') + '.',
    p.blurb ? 'About the business: ' + p.blurb : '',
    p.address && p.address !== '—' ? 'Address: ' + p.address : '',
    p.hours ? 'Business hours: ' + p.hours + ' (' + tz + ').' : '',
    'Current date and time: {{"now" | date: "%A, %B %d, %Y %I:%M %p", "' + tz + '"}}.',
    services ? 'Services:\n' + services : '',
    faqs ? 'Frequently asked questions:\n' + faqs : '',
    'Style: warm, concise, natural. One or two short sentences per turn. Never invent prices, policies, or availability.',
    'Tell callers the call may be recorded if they ask. Do not collect payment details or medical, legal, or financial specifics.',
    canBook ? 'Booking: collect the caller\'s name, phone number, and the service. Check calendar availability before offering times. Confirm date and time back to the caller before creating the booking. Use the business time zone.' : 'Do not book appointments; take a message instead.',
    canTransfer ? 'If the caller asks for a person, is upset, or has something you cannot handle, transfer the call.' : 'If the caller asks for a person, take a message with name, number, and reason.',
    'Texting is not available: never promise to send a text message.',
    'If you do not know an answer, say so and offer to take a message.'
  ].filter(Boolean).join('\n\n');
}

function assistantPayload(biz, opts = {}) {
  const p = biz.profile || {};
  const transferTo = toE164(p.transfer) || toE164(config.transferToNumber);
  const tools = [];
  if (transferTo && (!p.capabilities || p.capabilities.transfer !== false)) {
    tools.push({
      type: 'transferCall',
      destinations: [{ type: 'number', number: transferTo, message: 'One moment, I\'ll connect you now.', description: 'A person at ' + biz.name }]
    });
  }
  const model = {
    provider: 'openai',
    model: config.vapi.model,
    temperature: 0.4,
    messages: [{ role: 'system', content: systemPrompt(biz) }],
    tools
  };
  if (config.vapi.calendarToolIds.length && (!p.capabilities || p.capabilities.book !== false)) {
    model.toolIds = config.vapi.calendarToolIds;
  }
  const payload = {
    name: ('RW ' + biz.name).slice(0, 40),
    firstMessage: p.greeting || ('Thanks for calling ' + biz.name + '. How can I help?'),
    firstMessageMode: 'assistant-speaks-first',
    model,
    transcriber: { provider: 'deepgram', model: config.vapi.transcriberModel, language: 'en' },
    maxDurationSeconds: config.vapi.maxCallSeconds,
    serverMessages: ['end-of-call-report', 'status-update'],
    metadata: { receptwiseBusinessId: String(biz.id), receptwiseSlug: biz.slug }
  };
  if (config.vapi.voiceId) {
    payload.voice = { provider: config.vapi.voiceProvider, voiceId: config.vapi.voiceId, model: config.vapi.voiceModel };
  }
  if (opts.serverUrl) {
    payload.server = { url: opts.serverUrl };
    if (config.vapi.webhookSecret) payload.server.headers = { 'X-Vapi-Secret': config.vapi.webhookSecret };
  }
  return payload;
}

function createAssistant(payload) { return call('POST', '/assistant', payload); }
function updateAssistant(id, payload) { return call('PATCH', '/assistant/' + encodeURIComponent(id), payload); }

// Import a Twilio number we own into Vapi and attach the assistant for inbound calls.
function importTwilioNumber({ e164, assistantId, name, serverUrl }) {
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    throw new NotConfiguredError('Twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter((k) => !process.env[k]));
  }
  const body = {
    provider: 'twilio',
    number: e164,
    twilioAccountSid: config.twilio.accountSid,
    twilioAuthToken: config.twilio.authToken,
    smsEnabled: config.smsEnabled,
    name: (name || 'ReceptWise').slice(0, 40)
  };
  if (assistantId) body.assistantId = assistantId;
  if (serverUrl) {
    body.server = { url: serverUrl };
    if (config.vapi.webhookSecret) body.server.headers = { 'X-Vapi-Secret': config.vapi.webhookSecret };
  }
  return call('POST', '/phone-number', body);
}

function attachAssistantToNumber(phoneNumberId, assistantId) {
  return call('PATCH', '/phone-number/' + encodeURIComponent(phoneNumberId), { assistantId });
}

// Outbound test call from the business's AI number to a team member's phone.
function placeTestCall({ assistantId, phoneNumberId, to }) {
  return call('POST', '/call', { assistantId, phoneNumberId, customer: { number: to } });
}

function listCalls({ assistantId, limit = 50 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (assistantId) q.set('assistantId', assistantId);
  return call('GET', '/call?' + q.toString());
}

module.exports = {
  assertConfigured, assistantPayload, systemPrompt, createAssistant, updateAssistant,
  importTwilioNumber, attachAssistantToNumber, placeTestCall, listCalls, toE164
};
