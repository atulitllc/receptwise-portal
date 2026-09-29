'use strict';
// Turn caller-supplied times into instants and local strings in a business time zone.
const vapi = require('./integrations/vapi');

function parseOffsetMinutes(offset) {
  const match = String(offset || '').match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function zonedWallToUtc(year, month, day, hour, minute, second, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall;
  for (let i = 0; i < 4; i++) {
    const mins = parseOffsetMinutes(vapi.utcOffset(timeZone, new Date(utc)));
    const next = wall - mins * 60000;
    if (next === utc) return new Date(next);
    utc = next;
  }
  return new Date(utc);
}

// Offset and Z are absolute. A bare wall time is read in the business time zone.
function parseWhen(value, timeZone) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/[zZ]$/.test(text) || /[+-]\d{2}:\d{2}$/.test(text) || /[+-]\d{4}$/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return zonedWallToUtc(
      Number(match[1]), Number(match[2]), Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0),
      timeZone || 'UTC'
    );
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function localStamp(date, timeZone) {
  const offset = vapi.utcOffset(timeZone, date);
  const mins = parseOffsetMinutes(offset);
  const wall = new Date(date.getTime() + mins * 60000);
  const iso = wall.toISOString().slice(0, 19) + offset;
  let label = iso;
  try {
    label = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(date);
  } catch (e) { /* keep the ISO stamp */ }
  return { iso, label, timeZone, offset };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function eventTitle(businessName, service, name, phone) {
  const serviceName = clip(service, 80) || 'appointment';
  return clip(businessName, 80) + ' appointment – ' + serviceName + ' – ' + clip(name, 80) + ' – ' + clip(phone, 40);
}

function cleanEmail(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === 'object') return cleanEmail(first.email);
    return cleanEmail(first);
  }
  const email = clip(value, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

module.exports = {
  parseOffsetMinutes,
  parseWhen,
  addMinutes,
  localStamp,
  overlaps,
  clip,
  eventTitle,
  cleanEmail
};
