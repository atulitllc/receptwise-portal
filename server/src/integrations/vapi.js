'use strict';
// Vapi REST (no SDK): assistants, imported Twilio numbers, outbound test calls, call listing.
// Approved pilot stack: GPT-4.1 + voice from env (Cartesia Sonic-2 in production) + Deepgram Nova-3.
const config = require('../config');
const { NotConfiguredError, UpstreamError } = require('./errors');

function assertConfigured() {
  if (!config.vapi.apiKey) throw new NotConfiguredError('Vapi', ['VAPI_API_KEY']);
}

async function call(method, path, body) {
  assertConfigured();
  const res = await fetch(config.vapi.baseUrl + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + config.vapi.apiKey,
      'Content-Type': 'application/json',
      // Vapi rejects some default clients with HTTP 403.
      'User-Agent': config.userAgent
    },
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

// Wall-clock offset of `timeZone` at `date`, as ±HH:MM. America/New_York is -04:00 during
// daylight saving time and -05:00 otherwise.
function utcOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const map = {};
  dtf.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  let hour = Number(map.hour);
  let day = Number(map.day);
  if (hour === 24) { hour = 0; day += 1; }
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, day, hour, Number(map.minute), Number(map.second));
  return Math.round((asUTC - date.getTime()) / 60000);
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return sign + hh + ':' + mm;
}

function utcOffset(timeZone, date) {
  const when = date instanceof Date ? date : new Date();
  try {
    return formatOffset(utcOffsetMinutes(timeZone, when));
  } catch (e) {
    return '+00:00';
  }
}

function offsetMinutesValue(offset) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset || '');
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// States the offset to send on calendar tool timestamps. Daylight-saving zones name both offsets.
function offsetGuidance(timeZone, now) {
  const when = now instanceof Date ? now : new Date();
  const current = utcOffset(timeZone, when);
  const year = when.getUTCFullYear();
  let january = current;
  let july = current;
  try {
    january = utcOffset(timeZone, new Date(Date.UTC(year, 0, 15, 16, 0, 0)));
    july = utcOffset(timeZone, new Date(Date.UTC(year, 6, 15, 16, 0, 0)));
  } catch (e) { /* keep current */ }
  let stamp = '2026-09-29';
  try {
    stamp = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
  } catch (e) { /* keep the fallback date */ }
  const example = stamp + 'T10:00:00' + current;
  const rule = 'Every startDateTime and endDateTime sent to calendar tools MUST include this offset, for example ' + example + '. Never send times without an offset or with Z.';
  if (january === july) {
    return 'The current UTC offset for ' + timeZone + ' is ' + current + '. This zone does not change at daylight saving time. ' + rule;
  }
  const daylight = offsetMinutesValue(january) > offsetMinutesValue(july) ? january : july;
  const standard = daylight === january ? july : january;
  return 'The current UTC offset for ' + timeZone + ' is ' + current + '. It changes at daylight saving time: ' + daylight + ' during daylight saving time and ' + standard + ' otherwise. ' + rule;
}

function buildVoice(provider, voiceId, model) {
  if (!voiceId) return null;
  const voice = { provider: provider || '11labs', voiceId: voiceId };
  if (model) voice.model = model;
  // Cartesia rejects a voice payload that omits language.
  if (String(voice.provider).toLowerCase() === 'cartesia') voice.language = 'en';
  return voice;
}

// Builds the receptionist's system prompt from the business profile stored in Postgres.
function systemPrompt(biz) {
  const p = biz.profile || {};
  const tz = biz.timezone || 'America/New_York';
  const services = list(p.services, (s) => '- ' + [s.name, s.length, s.price].filter(Boolean).join(' · '));
  const faqs = list(p.faqs, (f) => 'Q: ' + f.q + '\nA: ' + f.a);
  const canTransfer = p.capabilities ? p.capabilities.transfer !== false : true;
  const canBook = p.capabilities ? p.capabilities.book !== false : true;
  const booking = canBook
    ? [
      'Booking: you can book appointments. Whenever a caller wants to book, schedule, or set up an appointment, you must use check_availability and then the booking tool. Never tell callers you can\'t book, and never turn a booking request into a callback request. Take a callback message only if the caller doesn\'t want to book a time. Collect the caller\'s name, phone number, service, and email. Confirm the day, the date, and the time before booking. Never say it\'s booked unless the booking tool confirmed it. Only book inside business hours. Do not double-book.',
      'Time zones: ' + offsetGuidance(tz) + ' check_availability results come back in UTC. Convert them to ' + tz + ' local time before comparing or speaking.',
      'The booking event title (summary) must be "' + biz.name + ' appointment – {service} – {caller name} – {phone}" with real values for the service, caller name, and phone. attendees = [caller email].'
    ].join('\n\n')
    : 'Do not book appointments; take a message instead.';
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
    booking,
    'Phone numbers: a US phone number has exactly 10 digits. Ignore a leading 1. If the caller gave more or fewer than 10 digits, ask for the number again. Read it back in groups of 3, 3, and 4 and get a yes. Once the caller confirms it, do not ask for the number again.',
    'Email: read back only the part before the @ sign, letter by letter. Say common domains as words: "at gmail dot com", "at yahoo dot com", "at outlook dot com", "at hotmail dot com", and "at icloud dot com". Spell only unusual domains letter by letter, and still say "dot com" as words. Get confirmation.',
    'Names: repeat the business name and the caller\'s name back, and ask the caller to spell unusual names.',
    'Never mention other company names.',
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
  const voice = buildVoice(config.vapi.voiceProvider, config.vapi.voiceId, config.vapi.voiceModel);
  if (voice) payload.voice = voice;
  if (opts.serverUrl) {
    payload.server = { url: opts.serverUrl };
    if (config.vapi.webhookSecret) payload.server.headers = { 'X-Vapi-Secret': config.vapi.webhookSecret };
  }
  return payload;
}

function createAssistant(payload) { return call('POST', '/assistant', payload); }
function getAssistant(id) { return call('GET', '/assistant/' + encodeURIComponent(id)); }
function updateAssistant(id, payload) { return call('PATCH', '/assistant/' + encodeURIComponent(id), payload); }
function listPhoneNumbers() { return call('GET', '/phone-number'); }
function getPhoneNumber(id) { return call('GET', '/phone-number/' + encodeURIComponent(id)); }

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
  assertConfigured, assistantPayload, systemPrompt, createAssistant, getAssistant, updateAssistant,
  listPhoneNumbers, getPhoneNumber, importTwilioNumber, attachAssistantToNumber, placeTestCall, listCalls, toE164,
  utcOffset, buildVoice
};
