'use strict';
// Google Calendar OAuth and Calendar API. Tokens are not stored here.
const config = require('../config');
const { UpstreamError } = require('./errors');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

let fetchImpl = null;

function currentFetch() {
  return fetchImpl || global.fetch;
}

function setFetch(fn) {
  fetchImpl = fn || null;
}

function authUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function readJson(res) {
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text }; }
  if (!res.ok) throw new UpstreamError('Google', res.status, data);
  return data;
}

async function postForm(url, params) {
  const res = await currentFetch()(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.userAgent
    },
    body: new URLSearchParams(params)
  });
  return readJson(res);
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  return postForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  return postForm(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
}

async function getJson(url, accessToken) {
  const res = await currentFetch()(url, {
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'User-Agent': config.userAgent
    }
  });
  return readJson(res);
}

async function postJson(url, accessToken, body) {
  const res = await currentFetch()(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'User-Agent': config.userAgent
    },
    body: JSON.stringify(body)
  });
  return readJson(res);
}

async function listCalendars(accessToken) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = new URL(CALENDAR_API + '/users/me/calendarList');
    url.searchParams.set('minAccessRole', 'writer');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await getJson(url, accessToken);
    (data.items || []).forEach((item) => {
      if (!item || item.deleted || item.hidden) return;
      items.push({
        id: item.id,
        summary: item.summary || item.id,
        primary: Boolean(item.primary),
        accessRole: item.accessRole || ''
      });
    });
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return items;
}

async function freeBusy(accessToken, { calendarId, timeMin, timeMax, timeZone }) {
  return postJson(CALENDAR_API + '/freeBusy', accessToken, {
    timeMin,
    timeMax,
    timeZone,
    items: [{ id: calendarId }]
  });
}

async function createEvent(accessToken, calendarId, event) {
  const url = new URL(CALENDAR_API + '/calendars/' + encodeURIComponent(calendarId) + '/events');
  url.searchParams.set('sendUpdates', 'none');
  return postJson(url, accessToken, event);
}

module.exports = {
  SCOPES,
  AUTH_URL,
  setFetch,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  listCalendars,
  freeBusy,
  createEvent
};
