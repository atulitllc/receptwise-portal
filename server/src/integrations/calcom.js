'use strict';
// Cal.com API v2. Versions are the ones the current docs require for each path:
// https://cal.com/docs/api-reference/v2/event-types/list-event-types
// https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type
// https://cal.com/docs/api-reference/v2/bookings/create-a-booking
const config = require('../config');
const { UpstreamError } = require('./errors');

const VERSIONS = {
  // https://cal.com/docs/api-reference/v2/event-types/list-event-types — must be 2026-06-12
  eventTypes: '2026-06-12',
  slots: '2024-09-04',
  bookings: '2026-02-25'
};

let fetchImpl = null;

function currentFetch() {
  return fetchImpl || global.fetch;
}

function setFetch(fn) {
  fetchImpl = fn || null;
}

async function readJson(res) {
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text }; }
  return data;
}

async function call(apiKey, method, path, { version, query, body } = {}) {
  const url = new URL(config.calcom.apiBase + path);
  Object.keys(query || {}).forEach((key) => {
    if (query[key] != null && query[key] !== '') url.searchParams.set(key, String(query[key]));
  });
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'cal-api-version': version,
    Accept: 'application/json'
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await currentFetch()(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await readJson(res);
  if (!res.ok) throw new UpstreamError('Cal.com', res.status, data);
  return data;
}

function listFrom(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function listEventTypes(apiKey) {
  const data = await call(apiKey, 'GET', '/v2/event-types', { version: VERSIONS.eventTypes });
  return listFrom(data).map((item) => ({
    id: item && item.id,
    title: item && item.title ? String(item.title) : '',
    slug: item && item.slug ? String(item.slug) : '',
    lengthInMinutes: item && item.lengthInMinutes != null ? Number(item.lengthInMinutes) : null
  })).filter((item) => item.id != null);
}

// start and end are UTC ISO instants. timeZone is the business zone the slots should come back in.
async function getSlots(apiKey, { eventTypeId, start, end, timeZone }) {
  const data = await call(apiKey, 'GET', '/v2/slots', {
    version: VERSIONS.slots,
    query: {
      eventTypeId,
      start,
      end,
      timeZone,
      format: 'range'
    }
  });
  const bucket = data && data.data && !Array.isArray(data.data) ? data.data : {};
  const slots = [];
  Object.keys(bucket).forEach((day) => {
    (bucket[day] || []).forEach((slot) => {
      if (!slot) return;
      if (typeof slot === 'string') slots.push({ start: slot, end: '' });
      else slots.push({ start: slot.start || '', end: slot.end || '' });
    });
  });
  return slots;
}

async function createBooking(apiKey, body) {
  const data = await call(apiKey, 'POST', '/v2/bookings', { version: VERSIONS.bookings, body });
  return (data && data.data) || data || {};
}

function isSlotTaken(err) {
  if (!err || err.code !== 'UPSTREAM') return false;
  const text = String(err.message || '').toLowerCase();
  if (err.upstreamStatus === 409) return true;
  return /already has booking|no_available|slot.{0,24}taken|timeslot.{0,24}taken|not available/.test(text);
}

module.exports = {
  VERSIONS,
  setFetch,
  listEventTypes,
  getSlots,
  createBooking,
  isSlotTaken
};
