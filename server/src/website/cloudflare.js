'use strict';
// Cloudflare Pages Direct Upload. Inert until CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are both set.
// A missing token does not throw: callers keep the GitHub publish and store status "not_configured".
const crypto = require('crypto');
const config = require('../config');

const API = 'https://api.cloudflare.com/client/v4';
const NOT_CONFIGURED = 'Cloudflare not configured';
const MAX_NAME = 58;

function configured() {
  const cf = config.cloudflare || {};
  return Boolean(cf.token && cf.accountId);
}

function projectName(repoSlug) {
  const slug = String(repoSlug || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'rw-site';
  let name = 'rw-' + slug;
  if (!/^[a-z0-9]/.test(name)) name = 'rw' + name;
  name = name.slice(0, MAX_NAME).replace(/-+$/g, '');
  return name || 'rw-site';
}

function pagesDevUrl(project) {
  return 'https://' + project + '.pages.dev';
}

function hashFile(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

function hostnameOf(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) return '';
  return raw;
}

function customDomain(biz) {
  const profile = (biz && biz.profile) || {};
  const wizard = profile.wizard || {};
  return hostnameOf(profile.domain || profile.customDomain || wizard.domain || '');
}

// Panel hosts are <slug>.receptwise.com. The public site is <slug>-site.receptwise.com.
// panel, www, and api are reserved the same way as the customer panel.
const SITE_ROOT = 'receptwise.com';
const RESERVED_SITE_SLUGS = new Set(['panel', 'www', 'api']);

function fitSiteSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(raw)) return '';
  if (RESERVED_SITE_SLUGS.has(raw)) return '';
  const cut = raw.slice(0, 58).replace(/-+$/g, '');
  if (!cut || RESERVED_SITE_SLUGS.has(cut)) return '';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(cut)) return '';
  return cut;
}

function slugifySiteName(name) {
  const raw = String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58)
    .replace(/-+$/g, '');
  return fitSiteSlug(raw);
}

// Prefer the business subdomain. If that field is missing or reserved, use the business slug, then the name.
function siteSlug(biz) {
  if (!biz) return '';
  const fromSubdomain = fitSiteSlug(biz.subdomain);
  if (fromSubdomain) return fromSubdomain;
  const fromSlug = fitSiteSlug(biz.slug);
  if (fromSlug) return fromSlug;
  return slugifySiteName(biz.name);
}

function hostedHostname(biz) {
  const slug = siteSlug(biz);
  if (!slug) return '';
  return slug + '-site.' + SITE_ROOT;
}

function hostedUrl(biz) {
  const host = hostedHostname(biz);
  return host ? 'https://' + host : '';
}

function isHostedSiteHostname(hostname) {
  const host = hostnameOf(hostname);
  const match = host.match(/^([a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?)-site\.receptwise\.com$/);
  if (!match || RESERVED_SITE_SLUGS.has(match[1])) return false;
  return (match[1] + '-site').length <= 63;
}

function effectiveSiteHost(biz) {
  const profile = (biz && biz.profile) || {};
  if (profile.siteHost === 'hosted' || profile.siteHost === 'custom') return profile.siteHost;
  return customDomain(biz) ? 'custom' : 'hosted';
}

// Hosted when the admin chose it, or when no customer domain is saved. A saved custom domain wins otherwise.
function publishHostname(biz) {
  const custom = customDomain(biz);
  const hosted = hostedHostname(biz);
  if (effectiveSiteHost(biz) === 'custom' && custom) return custom;
  return hosted;
}

// The apex stays off Pages. A panel host such as sphere.receptwise.com stays off Pages.
// The one exception is the public site hostname {slug}-site.receptwise.com.
function pagesBlockedReason(hostname) {
  const raw = String(hostname || '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  const host = hostnameOf(hostname) || raw;
  if (!host) return '';
  if (host === 'receptwise.com') {
    return 'receptwise.com stays a proxied placeholder that redirects to www and is never attached to Pages.';
  }
  if (isHostedSiteHostname(host)) return '';
  if (host.endsWith('.receptwise.com')) {
    return host + ' stays on the Render panel. Names under receptwise.com are never attached to Pages.';
  }
  return '';
}

function notConfigured() {
  return {
    status: 'not_configured',
    project: '',
    url: '',
    domain: '',
    domainStatus: '',
    dns: '',
    error: '',
    message: NOT_CONFIGURED
  };
}

function cfError(status, data) {
  const messages = [];
  if (data && Array.isArray(data.errors)) {
    data.errors.forEach((item) => {
      if (item && item.message) messages.push(String(item.message));
    });
  }
  const message = messages.join('; ')
    || (data && data.message)
    || (data && typeof data.raw === 'string' ? data.raw : '')
    || ('HTTP ' + status);
  const error = new Error(String(message).slice(0, 500));
  error.status = status;
  error.cloudflare = data;
  return error;
}

async function cf(method, path, { json, form, query } = {}) {
  const accountId = config.cloudflare.accountId;
  let url = API + path.replaceAll('{account_id}', encodeURIComponent(accountId));
  if (query) {
    const params = new URLSearchParams();
    Object.keys(query).forEach((key) => {
      if (query[key] != null && query[key] !== '') params.set(key, String(query[key]));
    });
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = { Authorization: 'Bearer ' + config.cloudflare.token };
  let body;
  if (form) body = form;
  else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (err) {
    const error = new Error('Cloudflare request failed: ' + (err && err.message ? err.message : 'network error'));
    error.status = 0;
    throw error;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch (e) { data = { raw: text.slice(0, 500) }; }
  }
  if (!res.ok || data.success === false) throw cfError(res.status, data);
  return data.result !== undefined ? data.result : data;
}

async function ensureProject(name) {
  try {
    return await cf('GET', '/accounts/{account_id}/pages/projects/' + encodeURIComponent(name));
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  try {
    return await cf('POST', '/accounts/{account_id}/pages/projects', {
      json: { name, production_branch: 'main' }
    });
  } catch (err) {
    if (err.status === 409 || /already exists/i.test(err.message || '')) return { name, production_branch: 'main' };
    throw err;
  }
}

function fileBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value == null ? '' : value), 'utf8');
}

function manifestAndParts(files) {
  const manifest = {};
  const parts = [];
  const seen = new Map();
  Object.keys(files || {}).sort().forEach((rel) => {
    const clean = String(rel).replace(/^\/+/, '');
    if (!clean || clean.split('/').includes('..')) return;
    const buf = fileBuffer(files[rel]);
    let hash = hashFile(buf);
    const prior = seen.get(hash);
    if (prior && !prior.equals(buf)) {
      hash = hashFile(Buffer.concat([Buffer.from(hash), buf]));
    }
    manifest['/' + clean] = hash;
    if (!seen.has(hash)) {
      seen.set(hash, buf);
      parts.push({ hash, buf, filename: clean.split('/').pop() || 'file' });
    }
  });
  return { manifest, parts };
}

async function uploadDeployment(name, files) {
  const { manifest, parts } = manifestAndParts(files);
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  form.append('branch', 'main');
  parts.forEach((part) => {
    form.append(part.hash, new Blob([part.buf]), part.filename);
  });
  return cf('POST', '/accounts/{account_id}/pages/projects/' + encodeURIComponent(name) + '/deployments', { form });
}

function zoneNames(hostname) {
  const labels = hostname.split('.');
  const names = [];
  for (let i = 0; i <= labels.length - 2; i++) names.push(labels.slice(i).join('.'));
  return names;
}

function dnsInstruction(hostname, project) {
  return 'Add a CNAME for ' + hostname + ' pointing to ' + project + '.pages.dev.';
}

async function findZone(hostname) {
  const accountId = config.cloudflare.accountId;
  for (const name of zoneNames(hostname)) {
    let zones;
    try {
      zones = await cf('GET', '/zones', { query: { name, 'account.id': accountId, per_page: '5' } });
    } catch (err) {
      return null;
    }
    const list = Array.isArray(zones) ? zones : [];
    const match = list.find((zone) => zone && zone.id && String(zone.name || '').toLowerCase() === name);
    if (match) return match;
  }
  return null;
}

async function upsertCname(zoneId, hostname, content, proxied) {
  if (!zoneId || !hostname || hostname === 'receptwise.com' || hostname === '*.receptwise.com') return false;
  const listed = await cf('GET', '/zones/' + encodeURIComponent(zoneId) + '/dns_records', {
    query: { type: 'CNAME', name: hostname, per_page: '100' }
  });
  const records = Array.isArray(listed) ? listed : [];
  const existing = records.find((rec) => rec && String(rec.name || '').replace(/\.$/, '').toLowerCase() === hostname);
  const json = { type: 'CNAME', name: hostname, content, proxied: Boolean(proxied), ttl: 1 };
  if (!existing) {
    await cf('POST', '/zones/' + encodeURIComponent(zoneId) + '/dns_records', { json });
    return true;
  }
  const current = String(existing.content || '').replace(/\.$/, '').toLowerCase();
  if (Boolean(existing.proxied) === Boolean(proxied) && current === content.toLowerCase()) return true;
  await cf('PATCH', '/zones/' + encodeURIComponent(zoneId) + '/dns_records/' + encodeURIComponent(existing.id), { json });
  return true;
}

// Customer domains stay proxied. A receptwise.com site hostname is DNS-only so it does not orange-cloud the name.
async function ensureCname(hostname, project) {
  const host = hostnameOf(hostname);
  if (!host || host === 'receptwise.com' || host === '*.receptwise.com') return false;
  const content = project + '.pages.dev';
  if (isHostedSiteHostname(host)) {
    try {
      const zoneId = config.cloudflare && config.cloudflare.zoneId;
      if (zoneId) return await upsertCname(zoneId, host, content, false);
      const zone = await findZone(host);
      if (!zone) return false;
      return await upsertCname(zone.id, host, content, false);
    } catch (err) {
      return false;
    }
  }
  const zone = await findZone(host);
  if (!zone) return false;
  try {
    await cf('POST', '/zones/' + encodeURIComponent(zone.id) + '/dns_records', {
      json: { type: 'CNAME', name: host, content, proxied: true, ttl: 1 }
    });
    return true;
  } catch (err) {
    if (err.status === 409 || /already exists|identical record/i.test(err.message || '')) return true;
    return false;
  }
}

async function readDomain(project, hostname) {
  return cf('GET', '/accounts/{account_id}/pages/projects/' + encodeURIComponent(project) + '/domains/' + encodeURIComponent(hostname));
}

async function attachDomain(project, hostname) {
  const blocked = pagesBlockedReason(hostname);
  if (blocked) {
    return {
      domain: hostnameOf(hostname) || String(hostname || '').trim().toLowerCase(),
      domainStatus: 'blocked',
      dns: '',
      domainError: blocked,
      blocked: true
    };
  }
  let domainStatus = 'pending';
  let domainError = '';
  try {
    const created = await cf('POST', '/accounts/{account_id}/pages/projects/' + encodeURIComponent(project) + '/domains', {
      json: { name: hostname }
    });
    domainStatus = (created && created.status) || 'pending';
  } catch (err) {
    if (err.status === 409 || /already/i.test(err.message || '')) {
      try {
        const existing = await readDomain(project, hostname);
        domainStatus = (existing && existing.status) || 'pending';
      } catch (readErr) {
        domainStatus = 'pending';
      }
    } else {
      domainStatus = 'error';
      domainError = err.message || 'Could not attach the custom domain.';
    }
  }
  let createdRecord = false;
  if (domainStatus !== 'error') createdRecord = await ensureCname(hostname, project);
  const instruction = dnsInstruction(hostname, project);
  const hosted = isHostedSiteHostname(hostname);
  return {
    domain: hostname,
    domainStatus,
    dns: createdRecord
      ? ('CNAME ' + hostname + ' → ' + project + '.pages.dev was created in this Cloudflare account.' + (hosted ? ' DNS only.' : ''))
      : instruction,
    domainError
  };
}

async function deploy({ project, files, domain } = {}) {
  if (!configured()) return notConfigured();
  const name = projectName(project);
  const host = hostnameOf(domain);
  try {
    await ensureProject(name);
    await uploadDeployment(name, files || {});
    const out = {
      status: 'deployed',
      project: name,
      url: pagesDevUrl(name),
      domain: '',
      domainStatus: '',
      dns: '',
      error: '',
      message: ''
    };
    if (host) {
      const attached = await attachDomain(name, host);
      out.domain = attached.domain;
      out.domainStatus = attached.domainStatus;
      out.dns = attached.dns;
      if (attached.domainError) out.error = attached.domainError;
    }
    return out;
  } catch (err) {
    return {
      status: 'error',
      project: name,
      url: '',
      domain: host,
      domainStatus: '',
      dns: host ? dnsInstruction(host, name) : '',
      error: err.message || 'Cloudflare deploy failed.',
      message: err.message || 'Cloudflare deploy failed.'
    };
  }
}

module.exports = {
  configured,
  projectName,
  pagesDevUrl,
  hashFile,
  hostnameOf,
  customDomain,
  siteSlug,
  hostedHostname,
  hostedUrl,
  isHostedSiteHostname,
  effectiveSiteHost,
  publishHostname,
  pagesBlockedReason,
  dnsInstruction,
  findZone,
  readDomain,
  attachDomain,
  cfRequest: cf,
  deploy,
  manifestAndParts,
  NOT_CONFIGURED
};
