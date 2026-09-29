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

async function ensureCname(hostname, project) {
  const zone = await findZone(hostname);
  if (!zone) return false;
  const content = project + '.pages.dev';
  try {
    await cf('POST', '/zones/' + encodeURIComponent(zone.id) + '/dns_records', {
      json: { type: 'CNAME', name: hostname, content, proxied: true, ttl: 1 }
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
  return {
    domain: hostname,
    domainStatus,
    dns: createdRecord
      ? 'CNAME ' + hostname + ' → ' + project + '.pages.dev was created in this Cloudflare account.'
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
  deploy,
  manifestAndParts,
  NOT_CONFIGURED
};
