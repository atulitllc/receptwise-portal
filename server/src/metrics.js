'use strict';
const db = require('./db');
const businesses = require('./businesses');

function roundAvg(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function fmtWhen(date, tz) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(date));
}

function fmtClock(sec) {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(Number(sec)));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
}

function providerLabel(id) {
  return {
    instagram: 'Instagram', facebook: 'Facebook', google_business: 'Google Business Profile',
    linkedin: 'LinkedIn', x: 'X', tiktok: 'TikTok', youtube: 'YouTube', meta: 'Meta', trello: 'Trello'
  }[id] || id || 'account';
}

function auditText(action, detail) {
  const d = detail || {};
  if (action === 'settings.update') {
    if (d.pushed) return 'Updated the live receptionist and pushed the greeting and instructions.';
    const missing = Array.isArray(d.missing) && d.missing.length ? ' Missing: ' + d.missing.join(', ') + '.' : '';
    return 'Saved receptionist settings. The live assistant was not updated.' + missing;
  }
  if (action === 'integration.recorded') return 'Recorded a ' + providerLabel(d.provider) + ' handle. Not an authorized connection.';
  if (action === 'integration.connected') {
    const parts = ['Connected Meta'];
    if (d.facebook) parts.push('Facebook: ' + d.facebook);
    if (d.instagram) parts.push('Instagram: ' + d.instagram);
    return parts.join(' · ');
  }
  if (action === 'integration.removed') return 'Removed the ' + providerLabel(d.provider) + ' record.';
  if (action === 'call.sync') return 'Synced calls from Vapi (' + (d.synced || 0) + ').';
  if (action === 'data.export') return 'Exported a backup (' + (d.format || 'json') + ').';
  if (action === 'appointment.create') return 'Added an appointment' + (d.customer ? ' for ' + d.customer : '') + '.';
  if (action === 'appointment.update') return 'Updated an appointment' + (d.customer ? ' for ' + d.customer : '') + '.';
  if (action === 'appointment.cancel') return 'Cancelled an appointment' + (d.customer ? ' for ' + d.customer : '') + '.';
  if (action === 'trello.credentials_saved') return 'Saved a Trello key for this business.';
  if (action === 'trello.credentials_removed') return 'Removed the saved Trello key.';
  if (action === 'trello.tested') return 'Tested the Trello connection' + (d.memberName ? ' (' + d.memberName + ')' : '') + '.';
  if (action === 'trello.rules') return 'Set Trello cards to ' + (d.boardName || 'a board') + ' / ' + (d.listName || 'a list') + '.';
  if (action === 'trello.card_created') {
    const kind = d.event === 'booking' ? 'a booking' : 'a missed call';
    return 'Created a Trello card for ' + kind + (d.caller ? ' (' + d.caller + ')' : '') + '.';
  }
  if (action === 'trello.card_updated') return 'Updated the Trello card for a booking' + (d.caller ? ' (' + d.caller + ')' : '') + '.';
  return '';
}

function callToMetric(row) {
  const tz = row.timezone || 'America/New_York';
  const other = row.direction === 'outbound' ? row.to_number : row.from_number;
  const pretty = businesses.prettyPhone(other);
  return {
    id: row.vapi_call_id,
    time: fmtWhen(row.started_at || row.created_at, tz),
    from: pretty || 'Unknown',
    callerName: row.caller_name || '',
    callerBusiness: row.caller_business || '',
    duration: fmtClock(row.duration_sec),
    durationSec: row.duration_sec,
    outcome: row.outcome || '',
    summary: row.summary || '',
    recordingUrl: safeUrl(row.recording_url),
    bookingConfirmed: row.booking_confirmed === true,
    businessId: row.slug,
    businessName: row.business_name
  };
}

async function activityList(businessId) {
  const params = [];
  const callWhere = businessId ? (params.push(businessId), 'WHERE c.business_id = $1') : '';
  const bookWhere = businessId ? 'WHERE k.business_id = $1' : '';
  const auditWhere = businessId ? 'WHERE a.business_id = $1' : '';
  const calls = await db.query(
    `SELECT c.started_at, c.created_at, c.outcome, c.summary, c.caller_name, c.from_number, c.to_number, c.direction,
            b.slug, b.name, b.timezone
     FROM calls c JOIN businesses b ON b.id = c.business_id
     ${callWhere}
     ORDER BY coalesce(c.started_at, c.created_at) DESC LIMIT 20`, params);
  const bookings = await db.query(
    `SELECT k.created_at, k.customer, k.service, k.starts_at, b.slug, b.name, b.timezone
     FROM bookings k JOIN businesses b ON b.id = k.business_id
     ${bookWhere}
     ORDER BY k.created_at DESC LIMIT 20`, params);
  const audits = await db.query(
    `SELECT a.created_at, a.action, a.detail, b.slug, b.name, b.timezone
     FROM audit_log a LEFT JOIN businesses b ON b.id = a.business_id
     ${auditWhere ? auditWhere + ' AND' : 'WHERE'} a.action IN (
       'settings.update', 'integration.recorded', 'integration.connected', 'integration.removed', 'call.sync',
       'trello.credentials_saved', 'trello.credentials_removed', 'trello.tested', 'trello.rules',
       'trello.card_created', 'trello.card_updated', 'data.export',
       'appointment.create', 'appointment.update', 'appointment.cancel')
     ORDER BY a.created_at DESC LIMIT 20`, params);

  const items = [];
  calls.rows.forEach((row) => {
    const who = row.caller_name || businesses.prettyPhone(row.direction === 'outbound' ? row.to_number : row.from_number) || 'unknown caller';
    const text = [row.outcome || 'Call', who, row.summary].filter(Boolean).join(' · ');
    items.push({ at: new Date(row.started_at || row.created_at), kind: 'call', businessId: row.slug, businessName: row.name, text, time: fmtWhen(row.started_at || row.created_at, row.timezone) });
  });
  bookings.rows.forEach((row) => {
    const text = 'Booked ' + (row.customer || 'a caller') + (row.service ? ' · ' + row.service : '');
    items.push({ at: new Date(row.created_at), kind: 'booking', businessId: row.slug, businessName: row.name, text, time: fmtWhen(row.created_at, row.timezone) });
  });
  audits.rows.forEach((row) => {
    const text = auditText(row.action, row.detail);
    if (!text) return;
    items.push({ at: new Date(row.created_at), kind: row.action, businessId: row.slug || '', businessName: row.name || '', text, time: fmtWhen(row.created_at, row.timezone || 'America/New_York') });
  });
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 20).map((item) => ({
    time: item.time, kind: item.kind, businessId: item.businessId, businessName: item.businessName, text: item.text
  }));
}

async function collect(businessId) {
  let tz = 'America/New_York';
  if (businessId) {
    const { rows } = await db.query('SELECT timezone FROM businesses WHERE id = $1', [businessId]);
    if (rows[0] && rows[0].timezone) tz = rows[0].timezone;
  }
  const params = [tz];
  let filter = '';
  if (businessId) {
    params.push(businessId);
    filter = ' AND c.business_id = $2';
  }
  const counts = await db.query(
    `WITH bounds AS (
       SELECT
         (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS today,
         (now() - interval '7 days') AS d7,
         (now() - interval '30 days') AS d30
     )
     SELECT
       count(*) FILTER (WHERE coalesce(c.started_at, c.created_at) >= b.today)::int AS calls_today,
       count(*) FILTER (WHERE coalesce(c.started_at, c.created_at) >= b.d7)::int AS calls_d7,
       count(*) FILTER (WHERE coalesce(c.started_at, c.created_at) >= b.d30)::int AS calls_d30,
       count(*) FILTER (WHERE c.answered IS TRUE AND coalesce(c.started_at, c.created_at) >= b.today)::int AS ans_today,
       count(*) FILTER (WHERE c.answered IS TRUE AND coalesce(c.started_at, c.created_at) >= b.d7)::int AS ans_d7,
       count(*) FILTER (WHERE c.answered IS TRUE AND coalesce(c.started_at, c.created_at) >= b.d30)::int AS ans_d30,
       count(*) FILTER (WHERE c.answered IS FALSE AND coalesce(c.started_at, c.created_at) >= b.today)::int AS miss_today,
       count(*) FILTER (WHERE c.answered IS FALSE AND coalesce(c.started_at, c.created_at) >= b.d7)::int AS miss_d7,
       count(*) FILTER (WHERE c.answered IS FALSE AND coalesce(c.started_at, c.created_at) >= b.d30)::int AS miss_d30,
       avg(c.duration_sec) FILTER (WHERE c.answered IS TRUE AND c.duration_sec IS NOT NULL AND coalesce(c.started_at, c.created_at) >= b.today) AS avg_today,
       avg(c.duration_sec) FILTER (WHERE c.answered IS TRUE AND c.duration_sec IS NOT NULL AND coalesce(c.started_at, c.created_at) >= b.d7) AS avg_d7,
       avg(c.duration_sec) FILTER (WHERE c.answered IS TRUE AND c.duration_sec IS NOT NULL AND coalesce(c.started_at, c.created_at) >= b.d30) AS avg_d30
     FROM calls c CROSS JOIN bounds b
     WHERE c.business_id IS NOT NULL ${filter}`, params);

  const bookParams = [tz];
  let bookFilter = '';
  if (businessId) {
    bookParams.push(businessId);
    bookFilter = ' AND k.business_id = $2';
  }
  const books = await db.query(
    `WITH bounds AS (
       SELECT
         (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS today,
         (now() - interval '7 days') AS d7,
         (now() - interval '30 days') AS d30
     )
     SELECT
       count(*) FILTER (WHERE k.created_at >= b.today)::int AS today,
       count(*) FILTER (WHERE k.created_at >= b.d7)::int AS d7,
       count(*) FILTER (WHERE k.created_at >= b.d30)::int AS d30
     FROM bookings k CROSS JOIN bounds b
     WHERE k.business_id IS NOT NULL ${bookFilter}`, bookParams);

  const recentParams = [];
  const recentWhere = businessId ? (recentParams.push(businessId), 'WHERE c.business_id = $1') : '';
  const recent = await db.query(
    `SELECT c.*, b.slug, b.name AS business_name, b.timezone
     FROM calls c JOIN businesses b ON b.id = c.business_id
     ${recentWhere}
     ORDER BY coalesce(c.started_at, c.created_at) DESC
     LIMIT 12`, recentParams);

  const row = counts.rows[0] || {};
  const bk = books.rows[0] || {};
  return {
    timezone: tz,
    calls: { today: row.calls_today || 0, d7: row.calls_d7 || 0, d30: row.calls_d30 || 0 },
    answered: { today: row.ans_today || 0, d7: row.ans_d7 || 0, d30: row.ans_d30 || 0 },
    missed: { today: row.miss_today || 0, d7: row.miss_d7 || 0, d30: row.miss_d30 || 0 },
    avgDurationSec: { today: roundAvg(row.avg_today), d7: roundAvg(row.avg_d7), d30: roundAvg(row.avg_d30) },
    bookings: { today: bk.today || 0, d7: bk.d7 || 0, d30: bk.d30 || 0 },
    recentCalls: recent.rows.map(callToMetric),
    activity: await activityList(businessId)
  };
}

module.exports = { collect, auditText };
