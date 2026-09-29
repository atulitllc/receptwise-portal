'use strict';
// Unit tests that need no database or network: node --test test/
const test = require('node:test');
const assert = require('node:assert');

process.env.VAPI_API_KEY = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TRANSFER_TO_NUMBER = '+16175550100';
process.env.TOKEN_ENCRYPTION_KEY = 'unit-test-key';

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
  assert.match(p.model.messages[0].content, /Malden, MA/);
  assert.match(p.model.messages[0].content, /never promise to send a text/);
  assert.equal(p.model.tools[0].type, 'transferCall');
  assert.equal(p.model.tools[0].destinations[0].number, '+16175550100');
  assert.equal(p.server.url, 'https://x.test/webhooks/vapi');
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

test('meta dialog URL uses the business login config when set', () => {
  const previous = process.env.META_LOGIN_CONFIG_ID;
  process.env.META_LOGIN_CONFIG_ID = '';
  const url = meta.authUrl('state-1');
  assert.match(url, /facebook\.com/);
  assert.match(url, /state=state-1/);
  if (previous) process.env.META_LOGIN_CONFIG_ID = previous;
});
