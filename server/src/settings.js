'use strict';
// Validates receptionist settings, stores them, and pushes a managed prompt section to Vapi.
const db = require('./db');
const config = require('./config');
const vapi = require('./integrations/vapi');
const audit = require('./audit');

const MARK_START = '<!-- receptwise:managed -->';
const MARK_END = '<!-- /receptwise:managed -->';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
};
const ZONES = {
  'Eastern Time': 'America/New_York',
  'Central Time': 'America/Chicago',
  'Mountain Time': 'America/Denver',
  'Pacific Time': 'America/Los_Angeles',
  'Arizona Time': 'America/Phoenix',
  'Alaska Time': 'America/Anchorage',
  'Hawaii Time': 'Pacific/Honolulu'
};
const ZONE_SET = new Set(Object.values(ZONES));

function fail(errors) {
  const err = new Error(errors[0]);
  err.status = 400;
  err.fields = errors;
  throw err;
}

function normalizeZone(value) {
  const raw = String(value || '').trim();
  if (ZONES[raw]) return ZONES[raw];
  if (ZONE_SET.has(raw)) return raw;
  return '';
}

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return match[1] + ':' + match[2];
}

function normalizeFaqs(raw) {
  if (raw == null || raw === '') return [];
  if (!Array.isArray(raw)) return { error: 'FAQs must be a list.' };
  if (raw.length > 25) return { error: 'Keep FAQs to 25 or fewer.' };
  const faqs = [];
  for (const item of raw) {
    const q = String((item && (item.q || item.question)) || '').trim();
    const a = String((item && (item.a || item.answer)) || '').trim();
    if (!q && !a) continue;
    if (!q || !a) return { error: 'Each FAQ needs both a question and an answer.' };
    if (q.length > 200 || a.length > 800) return { error: 'FAQ questions must be 200 characters or fewer, and answers 800 or fewer.' };
    faqs.push({ q, a });
  }
  return { faqs };
}

function validateSettings(input) {
  const src = input || {};
  const errors = [];
  const greeting = String(src.greeting || '').trim();
  if (greeting.length < 8 || greeting.length > 600) errors.push('Greeting must be 8 to 600 characters.');
  const businessName = String(src.businessName || src.name || '').trim();
  if (!businessName || businessName.length > 80) errors.push('Business name is required and must be 80 characters or fewer.');
  const hours = String(src.hours || '').trim();
  if (!hours || hours.length > 160) errors.push('Business hours are required (160 characters max).');
  const timezone = normalizeZone(src.timezone);
  if (!timezone) errors.push('Choose a supported time zone.');
  const appointmentMinutes = Number(src.appointmentMinutes);
  if (!Number.isInteger(appointmentMinutes) || appointmentMinutes < 5 || appointmentMinutes > 240) {
    errors.push('Appointment length must be a whole number of minutes from 5 to 240.');
  }
  const bufferMinutes = Number(src.bufferMinutes);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) {
    errors.push('Buffer time must be a whole number of minutes from 0 to 120.');
  }
  const days = Array.isArray(src.bookableDays) ? src.bookableDays.map((d) => String(d).toLowerCase()) : [];
  const bookableDays = DAY_ORDER.filter((d) => days.includes(d));
  if (!bookableDays.length) errors.push('Choose at least one bookable day.');
  const bookableStart = normalizeTime(src.bookableStart);
  const bookableEnd = normalizeTime(src.bookableEnd);
  if (!bookableStart || !bookableEnd) errors.push('Bookable hours must be times like 09:00.');
  else if (bookableStart >= bookableEnd) errors.push('Bookable hours must end after they start.');
  const transferRaw = String(src.transferNumber || src.transfer || '').trim();
  let transferNumber = '';
  if (transferRaw) {
    transferNumber = vapi.toE164(transferRaw);
    if (!transferNumber) errors.push('Transfer number must be a valid US phone number, or left blank.');
  }
  const faqResult = normalizeFaqs(src.faqs);
  if (faqResult.error) errors.push(faqResult.error);
  const notes = String(src.notes || '').trim();
  if (notes.length > 4000) errors.push('Notes must be 4000 characters or fewer.');
  if (errors.length) fail(errors);
  return {
    greeting,
    businessName,
    hours,
    timezone,
    appointmentMinutes,
    bookableDays,
    bookableStart,
    bookableEnd,
    bufferMinutes,
    transferNumber,
    faqs: faqResult.faqs,
    notes
  };
}

function buildManagedSection(settings) {
  const days = settings.bookableDays.map((d) => DAY_LABEL[d] || d).join(', ');
  const faqs = (settings.faqs || []).map((f) => 'Q: ' + f.q + '\nA: ' + f.a).join('\n');
  const transfer = settings.transferNumber
    ? 'Transfer to a person: ' + settings.transferNumber + '. Use this number only when the caller asks for a person, is upset, or the request is outside these instructions.'
    : 'No transfer number is set. If the caller asks for a person, take a message with their name, phone number, and reason. Do not invent a transfer destination.';
  return [
    'The following settings are maintained by the ReceptWise control panel. If they disagree with earlier instructions, follow this section.',
    'Business name: ' + settings.businessName + '.',
    'Business hours: ' + settings.hours + ' (' + settings.timezone + ').',
    'Booking preferences:',
    '- Appointment length: ' + settings.appointmentMinutes + ' minutes',
    '- Bookable days: ' + days,
    '- Bookable hours: ' + settings.bookableStart + '–' + settings.bookableEnd + ' in ' + settings.timezone,
    '- Buffer between appointments: ' + settings.bufferMinutes + ' minutes',
    transfer,
    faqs ? 'FAQ:\n' + faqs : 'FAQ: none on file.',
    settings.notes ? 'Notes for the receptionist:\n' + settings.notes : '',
    'Do not invent prices, policies, or open times. Texting is not available; never promise a text message.'
  ].filter(Boolean).join('\n');
}

function mergeSystemPrompt(existing, section) {
  const block = MARK_START + '\n' + section + '\n' + MARK_END;
  const text = String(existing || '').trim();
  const re = /<!-- receptwise:managed -->[\s\S]*?<!-- \/receptwise:managed -->/;
  if (!text) return block;
  if (re.test(text)) return text.replace(re, block);
  return text + '\n\n' + block;
}

function applyTransfer(model, settings) {
  const tools = (Array.isArray(model.tools) ? model.tools : []).filter((tool) => !tool || tool.type !== 'transferCall');
  if (settings.transferNumber) {
    tools.push({
      type: 'transferCall',
      destinations: [{
        type: 'number',
        number: settings.transferNumber,
        message: "One moment, I'll connect you now.",
        description: 'A person at ' + settings.businessName
      }]
    });
  }
  model.tools = tools;
}

// PATCH body for the live assistant. Keeps the existing model (tools, tool ids, voice stack)
// and rewrites only the managed prompt section plus firstMessage.
function buildAssistantPatch(current, settings, opts = {}) {
  const model = current && current.model ? JSON.parse(JSON.stringify(current.model)) : { messages: [] };
  if (!Array.isArray(model.messages)) model.messages = [];
  const idx = model.messages.findIndex((m) => m && m.role === 'system');
  const prior = idx >= 0 ? model.messages[idx].content : '';
  const content = mergeSystemPrompt(prior, buildManagedSection(settings));
  if (idx >= 0) model.messages[idx] = Object.assign({}, model.messages[idx], { content });
  else model.messages.unshift({ role: 'system', content });
  applyTransfer(model, settings);
  const patch = { firstMessage: settings.greeting, model };
  if (opts.serverUrl) {
    patch.server = { url: opts.serverUrl };
    if (opts.webhookSecret) patch.server.headers = { 'X-Vapi-Secret': opts.webhookSecret };
  }
  return patch;
}

function webhookUrl() {
  return config.appBaseUrl ? config.appBaseUrl + '/webhooks/vapi' : '';
}

async function assistantRow(businessId) {
  const { rows } = await db.query('SELECT * FROM assistants WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

async function phoneRow(businessId) {
  const { rows } = await db.query(
    "SELECT * FROM phone_numbers WHERE business_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1",
    [businessId]
  );
  return rows[0] || null;
}

function testCallHint(e164) {
  const pretty = e164 ? require('./businesses').prettyPhone(e164) : '';
  return {
    e164: e164 || '',
    pretty,
    hint: pretty ? 'Call ' + pretty + ' to hear the receptionist.' : 'No receptionist number is on file yet.'
  };
}

async function getSettings(biz) {
  const businesses = require('./businesses');
  const stored = biz.receptionist && Object.keys(biz.receptionist).length
    ? biz.receptionist
    : businesses.defaultReceptionist(biz);
  const [assistant, phone] = await Promise.all([assistantRow(biz.id), phoneRow(biz.id)]);
  return {
    settings: stored,
    assistantId: assistant ? assistant.vapi_assistant_id : (biz.pilot ? config.pilot.assistantId : null),
    lastPushedAt: assistant ? assistant.published_at : null,
    vapiConfigured: config.vapi.configured,
    testCall: testCallHint(phone ? phone.e164 : '')
  };
}

function stripSecrets(patch) {
  const copy = JSON.parse(JSON.stringify(patch));
  if (copy.server && copy.server.headers) delete copy.server.headers;
  return copy;
}

async function saveLocal(biz, settings) {
  const profile = Object.assign({}, biz.profile || {}, {
    greeting: settings.greeting,
    hours: settings.hours,
    transfer: settings.transferNumber,
    faqs: settings.faqs,
    notes: settings.notes
  });
  await db.query(
    `UPDATE businesses SET name = $2, timezone = $3, receptionist = $4, profile = $5, updated_at = now() WHERE id = $1`,
    [biz.id, settings.businessName, settings.timezone, JSON.stringify(settings), JSON.stringify(profile)]
  );
}

async function rememberAssistant(bizId, assistantId, patch) {
  await db.query(
    `INSERT INTO assistants (business_id, vapi_assistant_id, config, published_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (business_id) DO UPDATE SET vapi_assistant_id = EXCLUDED.vapi_assistant_id,
       config = EXCLUDED.config, published_at = now(), updated_at = now()`,
    [bizId, assistantId, JSON.stringify(stripSecrets(patch))]
  );
}

async function saveAndPush(biz, input, userId) {
  const settings = validateSettings(input);
  await saveLocal(biz, settings);
  const assistant = await assistantRow(biz.id);
  const assistantId = (assistant && assistant.vapi_assistant_id) || (biz.pilot ? config.pilot.assistantId : '');

  if (!config.vapi.configured) {
    await audit.record(userId, biz.id, 'settings.update', { pushed: false, missing: ['VAPI_API_KEY'] });
    return { ok: true, saved: true, pushed: false, missing: ['VAPI_API_KEY'], assistantId: assistantId || null, settings };
  }
  if (!assistantId) {
    await audit.record(userId, biz.id, 'settings.update', { pushed: false, reason: 'no assistant' });
    return {
      ok: true, saved: true, pushed: false, assistantId: null, settings,
      reason: 'No Vapi assistant is linked to this business.'
    };
  }

  let current;
  try {
    current = await vapi.getAssistant(assistantId);
  } catch (err) {
    err.saved = true;
    await audit.record(userId, biz.id, 'settings.update', { pushed: false, error: err.message });
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO assistant_backups (business_id, vapi_assistant_id, config, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [biz.id, assistantId, JSON.stringify(current), userId || null]
  );
  const backupId = Number(rows[0].id);
  const patch = buildAssistantPatch(current, settings, { serverUrl: webhookUrl(), webhookSecret: config.vapi.webhookSecret });
  try {
    await vapi.updateAssistant(assistantId, patch);
  } catch (err) {
    err.saved = true;
    err.backupId = backupId;
    throw err;
  }
  await rememberAssistant(biz.id, assistantId, patch);
  await audit.record(userId, biz.id, 'settings.update', { pushed: true, backupId });
  return { ok: true, saved: true, pushed: true, backupId, assistantId, settings };
}

module.exports = {
  MARK_START, MARK_END, validateSettings, buildManagedSection, mergeSystemPrompt,
  buildAssistantPatch, getSettings, saveAndPush
};
