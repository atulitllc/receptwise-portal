'use strict';
// API tests against Postgres with Vapi and Twilio HTTP mocked.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://rw:rwlocal@127.0.0.1:5432/rw_test';
process.env.ADMIN_EMAIL = 'admin@receptwise.example';
process.env.ADMIN_PASSWORD = 'pilot-password-10';
process.env.ADMIN_NAME = 'Studio Admin';
process.env.VAPI_API_KEY = 'test-vapi-key';
process.env.VAPI_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.VAPI_VOICE_PROVIDER = 'cartesia';
process.env.VAPI_VOICE_ID = 'nora';
process.env.VAPI_VOICE_MODEL = 'sonic-2';
process.env.VAPI_CALENDAR_TOOL_IDS = 'tool-check,tool-book';
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
  let path = target;
  let params = new URLSearchParams();
  try {
    const parsed = new URL(target);
    path = parsed.pathname;
    params = parsed.searchParams;
  } catch (e) { /* keep the raw target */ }
  if (method === 'POST' && path.endsWith('/assistant')) {
    const body = JSON.parse(opts.body);
    return jsonRes(200, { id: 'asst-new-harbor', name: body.name });
  }
  if (method === 'POST' && path.endsWith('/phone-number')) {
    const body = JSON.parse(opts.body);
    return jsonRes(200, { id: 'pn-new-harbor', number: body.number, assistantId: body.assistantId });
  }
  if (method === 'POST' && path.endsWith('/call')) {
    return jsonRes(200, { id: 'call-new-harbor' });
  }
  if (target.includes('AvailablePhoneNumbers')) {
    const area = params.get('AreaCode') || '503';
    if (area === '999') return jsonRes(200, { available_phone_numbers: [] });
    if (area === '781') {
      const pageSize = Number(params.get('PageSize') || 10);
      const numbers = [];
      for (let i = 0; i < 12; i++) {
        const line = String(2000000 + i);
        const national = area + line;
        numbers.push({
          phone_number: '+1' + national,
          friendly_name: '(' + area + ') ' + line.slice(0, 3) + '-' + line.slice(3),
          locality: 'Waltham',
          region: 'MA'
        });
      }
      return jsonRes(200, { available_phone_numbers: numbers.slice(0, pageSize) });
    }
    return jsonRes(200, {
      available_phone_numbers: [{
        phone_number: '+1' + area + '5550199',
        friendly_name: '(' + area + ') 555-0199',
        locality: 'Portland',
        region: 'OR'
      }]
    });
  }
  if (target.includes('IncomingPhoneNumbers.json') && method === 'POST') {
    const form = new URLSearchParams(opts.body);
    return jsonRes(201, { sid: 'PNharbor', phone_number: form.get('PhoneNumber') });
  }
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
const vapi = require('../src/integrations/vapi');
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
      support_access, trello_cards, assistant_backups, oauth_states, bookings, calls, integrations, audit_log,
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

  it('serves the feature status registry', async () => {
    const res = await request('GET', '/api/feature-status', { headers: { 'X-RW-Client': '' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.phone_number.status, 'real');
    assert.equal(res.json.number_search.status, 'real');
    assert.equal(res.json.voice_dropdown.status, 'real');
    assert.equal(res.json.calendar_connection.status, 'in_progress');
    assert.equal(res.json.receptionist.status, 'real');
    assert.equal(res.json.website_generator.status, 'in_progress');
    assert.equal(res.json.cloudflare_pages.status, 'in_progress');
    assert.equal(res.json.website, undefined);
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
    assert.equal(booked.callerName, '');
    assert.equal(booked.from, '');
    assert.equal(booked.outcome, 'Booked');
    assert.equal(booked.summary, '');
    assert.equal(booked.recordingUrl, '');
    assert.equal(booked.redacted, true);
    assert.equal(booked.bookingConfirmed, true);
    const missed = res.json.recentCalls.find((c) => c.id === 'call-test-missed');
    assert.equal(missed.outcome, 'Missed');
    assert.equal(JSON.stringify(res.json.activity).includes('Sam Ortiz'), false);
    assert.ok(res.json.activity.some((item) => item.kind === 'booking' && item.text === 'Booked – details hidden'));
    assert.ok(res.json.activity.some((item) => item.kind === 'call' && item.text === 'Call · details hidden'));
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
    assert.equal(JSON.stringify(metrics.json.activity).includes('Sam Ortiz'), false);
    assert.ok(metrics.json.activity.some((item) => item.kind === 'trello.card_created' && item.text === 'Updated a card · details hidden'));
    assert.ok(metrics.json.activity.some((item) => item.kind === 'trello.card_updated' && item.text === 'Updated a card · details hidden'));
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
    const bookedCall = json.json.calls.find((item) => item.outcome === 'Booked' && item.vapi_call_id === 'call-test-booked');
    assert.ok(bookedCall);
    assert.equal(bookedCall.caller_name, null);
    assert.equal(bookedCall.summary, null);
    assert.equal(bookedCall.recording_url, null);
    assert.ok(json.json.activity.length > 0);
    const packed = JSON.stringify(json.json);
    assert.equal(packed.includes('Sam Ortiz'), false);
    assert.equal(packed.includes('password_hash'), false);
    assert.equal(packed.includes('token_enc'), false);
    assert.equal(packed.includes('test-vapi-key'), false);
    assert.equal(packed.includes('f1f2f3f4f5f6f7f8'), false);

    const sql = await request('GET', '/api/export?format=sql', { cookie });
    assert.equal(sql.status, 200, sql.text.slice(0, 200));
    assert.match(sql.headers['content-disposition'], /receptwise-export-.*\.sql/);
    assert.match(sql.text, /INSERT INTO businesses/);
    assert.match(sql.text, /INSERT INTO calls/);
    assert.equal(sql.text.includes('Sam Ortiz'), false);
    assert.equal(sql.text.includes('password_hash'), false);
    assert.equal(sql.text.includes('token_enc'), false);
  });

  it('onboards a business: save profile, publish, search, buy, and place a test call', async () => {
    const created = await request('POST', '/api/businesses', {
      cookie,
      body: {
        name: 'Harbor Cafe',
        category: 'Cafe',
        city: 'Portland, OR',
        timezone: 'Pacific Time',
        hours: 'Tue–Sun 8:00 AM – 3:00 PM',
        greeting: 'Thanks for calling Harbor Cafe.',
        address: '418 Lantern Street',
        transfer: '(503) 555-0101',
        services: [{ name: 'Brunch table', length: '90 min' }],
        faqs: [{ q: 'Do you take reservations?', a: 'Yes.' }],
        blurb: 'A neighborhood cafe.',
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false }
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.business.id, 'harbor-cafe');

    const saved = await request('PUT', '/api/businesses/harbor-cafe', {
      cookie,
      body: {
        hours: 'Tue–Sun 8:00 AM – 4:00 PM',
        greeting: 'Thanks for calling Harbor Cafe. This call may be recorded.',
        timezone: 'Pacific Time',
        services: [{ name: 'Brunch table', length: '90 min', price: '$0' }],
        transfer: '(503) 555-0172'
      }
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.business.hours, 'Tue–Sun 8:00 AM – 4:00 PM');
    assert.equal(saved.json.business.timezone, 'Pacific Time');

    httpCalls.length = 0;
    const published = await request('POST', '/api/businesses/harbor-cafe/assistant/publish', { cookie });
    assert.equal(published.status, 200, published.text);
    assert.equal(published.json.assistantId, 'asst-new-harbor');
    assert.equal(published.json.voiceSet, true);
    assert.equal(published.json.calendarTools, 2);

    const createCall = httpCalls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/assistant');
    assert.ok(createCall, 'expected a Vapi assistant create');
    assert.equal(createCall.opts.headers.Authorization, 'Bearer test-vapi-key');
    assert.equal(new URL(createCall.url).host, 'api.vapi.ai');
    const assistant = JSON.parse(createCall.opts.body);
    assert.equal(assistant.firstMessage, 'Thanks for calling Harbor Cafe. This call may be recorded.');
    assert.equal(assistant.voice.provider, 'cartesia');
    assert.equal(assistant.voice.voiceId, 'nora');
    assert.equal(assistant.voice.model, 'sonic-2');
    assert.equal(assistant.voice.language, 'en');
    assert.deepEqual(assistant.model.toolIds, ['tool-check', 'tool-book']);
    assert.equal(assistant.model.tools[0].destinations[0].number, '+15035550172');
    assert.equal(assistant.server.url, 'https://panel.example.test/webhooks/vapi');
    assert.equal(assistant.server.headers['X-Vapi-Secret'], 'test-webhook-secret');
    const prompt = assistant.model.messages[0].content;
    assert.match(prompt, /Harbor Cafe/);
    assert.match(prompt, /Portland, OR/);
    assert.match(prompt, /Tue–Sun 8:00 AM – 4:00 PM/);
    assert.match(prompt, /Brunch table/);
    assert.match(prompt, /you can book appointments/);
    assert.match(prompt, /check_availability and then the booking tool/);
    const laOffset = vapi.utcOffset('America/Los_Angeles');
    assert.match(prompt, new RegExp('The current UTC offset for America/Los_Angeles is ' + laOffset.replace('+', '\\+')));
    assert.match(prompt, /-07:00 during daylight saving time and -08:00 otherwise/);
    assert.match(prompt, /Harbor Cafe appointment – \{service\} – \{caller name\} – \{phone\}/);
    assert.match(prompt, /never promise to send a text/);

    const stored = await db.query(
      `SELECT a.config, a.vapi_assistant_id FROM assistants a
       JOIN businesses b ON b.id = a.business_id WHERE b.slug = 'harbor-cafe'`
    );
    const configRow = typeof stored.rows[0].config === 'string' ? JSON.parse(stored.rows[0].config) : stored.rows[0].config;
    assert.equal(stored.rows[0].vapi_assistant_id, 'asst-new-harbor');
    assert.equal(configRow.server.url, 'https://panel.example.test/webhooks/vapi');
    assert.equal(configRow.server.headers, undefined);
    assert.equal(JSON.stringify(configRow).includes('test-webhook-secret'), false);

    const search = await request('GET', '/api/businesses/harbor-cafe/numbers/search?areaCode=503', { cookie });
    assert.equal(search.status, 200, search.text);
    assert.equal(search.json.numbers[0].e164, '+15035550199');
    const searchCall = httpCalls.find((c) => c.url.includes('AvailablePhoneNumbers'));
    assert.ok(searchCall);
    assert.equal(new URL(searchCall.url).searchParams.get('AreaCode'), '503');
    assert.equal(new URL(searchCall.url).host, 'api.twilio.com');

    const bought = await request('POST', '/api/businesses/harbor-cafe/numbers/provision', {
      cookie,
      body: { e164: search.json.numbers[0].e164 }
    });
    assert.equal(bought.status, 201, bought.text);
    assert.equal(bought.json.e164, '+15035550199');
    assert.equal(bought.json.pretty, '(503) 555-0199');
    assert.equal(bought.json.business.phone.aiNumber, '(503) 555-0199');
    const numberStep = bought.json.business.checklist.find((item) => item.key === 'number');
    assert.equal(numberStep.status, 'connected');

    const twilioBuy = httpCalls.find((c) => c.method === 'POST' && c.url.includes('IncomingPhoneNumbers.json'));
    assert.ok(twilioBuy);
    assert.equal(new URLSearchParams(twilioBuy.opts.body).get('PhoneNumber'), '+15035550199');
    const imported = httpCalls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/phone-number');
    assert.ok(imported);
    const importBody = JSON.parse(imported.opts.body);
    assert.equal(importBody.provider, 'twilio');
    assert.equal(importBody.number, '+15035550199');
    assert.equal(importBody.assistantId, 'asst-new-harbor');
    assert.equal(importBody.smsEnabled, false);
    assert.equal(importBody.server.url, 'https://panel.example.test/webhooks/vapi');
    assert.equal(importBody.server.headers['X-Vapi-Secret'], 'test-webhook-secret');
    assert.equal(importBody.twilioAccountSid, 'AC11111111111111111111111111111111');

    const again = await request('POST', '/api/businesses/harbor-cafe/numbers/provision', {
      cookie,
      body: { e164: '+15035550198' }
    });
    assert.equal(again.status, 409, again.text);

    const tested = await request('POST', '/api/businesses/harbor-cafe/test-call', {
      cookie,
      body: { to: '(617) 555-0144' }
    });
    assert.equal(tested.status, 200, tested.text);
    assert.equal(tested.json.callId, 'call-new-harbor');
    const testCall = httpCalls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/call');
    assert.ok(testCall);
    const testBody = JSON.parse(testCall.opts.body);
    assert.equal(testBody.assistantId, 'asst-new-harbor');
    assert.equal(testBody.phoneNumberId, 'pn-new-harbor');
    assert.equal(testBody.customer.number, '+16175550144');
  });

  it('lets an admin search available numbers by area code without buying', async () => {
    const anon = await request('GET', '/api/numbers/search?areaCode=781');
    assert.equal(anon.status, 401);

    const team = await request('POST', '/api/users', {
      cookie,
      body: { email: 'search-team@receptwise.example', name: 'Search Team', password: 'team-password-10', role: 'team' }
    });
    assert.equal(team.status, 201, team.text);
    const teamLogin = await request('POST', '/api/auth/login', {
      body: { email: 'search-team@receptwise.example', password: 'team-password-10' }
    });
    assert.equal(teamLogin.status, 200, teamLogin.text);
    const denied = await request('GET', '/api/numbers/search?areaCode=781', { cookie: cookieFrom(teamLogin.setCookie) });
    assert.equal(denied.status, 403);

    const bad = await request('GET', '/api/numbers/search?areaCode=78', { cookie });
    assert.equal(bad.status, 400);

    const before = httpCalls.length;
    const res = await request('GET', '/api/numbers/search?areaCode=781', { cookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.numbers.length, 10);
    assert.equal(res.json.numbers[0].e164, '+17812000000');
    assert.equal(res.json.numbers[0].friendly, '(781) 200-0000');
    assert.equal(res.json.numbers[0].locality, 'Waltham');
    const calls = httpCalls.slice(before);
    const searchCall = calls.find((c) => c.url.includes('AvailablePhoneNumbers'));
    assert.ok(searchCall);
    assert.equal(searchCall.method, 'GET');
    assert.equal(new URL(searchCall.url).searchParams.get('AreaCode'), '781');
    assert.equal(new URL(searchCall.url).searchParams.get('PageSize'), '10');
    assert.equal(new URL(searchCall.url).searchParams.get('VoiceEnabled'), 'true');
    assert.equal(calls.some((c) => c.method === 'POST' && c.url.includes('IncomingPhoneNumbers')), false);

    const empty = await request('GET', '/api/numbers/search?areaCode=999', { cookie });
    assert.equal(empty.status, 200, empty.text);
    assert.deepEqual(empty.json.numbers, []);
  });

  it('provisions the e164 the admin picked and does not search first', async () => {
    const created = await request('POST', '/api/businesses', {
      cookie,
      body: { name: 'Waltham Books', category: 'Retail', city: 'Waltham, MA', timezone: 'Eastern Time' }
    });
    assert.equal(created.status, 201, created.text);
    const slug = created.json.business.id;
    httpCalls.length = 0;
    const chosen = '+17812000999';
    const bought = await request('POST', '/api/businesses/' + slug + '/numbers/provision', {
      cookie,
      body: { e164: chosen }
    });
    assert.equal(bought.status, 201, bought.text);
    assert.equal(bought.json.e164, chosen);
    assert.equal(bought.json.pretty, '(781) 200-0999');
    assert.equal(bought.json.business.phone.aiNumber, '(781) 200-0999');
    assert.equal(httpCalls.some((c) => c.url.includes('AvailablePhoneNumbers')), false);
    const twilioBuy = httpCalls.find((c) => c.method === 'POST' && c.url.includes('IncomingPhoneNumbers.json'));
    assert.ok(twilioBuy);
    assert.equal(new URLSearchParams(twilioBuy.opts.body).get('PhoneNumber'), chosen);
    assert.equal(httpCalls.filter((c) => c.method === 'POST' && c.url.includes('IncomingPhoneNumbers.json')).length, 1);
  });

  it('saves a wizard draft without creating an assistant or buying a number', async () => {
    const missing = await request('POST', '/api/businesses/draft', {
      cookie,
      body: { name: 'Draft Bakery' }
    });
    assert.equal(missing.status, 400);

    const before = httpCalls.length;
    const created = await request('POST', '/api/businesses/draft', {
      cookie,
      body: {
        name: 'Draft Bakery',
        category: 'Retail',
        city: 'Waltham, MA',
        timezone: 'Eastern Time',
        hours: 'Mon–Fri 8–4',
        greeting: 'Thanks for calling Draft Bakery.',
        wizardStep: 2,
        phone: { mode: 'new', requestedE164: '+17812000007', aiNumber: '(781) 555-0148' },
        wizard: {
          step: 2,
          name: 'Draft Bakery',
          category: 'Retail',
          city: 'Waltham, MA',
          hours: 'Mon–Fri 8–4',
          greeting: 'Thanks for calling Draft Bakery.',
          areaCode: '781',
          chosenE164: '+17812000007',
          chosenNumber: '(781) 200-0007'
        }
      }
    });
    assert.equal(created.status, 201, created.text);
    const draft = created.json.business;
    assert.equal(draft.status, 'draft');
    assert.equal(draft.name, 'Draft Bakery');
    assert.equal(draft.category, 'Retail');
    assert.equal(draft.wizardStep, 2);
    assert.equal(draft.wizard.greeting, 'Thanks for calling Draft Bakery.');
    assert.equal(draft.wizard.chosenE164, '+17812000007');
    assert.equal(draft.phone.aiNumber, '');
    assert.equal(draft.phone.requestedE164, '+17812000007');
    assert.equal(draft.assistantPublished, false);
    const progress = Object.fromEntries(draft.setupProgress.map((item) => [item.key, item.done]));
    assert.equal(progress.details, true);
    assert.equal(progress.receptionist, false);
    assert.equal(progress.number, false);
    assert.equal(progress.test, false);
    const calls = httpCalls.slice(before);
    assert.equal(calls.some((c) => /vapi|twilio/i.test(c.url)), false);
    const assistants = await db.query('SELECT vapi_assistant_id FROM assistants WHERE business_id = $1', [draft.dbId]);
    const numbers = await db.query('SELECT e164 FROM phone_numbers WHERE business_id = $1', [draft.dbId]);
    assert.equal(assistants.rows.length, 0);
    assert.equal(numbers.rows.length, 0);

    const listed = await request('GET', '/api/businesses', { cookie });
    assert.equal(listed.status, 200, listed.text);
    const row = listed.json.businesses.find((b) => b.id === draft.id);
    assert.ok(row);
    assert.equal(row.status, 'draft');
    assert.equal(row.wizardStep, 2);

    const resumed = await request('GET', '/api/businesses/' + draft.id, { cookie });
    assert.equal(resumed.status, 200, resumed.text);
    assert.equal(resumed.json.business.wizardStep, 2);
    assert.equal(resumed.json.business.wizard.chosenE164, '+17812000007');
    assert.equal(resumed.json.business.wizard.hours, 'Mon–Fri 8–4');
    assert.equal(resumed.json.business.hours, 'Mon–Fri 8–4');

    const updatedBefore = httpCalls.length;
    const updated = await request('PUT', '/api/businesses/' + draft.id + '/draft', {
      cookie,
      body: {
        name: 'Draft Bakery',
        category: 'Retail',
        city: 'Waltham, MA',
        address: '12 Main Street',
        wizardStep: 4,
        wizard: {
          step: 4,
          name: 'Draft Bakery',
          category: 'Retail',
          address: '12 Main Street',
          greeting: 'Thanks for calling Draft Bakery. We book visits.',
          chosenE164: '+17812000007'
        }
      }
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.business.status, 'draft');
    assert.equal(updated.json.business.wizardStep, 4);
    assert.equal(updated.json.business.address, '12 Main Street');
    assert.equal(updated.json.business.wizard.greeting, 'Thanks for calling Draft Bakery. We book visits.');
    assert.equal(updated.json.business.wizard.chosenE164, '+17812000007');
    assert.equal(httpCalls.slice(updatedBefore).some((c) => /vapi|twilio/i.test(c.url)), false);

    const stuck = await request('PUT', '/api/businesses/' + draft.id, {
      cookie,
      body: { status: 'live', name: 'Draft Bakery' }
    });
    assert.equal(stuck.status, 200, stuck.text);
    assert.equal(stuck.json.business.status, 'draft');

    const notDraft = await request('PUT', '/api/businesses/receptwise/draft', {
      cookie,
      body: { name: 'ReceptWise', category: 'Professional services' }
    });
    assert.equal(notDraft.status, 409);
    const keepPilot = await request('DELETE', '/api/businesses/receptwise', { cookie });
    assert.equal(keepPilot.status, 409);

    const finished = await request('POST', '/api/businesses/' + draft.id + '/draft/finish', {
      cookie,
      body: { name: 'Draft Bakery', category: 'Retail', city: 'Waltham, MA' }
    });
    assert.equal(finished.status, 200, finished.text);
    assert.equal(finished.json.business.status, 'setup');
    assert.equal(finished.json.business.wizardStep, 9);
    assert.equal(finished.json.business.wizard.chosenE164, '+17812000007');
    assert.equal(finished.json.business.phone.aiNumber, '');
    const finishedDelete = await request('DELETE', '/api/businesses/' + draft.id, { cookie });
    assert.equal(finishedDelete.status, 409);

    const second = await request('POST', '/api/businesses/draft', {
      cookie,
      body: { name: 'Discarded Draft', category: 'Salon', wizardStep: 1, wizard: { step: 1, name: 'Discarded Draft', category: 'Salon' } }
    });
    assert.equal(second.status, 201, second.text);
    const removed = await request('DELETE', '/api/businesses/' + second.json.business.id, { cookie });
    assert.equal(removed.status, 200, removed.text);
    assert.equal(removed.json.ok, true);
    const gone = await request('GET', '/api/businesses/' + second.json.business.id, { cookie });
    assert.equal(gone.status, 404);
    const afterList = await request('GET', '/api/businesses', { cookie });
    assert.equal(afterList.json.businesses.some((b) => b.id === second.json.business.id), false);
    assert.equal(afterList.json.businesses.some((b) => b.id === draft.id && b.status === 'setup'), true);
  });

  it('stores a Cal.com event type and encrypts the API key', async () => {
    const cryptoBox = require('../src/cryptoBox');
    const secret = 'cal_live_test_key_123';
    const created = await request('POST', '/api/businesses/draft', {
      cookie,
      body: {
        name: 'Cal.com Draft',
        category: 'Professional services',
        calendar: { provider: 'calcom', calcomEventTypeId: '20-minute-demo', apiKey: secret },
        wizard: { calendar: 'cal', calcomEventTypeId: '20-minute-demo', calcomApiKey: secret, step: 4 }
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.business.calendar.provider, 'calcom');
    assert.equal(created.json.business.calendar.calcomEventTypeId, '20-minute-demo');
    assert.equal(created.json.business.calcomKeySaved, false);
    assert.equal(JSON.stringify(created.json).includes(secret), false);
    const slug = created.json.business.id;
    const storedEarly = await db.query(
      `SELECT profile, (SELECT count(*) FROM integrations i WHERE i.business_id = businesses.id AND i.provider = 'calcom') AS keys
       FROM businesses WHERE slug = $1`,
      [slug]
    );
    assert.equal(JSON.stringify(storedEarly.rows[0].profile).includes(secret), false);
    assert.equal(Number(storedEarly.rows[0].keys), 0);

    const before = httpCalls.length;
    const saved = await request('PUT', '/api/businesses/' + slug + '/calendar', {
      cookie,
      body: { provider: 'calcom', calcomEventTypeId: '20-minute-demo', apiKey: secret }
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.calcomKeySaved, true);
    assert.equal(saved.json.calendar.provider, 'calcom');
    assert.equal(saved.json.calendar.calcomEventTypeId, '20-minute-demo');
    assert.equal(saved.json.business.calcomKeySaved, true);
    assert.equal(JSON.stringify(saved.json).includes(secret), false);
    assert.equal(httpCalls.slice(before).some((c) => /vapi|twilio|cal\.com/i.test(c.url)), false);

    const row = await db.query(
      `SELECT i.token_enc, b.profile FROM integrations i JOIN businesses b ON b.id = i.business_id
       WHERE b.slug = $1 AND i.provider = 'calcom'`,
      [slug]
    );
    assert.equal(cryptoBox.decrypt(row.rows[0].token_enc), secret);
    assert.equal(row.rows[0].profile.calendar.provider, 'calcom');
    assert.equal(row.rows[0].profile.calendar.calcomEventTypeId, '20-minute-demo');
    assert.equal(JSON.stringify(row.rows[0].profile).includes(secret), false);

    const renamed = await request('PUT', '/api/businesses/' + slug + '/calendar', {
      cookie,
      body: { provider: 'calcom', calcomEventTypeId: 'intro-call' }
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.calendar.calcomEventTypeId, 'intro-call');
    assert.equal(renamed.json.calcomKeySaved, true);
    const still = await db.query(
      `SELECT i.token_enc FROM integrations i JOIN businesses b ON b.id = i.business_id
       WHERE b.slug = $1 AND i.provider = 'calcom'`,
      [slug]
    );
    assert.equal(cryptoBox.decrypt(still.rows[0].token_enc), secret);

    const resumed = await request('GET', '/api/businesses/' + slug, { cookie });
    assert.equal(resumed.json.business.calendar.calcomEventTypeId, 'intro-call');
    assert.equal(resumed.json.business.calcomKeySaved, true);
    assert.equal(resumed.json.business.wizard.calcomEventTypeId, '20-minute-demo');
    assert.equal(JSON.stringify(resumed.json).includes(secret), false);

    const rejected = await request('PUT', '/api/businesses/' + slug + '/calendar', {
      cookie,
      body: { provider: 'google', apiKey: secret }
    });
    assert.equal(rejected.status, 400, rejected.text);
    const unchanged = await db.query('SELECT profile FROM businesses WHERE slug = $1', [slug]);
    assert.equal(unchanged.rows[0].profile.calendar.provider, 'calcom');

    const messages = await request('PUT', '/api/businesses/' + slug + '/calendar', {
      cookie,
      body: { provider: 'none' }
    });
    assert.equal(messages.status, 200, messages.text);
    assert.equal(messages.json.calendar.provider, 'none');
    assert.equal(Object.hasOwn(messages.json.calendar, 'calcomEventTypeId'), false);
  });

  it('lists the voice catalog and publishes the voice saved on the business', async () => {
    const fs = require('fs');
    const path = require('path');
    const anon = await request('GET', '/api/voices');
    assert.equal(anon.status, 401);

    const catalog = await request('GET', '/api/voices', { cookie });
    assert.equal(catalog.status, 200, catalog.text);
    const keys = catalog.json.voices.map((voice) => voice.key);
    assert.deepEqual(keys, ['nora', 'sarah', 'jessica', 'laura', 'lily']);
    assert.equal(catalog.json.voices[0].isDefault, true);
    assert.match(catalog.json.voices[0].description, /calm and natural/);
    assert.equal(JSON.stringify(catalog.json).includes('Juniper'), false);
    assert.equal(keys.includes('andrew'), false);

    const created = await request('POST', '/api/businesses', {
      cookie,
      body: { name: 'Voice Trial', category: 'Retail', voice: 'sarah' }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.business.voice, 'sarah');
    httpCalls.length = 0;
    const published = await request('POST', '/api/businesses/' + created.json.business.id + '/assistant/publish', { cookie });
    assert.equal(published.status, 200, published.text);
    const assistant = JSON.parse(httpCalls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/assistant').opts.body);
    assert.deepEqual(assistant.voice, {
      provider: '11labs', voiceId: 'EXAVITQu4vr4xnSDxMaL', model: 'eleven_flash_v2_5'
    });

    const migrated = await request('PUT', '/api/businesses/' + created.json.business.id, {
      cookie,
      body: { voice: 'Sol (bright)' }
    });
    assert.equal(migrated.status, 200, migrated.text);
    assert.equal(migrated.json.business.voice, 'nora');

    await db.query(`UPDATE businesses SET profile = jsonb_set(profile, '{voice}', '"Harbor (clear)"') WHERE slug = $1`, [created.json.business.id]);
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/006_voice_catalog.sql'), 'utf8');
    await db.query(sql);
    const again = await db.query(`SELECT profile->>'voice' AS voice FROM businesses WHERE slug = $1`, [created.json.business.id]);
    assert.equal(again.rows[0].voice, 'nora');
    await db.query(sql);
    const twice = await db.query(`SELECT profile->>'voice' AS voice FROM businesses WHERE slug = $1`, [created.json.business.id]);
    assert.equal(twice.rows[0].voice, 'nora');
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

    const hidden = await request('GET', '/api/appointments?business=receptwise&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z', { cookie });
    assert.equal(hidden.status, 200, hidden.text);
    const veiled = hidden.json.appointments.find((item) => item.startsAt === '2026-10-07T19:00:00.000Z');
    assert.ok(veiled);
    assert.equal(veiled.customer, 'Booked – details hidden');
    assert.equal(veiled.phone, '');
    assert.equal(veiled.email, '');
    assert.equal(veiled.callId, null);
    assert.equal(JSON.stringify(hidden.json).includes('Riley'), false);
    const deniedWrite = await request('POST', '/api/appointments', {
      cookie,
      body: {
        businessId: 'receptwise',
        customer: 'Should Fail',
        startsAt: '2026-10-09T11:00:00',
        timeZone: 'America/New_York'
      }
    });
    assert.equal(deniedWrite.status, 403);

    await db.query(
      `INSERT INTO support_access (business_id, enabled, expires_at, granted_by)
       SELECT id, true, now() + interval '72 hours', (SELECT id FROM users WHERE email = 'admin@receptwise.example')
       FROM businesses WHERE slug = 'receptwise'
       ON CONFLICT (business_id) DO UPDATE SET enabled = true, expires_at = now() + interval '72 hours'`
    );

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

  it('keeps caller details inside one business until its owner allows Receptwise access', async () => {
    await db.query('DELETE FROM support_access');
    const adminBiz = await request('GET', '/api/businesses/receptwise', { cookie });
    assert.equal(adminBiz.status, 200, adminBiz.text);
    assert.equal(adminBiz.json.business.detailsVisible, false);
    assert.ok(adminBiz.json.business.calls.length > 0);
    assert.ok(adminBiz.json.business.calls.every((call) => call.from === 'Details hidden' && call.summary === '' && call.lines.length === 0 && call.recordingUrl === ''));
    assert.ok(adminBiz.json.business.bookings.every((booking) => booking.phone === '' && booking.email === '' && /details hidden$/.test(booking.customer)));
    assert.equal(JSON.stringify(adminBiz.json).includes('Sam Ortiz'), false);
    assert.equal(JSON.stringify(adminBiz.json).includes('Riley'), false);
    assert.ok(adminBiz.json.business.callsToday >= 0);

    const blocked = await request('POST', '/api/appointments', {
      cookie,
      body: { businessId: 'receptwise', customer: 'Hidden', startsAt: '2026-11-02T15:00:00', timeZone: 'America/New_York' }
    });
    assert.equal(blocked.status, 403);
    const blockedPatch = await request('PATCH', '/api/appointments/1', { cookie, body: { status: 'Completed' } });
    assert.ok(blockedPatch.status === 403 || blockedPatch.status === 404);

    const quiet = await request('GET', '/api/metrics?business=receptwise', { cookie });
    assert.equal(quiet.status, 200, quiet.text);
    assert.equal(JSON.stringify(quiet.json.recentCalls).includes('Sam Ortiz'), false);
    assert.equal(JSON.stringify(quiet.json.activity).includes('Sam Ortiz'), false);
    assert.ok(quiet.json.calls.today >= 1);

    const recept = await db.query("SELECT id FROM businesses WHERE slug = 'receptwise'");
    const owner = await auth.createUser({
      email: 'owner-privacy@receptwise.example',
      password: 'owner-password-10',
      name: 'Pilot Owner',
      role: 'owner',
      businessId: recept.rows[0].id
    });
    assert.ok(owner);
    const ownerLogin = await request('POST', '/api/auth/login', {
      body: { email: 'owner-privacy@receptwise.example', password: 'owner-password-10' }
    });
    assert.equal(ownerLogin.status, 200, ownerLogin.text);
    assert.equal(ownerLogin.json.user.role, 'owner');
    assert.equal(ownerLogin.json.user.businessSlug, 'receptwise');
    const ownerCookie = cookieFrom(ownerLogin.setCookie);

    const ownList = await request('GET', '/api/businesses', { cookie: ownerCookie });
    assert.equal(ownList.status, 200, ownList.text);
    assert.equal(ownList.json.businesses.length, 1);
    assert.equal(ownList.json.businesses[0].id, 'receptwise');
    assert.equal(ownList.json.businesses[0].detailsVisible, true);
    assert.ok(JSON.stringify(ownList.json).includes('Sam Ortiz') || JSON.stringify(ownList.json).includes('Riley Cho'));

    const viewsBeforeOwn = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'support.view' AND user_id = $1", [owner.id]);
    const ownAppts = await request('GET', '/api/appointments?business=receptwise', { cookie: ownerCookie });
    assert.equal(ownAppts.status, 200, ownAppts.text);
    assert.ok(ownAppts.json.appointments.some((item) => item.customer === 'Riley Cho' || item.customer === 'Sam Ortiz'));
    const viewsAfterOwn = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'support.view' AND user_id = $1", [owner.id]);
    assert.equal(viewsAfterOwn.rows[0].n, viewsBeforeOwn.rows[0].n);

    const foreignBiz = await request('GET', '/api/businesses/northline-family-clinic', { cookie: ownerCookie });
    assert.equal(foreignBiz.status, 404);
    const foreignAppts = await request('GET', '/api/appointments?business=northline-family-clinic', { cookie: ownerCookie });
    assert.equal(foreignAppts.status, 404);
    const foreignMetrics = await request('GET', '/api/metrics?business=northline-family-clinic', { cookie: ownerCookie });
    assert.equal(foreignMetrics.status, 404);
    const noCreate = await request('POST', '/api/businesses', {
      cookie: ownerCookie,
      body: { name: 'Should Fail', timezone: 'Eastern Time', category: 'Cafe' }
    });
    assert.equal(noCreate.status, 403);

    const adminGrant = await request('PUT', '/api/businesses/receptwise/support-access', {
      cookie,
      body: { enabled: true, hours: 72 }
    });
    assert.equal(adminGrant.status, 403);

    const north = await db.query("SELECT id, slug FROM businesses WHERE slug = 'northline-family-clinic'");
    assert.ok(north.rows[0]);
    const staff = await auth.createUser({
      email: 'staff-privacy@northline.example',
      password: 'staff-password-10',
      name: 'North Staff',
      role: 'staff',
      businessId: north.rows[0].id
    });
    assert.ok(staff);
    const staffLogin = await request('POST', '/api/auth/login', {
      body: { email: 'staff-privacy@northline.example', password: 'staff-password-10' }
    });
    const staffCookie = cookieFrom(staffLogin.setCookie);
    assert.equal(staffLogin.json.user.businessSlug, 'northline-family-clinic');
    const cross = await request('GET', '/api/businesses/receptwise', { cookie: staffCookie });
    assert.equal(cross.status, 404);
    const crossAppts = await request('GET', '/api/appointments?business=receptwise', { cookie: staffCookie });
    assert.equal(crossAppts.status, 404);
    const crossCalls = await request('GET', '/api/appointments', { cookie: staffCookie });
    assert.equal(crossCalls.status, 200, crossCalls.text);
    assert.equal(crossCalls.json.businessId, 'northline-family-clinic');
    assert.equal(JSON.stringify(crossCalls.json).includes('Riley'), false);
    assert.equal(JSON.stringify(crossCalls.json).includes('Sam Ortiz'), false);
    const staffGrant = await request('PUT', '/api/businesses/' + north.rows[0].slug + '/support-access', {
      cookie: staffCookie,
      body: { enabled: true }
    });
    assert.equal(staffGrant.status, 403);

    const badHours = await request('PUT', '/api/businesses/receptwise/support-access', {
      cookie: ownerCookie,
      body: { enabled: true, hours: 0 }
    });
    assert.equal(badHours.status, 400);
    const granted = await request('PUT', '/api/businesses/receptwise/support-access', {
      cookie: ownerCookie,
      body: { enabled: true }
    });
    assert.equal(granted.status, 200, granted.text);
    assert.equal(granted.json.supportAccess.active, true);
    assert.ok(granted.json.supportAccess.expiresAt);
    const hours = (new Date(granted.json.supportAccess.expiresAt).getTime() - Date.now()) / 3600000;
    assert.ok(hours > 71 && hours <= 72);

    const seen = await request('GET', '/api/appointments?business=receptwise&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z', { cookie });
    assert.ok(seen.json.appointments.some((item) => item.customer === 'Riley Cho'));
    const opened = await request('GET', '/api/businesses/receptwise', { cookie });
    assert.equal(opened.json.business.detailsVisible, true);
    assert.ok(opened.json.business.calls.some((call) => /Sam Ortiz/.test(call.from) || /Riley/.test(call.summary) || call.summary));
    const views = await db.query(
      "SELECT user_id, detail FROM audit_log WHERE action = 'support.view' AND business_id = $1",
      [recept.rows[0].id]
    );
    assert.ok(views.rows.length > 0);
    assert.ok(views.rows.every((row) => Number(row.user_id) !== Number(owner.id)));
    assert.equal(JSON.stringify(views.rows).includes('Riley'), false);
    assert.equal(JSON.stringify(views.rows).includes('Sam'), false);
    assert.ok(views.rows.some((row) => row.detail && (row.detail.what === 'appointments' || row.detail.what === 'business')));

    const teamLogin = await request('POST', '/api/auth/login', {
      body: { email: 'team@receptwise.example', password: 'team-password-10' }
    });
    const teamCookie = cookieFrom(teamLogin.setCookie);
    const teamOpen = await request('GET', '/api/businesses/receptwise', { cookie: teamCookie });
    assert.equal(teamOpen.json.business.detailsVisible, true);
    assert.ok(JSON.stringify(teamOpen.json).includes('Sam Ortiz') || JSON.stringify(teamOpen.json).includes('Riley Cho'));

    const off = await request('PUT', '/api/businesses/receptwise/support-access', {
      cookie: ownerCookie,
      body: { enabled: false }
    });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.json.supportAccess.active, false);
    const closed = await request('GET', '/api/businesses/receptwise', { cookie });
    assert.equal(closed.json.business.detailsVisible, false);
    assert.equal(JSON.stringify(closed.json).includes('Sam Ortiz'), false);

    await db.query(
      "UPDATE support_access SET enabled = true, expires_at = now() - interval '1 hour' WHERE business_id = $1",
      [recept.rows[0].id]
    );
    const expired = await request('GET', '/api/metrics?business=receptwise', { cookie });
    assert.ok(expired.json.recentCalls.length > 0);
    assert.ok(expired.json.recentCalls.every((call) => call.redacted === true && call.callerName === ''));
    assert.equal(JSON.stringify(expired.json).includes('Sam Ortiz'), false);
  });
});
