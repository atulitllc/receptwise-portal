'use strict';
// API tests against Postgres with Vapi and Twilio HTTP mocked.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://rw:rwlocal@127.0.0.1:5432/rw_test';
process.env.ADMIN_EMAIL = 'admin@receptwise.example';
process.env.ADMIN_PASSWORD = 'pilot-password-10';
process.env.ADMIN_NAME = 'Studio Admin';
process.env.VAPI_API_KEY = 'test-vapi-key';
process.env.VAPI_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.TWILIO_ACCOUNT_SID = 'AC11111111111111111111111111111111';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';
process.env.TOKEN_ENCRYPTION_KEY = 'test-token-key';
process.env.APP_BASE_URL = 'https://panel.example.test';
process.env.NODE_ENV = 'test';
process.env.SMS_ENABLED = 'false';
process.env.VAPI_ASSISTANT_ID = 'c3c8899c-e42d-494b-bf47-3af37f942341';
process.env.VAPI_PHONE_NUMBER_ID = '60a44606-c827-4f01-b381-852e247a8003';
process.env.PILOT_PHONE_E164 = '+17817057179';
process.env.META_APP_ID = '';
process.env.META_APP_SECRET = '';

const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const ASSISTANT = process.env.VAPI_ASSISTANT_ID;
const PHONE_ID = process.env.VAPI_PHONE_NUMBER_ID;
const httpCalls = [];

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

global.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const target = String(url);
  httpCalls.push({ url: target, method, opts });
  if (target.includes('/assistant/') && method === 'PATCH') return jsonRes(200, { id: ASSISTANT });
  if (target.includes('/assistant/')) {
    return jsonRes(200, {
      id: ASSISTANT,
      name: 'ReceptWise Receptionist',
      firstMessage: 'Old greeting',
      model: {
        provider: 'openai',
        model: 'gpt-4.1',
        temperature: 0.4,
        toolIds: ['f3655080-9833-42a8-888e-f93ff7d2bfde', 'ccf9a444-6462-4513-95c4-955c73142285'],
        tools: [],
        messages: [{ role: 'system', content: 'You are the virtual receptionist. Keep this sentence.' }]
      }
    });
  }
  if (target.includes('/phone-number')) {
    return jsonRes(200, [{
      id: PHONE_ID,
      provider: 'twilio',
      number: '+17817057179',
      assistantId: ASSISTANT,
      name: 'ReceptWise'
    }]);
  }
  if (target.includes('/call')) return jsonRes(200, []);
  if (target.includes('api.twilio.com')) {
    return jsonRes(200, { incoming_phone_numbers: [{ sid: 'PN123', phone_number: '+17817057179', status: 'in-use' }] });
  }
  return jsonRes(404, { message: 'not mocked' });
};

const db = require('../src/db');
const auth = require('../src/auth');
const businesses = require('../src/businesses');
const { createApp } = require('../src/server');

let server;
let port;
let cookie = '';

function request(method, path, { body, cookie: jar, headers } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'X-RW-Client': 'portal',
        ...(jar ? { Cookie: jar } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }, headers || {})
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, text, setCookie: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie) {
  const raw = (setCookie || []).join(';');
  const match = raw.match(/rw_sid=([^;]+)/);
  return match ? 'rw_sid=' + match[1] : '';
}

describe('control panel API', () => {
  before(async () => {
    await db.migrate();
    await db.query(`TRUNCATE TABLE
      assistant_backups, oauth_states, bookings, calls, integrations, audit_log,
      phone_numbers, assistants, business_setup, businesses, sessions, users
      RESTART IDENTITY CASCADE`);
    await auth.ensureBootstrapAdmin();
    await businesses.seedPilot();
    const app = createApp();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close();
  });

  it('health check answers without a session', async () => {
    const res = await request('GET', '/api/health', { headers: { 'X-RW-Client': '' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  it('logs in with the seeded admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@receptwise.example', password: 'pilot-password-10' }
    });
    assert.equal(res.status, 200);
    cookie = cookieFrom(res.setCookie);
    assert.ok(cookie);
    assert.equal(res.json.user.role, 'admin');
  });

  it('rejects a settings write without the client header', async () => {
    const res = await request('PUT', '/api/businesses/receptwise/settings', {
      cookie,
      body: { greeting: 'too short' },
      headers: { 'X-RW-Client': '' }
    });
    assert.equal(res.status, 403);
  });

  it('validates settings before calling Vapi', async () => {
    const before = httpCalls.length;
    const res = await request('PUT', '/api/businesses/receptwise/settings', {
      cookie,
      body: { greeting: 'Hi', businessName: 'ReceptWise' }
    });
    assert.equal(res.status, 400);
    assert.equal(httpCalls.length, before);
  });

  it('saves settings and patches the live assistant', async () => {
    httpCalls.length = 0;
    const res = await request('PUT', '/api/businesses/receptwise/settings', {
      cookie,
      body: {
        greeting: 'Thanks for calling ReceptWise. This call may be recorded.',
        businessName: 'ReceptWise',
        hours: 'Mon–Fri 9:00 AM – 6:00 PM',
        timezone: 'Eastern Time',
        appointmentMinutes: 30,
        bookableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        bookableStart: '09:00',
        bookableEnd: '18:00',
        bufferMinutes: 15,
        transferNumber: '(781) 555-0199',
        faqs: [{ q: 'What do you do?', a: 'We answer the phone and book demos.' }],
        notes: 'Pilot client.'
      }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.saved, true);
    assert.equal(res.json.pushed, true);
    assert.ok(res.json.backupId);

    const patchCall = httpCalls.find((c) => c.method === 'PATCH' && c.url.includes('/assistant/'));
    assert.ok(patchCall, 'expected a Vapi assistant PATCH');
    assert.equal(patchCall.opts.headers['User-Agent'], 'ReceptWise-Control-Panel/1.0');
    assert.equal(patchCall.opts.headers.Authorization, 'Bearer test-vapi-key');
    const patch = JSON.parse(patchCall.opts.body);
    assert.equal(patch.firstMessage, 'Thanks for calling ReceptWise. This call may be recorded.');
    const system = patch.model.messages.find((m) => m.role === 'system').content;
    assert.match(system, /Keep this sentence\./);
    assert.match(system, /<!-- receptwise:managed -->/);
    assert.match(system, /Appointment length: 30 minutes/);
    assert.match(system, /Buffer between appointments: 15 minutes/);
    assert.match(system, /Monday, Tuesday, Wednesday, Thursday, Friday/);
    assert.match(system, /Business name: ReceptWise/);
    assert.equal(patch.model.toolIds.length, 2);
    assert.equal(patch.model.tools[0].type, 'transferCall');
    assert.equal(patch.model.tools[0].destinations[0].number, '+17815550199');
    assert.equal(patch.server.url, 'https://panel.example.test/webhooks/vapi');

    const backup = await db.query('SELECT config FROM assistant_backups WHERE id = $1', [res.json.backupId]);
    const stored = typeof backup.rows[0].config === 'string' ? JSON.parse(backup.rows[0].config) : backup.rows[0].config;
    assert.equal(stored.firstMessage, 'Old greeting');
  });

  it('shows the live phone line from Vapi and Twilio', async () => {
    const res = await request('GET', '/api/businesses/receptwise/phone', { cookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.state || res.json.state, 'connected');
    assert.equal(res.json.numbers[0].e164, '+17817057179');
    assert.equal(res.json.numbers[0].status, 'attached');
    assert.equal(res.json.numbers[0].assistantName, 'ReceptWise Receptionist');
    assert.equal(res.json.numbers[0].twilioStatus, 'in-use');
    assert.match(res.json.testCallHint, /\(781\) 705-7179/);
    const twilioCall = httpCalls.find((c) => c.url.includes('api.twilio.com'));
    assert.ok(twilioCall);
    assert.equal(twilioCall.opts.headers['User-Agent'], 'ReceptWise-Control-Panel/1.0');
  });

  it('refuses a webhook with the wrong secret and stores a good end-of-call report', async () => {
    const bad = await request('POST', '/webhooks/vapi', {
      body: { message: { type: 'end-of-call-report', call: { id: 'nope' } } },
      headers: { 'X-Vapi-Secret': 'wrong' }
    });
    assert.equal(bad.status, 401);

    const now = new Date().toISOString();
    const good = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: {
        message: {
          type: 'end-of-call-report',
          endedReason: 'customer-ended-call',
          durationSeconds: 95,
          cost: 0.08,
          startedAt: now,
          endedAt: now,
          call: {
            id: 'call-test-booked',
            assistantId: ASSISTANT,
            phoneNumberId: PHONE_ID,
            type: 'inboundPhoneCall',
            status: 'ended',
            customer: { number: '+16175550199' }
          },
          artifact: {
            transcript: 'Caller booked a demo.',
            recordingUrl: 'https://cdn.example.test/rec.wav',
            messages: []
          },
          analysis: {
            summary: 'Sam Ortiz booked a demo for Harbor Cafe.',
            structuredData: {
              name: 'Sam Ortiz',
              business: 'Harbor Cafe',
              type: 'demo',
              phone: '+16175550199',
              email: 'sam@example.test',
              booked_start: '2026-10-06T15:00:00-04:00',
              booking_confirmed: true
            }
          }
        }
      }
    });
    assert.equal(good.status, 200, good.text);

    const missed = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: {
        message: {
          type: 'end-of-call-report',
          endedReason: 'customer-did-not-answer',
          durationSeconds: 3,
          startedAt: now,
          endedAt: now,
          call: {
            id: 'call-test-missed',
            assistantId: ASSISTANT,
            type: 'inboundPhoneCall',
            status: 'ended',
            customer: { number: '+16175550100' }
          },
          analysis: { summary: 'No one stayed on the line.' }
        }
      }
    });
    assert.equal(missed.status, 200, missed.text);
  });

  it('reports call and booking metrics from stored calls', async () => {
    const res = await request('GET', '/api/metrics?business=receptwise', { cookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.calls.today, 2);
    assert.equal(res.json.answered.today, 1);
    assert.equal(res.json.missed.today, 1);
    assert.equal(res.json.bookings.today, 1);
    assert.equal(res.json.avgDurationSec.today, 95);
    const booked = res.json.recentCalls.find((c) => c.id === 'call-test-booked');
    assert.ok(booked);
    assert.equal(booked.callerName, 'Sam Ortiz');
    assert.equal(booked.outcome, 'Booked');
    assert.equal(booked.summary, 'Sam Ortiz booked a demo for Harbor Cafe.');
    assert.equal(booked.recordingUrl, 'https://cdn.example.test/rec.wav');
    assert.equal(booked.bookingConfirmed, true);
    const missed = res.json.recentCalls.find((c) => c.id === 'call-test-missed');
    assert.equal(missed.outcome, 'Missed');
    assert.ok(res.json.activity.some((item) => /Sam Ortiz/.test(item.text)));
    assert.ok(res.json.activity.some((item) => item.kind === 'booking'));
  });

  it('records a social handle without pretending it is connected', async () => {
    const start = await request('GET', '/api/integrations/meta/start?business=receptwise', { cookie });
    assert.equal(start.status, 409);
    assert.ok(start.json.missing.includes('META_APP_ID'));

    const saved = await request('PUT', '/api/businesses/receptwise/integrations/instagram', {
      cookie,
      body: { handle: '@receptwise', profileUrl: 'https://instagram.com/receptwise' }
    });
    assert.equal(saved.status, 200, saved.text);
    const ig = saved.json.accounts.find((a) => a.provider === 'instagram');
    assert.equal(ig.status, 'recorded');
    assert.equal(ig.statusLabel, 'Recorded by the team');
    assert.notEqual(ig.status, 'connected');
    const soon = await request('PUT', '/api/businesses/receptwise/integrations/tiktok', {
      cookie,
      body: { handle: '@nope' }
    });
    assert.equal(soon.status, 400);
    const linkedin = saved.json.accounts.find((a) => a.provider === 'linkedin');
    assert.equal(linkedin.status, 'coming_soon');
  });
});
