'use strict';
// Unit tests that need no database or network: node --test test/
const test = require('node:test');
const assert = require('node:assert');

process.env.VAPI_API_KEY = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TRANSFER_TO_NUMBER = '+16175550100';

const vapi = require('../src/integrations/vapi');
const twilio = require('../src/integrations/twilio');
const { extractBookings } = require('../src/calls');
const { slugify } = require('../src/businesses');

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
    { role: 'tool_calls', toolCalls: [{ function: { name: 'scheduleAppointment', arguments: '{"startDateTime":"2026-10-06T10:00:00-04:00","summary":"Intro demo"}' } }] }
  ]);
  assert.equal(b.length, 1);
  assert.equal(b[0].service, 'Intro demo');
});

test('slugify', () => {
  assert.equal(slugify('Harbor & Rye'), 'harbor-and-rye');
  assert.equal(slugify(''), 'business');
});
