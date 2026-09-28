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

function extractBookings(messages) {
  const out = [];
  (messages || []).forEach((m) => {
    const calls = m && (m.toolCalls || m.tool_calls);
    if (!Array.isArray(calls)) return;
    calls.forEach((tc) => {
      const fn = tc.function || {};
      if (!BOOKING_TOOL.test(fn.name || '')) return;
      if (/availability|check/i.test(fn.name || '')) return;
      const args = parseArgs(fn.arguments);
      out.push({
        startsAt: args.startDateTime || args.start_time || args.start || null,
        service: args.summary || args.service || '',
        customer: args.name || args.customerName || (Array.isArray(args.attendees) ? args.attendees.join(', ') : '')
      });
    });
  });
  return out;
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
  const toolBookings = extractBookings(messages);
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
  const bookings = toolBookings.slice();
  if (structuredBooking) {
    bookings.push({
      startsAt: cleanStart(structuredBooking.startsAt),
      customer: structuredBooking.customer,
      service: structuredBooking.service || structuredBooking.business || ''
    });
  }
  if (businessId && bookings.length) {
    for (const b of bookings) {
      await db.query(
        `INSERT INTO bookings (business_id, call_id, starts_at, customer, service, source, status)
         SELECT $1, $2, $3, $4, $5, 'Phone', 'Confirmed'
         WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE call_id = $2 AND starts_at IS NOT DISTINCT FROM $3::timestamptz)`,
        [businessId, row.id, b.startsAt, b.customer, b.service]
      );
    }
  }
  // A completed outbound call from the business's own number counts as the receptionist test.
  if (businessId && outbound && call.status === 'ended' && (duration || 0) >= 5) {
    await businesses.setStep(businessId, 'test', 'connected', 'Test call completed ' + new Date(endedAt || Date.now()).toISOString().slice(0, 10) + '.', {});
  }
  return row;
}

module.exports = { upsertCall, extractBookings, findBusinessId, classifyCall, bookingFromStructured };
