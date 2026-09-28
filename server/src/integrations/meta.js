'use strict';
// Facebook Login for Business. Tokens are exchanged here and stored by social.js, encrypted.
const config = require('../config');
const { UpstreamError } = require('./errors');

function redirectUri() {
  if (config.meta.redirectUri) return config.meta.redirectUri;
  if (!config.appBaseUrl) return '';
  return config.appBaseUrl + '/api/integrations/meta/callback';
}

function configured() {
  return config.meta.configured;
}

function authUrl(state) {
  const redirect = redirectUri();
  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: redirect,
    state: state,
    response_type: 'code'
  });
  if (config.meta.loginConfigId) params.set('config_id', config.meta.loginConfigId);
  else params.set('scope', config.meta.scopes);
  return 'https://www.facebook.com/' + config.meta.graphVersion + '/dialog/oauth?' + params.toString();
}

async function graphGet(path, params) {
  const url = 'https://graph.facebook.com/' + config.meta.graphVersion + path + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = text; }
  if (!res.ok) throw new UpstreamError('Meta', res.status, data);
  return data;
}

async function exchangeCode(code) {
  const shortLived = await graphGet('/oauth/access_token', {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: redirectUri(),
    code
  });
  if (!shortLived.access_token) throw new UpstreamError('Meta', 502, 'Token exchange returned no access token.');
  const longLived = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: shortLived.access_token
  });
  return longLived.access_token || shortLived.access_token;
}

async function listPages(userToken) {
  const data = await graphGet('/me/accounts', {
    fields: 'id,name,access_token,instagram_business_account{id,username,name}',
    access_token: userToken
  });
  return data.data || [];
}

module.exports = { redirectUri, configured, authUrl, exchangeCode, listPages };
