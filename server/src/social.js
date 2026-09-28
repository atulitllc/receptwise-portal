'use strict';
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const meta = require('./integrations/meta');
const cryptoBox = require('./cryptoBox');
const audit = require('./audit');
const { NotConfiguredError } = require('./integrations/errors');

const PROVIDERS = [
  { id: 'instagram', label: 'Instagram', group: 'meta' },
  { id: 'facebook', label: 'Facebook', group: 'meta' },
  { id: 'google_business', label: 'Google Business Profile', group: 'manual' },
  { id: 'linkedin', label: 'LinkedIn', group: 'soon' },
  { id: 'x', label: 'X', group: 'soon' },
  { id: 'tiktok', label: 'TikTok', group: 'soon' },
  { id: 'youtube', label: 'YouTube', group: 'soon' }
];
const MANUAL = new Set(['instagram', 'facebook', 'google_business']);

function emptyAccount(provider) {
  const metaReady = meta.configured() && Boolean(config.tokenKey) && Boolean(meta.redirectUri());
  if (provider.group === 'soon') {
    return {
      provider: provider.id, label: provider.label, status: 'coming_soon', statusLabel: 'Coming soon',
      accountName: '', handle: '', profileUrl: '', canConnect: false, manual: false
    };
  }
  const needsMeta = provider.group === 'meta' && !meta.configured();
  return {
    provider: provider.id,
    label: provider.label,
    status: 'not_connected',
    statusLabel: needsMeta ? 'Needs Meta app setup' : 'Not connected',
    accountName: '',
    handle: '',
    profileUrl: '',
    canConnect: provider.group === 'meta' && metaReady,
    manual: true
  };
}

function fromRow(provider, row) {
  const connected = row.status === 'connected';
  const metaReady = meta.configured() && Boolean(config.tokenKey) && Boolean(meta.redirectUri());
  return {
    provider: provider.id,
    label: provider.label,
    status: connected ? 'connected' : 'recorded',
    statusLabel: connected ? 'Connected' : 'Recorded by the team',
    accountName: row.account_label || '',
    handle: row.handle || '',
    profileUrl: row.profile_url || '',
    externalId: row.external_id || '',
    updatedAt: row.updated_at,
    canConnect: provider.group === 'meta' && metaReady,
    manual: !connected
  };
}

async function listForBusiness(businessId) {
  const { rows } = await db.query(
    `SELECT provider, account_label, handle, profile_url, status, external_id, updated_at
     FROM integrations WHERE business_id = $1`, [businessId]);
  const by = {};
  rows.forEach((row) => { by[row.provider] = row; });
  return {
    metaApp: meta.configured(),
    encryption: Boolean(config.tokenKey),
    redirectReady: Boolean(meta.redirectUri()),
    accounts: PROVIDERS.map((provider) => by[provider.id] ? fromRow(provider, by[provider.id]) : emptyAccount(provider))
  };
}

async function recordManual(biz, providerId, input, userId) {
  if (!MANUAL.has(providerId)) {
    const err = new Error('That network is not available yet.');
    err.status = 400;
    throw err;
  }
  const handle = String((input && input.handle) || '').trim().slice(0, 80);
  const profileUrl = String((input && (input.profileUrl || input.profile_url)) || '').trim();
  if (!handle && !profileUrl) {
    const err = new Error('Enter a handle or a profile URL.');
    err.status = 400;
    throw err;
  }
  if (profileUrl && (!/^https:\/\/\S+$/i.test(profileUrl) || profileUrl.length > 300)) {
    const err = new Error('Profile URL must be an https link, 300 characters or fewer.');
    err.status = 400;
    throw err;
  }
  const existing = await db.query('SELECT status FROM integrations WHERE business_id = $1 AND provider = $2', [biz.id, providerId]);
  if (existing.rows[0] && existing.rows[0].status === 'connected') {
    const err = new Error('This account is connected with Meta. Disconnect it before recording a handle by hand.');
    err.status = 409;
    throw err;
  }
  await db.query(
    `INSERT INTO integrations (business_id, provider, account_label, handle, profile_url, status, token_enc, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'recorded', NULL, now())
     ON CONFLICT (business_id, provider) DO UPDATE SET
       account_label = EXCLUDED.account_label, handle = EXCLUDED.handle, profile_url = EXCLUDED.profile_url,
       status = 'recorded', token_enc = NULL, updated_at = now()`,
    [biz.id, providerId, handle || profileUrl, handle, profileUrl]
  );
  await audit.record(userId, biz.id, 'integration.recorded', { provider: providerId, handle });
  return listForBusiness(biz.id);
}

async function removeIntegration(biz, providerId, userId) {
  const known = PROVIDERS.some((p) => p.id === providerId && p.group !== 'soon');
  if (!known) {
    const err = new Error('Unknown integration.');
    err.status = 400;
    throw err;
  }
  await db.query('DELETE FROM integrations WHERE business_id = $1 AND provider = $2', [biz.id, providerId]);
  await audit.record(userId, biz.id, 'integration.removed', { provider: providerId });
  return listForBusiness(biz.id);
}

async function beginMeta(biz, userId) {
  const missing = [];
  if (!config.meta.appId) missing.push('META_APP_ID');
  if (!config.meta.appSecret) missing.push('META_APP_SECRET');
  if (missing.length) throw new NotConfiguredError('Meta', missing);
  if (!config.tokenKey) throw new NotConfiguredError('Token encryption', ['TOKEN_ENCRYPTION_KEY']);
  if (!meta.redirectUri()) {
    const err = new Error('Set APP_BASE_URL so the Meta redirect URL can be built.');
    err.status = 409;
    throw err;
  }
  const state = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await db.query(
    'INSERT INTO oauth_states (state, business_id, user_id, provider, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [state, biz.id, userId || null, 'meta', expires]
  );
  return meta.authUrl(state);
}

async function upsertConnected(businessId, provider, fields) {
  await db.query(
    `INSERT INTO integrations (business_id, provider, account_label, handle, profile_url, external_id, token_enc, status, scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', $8, now())
     ON CONFLICT (business_id, provider) DO UPDATE SET
       account_label = EXCLUDED.account_label, handle = EXCLUDED.handle, profile_url = EXCLUDED.profile_url,
       external_id = EXCLUDED.external_id, token_enc = EXCLUDED.token_enc, status = 'connected',
       scopes = EXCLUDED.scopes, updated_at = now()`,
    [businessId, provider, fields.accountLabel, fields.handle || '', fields.profileUrl || '', fields.externalId, fields.tokenEnc, fields.scopes || '']
  );
}

async function finishMeta(code, state) {
  if (!code || !state) {
    const err = new Error('Missing code or state.');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    'DELETE FROM oauth_states WHERE state = $1 AND provider = $2 AND expires_at > now() RETURNING *',
    [state, 'meta']
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('That connection attempt expired. Start it again.');
    err.status = 400;
    throw err;
  }
  const userToken = await meta.exchangeCode(code);
  const pages = await meta.listPages(userToken);
  if (!pages.length) {
    const err = new Error('Meta did not return a Facebook Page for this login.');
    err.status = 409;
    throw err;
  }
  const page = pages.find((p) => p.instagram_business_account && p.instagram_business_account.id) || pages[0];
  if (!page.access_token) {
    const err = new Error('Meta did not return a Page token.');
    err.status = 502;
    throw err;
  }
  const tokenEnc = cryptoBox.encrypt(page.access_token);
  await upsertConnected(row.business_id, 'facebook', {
    accountLabel: page.name || 'Facebook Page',
    handle: page.name || '',
    profileUrl: page.id ? 'https://facebook.com/' + page.id : '',
    externalId: page.id || '',
    tokenEnc,
    scopes: config.meta.scopes
  });
  let instagram = null;
  const ig = page.instagram_business_account;
  if (ig && ig.id) {
    const username = String(ig.username || '').replace(/^@/, '');
    instagram = username ? '@' + username : (ig.name || 'Instagram');
    await upsertConnected(row.business_id, 'instagram', {
      accountLabel: instagram,
      handle: username ? '@' + username : '',
      profileUrl: username ? 'https://instagram.com/' + username : '',
      externalId: ig.id,
      tokenEnc: cryptoBox.encrypt(page.access_token),
      scopes: config.meta.scopes
    });
  }
  await audit.record(row.user_id, row.business_id, 'integration.connected', {
    provider: 'meta',
    facebook: page.name || '',
    instagram
  });
  const biz = await db.query('SELECT slug FROM businesses WHERE id = $1', [row.business_id]);
  return { slug: biz.rows[0] ? biz.rows[0].slug : '', facebook: page.name || '', instagram };
}

module.exports = { PROVIDERS, listForBusiness, recordManual, removeIntegration, beginMeta, finishMeta };
