'use strict';
// Stores Vapi calls (from webhooks or API sync) and derives bookings from calendar tool calls.
const db = require('./db');
const businesses = require('./businesses');

const BOOKING_TOOL = /(google\.calendar\.event\.create|schedule|book|create_?event|createEvent)/i;

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
  const bookings = extractBookings(messages);
  let outcome = null;
  if (bookings.length) outcome = 'Booked';
  else if (endedReason && /forward|transfer/i.test(endedReason)) outcome = 'Transferred';
  else if (call.status === 'ended') outcome = 'Answered';
  const businessId = await findBusinessId(call);
  const cost = report && report.cost != null ? report.cost : call.cost;

  const { rows } = await db.query(
    `INSERT INTO calls (business_id, vapi_call_id, direction, from_number, to_number, status, started_at, ended_at, duration_sec,
       cost_usd, ended_reason, outcome, summary, transcript, messages, recording_url, raw, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
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
       updated_at = now()
     RETURNING *`,
    [businessId, call.id, outbound ? 'outbound' : 'inbound', outbound ? own : customer, outbound ? customer : own,
      call.status || null, startedAt, endedAt, duration != null ? Math.round(duration) : null,
      cost != null ? cost : null, endedReason, outcome, analysis.summary || call.summary || null,
      artifact.transcript || call.transcript || null, JSON.stringify(messages), recording, null]
  );
  const row = rows[0];
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

module.exports = { upsertCall, extractBookings, findBusinessId };
