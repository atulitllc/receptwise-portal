'use strict';
// Stores Vapi calls (from webhooks or API sync) and derives bookings from calendar tool calls.
const db = require('./db');
const businesses = require('./businesses');

const BOOKING_TOOL = /(google\.calendar\.event\.create|schedule|book|create_?event|createEvent)/i;
const MISS_REASON = /customer-did-not-answer|did-not-answer|no-answer|customer-busy|busy|failed-to-connect|twilio-failed|call\.start\.error|rejected/i;

function classifyCall({ status, endedReason }) {
  const reason = String(endedReason || '');
  const missed = MISS_REASON.test(reason) || /^(missed|no-answer|busy)$/i.test(String(status || ''));
  const terminal = status === 'ended' || Boolean(endedReason);
  return { missed, answered: terminal && !missed, terminal };
}

function truthyFlag(value) {
  return value === true || value === 'true' || value === 'yes' || value === 1 || value === '1';
}

function bookingFromStructured(analysis) {
  const sd = analysis && analysis.structuredData;
  if (!sd || typeof sd !== 'object') return null;
  if (!truthyFlag(sd.booking_confirmed)) return null;
  return {
    startsAt: sd.booked_start || sd.bookedStart || null,
    customer: sd.name || '',
    service: sd.type || '',
    email: sd.email || '',
    business: sd.business || '',
    phone: sd.phone || ''
  };
}

function cleanStart(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function findBusinessId(call) {
  if (!call) return null;
  const meta = (call.assistant && call.assistant.metadata) || call.metadata || {};
  if (meta.receptwiseBusinessId) return Number(meta.receptwiseBusinessId);
  if (call.phoneNumberId) {
    const { rows } = await db.query('SELECT business_id FROM phone_numbers WHERE vapi_phone_number_id = $1', [call.phoneNumberId]);
    if (rows[0]) return Number(rows[0].business_id);
  }
  if (call.assistantId) {
    const { rows } = await db.query('SELECT business_id FROM assistants WHERE vapi_assistant_id = $1', [call.assistantId]);
    if (rows[0]) return Number(rows[0].business_id);
  }
  return null;
}

function parseArgs(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try { return JSON.parse(a); } catch (e) { return {}; }
}

function ianaZone(value) {
  const text = String(value || '').trim();
  const labels = {
    'Eastern Time': 'America/New_York',
    'Central Time': 'America/Chicago',
    'Mountain Time': 'America/Denver',
    'Pacific Time': 'America/Los_Angeles',
    'Arizona Time': 'America/Phoenix',
    'Alaska Time': 'America/Anchorage',
    'Hawaii Time': 'Pacific/Honolulu'
  };
  if (labels[text]) return labels[text];
  if (/^[A-Za-z]+\/[A-Za-z0-9_+-]+$/.test(text)) return text;
  return '';
}

function hasOffset(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());
}

function zoneParts(timeZone, utcMs) {
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
  dtf.formatToParts(new Date(utcMs)).forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  let year = Number(map.year);
  let month = Number(map.month);
  let day = Number(map.day);
  let hour = Number(map.hour);
  if (hour === 24) {
    hour = 0;
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 1);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return { year, month, day, hour, minute: Number(map.minute), second: Number(map.second) };
}

function zoneOffset(timeZone, utcMs) {
  try {
    const part = zoneParts(timeZone, utcMs);
    return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - utcMs;
  } catch (e) {
    return null;
  }
}

// A clock time with no offset is read in `timeZone`. Values that already include Z or an offset are absolute.
function zonedInstant(value, timeZone) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const zone = ianaZone(timeZone);
  if (hasOffset(raw) || !zone) return cleanStart(raw);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return cleanStart(raw);
  const utcGuess = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
  let offset = zoneOffset(zone, utcGuess);
  if (offset == null) return cleanStart(raw);
  let instant = utcGuess - offset;
  const again = zoneOffset(zone, instant);
  if (again != null) instant = utcGuess - again;
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// book_demo writes "Receptwise demo – {business} – {name} – {phone}". The dashes are en dashes; a spaced hyphen is accepted too.
function splitDemoSummary(summary) {
  const text = String(summary || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const patterns = [
    /^receptwise\s+demo\s*[\u2013\u2014\u2212]\s*(.*?)\s*[\u2013\u2014\u2212]\s*(.*?)\s*[\u2013\u2014\u2212]\s*(.+)$/i,
    /^receptwise\s+demo\s+-\s+(.*?)\s+-\s+(.*?)\s+-\s+(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return {
      business: match[1].trim(),
      customer: match[2].trim(),
      phone: match[3].trim().replace(/[.,;]+$/, '')
    };
  }
  return null;
}

function textField(args, keys) {
  for (const key of keys) {
    if (args[key] != null && String(args[key]).trim()) return String(args[key]).trim();
  }
  return '';
}

function peopleFromAttendees(attendees) {
  const names = [];
  const emails = [];
  (Array.isArray(attendees) ? attendees : []).forEach((item) => {
    if (item && typeof item === 'object') {
      const name = String(item.name || item.displayName || '').trim();
      const email = String(item.email || '').trim();
      if (name && !name.includes('@')) names.push(name);
      if (email.includes('@')) emails.push(email);
      return;
    }
    const text = String(item || '').trim();
    if (!text) return;
    if (text.includes('@')) emails.push(text);
    else names.push(text);
  });
  return { name: names.join(', '), email: emails[0] || '' };
}

function isBookingTool(tc) {
  const fn = (tc && tc.function) || {};
  const name = String(fn.name || (tc && tc.name) || '');
  const type = String((tc && tc.type) || fn.type || '');
  if (/availability/i.test(name) || /availability/i.test(type)) return false;
  if (/^check/i.test(name)) return false;
  return BOOKING_TOOL.test(name) || BOOKING_TOOL.test(type);
}

function bookingFromTool(tc) {
  const fn = (tc && tc.function) || {};
  const args = parseArgs(fn.arguments != null ? fn.arguments : tc.arguments);
  const zone = ianaZone(textField(args, ['timeZone', 'timezone', 'time_zone']));
  const summary = textField(args, ['summary', 'title']);
  const description = textField(args, ['description']);
  const parsed = splitDemoSummary(summary) || splitDemoSummary(description);
  const people = peopleFromAttendees(args.attendees);
  const customer = (parsed && parsed.customer) || textField(args, ['name', 'customerName', 'customer_name', 'attendeeName']) || people.name;
  const phone = (parsed && parsed.phone) || textField(args, ['phone', 'customerPhone', 'customer_phone', 'attendeePhone']);
  let service = '';
  if (parsed && parsed.business) service = parsed.business;
  else if (textField(args, ['service'])) service = textField(args, ['service']);
  else if (summary && !parsed) service = summary;
  return {
    startsAt: zonedInstant(textField(args, ['startDateTime', 'start_time', 'start', 'startTime']), zone),
    endsAt: zonedInstant(textField(args, ['endDateTime', 'end_time', 'end', 'endTime']), zone),
    timeZone: zone,
    customer,
    phone,
    email: textField(args, ['email']) || people.email,
    service
  };
}

function extractBookings(messages) {
  const out = [];
  (messages || []).forEach((m) => {
    const calls = m && (m.toolCalls || m.tool_calls);
    if (!Array.isArray(calls)) return;
    calls.forEach((tc) => {
      if (!tc || !isBookingTool(tc)) return;
      out.push(bookingFromTool(tc));
    });
  });
  return out;
}

function dedupeBookings(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = [item.startsAt || '', item.endsAt || '', item.customer || '', item.phone || '', item.service || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordFromStructured(structured) {
  if (!structured) return null;
  return {
    startsAt: cleanStart(structured.startsAt),
    endsAt: null,
    timeZone: '',
    customer: structured.customer || '',
    phone: structured.phone || '',
    email: structured.email || '',
    service: structured.service || structured.business || ''
  };
}

function combineBookings(toolBookings, structuredBooking) {
  const list = (toolBookings || []).map((item) => Object.assign({}, item));
  const structured = recordFromStructured(structuredBooking);
  if (!structured) return dedupeBookings(list);
  if (!list.length) return [structured];
  const target = list.find((item) => item.startsAt && structured.startsAt && item.startsAt === structured.startsAt) || list[0];
  ['customer', 'phone', 'email', 'service', 'startsAt', 'endsAt', 'timeZone'].forEach((key) => {
    if (!target[key] && structured[key]) target[key] = structured[key];
  });
  return dedupeBookings(list);
}

function sameInstant(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && a === b;
}

async function saveExtractedBookings(businessId, callId, list) {
  if (!businessId || !callId || !list.length) return;
  const { rows: existing } = await db.query(
    `SELECT id, starts_at, portal_edited FROM bookings WHERE call_id = $1 AND source = 'Phone' ORDER BY id`,
    [callId]
  );
  const editable = existing.filter((row) => !row.portal_edited);
  const positional = editable.length > 0 && editable.length === list.length;
  const used = new Set();
  let pos = 0;
  for (const item of list) {
    let row = editable.find((candidate) => !used.has(candidate.id) && sameInstant(candidate.starts_at, item.startsAt));
    if (!row && positional) {
      while (pos < editable.length && used.has(editable[pos].id)) pos += 1;
      row = editable[pos] || null;
      if (row) pos += 1;
    }
    if (row) {
      used.add(row.id);
      await db.query(
        `UPDATE bookings
         SET business_id = $2, starts_at = $3, ends_at = $4, customer = $5, phone = $6, email = $7,
             service = $8, timezone = $9, updated_at = now()
         WHERE id = $1 AND portal_edited = false`,
        [row.id, businessId, item.startsAt || null, item.endsAt || null, item.customer || '',
          item.phone || null, item.email || null, item.service || '', item.timeZone || null]
      );
      continue;
    }
    const humanOwnsOnlyRow = existing.length === 1 && existing[0].portal_edited && list.length === 1;
    if (humanOwnsOnlyRow) continue;
    if (item.startsAt) {
      const linked = await db.query(
        `UPDATE bookings
         SET call_id = coalesce(call_id, $2), updated_at = now()
         WHERE business_id = $1
           AND source <> 'Phone'
           AND starts_at IS NOT DISTINCT FROM $3::timestamptz
           AND lower(coalesce(customer, '')) = lower(coalesce($4, ''))
         RETURNING id`,
        [businessId, callId, item.startsAt, item.customer || '']
      );
      if (linked.rows.length) continue;
    }
    await db.query(
      `INSERT INTO bookings (business_id, call_id, starts_at, ends_at, customer, phone, email, service, timezone, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Phone','Confirmed')`,
      [businessId, callId, item.startsAt || null, item.endsAt || null, item.customer || '',
        item.phone || null, item.email || null, item.service || '', item.timeZone || null]
    );
  }
}

// `call` is a Vapi Call object; `report` is the optional end-of-call-report message (artifact/analysis at top level).
async function upsertCall(call, report) {
  if (!call || !call.id) return null;
  const artifact = (report && report.artifact) || call.artifact || {};
  const analysis = (report && report.analysis) || call.analysis || {};
  const endedReason = (report && report.endedReason) || call.endedReason || null;
  const messages = artifact.messages || call.messages || [];
  const startedAt = call.startedAt || (report && report.startedAt) || null;
  const endedAt = call.endedAt || (report && report.endedAt) || null;
  let duration = report && report.durationSeconds != null ? report.durationSeconds : null;
  if (duration == null && startedAt && endedAt) duration = (new Date(endedAt) - new Date(startedAt)) / 1000;
  const outbound = /outbound/i.test(call.type || '');
  const customer = (call.customer && call.customer.number) || null;
  const own = (call.phoneNumber && call.phoneNumber.number) || null;
  const recording = artifact.recordingUrl || (artifact.recording && (artifact.recording.stereoUrl || artifact.recording.url ||
    (artifact.recording.mono && artifact.recording.mono.combinedUrl))) || call.recordingUrl || null;
  let toolBookings = extractBookings(messages);
  if (!toolBookings.length && artifact.messagesOpenAIFormatted) toolBookings = extractBookings(artifact.messagesOpenAIFormatted);
  const structuredBooking = bookingFromStructured(analysis);
  const sd = (analysis && analysis.structuredData && typeof analysis.structuredData === 'object') ? analysis.structuredData : null;
  const classified = classifyCall({ status: call.status, endedReason });
  let outcome = null;
  if (classified.terminal || report) {
    if (structuredBooking || toolBookings.length) outcome = 'Booked';
    else if (endedReason && /forward|transfer/i.test(endedReason)) outcome = 'Transferred';
    else if (classified.missed) outcome = 'Missed';
    else if (classified.answered) outcome = 'Answered';
  }
  const answered = outcome === 'Missed' ? false : (outcome ? true : null);
  const businessId = await findBusinessId(call);
  const cost = report && report.cost != null ? report.cost : call.cost;

  const { rows } = await db.query(
    `INSERT INTO calls (business_id, vapi_call_id, direction, from_number, to_number, status, started_at, ended_at, duration_sec,
       cost_usd, ended_reason, outcome, summary, transcript, messages, recording_url, raw,
       caller_name, caller_email, caller_business, call_type, booking_confirmed, booked_start, answered, structured, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25, now())
     ON CONFLICT (vapi_call_id) DO UPDATE SET
       business_id = coalesce(EXCLUDED.business_id, calls.business_id),
       status = coalesce(EXCLUDED.status, calls.status),
       started_at = coalesce(EXCLUDED.started_at, calls.started_at),
       ended_at = coalesce(EXCLUDED.ended_at, calls.ended_at),
       duration_sec = coalesce(EXCLUDED.duration_sec, calls.duration_sec),
       cost_usd = coalesce(EXCLUDED.cost_usd, calls.cost_usd),
       ended_reason = coalesce(EXCLUDED.ended_reason, calls.ended_reason),
       outcome = coalesce(EXCLUDED.outcome, calls.outcome),
       summary = coalesce(EXCLUDED.summary, calls.summary),
       transcript = coalesce(EXCLUDED.transcript, calls.transcript),
       messages = CASE WHEN jsonb_array_length(EXCLUDED.messages) > 0 THEN EXCLUDED.messages ELSE calls.messages END,
       recording_url = coalesce(EXCLUDED.recording_url, calls.recording_url),
       raw = coalesce(EXCLUDED.raw, calls.raw),
       caller_name = coalesce(EXCLUDED.caller_name, calls.caller_name),
       caller_email = coalesce(EXCLUDED.caller_email, calls.caller_email),
       caller_business = coalesce(EXCLUDED.caller_business, calls.caller_business),
       call_type = coalesce(EXCLUDED.call_type, calls.call_type),
       booking_confirmed = coalesce(EXCLUDED.booking_confirmed, calls.booking_confirmed),
       booked_start = coalesce(EXCLUDED.booked_start, calls.booked_start),
       answered = coalesce(EXCLUDED.answered, calls.answered),
       structured = coalesce(EXCLUDED.structured, calls.structured),
       updated_at = now()
     RETURNING *`,
    [businessId, call.id, outbound ? 'outbound' : 'inbound', outbound ? own : customer, outbound ? customer : own,
      call.status || null, startedAt, endedAt, duration != null ? Math.round(duration) : null,
      cost != null ? cost : null, endedReason, outcome, analysis.summary || call.summary || null,
      artifact.transcript || call.transcript || null, JSON.stringify(messages), recording, null,
      sd ? (sd.name || null) : null, sd ? (sd.email || null) : null, sd ? (sd.business || null) : null,
      sd ? (sd.type || null) : null, sd ? truthyFlag(sd.booking_confirmed) : null,
      sd ? cleanStart(sd.booked_start || sd.bookedStart) : null, answered, sd ? JSON.stringify(sd) : null]
  );
  const row = rows[0];
  const bookings = combineBookings(toolBookings, structuredBooking);
  if (businessId && bookings.length) await saveExtractedBookings(businessId, row.id, bookings);
  // A completed outbound call from the business's own number counts as the receptionist test.
  if (businessId && outbound && call.status === 'ended' && (duration || 0) >= 5) {
    await businesses.setStep(businessId, 'test', 'connected', 'Test call completed ' + new Date(endedAt || Date.now()).toISOString().slice(0, 10) + '.', {});
  }
  return row;
}

module.exports = { upsertCall, extractBookings, findBusinessId, classifyCall, bookingFromStructured, zonedInstant, splitDemoSummary };
