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
const trelloCards = {};
let trelloSeq = 0;

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
  if (target.includes('api.trello.com')) {
    const u = new URL(target);
    if (u.pathname === '/1/members/me/boards') {
      return jsonRes(200, [
        { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Reception', closed: false },
        { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Archive', closed: true }
      ]);
    }
    if (u.pathname === '/1/members/me') return jsonRes(200, { id: 'member1', fullName: 'Studio Admin', username: 'studioadmin' });
    if (/^\/1\/boards\/[a-f0-9]+\/lists$/i.test(u.pathname)) {
      return jsonRes(200, [
        { id: 'cccccccccccccccccccccccc', name: 'New leads', closed: false },
        { id: 'dddddddddddddddddddddddd', name: 'Done', closed: true }
      ]);
    }
    if (u.pathname === '/1/cards' && method === 'POST') {
      trelloSeq += 1;
      const id = trelloSeq.toString(16).padStart(24, 'e');
      const card = JSON.parse(opts.body);
      trelloCards[id] = card;
      return jsonRes(200, { id, name: card.name, desc: card.desc, idList: card.idList });
    }
    const cardPath = u.pathname.match(/^\/1\/cards\/([a-f0-9]+)$/i);
    if (cardPath && method === 'PUT') {
      const card = JSON.parse(opts.body);
      trelloCards[cardPath[1]] = Object.assign({}, trelloCards[cardPath[1]], card);
      return jsonRes(200, { id: cardPath[1], name: card.name, desc: card.desc });
    }
    return jsonRes(404, { message: 'trello ' + method + ' ' + u.pathname });
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
        resolve({ status: res.statusCode, json, text, headers: res.headers, setCookie: res.headers['set-cookie'] || [] });
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
      trello_cards, assistant_backups, oauth_states, bookings, calls, integrations, audit_log,
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
    const listed = await request('GET', '/api/businesses/receptwise/integrations', { cookie });
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.json.trello.configured, false);
    assert.equal(JSON.stringify(listed.json).includes('token_enc'), false);
  });

  it('stores a Trello key encrypted and never returns it', async () => {
    const key = 'cd'.repeat(16);
    const token = 'ab'.repeat(32);
    const before = httpCalls.length;
    const bad = await request('PUT', '/api/businesses/receptwise/trello/credentials', {
      cookie,
      body: { apiKey: 'short', token }
    });
    assert.equal(bad.status, 400);
    assert.equal(httpCalls.length, before);

    const saved = await request('PUT', '/api/businesses/receptwise/trello/credentials', {
      cookie,
      body: { apiKey: key, token }
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.source, 'saved');
    assert.equal(saved.json.status, 'saved');
    const body = JSON.stringify(saved.json);
    assert.equal(body.includes(key), false);
    assert.equal(body.includes(token), false);
    const row = await db.query("SELECT token_enc FROM integrations WHERE provider = 'trello'");
    assert.ok(row.rows[0].token_enc);
    assert.equal(row.rows[0].token_enc.includes(key), false);
    assert.equal(row.rows[0].token_enc.includes(token), false);
    const cryptoBox = require('../src/cryptoBox');
    const stored = JSON.parse(cryptoBox.decrypt(row.rows[0].token_enc));
    assert.equal(stored.apiKey, key);
    assert.equal(stored.token, token);
    assert.equal(httpCalls.length, before);
  });

  it('tests the Trello connection and saves a board, list, and rules', async () => {
    const key = 'cd'.repeat(16);
    const token = 'ab'.repeat(32);
    httpCalls.length = 0;
    const tested = await request('POST', '/api/businesses/receptwise/trello/test', { cookie });
    assert.equal(tested.status, 200, tested.text);
    assert.equal(tested.json.status, 'connected');
    assert.equal(tested.json.memberName, 'Studio Admin');
    assert.equal(JSON.stringify(tested.json).includes(token), false);
    const me = httpCalls.find((c) => c.url.includes('/1/members/me') && !c.url.includes('/boards'));
    assert.ok(me);
    const meUrl = new URL(me.url);
    assert.equal(meUrl.searchParams.get('key'), key);
    assert.equal(meUrl.searchParams.get('token'), token);
    assert.equal(me.opts.headers['User-Agent'], 'ReceptWise-Control-Panel/1.0');

    const boards = await request('GET', '/api/businesses/receptwise/trello/boards', { cookie });
    assert.equal(boards.status, 200, boards.text);
    assert.deepEqual(boards.json.boards.map((b) => b.name), ['Reception']);

    const lists = await request('GET', '/api/businesses/receptwise/trello/boards/aaaaaaaaaaaaaaaaaaaaaaaa/lists', { cookie });
    assert.equal(lists.status, 200, lists.text);
    assert.deepEqual(lists.json.lists.map((l) => l.name), ['New leads']);

    const rules = await request('PUT', '/api/businesses/receptwise/trello', {
      cookie,
      body: {
        boardId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        listId: 'cccccccccccccccccccccccc',
        rules: { booking: true, missedCall: true }
      }
    });
    assert.equal(rules.status, 200, rules.text);
    assert.equal(rules.json.boardName, 'Reception');
    assert.equal(rules.json.listName, 'New leads');
    assert.equal(rules.json.rules.booking, true);
    assert.equal(rules.json.rules.missedCall, true);
    assert.equal(JSON.stringify(rules.json).includes(key), false);
  });

  it('opens a Trello card for a booking, skips a duplicate, and updates when it changes', async () => {
    const now = new Date().toISOString();
    const posts = () => httpCalls.filter((c) => c.method === 'POST' && c.url.includes('/1/cards') && !c.url.includes('/1/cards/'));
    httpCalls.length = 0;
    const report = (summary, start) => ({
      message: {
        type: 'end-of-call-report',
        endedReason: 'customer-ended-call',
        durationSeconds: 80,
        startedAt: now,
        endedAt: now,
        call: {
          id: 'call-trello-booked',
          assistantId: ASSISTANT,
          phoneNumberId: PHONE_ID,
          type: 'inboundPhoneCall',
          status: 'ended',
          customer: { number: '+16175550199' }
        },
        analysis: {
          summary,
          structuredData: {
            name: 'Sam Ortiz',
            business: 'Harbor Cafe',
            phone: '+16175550199',
            booked_start: start,
            booking_confirmed: true
          }
        }
      }
    });
    const first = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: report('Sam Ortiz booked a demo for Harbor Cafe.', '2026-10-06T15:00:00-04:00')
    });
    assert.equal(first.status, 200, first.text);
    assert.equal(posts().length, 1);
    const created = JSON.parse(posts()[0].opts.body);
    assert.equal(created.idList, 'cccccccccccccccccccccccc');
    assert.equal(created.name, 'Booking · Sam Ortiz');
    assert.match(created.desc, /Caller: Sam Ortiz/);
    assert.match(created.desc, /Phone: \(617\) 555-0199/);
    assert.match(created.desc, /Business: Harbor Cafe/);
    assert.match(created.desc, /Summary: Sam Ortiz booked a demo for Harbor Cafe\./);
    assert.match(created.desc, /https:\/\/panel\.example\.test\/dashboard\.html\?call=call-trello-booked/);
    assert.equal(posts()[0].opts.headers['User-Agent'], 'ReceptWise-Control-Panel/1.0');

    const again = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: report('Sam Ortiz booked a demo for Harbor Cafe.', '2026-10-06T15:00:00-04:00')
    });
    assert.equal(again.status, 200, again.text);
    assert.equal(posts().length, 1);
    assert.equal(httpCalls.filter((c) => c.method === 'PUT' && c.url.includes('/1/cards/')).length, 0);

    const moved = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: report('Sam Ortiz moved the Harbor Cafe demo.', '2026-10-07T16:00:00-04:00')
    });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(posts().length, 1);
    const updates = httpCalls.filter((c) => c.method === 'PUT' && c.url.includes('/1/cards/'));
    assert.equal(updates.length, 1);
    const updated = JSON.parse(updates[0].opts.body);
    assert.match(updated.desc, /Sam Ortiz moved the Harbor Cafe demo\./);
    assert.match(updated.desc, /Oct/);
    const metrics = await request('GET', '/api/metrics?business=receptwise', { cookie });
    assert.ok(metrics.json.activity.some((item) => item.text === 'Created a Trello card for a booking (Sam Ortiz).'));
    assert.ok(metrics.json.activity.some((item) => item.text === 'Updated the Trello card for a booking (Sam Ortiz).'));
    const cards = await db.query("SELECT count(*)::int AS n FROM trello_cards WHERE event_kind = 'booking'");
    assert.equal(cards.rows[0].n, 1);
  });

  it('opens one Trello card for a missed call and skips when that rule is off', async () => {
    const now = new Date().toISOString();
    const missedBody = (id) => ({
      message: {
        type: 'end-of-call-report',
        endedReason: 'customer-did-not-answer',
        durationSeconds: 4,
        startedAt: now,
        endedAt: now,
        call: {
          id,
          assistantId: ASSISTANT,
          type: 'inboundPhoneCall',
          status: 'ended',
          customer: { number: '+16175550100' }
        },
        analysis: {
          summary: 'Riley Chen did not stay on the line.',
          structuredData: { name: 'Riley Chen', phone: '+16175550100', business: 'North Cafe' }
        }
      }
    });
    httpCalls.length = 0;
    const missed = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: missedBody('call-trello-missed')
    });
    assert.equal(missed.status, 200, missed.text);
    const posts = httpCalls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/1/cards');
    assert.equal(posts.length, 1);
    const card = JSON.parse(posts[0].opts.body);
    assert.equal(card.name, 'Missed call · Riley Chen');
    assert.match(card.desc, /Phone: \(617\) 555-0100/);
    assert.match(card.desc, /Business: North Cafe/);
    assert.match(card.desc, /Riley Chen did not stay on the line\./);
    assert.match(card.desc, /dashboard\.html\?call=call-trello-missed/);

    const off = await request('PUT', '/api/businesses/receptwise/trello', {
      cookie,
      body: {
        boardId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        listId: 'cccccccccccccccccccccccc',
        rules: { booking: true, missedCall: false }
      }
    });
    assert.equal(off.status, 200, off.text);
    const before = httpCalls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/1/cards').length;
    const second = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: missedBody('call-trello-missed-2')
    });
    assert.equal(second.status, 200, second.text);
    const after = httpCalls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/1/cards').length;
    assert.equal(after, before);
  });

  it('uses TRELLO_API_KEY and TRELLO_TOKEN when no key is saved', async () => {
    const config = require('../src/config');
    const removed = await request('DELETE', '/api/businesses/receptwise/trello/credentials', { cookie });
    assert.equal(removed.status, 200, removed.text);
    assert.equal(removed.json.source, null);
    config.trello.apiKey = 'e1e2e3e4e5e6e7e8';
    config.trello.token = 'f1f2f3f4f5f6f7f8';
    try {
      const status = await request('GET', '/api/businesses/receptwise/trello', { cookie });
      assert.equal(status.json.source, 'env');
      assert.equal(JSON.stringify(status.json).includes('f1f2f3f4f5f6f7f8'), false);
      const rules = await request('PUT', '/api/businesses/receptwise/trello', {
        cookie,
        body: {
          boardId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          listId: 'cccccccccccccccccccccccc',
          rules: { booking: true, missedCall: true }
        }
      });
      assert.equal(rules.status, 200, rules.text);
      httpCalls.length = 0;
      const now = new Date().toISOString();
      const booked = await request('POST', '/webhooks/vapi', {
        headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
        body: {
          message: {
            type: 'end-of-call-report',
            endedReason: 'customer-ended-call',
            startedAt: now,
            endedAt: now,
            call: {
              id: 'call-trello-env',
              assistantId: ASSISTANT,
              type: 'inboundPhoneCall',
              status: 'ended',
              customer: { number: '+16175550188' }
            },
            analysis: {
              summary: 'Env key booking.',
              structuredData: { name: 'Env Caller', business: 'Env Cafe', phone: '+16175550188', booked_start: '2026-10-08T11:00:00-04:00', booking_confirmed: true }
            }
          }
        }
      });
      assert.equal(booked.status, 200, booked.text);
      const post = httpCalls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/1/cards');
      assert.ok(post);
      assert.equal(new URL(post.url).searchParams.get('key'), 'e1e2e3e4e5e6e7e8');
      assert.equal(new URL(post.url).searchParams.get('token'), 'f1f2f3f4f5f6f7f8');
    } finally {
      config.trello.apiKey = '';
      config.trello.token = '';
    }
  });

  it('lets an admin download clients, settings, calls, and activity', async () => {
    const anon = await request('GET', '/api/export', { headers: { 'X-RW-Client': '' } });
    assert.equal(anon.status, 401);

    const created = await request('POST', '/api/users', {
      cookie,
      body: { email: 'team@receptwise.example', name: 'Team Member', password: 'team-password-10', role: 'team' }
    });
    assert.equal(created.status, 201, created.text);
    const teamLogin = await request('POST', '/api/auth/login', {
      body: { email: 'team@receptwise.example', password: 'team-password-10' }
    });
    assert.equal(teamLogin.status, 200, teamLogin.text);
    const teamCookie = cookieFrom(teamLogin.setCookie);
    const denied = await request('GET', '/api/export', { cookie: teamCookie });
    assert.equal(denied.status, 403);

    const json = await request('GET', '/api/export?format=json', { cookie });
    assert.equal(json.status, 200, json.text);
    assert.match(json.headers['content-disposition'], /receptwise-export-.*\.json/);
    assert.match(json.headers['content-type'], /json/);
    const client = json.json.clients.find((item) => item.slug === 'receptwise');
    assert.ok(client);
    assert.equal(client.name, 'ReceptWise');
    assert.ok(json.json.settings.find((item) => item.slug === 'receptwise'));
    assert.ok(json.json.calls.find((item) => item.caller_name === 'Sam Ortiz' && item.outcome === 'Booked'));
    assert.ok(json.json.activity.length > 0);
    const packed = JSON.stringify(json.json);
    assert.equal(packed.includes('password_hash'), false);
    assert.equal(packed.includes('token_enc'), false);
    assert.equal(packed.includes('test-vapi-key'), false);
    assert.equal(packed.includes('f1f2f3f4f5f6f7f8'), false);

    const sql = await request('GET', '/api/export?format=sql', { cookie });
    assert.equal(sql.status, 200, sql.text.slice(0, 200));
    assert.match(sql.headers['content-disposition'], /receptwise-export-.*\.sql/);
    assert.match(sql.text, /INSERT INTO businesses/);
    assert.match(sql.text, /INSERT INTO calls/);
    assert.match(sql.text, /Sam Ortiz/);
    assert.equal(sql.text.includes('password_hash'), false);
    assert.equal(sql.text.includes('token_enc'), false);
  });

  it('lists, filters, and edits appointments without leaving the portal', async () => {
    const anon = await request('GET', '/api/appointments');
    assert.equal(anon.status, 401);

    const missing = await request('GET', '/api/appointments?business=no-such-business', { cookie });
    assert.equal(missing.status, 404);

    const demoCall = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: {
        message: {
          type: 'end-of-call-report',
          endedReason: 'customer-ended-call',
          durationSeconds: 80,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          call: {
            id: 'call-test-book-demo',
            assistantId: ASSISTANT,
            phoneNumberId: PHONE_ID,
            type: 'inboundPhoneCall',
            status: 'ended',
            customer: { number: '+16175550142' }
          },
          artifact: {
            transcript: 'Booked a demo.',
            messages: [{
              role: 'tool_calls',
              toolCalls: [{
                type: 'function',
                function: {
                  name: 'book_demo',
                  arguments: JSON.stringify({
                    summary: 'Receptwise demo – Northline Clinic – Riley Cho – +16175550142',
                    startDateTime: '2026-10-07T15:00:00',
                    endDateTime: '2026-10-07T15:30:00',
                    timeZone: 'America/New_York',
                    attendees: ['riley@example.test']
                  })
                }
              }]
            }]
          },
          analysis: { summary: 'Riley Cho booked a demo.', structuredData: { name: 'Riley Cho', booking_confirmed: true } }
        }
      }
    });
    assert.equal(demoCall.status, 200, demoCall.text);

    const listed = await request('GET', '/api/appointments?business=receptwise&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z', { cookie });
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.json.businessId, 'receptwise');
    const riley = listed.json.appointments.find((item) => item.customer === 'Riley Cho');
    assert.ok(riley);
    assert.equal(riley.service, 'Northline Clinic');
    assert.equal(riley.phone, '(617) 555-0142');
    assert.equal(riley.startsAt, '2026-10-07T19:00:00.000Z');
    assert.equal(riley.endsAt, '2026-10-07T19:30:00.000Z');
    assert.equal(riley.status, 'Confirmed');
    assert.equal(riley.source, 'Phone');
    assert.equal(riley.callId, 'call-test-book-demo');
    assert.equal(riley.callHref, 'dashboard.html?call=call-test-book-demo');
    const sam = listed.json.appointments.find((item) => item.customer === 'Sam Ortiz');
    assert.ok(sam);
    assert.equal(sam.phone, '(617) 555-0199');

    const other = await request('POST', '/api/businesses', {
      cookie,
      body: { name: 'Northline Family Clinic', timezone: 'Eastern Time', category: 'Clinic' }
    });
    assert.equal(other.status, 201, other.text);
    const scoped = await request('GET', '/api/appointments?business=' + other.json.business.id, { cookie });
    assert.equal(scoped.status, 200, scoped.text);
    assert.equal(scoped.json.appointments.length, 0);

    const created = await request('POST', '/api/appointments', {
      cookie,
      body: {
        businessId: 'receptwise',
        customer: 'Ada Lovelace',
        phone: '7815550100',
        service: 'Intro demo',
        startsAt: '2026-10-09T11:00:00',
        endsAt: '2026-10-09T11:20:00',
        timeZone: 'America/New_York'
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.appointment.customer, 'Ada Lovelace');
    assert.equal(created.json.appointment.phone, '(781) 555-0100');
    assert.equal(created.json.appointment.source, 'Portal');
    assert.equal(created.json.appointment.startsAt, '2026-10-09T15:00:00.000Z');
    assert.equal(created.json.appointment.callHref, null);

    const renamed = await request('PATCH', '/api/appointments/' + created.json.appointment.id, {
      cookie,
      body: { customer: 'Ada King', status: 'Cancelled' }
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.appointment.customer, 'Ada King');
    assert.equal(renamed.json.appointment.status, 'Cancelled');
    assert.equal(renamed.json.appointment.service, 'Intro demo');

    const again = await request('POST', '/webhooks/vapi', {
      headers: { 'X-Vapi-Secret': 'test-webhook-secret' },
      body: {
        message: {
          type: 'end-of-call-report',
          endedReason: 'customer-ended-call',
          call: {
            id: 'call-test-book-demo',
            assistantId: ASSISTANT,
            type: 'inboundPhoneCall',
            status: 'ended',
            customer: { number: '+16175550142' }
          },
          artifact: {
            messages: [{
              role: 'tool_calls',
              toolCalls: [{
                function: {
                  name: 'book_demo',
                  arguments: JSON.stringify({
                    summary: 'Receptwise demo – Northline Clinic – Riley Cho – +16175550142',
                    startDateTime: '2026-10-07T16:00:00',
                    endDateTime: '2026-10-07T16:30:00',
                    timeZone: 'America/New_York'
                  })
                }
              }]
            }]
          }
        }
      }
    });
    assert.equal(again.status, 200, again.text);
    const resynced = await request('GET', '/api/appointments?business=receptwise&from=2026-10-07T00:00:00.000Z&to=2026-10-08T00:00:00.000Z', { cookie });
    const moved = resynced.json.appointments.filter((item) => item.callId === 'call-test-book-demo');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].startsAt, '2026-10-07T20:00:00.000Z');
    const kept = await request('GET', '/api/appointments?business=receptwise&from=2026-10-09T00:00:00.000Z&to=2026-10-10T00:00:00.000Z', { cookie });
    const ada = kept.json.appointments.find((item) => item.customer === 'Ada King');
    assert.ok(ada);
    assert.equal(ada.status, 'Cancelled');

    const bad = await request('POST', '/api/appointments', { cookie, body: { businessId: 'receptwise', service: 'Intro demo' } });
    assert.equal(bad.status, 400);
  });
});
