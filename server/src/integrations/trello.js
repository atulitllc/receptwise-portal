'use strict';
// Trello REST API. Key and token travel as query params and are never logged in full.
const config = require('../config');
const { UpstreamError } = require('./errors');

function redact(text) {
  return String(text || '').replace(/([?&](?:key|token)=)[^&\s]+/gi, '$1redacted');
}

function authorizeUrl(apiKey) {
  const url = new URL('https://trello.com/1/authorize');
  url.searchParams.set('expiration', 'never');
  url.searchParams.set('name', 'ReceptWise');
  url.searchParams.set('scope', 'read,write');
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('key', apiKey);
  return url.toString();
}

async function request(creds, method, path, { query, body } = {}) {
  const url = new URL(config.trello.baseUrl + path);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('token', creds.token);
  Object.keys(query || {}).forEach((key) => {
    if (query[key] != null && query[key] !== '') url.searchParams.set(key, String(query[key]));
  });
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: Object.assign({
        Accept: 'application/json',
        'User-Agent': config.userAgent
      }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    const wrapped = new Error('Trello could not be reached.');
    wrapped.status = 502;
    throw wrapped;
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: String(text).slice(0, 180) }; }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Trello rejected the key or token.');
      err.status = 502;
      err.code = 'UPSTREAM';
      throw err;
    }
    const err = new UpstreamError('Trello', res.status, data);
    err.message = redact(err.message);
    throw err;
  }
  return data;
}

function member(creds) {
  return request(creds, 'GET', '/1/members/me', { query: { fields: 'fullName,username' } });
}

function boards(creds) {
  return request(creds, 'GET', '/1/members/me/boards', { query: { filter: 'open', fields: 'name,closed' } });
}

function lists(creds, boardId) {
  return request(creds, 'GET', '/1/boards/' + encodeURIComponent(boardId) + '/lists', {
    query: { filter: 'open', fields: 'name,closed' }
  });
}

function createCard(creds, card) {
  return request(creds, 'POST', '/1/cards', { body: { idList: card.idList, name: card.name, desc: card.desc } });
}

function updateCard(creds, cardId, card) {
  return request(creds, 'PUT', '/1/cards/' + encodeURIComponent(cardId), { body: { name: card.name, desc: card.desc } });
}

module.exports = { redact, authorizeUrl, request, member, boards, lists, createCard, updateCard };
