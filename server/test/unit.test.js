'use strict';
// Unit tests that need no database or network: node --test test/
const test = require('node:test');
const assert = require('node:assert');

process.env.VAPI_API_KEY = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TRANSFER_TO_NUMBER = '+16175550100';
process.env.TOKEN_ENCRYPTION_KEY = 'unit-test-key';
process.env.VAPI_VOICE_PROVIDER = 'cartesia';
process.env.VAPI_VOICE_ID = 'nora';
process.env.VAPI_VOICE_MODEL = 'sonic-2';
process.env.VAPI_CALENDAR_TOOL_IDS = 'tool-check,tool-book';

const vapi = require('../src/integrations/vapi');
const twilio = require('../src/integrations/twilio');
const { extractBookings, classifyCall, bookingFromStructured, zonedInstant } = require('../src/calls');
const { slugify } = require('../src/businesses');
const settings = require('../src/settings');
const { presentNumbers } = require('../src/phoneView');
const cryptoBox = require('../src/cryptoBox');
const meta = require('../src/integrations/meta');
const { buildCard } = require('../src/trelloSync');
const { authorizeUrl, redact } = require('../src/integrations/trello');

test('integrations are inert without keys', async () => {
  assert.throws(() => vapi.assertConfigured(), /VAPI_API_KEY/);
  await assert.rejects(() => twilio.searchLocalNumbers({ areaCode: '781' }), /TWILIO_ACCOUNT_SID/);
  await assert.rejects(() => vapi.createAssistant({}), (e) => e.code === 'NOT_CONFIGURED');
});

test('assistant payload uses the approved stack and never promises texts', () => {
  const p = vapi.assistantPayload({ id: 1, slug: 'receptwise', name: 'ReceptWise', city: 'Malden, MA', timezone: 'America/New_York',
    profile: { greeting: 'Hi', hours: 'Mon–Fri 9–6', services: [{ name: 'Intro demo', length: '20 min' }] } }, { serverUrl: 'https://x.test/webhooks/vapi' });
  assert.equal(p.model.provider, 'openai');
  assert.equal(p.model.model, 'gpt-4.1');
  assert.equal(p.transcriber.provider, 'deepgram');
  assert.equal(p.firstMessage, 'Hi');
  const prompt = p.model.messages[0].content;
  assert.match(prompt, /Malden, MA/);
  assert.match(prompt, /never promise to send a text/);
  assert.match(prompt, /you can book appointments/);
  assert.match(prompt, /check_availability and then the booking tool/);
  assert.match(prompt, /Never tell callers you can't book/);
  assert.match(prompt, /never turn a booking request into a callback request/);
  assert.match(prompt, /Take a callback message only if the caller doesn't want to book a time/);
  assert.match(prompt, /name, phone number, service, and email/);
  assert.match(prompt, /Confirm the day, the date, and the time before booking/);
  assert.match(prompt, /Never say it's booked unless the booking tool confirmed it/);
  assert.match(prompt, /Only book inside business hours/);
  assert.match(prompt, /Do not double-book/);
  assert.match(prompt, /-04:00 during daylight saving time and -05:00 otherwise/);
  assert.match(prompt, /It changes at daylight saving time/);
  assert.match(prompt, /Never send times without an offset or with Z/);
  assert.match(prompt, /check_availability results come back in UTC/);
  assert.match(prompt, /America\/New_York local time before comparing or speaking/);
  assert.match(prompt, /exactly 10 digits/);
  assert.match(prompt, /groups of 3, 3, and 4/);
  assert.match(prompt, /do not ask for the number again/);
  assert.match(prompt, /letter by letter/);
  assert.match(prompt, /at gmail dot com/);
  assert.match(prompt, /at yahoo dot com/);
  assert.match(prompt, /at outlook dot com/);
  assert.match(prompt, /at hotmail dot com/);
  assert.match(prompt, /at icloud dot com/);
  assert.match(prompt, /say "dot com" as words/);
  assert.match(prompt, /spell unusual names/);
  assert.match(prompt, /ReceptWise appointment – \{service\} – \{caller name\} – \{phone\}/);
  assert.match(prompt, /attendees = \[caller email\]/);
  assert.match(prompt, /Never mention other company names/);
  assert.match(prompt, /transfer the call/);
  const offset = vapi.utcOffset('America/New_York');
  assert.match(prompt, new RegExp('The current UTC offset for America/New_York is ' + offset.replace('+', '\\+')));
  assert.equal(p.model.tools[0].type, 'transferCall');
  assert.equal(p.model.tools[0].destinations[0].number, '+16175550100');
  assert.deepEqual(p.model.toolIds, ['tool-check', 'tool-book']);
  assert.deepEqual(p.voice, { provider: 'cartesia', voiceId: 'nora', model: 'sonic-2', language: 'en' });
  assert.equal(p.server.url, 'https://x.test/webhooks/vapi');
});

test('utc offset follows the business time zone and daylight saving time', () => {
  assert.equal(vapi.utcOffset('America/New_York', new Date('2026-07-15T16:00:00Z')), '-04:00');
  assert.equal(vapi.utcOffset('America/New_York', new Date('2026-01-15T16:00:00Z')), '-05:00');
  assert.equal(vapi.utcOffset('America/New_York', new Date('2026-09-29T16:00:00Z')), '-04:00');
  assert.equal(vapi.utcOffset('America/Los_Angeles', new Date('2026-07-15T16:00:00Z')), '-07:00');
  assert.equal(vapi.utcOffset('America/Los_Angeles', new Date('2026-01-15T16:00:00Z')), '-08:00');
  assert.equal(vapi.utcOffset('America/Phoenix', new Date('2026-07-15T16:00:00Z')), '-07:00');
  assert.equal(vapi.utcOffset('America/Phoenix', new Date('2026-01-15T16:00:00Z')), '-07:00');
  assert.equal(vapi.utcOffset('Asia/Kolkata', new Date('2026-01-15T16:00:00Z')), '+05:30');
  const phoenix = vapi.systemPrompt({ name: 'Desert Desk', timezone: 'America/Phoenix', profile: { capabilities: { book: true } } });
  assert.match(phoenix, /The current UTC offset for America\/Phoenix is -07:00/);
  assert.match(phoenix, /does not change at daylight saving time/);
});

test('booking can be turned off, and only Cartesia voices send language', () => {
  const off = vapi.assistantPayload({
    id: 2, slug: 'messages-only', name: 'Messages Only', timezone: 'America/Chicago',
    profile: { capabilities: { book: false, transfer: false } }
  });
  assert.match(off.model.messages[0].content, /Do not book appointments; take a message instead/);
  assert.equal(off.model.messages[0].content.includes('you can book appointments'), false);
  assert.equal(off.model.toolIds, undefined);
  assert.equal(off.model.tools.length, 0);
  const eleven = vapi.buildVoice('11labs', 'voice-1', 'eleven_flash_v2_5');
  assert.equal(eleven.language, undefined);
  assert.deepEqual(eleven, { provider: '11labs', voiceId: 'voice-1', model: 'eleven_flash_v2_5' });
  assert.deepEqual(vapi.buildVoice('cartesia', 'nora', 'sonic-2'), {
    provider: 'cartesia', voiceId: 'nora', model: 'sonic-2', language: 'en'
  });
  assert.deepEqual(vapi.buildVoice('Cartesia', 'nora', ''), {
    provider: 'Cartesia', voiceId: 'nora', language: 'en'
  });
});

test('assistant payload uses the business voice and falls back to the env voice', () => {
  const voices = require('../src/voices');
  const base = {
    id: 3, slug: 'voice-shop', name: 'Voice Shop', timezone: 'America/New_York',
    profile: { capabilities: { book: false, transfer: false } }
  };
  function payload(voice) {
    return vapi.assistantPayload(Object.assign({}, base, {
      profile: Object.assign({}, base.profile, voice ? { voice } : {})
    }));
  }
  assert.deepEqual(payload('sarah').voice, {
    provider: '11labs', voiceId: 'EXAVITQu4vr4xnSDxMaL', model: 'eleven_flash_v2_5'
  });
  assert.deepEqual(payload('jessica').voice, {
    provider: '11labs', voiceId: 'cgSgspJ2msm6clMCkdW9', model: 'eleven_flash_v2_5'
  });
  assert.deepEqual(payload('laura').voice, {
    provider: '11labs', voiceId: 'FGY2WhTYpPnrIDTdsKH5', model: 'eleven_flash_v2_5'
  });
  assert.deepEqual(payload('lily').voice, {
    provider: '11labs', voiceId: 'pFZP5JQG7iQjIQuC4Bku', model: 'eleven_flash_v2_5'
  });
  assert.equal(payload('sarah').voice.language, undefined);
  assert.deepEqual(payload('nora').voice, {
    provider: 'cartesia',
    voiceId: 'f4c1a0b2-669d-403f-b440-4b34b34856aa',
    model: 'sonic-2',
    language: 'en'
  });
  assert.equal(payload('Juniper (warm)').voice.voiceId, 'f4c1a0b2-669d-403f-b440-4b34b34856aa');
  assert.equal(payload('Harbor (clear)').voice.voiceId, 'f4c1a0b2-669d-403f-b440-4b34b34856aa');
  assert.deepEqual(payload('').voice, { provider: 'cartesia', voiceId: 'nora', model: 'sonic-2', language: 'en' });
  assert.equal(voices.publicList().some((voice) => voice.key === 'andrew'), false);
  assert.equal(voices.publicList().find((voice) => voice.key === 'nora').isDefault, true);
});

test('toE164', () => {
  assert.equal(vapi.toE164('(781) 555-0100'), '+17815550100');
  assert.equal(vapi.toE164('1-781-555-0100'), '+17815550100');
  assert.equal(vapi.toE164('12'), '');
});

test('bookings are extracted from calendar tool calls only', () => {
  const b = extractBookings([
    { role: 'tool_calls', toolCalls: [{ function: { name: 'checkAvailability', arguments: '{}' } }] },
    { role: 'tool_calls', toolCalls: [{ type: 'google.calendar.availability.check', function: { name: 'check_availability', arguments: '{}' } }] },
    { role: 'tool_calls', toolCalls: [{ function: { name: 'scheduleAppointment', arguments: '{"startDateTime":"2026-10-06T10:00:00-04:00","summary":"Intro demo"}' } }] }
  ]);
  assert.equal(b.length, 1);
  assert.equal(b[0].service, 'Intro demo');
  assert.equal(b[0].startsAt, '2026-10-06T14:00:00.000Z');
  assert.equal(b[0].customer, '');
});

test('book_demo summary yields start, customer, phone, and business', () => {
  const bookings = extractBookings([
    {
      role: 'tool_calls',
      toolCalls: [{
        type: 'function',
        function: {
          name: 'book_demo',
          arguments: JSON.stringify({
            summary: 'Receptwise demo – Northline Clinic – Riley Cho – +1 617-555-0142',
            startDateTime: '2026-10-06T15:00:00',
            endDateTime: '2026-10-06T15:30:00',
            timeZone: 'America/New_York',
            attendees: ['riley@example.test']
          })
        }
      }]
    }
  ]);
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].customer, 'Riley Cho');
  assert.equal(bookings[0].phone, '+1 617-555-0142');
  assert.equal(bookings[0].service, 'Northline Clinic');
  assert.equal(bookings[0].email, 'riley@example.test');
  assert.equal(bookings[0].startsAt, '2026-10-06T19:00:00.000Z');
  assert.equal(bookings[0].endsAt, '2026-10-06T19:30:00.000Z');
  assert.equal(bookings[0].timeZone, 'America/New_York');
  const hyphen = extractBookings([{
    toolCalls: [{
      function: {
        name: 'google.calendar.event.create',
        arguments: {
          summary: 'Receptwise demo - Harbor Cafe - Sam Ortiz - (617) 555-0199',
          startDateTime: '2026-01-15T15:00:00',
          timeZone: 'America/New_York',
          attendees: [{ email: 'sam@example.test', displayName: 'Ignored Because Summary Has A Name' }]
        }
      }
    }]
  }]);
  assert.equal(hyphen[0].customer, 'Sam Ortiz');
  assert.equal(hyphen[0].phone, '(617) 555-0199');
  assert.equal(hyphen[0].service, 'Harbor Cafe');
  assert.equal(hyphen[0].startsAt, '2026-01-15T20:00:00.000Z');
  assert.equal(zonedInstant('2026-10-06T10:00:00-04:00', 'America/Los_Angeles'), '2026-10-06T14:00:00.000Z');
});

test('slugify', () => {
  assert.equal(slugify('Harbor & Rye'), 'harbor-and-rye');
  assert.equal(slugify(''), 'business');
});

test('settings push keeps the existing prompt and writes the managed section', () => {
  const current = {
    id: 'asst',
    firstMessage: 'Old greeting',
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      toolIds: ['f3655080-9833-42a8-888e-f93ff7d2bfde'],
      tools: [{ type: 'function', function: { name: 'check_availability' } }],
      messages: [{ role: 'system', content: 'You are the virtual receptionist. Keep this sentence.' }]
    }
  };
  const saved = settings.validateSettings({
    greeting: 'Thanks for calling ReceptWise. This call may be recorded.',
    businessName: 'ReceptWise',
    hours: 'Mon–Fri 9:00 AM – 6:00 PM',
    timezone: 'America/New_York',
    appointmentMinutes: 30,
    bookableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    bookableStart: '09:00',
    bookableEnd: '18:00',
    bufferMinutes: 15,
    transferNumber: '7815550199',
    faqs: [{ q: 'What do you do?', a: 'We answer the phone and book demos.' }],
    notes: 'Pilot client.'
  });
  const patch = settings.buildAssistantPatch(current, saved, {
    serverUrl: 'https://panel.example.test/webhooks/vapi',
    webhookSecret: 'sek'
  });
  assert.equal(patch.firstMessage, saved.greeting);
  const system = patch.model.messages[0].content;
  assert.match(system, /Keep this sentence\./);
  assert.match(system, /<!-- receptwise:managed -->/);
  assert.match(system, /Appointment length: 30 minutes/);
  assert.match(system, /Buffer between appointments: 15 minutes/);
  assert.match(system, /Bookable days: Monday, Tuesday, Wednesday, Thursday, Friday/);
  assert.match(system, /What do you do\?/);
  assert.equal(patch.model.toolIds[0], 'f3655080-9833-42a8-888e-f93ff7d2bfde');
  assert.equal(patch.model.tools.find((t) => t.type === 'function').function.name, 'check_availability');
  assert.equal(patch.model.tools.find((t) => t.type === 'transferCall').destinations[0].number, '+17815550199');
  assert.equal(patch.server.url, 'https://panel.example.test/webhooks/vapi');
  assert.equal(patch.server.headers['X-Vapi-Secret'], 'sek');
  const again = settings.buildAssistantPatch({ model: { messages: [{ role: 'system', content: system }] } }, saved);
  assert.equal(again.model.messages[0].content.split('receptwise:managed').length, 3);
});

test('phone view is honest when Vapi is not connected', () => {
  const view = presentNumbers({
    vapiConfigured: false,
    twilioConfigured: false,
    missingVapi: ['VAPI_API_KEY'],
    missingTwilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    localRows: [{ e164: '+17817057179', vapi_phone_number_id: '60a44606-c827-4f01-b381-852e247a8003', provider: 'twilio' }],
    assistant: { vapi_assistant_id: 'c3c8899c-e42d-494b-bf47-3af37f942341' }
  });
  assert.equal(view.state, 'not_connected');
  assert.deepEqual(view.missing, ['VAPI_API_KEY']);
  assert.equal(view.numbers[0].status, 'not_verified');
  assert.equal(view.numbers[0].statusLabel, 'Not connected');
  assert.match(view.testCallHint, /781/);
});

test('call classification and structured bookings', () => {
  assert.equal(classifyCall({ status: 'ended', endedReason: 'customer-ended-call' }).answered, true);
  assert.equal(classifyCall({ status: 'ended', endedReason: 'customer-did-not-answer' }).missed, true);
  const booking = bookingFromStructured({ structuredData: { booking_confirmed: true, booked_start: '2026-10-06T15:00:00-04:00', name: 'Sam Ortiz' } });
  assert.equal(booking.customer, 'Sam Ortiz');
  assert.equal(bookingFromStructured({ structuredData: { booking_confirmed: false, booked_start: '2026-10-06T15:00:00-04:00' } }), null);
});

test('token encryption round trip', () => {
  const enc = cryptoBox.encrypt('page-token-value');
  assert.notEqual(enc, 'page-token-value');
  assert.equal(cryptoBox.decrypt(enc), 'page-token-value');
});

test('trello card text names the caller and links back to the call', () => {
  const card = buildCard({
    kind: 'booking',
    callerName: 'Sam Ortiz',
    phone: '(617) 555-0199',
    business: 'Harbor Cafe',
    timeLabel: 'Mon, Oct 6, 3:00 PM',
    summary: 'Booked a demo.',
    callUrl: 'https://panel.example.test/dashboard.html?call=abc'
  });
  assert.equal(card.name, 'Booking · Sam Ortiz');
  assert.match(card.desc, /Harbor Cafe/);
  assert.match(card.desc, /Booked a demo\./);
  assert.match(card.desc, /https:\/\/panel\.example\.test\/dashboard\.html\?call=abc/);
  const missed = buildCard({ kind: 'missed_call', callerName: '', callId: 'call-1' });
  assert.equal(missed.name, 'Missed call · Unknown caller');
  assert.match(missed.desc, /Call id: call-1/);
  const url = authorizeUrl('my-key');
  assert.match(url, /^https:\/\/trello\.com\/1\/authorize\?/);
  assert.match(url, /expiration=never/);
  assert.match(url, /response_type=token/);
  assert.match(url, /key=my-key/);
  assert.equal(redact('https://api.trello.com/1/members/me?key=secret&token=tok'), 'https://api.trello.com/1/members/me?key=redacted&token=redacted');
});

test('feature status registry is the single badge source', () => {
  const registry = require('../../assets/feature-status');
  const allowed = new Set(['real', 'mockup', 'in_progress']);
  const expected = {
    phone_number: 'real',
    test_call: 'real',
    bookings: 'real',
    number_search: 'real',
    calendar_connection: 'in_progress',
    social: 'mockup',
    reviews: 'mockup',
    website_generator: 'in_progress',
    outreach: 'mockup',
    voice_dropdown: 'real',
    email_domain: 'mockup',
    receptionist: 'real'
  };
  Object.keys(expected).forEach((key) => {
    assert.equal(registry[key].status, expected[key], key);
    assert.ok(registry[key].label, key);
  });
  Object.keys(registry).forEach((key) => {
    assert.ok(allowed.has(registry[key].status), key);
    assert.equal(typeof registry[key].note, 'string', key);
  });
});

test('support access hides caller and booking details unless the grant matches', () => {
  const privacy = require('../src/privacy');
  const grants = new Set([7]);
  const admin = { id: 1, role: 'admin', businessId: null };
  const team = { id: 2, role: 'team', businessId: null };
  const owner = { id: 3, role: 'owner', businessId: 4 };
  const staff = { id: 5, role: 'staff', businessId: 4 };
  assert.equal(privacy.allows(admin, 7, grants), true);
  assert.equal(privacy.allows(admin, 4, grants), false);
  assert.equal(privacy.allows(team, 4, grants), false);
  assert.equal(privacy.allows(owner, 4, grants), true);
  assert.equal(privacy.allows(owner, 7, grants), false);
  assert.equal(privacy.allows(staff, 4, new Set()), true);
  assert.equal(privacy.allows(staff, 9, grants), false);
  assert.equal(privacy.hiddenLabel('Cancelled'), 'Cancelled – details hidden');
  assert.equal(privacy.hiddenLabel('Completed'), 'Completed – details hidden');
  assert.equal(privacy.hiddenLabel('Confirmed'), 'Booked – details hidden');
  const appt = privacy.redactAppointment({
    id: 3, businessId: 'harbor', businessName: 'Harbor', timezone: 'America/New_York',
    startsAt: '2026-10-07T19:00:00.000Z', endsAt: null, customer: 'Riley Cho', phone: '(617) 555-0142',
    email: 'riley@example.test', service: 'Visit', source: 'Phone', status: 'Confirmed',
    callId: 'call-1', callHref: 'dashboard.html?call=call-1'
  });
  assert.equal(appt.customer, 'Booked – details hidden');
  assert.equal(appt.phone, '');
  assert.equal(appt.email, '');
  assert.equal(appt.service, '');
  assert.equal(appt.callId, null);
  assert.equal(appt.callHref, null);
  assert.equal(appt.startsAt, '2026-10-07T19:00:00.000Z');
  assert.equal(appt.redacted, true);
  assert.equal(privacy.redactActivity({ kind: 'call', text: 'Booked · Riley Cho' }).text, 'Call · details hidden');
  assert.equal(privacy.redactActivity({ kind: 'booking', text: 'Booked Riley Cho' }).text, 'Booked – details hidden');
  assert.equal(privacy.redactActivity({ kind: 'trello.card_created', text: 'Created a Trello card for a booking (Sam Ortiz).' }).text, 'Updated a card · details hidden');
  assert.equal(privacy.redactActivity({ kind: 'settings.update', text: 'Saved receptionist settings.' }).text, 'Saved receptionist settings.');
  const past = privacy.presentGrant({ enabled: true, expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(past.active, false);
  const live = privacy.presentGrant({ enabled: true, expires_at: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(live.active, true);
});

test('meta dialog URL uses the business login config when set', () => {
  const previous = process.env.META_LOGIN_CONFIG_ID;
  process.env.META_LOGIN_CONFIG_ID = '';
  const url = meta.authUrl('state-1');
  assert.match(url, /facebook\.com/);
  assert.match(url, /state=state-1/);
  if (previous) process.env.META_LOGIN_CONFIG_ID = previous;
});
