'use strict';
// Domains card: customer panel URL, health check, Pages custom domain, and the Render wildcard.
// Inert (message "Not configured") until the Cloudflare token, account, zone, and Render key and service id are all set.
const config = require('./config');
const db = require('./db');
const businesses = require('./businesses');
const audit = require('./audit');
const cloudflare = require('./website/cloudflare');

const ROOT = 'receptwise.com';
const WILDCARD = '*.' + ROOT;
const RESERVED = new Set(['panel', 'www', 'api', 'sphere-admin']);
const HEALTH_MS = 8000;

function hostingConfigured() {
  return config.domainsConfigured();
}

function panelSlug(biz) {
  return String((biz && (biz.subdomain || biz.slug)) || '').trim().toLowerCase();
}

function panelAddress(slug) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug || '')) return '';
  return 'https://' + slug + '.' + ROOT;
}

function projectFor(site) {
  if (site && site.cloudflare_project) return String(site.cloudflare_project);
  const repo = site && site.repo_full_name ? String(site.repo_full_name).split('/')[1] : '';
  return repo ? cloudflare.projectName(repo) : '';
}

function codeFrom(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? match[0] : '';
}

function codeFromBody(text) {
  const html = String(text || '');
  const marked = html.match(/cf-error-code[^0-9]{0,40}(\d{4})/i);
  if (marked) return marked[1];
  const titled = html.match(/Error\s+(\d{4})/i);
  return titled ? titled[1] : '';
}

function describeCloudflare(code, text) {
  const plain = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const around = plain.match(new RegExp('(?:Cloudflare\\s+)?Error\\s+' + code + '[^.]{0,160}', 'i'));
  if (around) {
    const sentence = around[0].trim().replace(/^Error\s+/i, 'Cloudflare ');
    return /cloudflare/i.test(sentence) ? sentence : ('Cloudflare ' + code + ': ' + sentence);
  }
  return 'Cloudflare ' + code;
}

async function checkHealth(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'ReceptWise-panel-check', Accept: 'text/html' }
    });
    const raw = await res.text();
    const text = raw.slice(0, 20000);
    const headerCode = res.headers && typeof res.headers.get === 'function' ? res.headers.get('cf-error-code') : '';
    const code = codeFrom(headerCode) || codeFromBody(text);
    if (code) return { ok: false, detail: describeCloudflare(code, text) };
    if (res.status >= 200 && res.status < 300) return { ok: true, detail: 'OK' };
    return { ok: false, detail: 'HTTP ' + res.status };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /aborted|abort/i.test(err.message || ''));
    if (aborted) return { ok: false, detail: 'Timed out' };
    const cause = err && err.cause;
    const detail = (cause && cause.message) || (err && err.message) || 'Could not reach the panel';
    return { ok: false, detail: String(detail).replace(/^fetch failed:?\s*/i, '') || 'Could not reach the panel' };
  } finally {
    clearTimeout(timer);
  }
}

function emptyWebsite(biz, site, message) {
  return {
    domain: cloudflare.customDomain(biz),
    project: projectFor(site),
    message,
    verification: '',
    ssl: '',
    records: [],
    dns: '',
    created: false
  };
}

function presentDomain(domainObj) {
  if (!domainObj) return { verification: '', ssl: '', error: '' };
  const verification = (domainObj.verification_data && domainObj.verification_data.status) || domainObj.status || '';
  const validation = domainObj.validation_data || {};
  const sslStatus = (domainObj.ssl && domainObj.ssl.status) || '';
  const ssl = sslStatus || (domainObj.status === 'active' ? 'active' : (validation.status || 'pending'));
  const error = (domainObj.verification_data && domainObj.verification_data.error_message) || '';
  return { verification, ssl, error };
}

function recordsFor(hostname, project, domainObj) {
  const records = [{ type: 'CNAME', name: hostname, content: project + '.pages.dev', proxied: true }];
  const validation = domainObj && domainObj.validation_data;
  if (validation && validation.txt_name && validation.txt_value) {
    records.push({ type: 'TXT', name: validation.txt_name, content: validation.txt_value });
  }
  return records;
}

async function websiteSection(biz, site, write) {
  const host = cloudflare.customDomain(biz);
  const project = projectFor(site);
  const blocked = cloudflare.pagesBlockedReason(host);
  const base = emptyWebsite(biz, site, '');
  try {
    if (!host) {
      base.message = 'No website domain is saved.';
      return base;
    }
    if (blocked) {
      base.message = blocked;
      base.verification = 'blocked';
      return base;
    }
    if (!project) {
      base.message = 'Generate the website first.';
      return base;
    }
    if (write) {
      const attached = await cloudflare.attachDomain(project, host);
      base.created = Boolean(attached && !attached.blocked && /was created/i.test(attached.dns || ''));
      base.dns = (attached && attached.dns) || '';
      if (attached && attached.domainStatus === 'error') base.message = attached.domainError || 'Could not attach the custom domain.';
      if (attached && attached.blocked) {
        base.message = attached.domainError || blocked;
        base.verification = 'blocked';
        return base;
      }
    }
    let domainObj = null;
    try {
      domainObj = await cloudflare.readDomain(project, host);
    } catch (err) {
      if (!write) base.message = base.message || 'Not attached yet. Re-check to attach this domain.';
      else if (!base.message) base.message = err.message || 'Could not read domain status.';
    }
    const presented = presentDomain(domainObj);
    if (presented.verification) base.verification = presented.verification;
    base.ssl = presented.ssl;
    if (presented.error && !base.message) base.message = presented.error;
    base.records = recordsFor(host, project, domainObj);
    if (!base.dns) base.dns = cloudflare.dnsInstruction(host, project);
    const validation = domainObj && domainObj.validation_data;
    if (validation && validation.txt_name && validation.txt_value) {
      base.dns += ' Also add TXT ' + validation.txt_name + ' with value ' + validation.txt_value + '.';
    }
    return base;
  } catch (err) {
    base.message = err.message || 'Could not check the website domain.';
    return base;
  }
}

function domainNames(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list.map((item) => {
    if (!item) return '';
    if (typeof item.name === 'string') return item.name.toLowerCase();
    if (item.customDomain && typeof item.customDomain.name === 'string') return item.customDomain.name.toLowerCase();
    return '';
  }).filter(Boolean);
}

function onrenderHost(service) {
  const details = service && service.serviceDetails;
  return cloudflare.hostnameOf((details && details.url) || (service && service.url) || '');
}

async function renderRequest(method, path, json) {
  const headers = {
    Authorization: 'Bearer ' + config.render.apiKey,
    Accept: 'application/json'
  };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch('https://api.render.com/v1' + path, { method, headers, body });
  } catch (err) {
    const error = new Error('Render request failed: ' + ((err && err.message) || 'network error'));
    error.status = 0;
    throw error;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch (e) { data = { message: text.slice(0, 300) }; }
  }
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || ('Render HTTP ' + res.status);
    const error = new Error(String(message).slice(0, 300));
    error.status = res.status;
    throw error;
  }
  return data;
}

async function syncWildcard(target, write) {
  const zoneId = config.cloudflare.zoneId;
  const listed = await cloudflare.cfRequest('GET', '/zones/' + encodeURIComponent(zoneId) + '/dns_records', {
    query: { type: 'CNAME', name: WILDCARD, per_page: '100' }
  });
  const records = Array.isArray(listed) ? listed : [];
  const wildcard = records.find((rec) => rec && String(rec.name || '').toLowerCase() === WILDCARD);
  const ready = 'Wildcard *.receptwise.com points to ' + target + ' (DNS only).';
  if (!wildcard) {
    if (!write) return { proxied: null, message: 'Wildcard CNAME *.receptwise.com is missing. Re-check to create it (DNS only).' };
    await cloudflare.cfRequest('POST', '/zones/' + encodeURIComponent(zoneId) + '/dns_records', {
      json: { type: 'CNAME', name: WILDCARD, content: target, proxied: false, ttl: 1 }
    });
    return { proxied: false, message: ready };
  }
  const proxied = Boolean(wildcard.proxied);
  const content = String(wildcard.content || '').replace(/\.$/, '').toLowerCase();
  if (!proxied && content === target.toLowerCase()) return { proxied: false, message: ready };
  if (!write) {
    return {
      proxied,
      message: proxied
        ? 'Wildcard *.receptwise.com is proxied. Re-check to make it DNS only.'
        : ('Wildcard *.receptwise.com points at ' + wildcard.content + '.')
    };
  }
  await cloudflare.cfRequest('PATCH', '/zones/' + encodeURIComponent(zoneId) + '/dns_records/' + encodeURIComponent(wildcard.id), {
    json: { type: 'CNAME', name: WILDCARD, content: target, proxied: false, ttl: 1 }
  });
  return { proxied: false, message: ready };
}

async function renderSection(write) {
  const out = { message: '', wildcard: WILDCARD, target: '', proxied: null, present: false };
  try {
    const serviceId = encodeURIComponent(config.render.serviceId);
    const service = await renderRequest('GET', '/services/' + serviceId);
    const target = onrenderHost(service);
    if (!target || !target.endsWith('.onrender.com')) {
      out.message = 'Render did not return an onrender.com address.';
      return out;
    }
    out.target = target;
    const listed = await renderRequest('GET', '/services/' + serviceId + '/custom-domains');
    const names = domainNames(listed);
    out.present = names.some((name) => name === WILDCARD);
    if (write && !out.present) {
      await renderRequest('POST', '/services/' + serviceId + '/custom-domains', { name: WILDCARD });
      out.present = true;
    }
    const dns = await syncWildcard(target, write);
    out.proxied = dns.proxied;
    out.message = dns.message;
    return out;
  } catch (err) {
    out.message = err.message || 'Render check failed.';
    return out;
  }
}

async function collect(biz, site, opts) {
  const write = Boolean(opts && opts.write);
  const slug = panelSlug(biz);
  const url = panelAddress(slug);
  const reserved = RESERVED.has(slug);
  const health = url ? await checkHealth(url) : { ok: false, detail: 'No panel address.' };
  const panel = {
    slug,
    url,
    reserved,
    reservedNote: reserved ? (slug + ' is reserved. It is not a customer panel, and no DNS record is created for it.') : '',
    health
  };
  if (!hostingConfigured()) {
    return {
      configured: false,
      message: 'Not configured',
      panel,
      website: emptyWebsite(biz, site, 'Not configured'),
      render: { message: 'Not configured', wildcard: WILDCARD, target: '', proxied: null, present: false }
    };
  }
  const [website, render] = await Promise.all([
    websiteSection(biz, site, write),
    renderSection(write)
  ]);
  return { configured: true, message: '', panel, website, render };
}

async function loadSite(businessId) {
  if (!businessId) return null;
  const { rows } = await db.query('SELECT * FROM business_websites WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

async function status(biz) {
  return collect(biz, await loadSite(biz && biz.id), { write: false });
}

async function recheck(biz, body, user) {
  let current = biz;
  if (body && Object.prototype.hasOwnProperty.call(body, 'domain')) {
    const raw = String(body.domain || '').trim();
    const host = raw ? cloudflare.hostnameOf(raw) : '';
    if (raw && !host) {
      const err = new Error('Enter a domain like www.cafe.example.');
      err.status = 400;
      throw err;
    }
    const saved = await businesses.updateBusiness(biz.slug, { domain: host }, user && user.id);
    if (saved) current = saved;
  }
  const site = await loadSite(current && current.id);
  const result = await collect(current, site, { write: true });
  if (site && current && current.id && hostingConfigured()) {
    const website = result.website || {};
    const errorText = website.verification === 'blocked' || website.verification === 'error' ? (website.message || '') : '';
    try {
      await db.query(
        `UPDATE business_websites
         SET cloudflare_domain = $2, cloudflare_domain_status = $3, cloudflare_dns = $4, cloudflare_error = $5, updated_at = now()
         WHERE business_id = $1`,
        [current.id, website.domain || '', website.verification || '', website.dns || '', errorText]
      );
    } catch (err) { /* the card still returns the live check */ }
  }
  if (user && current) {
    await audit.record(user.id, current.id, 'domains.recheck', {
      domain: result.website && result.website.domain,
      configured: result.configured
    });
    result.business = await businesses.toUi(current, user);
  }
  return result;
}

module.exports = {
  RESERVED: ['panel', 'www', 'api', 'sphere-admin'],
  hostingConfigured,
  panelSlug,
  panelAddress,
  checkHealth,
  collect,
  status,
  recheck
};
