'use strict';
// Cloudflare Pages client. Fetch is mocked. These tests never call Cloudflare.
const test = require('node:test');
const assert = require('node:assert');

const config = require('../src/config');
const cloudflare = require('../src/website/cloudflare');

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function ok(result) {
  return json(200, { success: true, result });
}

async function readForm(body) {
  const fields = [];
  if (!body || typeof body.entries !== 'function') return fields;
  for (const [key, value] of body.entries()) {
    const text = typeof value === 'string' ? value : await value.text();
    fields.push({ key, text });
  }
  return fields;
}

test('project names follow Cloudflare Pages rules', () => {
  assert.equal(cloudflare.projectName('harbor-and-rye-site'), 'rw-harbor-and-rye-site');
  assert.equal(cloudflare.projectName('Cafe_Site'), 'rw-cafe-site');
  assert.equal(cloudflare.projectName(''), 'rw-site');
  const long = cloudflare.projectName('a'.repeat(80) + '-site');
  assert.ok(long.length <= 58, long);
  assert.match(long, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  assert.equal(cloudflare.pagesDevUrl('rw-harbor-and-rye-site'), 'https://rw-harbor-and-rye-site.pages.dev');
  assert.equal(cloudflare.customDomain({ profile: { website: 'https://not-this.example', domain: 'https://Cafe.Example/menu' } }), 'cafe.example');
  assert.equal(cloudflare.customDomain({ profile: { wizard: { domain: 'www.cafe.example' } } }), 'www.cafe.example');
  assert.equal(cloudflare.customDomain({ profile: { website: 'only-the-website.example' } }), '');
});

test('missing Cloudflare env skips the API', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = '';
  config.cloudflare.accountId = 'account-1';
  let called = 0;
  global.fetch = async () => { called += 1; return ok({}); };
  try {
    const onlyTokenMissing = await cloudflare.deploy({ project: 'harbor-and-rye-site', files: { 'index.html': '<p>Hi</p>' } });
    assert.equal(onlyTokenMissing.status, 'not_configured');
    assert.equal(onlyTokenMissing.message, 'Cloudflare not configured');
    config.cloudflare.token = 'cf-token';
    config.cloudflare.accountId = '';
    const onlyAccountMissing = await cloudflare.deploy({ project: 'harbor-and-rye-site', files: { 'index.html': '<p>Hi</p>' } });
    assert.equal(onlyAccountMissing.status, 'not_configured');
    assert.equal(called, 0);
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('creates a project when missing, then uploads the same files to main', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push({ method, path: target.pathname, search: target.search, body: opts.body, authorization: opts.headers && opts.headers.Authorization, contentType: opts.headers && opts.headers['Content-Type'] });
    if (method === 'GET' && target.pathname === '/client/v4/accounts/account-1/pages/projects/rw-harbor-and-rye-site') {
      return json(404, { success: false, errors: [{ message: 'Project not found' }] });
    }
    if (method === 'POST' && target.pathname === '/client/v4/accounts/account-1/pages/projects') {
      const body = JSON.parse(opts.body);
      assert.equal(body.name, 'rw-harbor-and-rye-site');
      assert.equal(body.production_branch, 'main');
      return ok({ name: body.name, production_branch: 'main' });
    }
    if (method === 'POST' && target.pathname.endsWith('/deployments')) {
      return ok({ url: 'https://abc123.rw-harbor-and-rye-site.pages.dev', environment: 'production' });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const files = { 'index.html': '<p>Harbor</p>', 'styles.css': 'body{}', '.nojekyll': '' };
    const result = await cloudflare.deploy({ project: 'harbor-and-rye-site', files });
    assert.equal(result.status, 'deployed');
    assert.equal(result.project, 'rw-harbor-and-rye-site');
    assert.equal(result.url, 'https://rw-harbor-and-rye-site.pages.dev');
    assert.equal(result.error, '');
    const create = calls.find((call) => call.method === 'POST' && call.path.endsWith('/pages/projects'));
    assert.ok(create);
    assert.equal(create.authorization, 'Bearer cf-token');
    const upload = calls.find((call) => call.path.endsWith('/deployments'));
    assert.ok(upload);
    assert.equal(upload.contentType, undefined);
    const fields = await readForm(upload.body);
    const manifest = JSON.parse(fields.find((field) => field.key === 'manifest').text);
    assert.equal(fields.find((field) => field.key === 'branch').text, 'main');
    assert.equal(manifest['/index.html'], cloudflare.hashFile(Buffer.from('<p>Harbor</p>')));
    assert.equal(manifest['/styles.css'], cloudflare.hashFile(Buffer.from('body{}')));
    assert.equal(manifest['/.nojekyll'], cloudflare.hashFile(Buffer.from('')));
    Object.values(manifest).forEach((hash) => {
      assert.equal(fields.filter((field) => field.key === hash).length, 1);
    });
    const html = fields.find((field) => field.key === manifest['/index.html']);
    assert.equal(html.text, '<p>Harbor</p>');
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('an existing project is reused', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push(method + ' ' + target.pathname);
    if (method === 'GET' && target.pathname.endsWith('/rw-cafe-site')) return ok({ name: 'rw-cafe-site', production_branch: 'main' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) return ok({ id: 'dep-1' });
    return json(500, { success: false, errors: [{ message: 'unexpected' }] });
  };
  try {
    const result = await cloudflare.deploy({ project: 'cafe-site', files: { 'index.html': '<p>Cafe</p>' } });
    assert.equal(result.status, 'deployed');
    assert.equal(calls.some((line) => line === 'POST /client/v4/accounts/account-1/pages/projects'), false);
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('custom domain is attached and a CNAME is created when the zone is in the account', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, name: target.searchParams.get('name'), body });
    if (method === 'GET' && target.pathname.endsWith('/pages/projects/rw-cafe-site')) return ok({ name: 'rw-cafe-site' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) return ok({ id: 'dep-2' });
    if (method === 'POST' && target.pathname.endsWith('/domains')) {
      assert.equal(body.name, 'www.cafe.example');
      return ok({ name: 'www.cafe.example', status: 'pending' });
    }
    if (method === 'GET' && target.pathname === '/client/v4/zones') {
      if (target.searchParams.get('name') === 'www.cafe.example') return ok([]);
      assert.equal(target.searchParams.get('account.id'), 'account-1');
      return ok([{ id: 'zone-9', name: 'cafe.example' }]);
    }
    if (method === 'POST' && target.pathname === '/client/v4/zones/zone-9/dns_records') {
      assert.equal(body.type, 'CNAME');
      assert.equal(body.name, 'www.cafe.example');
      assert.equal(body.content, 'rw-cafe-site.pages.dev');
      assert.equal(body.proxied, true);
      return ok({ id: 'rec-1' });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const result = await cloudflare.deploy({
      project: 'cafe-site',
      files: { 'index.html': '<p>Cafe</p>' },
      domain: 'https://www.cafe.example/order'
    });
    assert.equal(result.status, 'deployed');
    assert.equal(result.domain, 'www.cafe.example');
    assert.equal(result.domainStatus, 'pending');
    assert.match(result.dns, /CNAME www\.cafe\.example → rw-cafe-site\.pages\.dev/);
    assert.ok(calls.some((call) => call.method === 'POST' && call.path.endsWith('/dns_records')));
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('a missing zone still returns the CNAME instruction', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push(method + ' ' + target.pathname);
    if (method === 'GET' && target.pathname.endsWith('/rw-cafe-site')) return ok({ name: 'rw-cafe-site' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) return ok({ id: 'dep-3' });
    if (method === 'POST' && target.pathname.endsWith('/domains')) return ok({ name: 'cafe.example', status: 'pending' });
    if (method === 'GET' && target.pathname === '/client/v4/zones') return ok([]);
    return json(500, { success: false, errors: [{ message: 'unexpected' }] });
  };
  try {
    const result = await cloudflare.deploy({
      project: 'cafe-site',
      files: { 'index.html': '<p>Cafe</p>' },
      domain: 'cafe.example'
    });
    assert.equal(result.status, 'deployed');
    assert.equal(result.dns, 'Add a CNAME for cafe.example pointing to rw-cafe-site.pages.dev.');
    assert.equal(calls.some((line) => line.includes('/dns_records')), false);
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('hosted hostname uses the subdomain, then the slug, then the business name', () => {
  assert.equal(cloudflare.hostedHostname({ subdomain: 'Sphere', slug: 'other', name: 'Other' }), 'sphere.receptwise.com');
  assert.equal(cloudflare.hostedUrl({ subdomain: 'sphere' }), 'https://sphere.receptwise.com');
  assert.notEqual(cloudflare.hostedHostname({ subdomain: 'sphere' }), 'sphere-admin.receptwise.com');
  assert.equal(cloudflare.hostedHostname({ slug: 'harbor-cafe', name: 'Other Name' }), 'harbor-cafe.receptwise.com');
  assert.equal(cloudflare.hostedHostname({ name: 'SPHERE' }), 'sphere.receptwise.com');
  assert.equal(cloudflare.hostedHostname({ name: 'Harbor & Rye' }), 'harbor-and-rye.receptwise.com');
  assert.equal(cloudflare.siteSlug({ subdomain: 'a'.repeat(60) }).length, 57);
  assert.equal(cloudflare.hostedHostname({ subdomain: 'panel', slug: 'cafe', name: 'Panel' }), 'cafe.receptwise.com');
  assert.equal(cloudflare.hostedHostname({ subdomain: 'www', slug: 'www', name: 'Www' }), '');
  assert.equal(cloudflare.hostedHostname({ subdomain: 'api', slug: 'api', name: 'Api' }), '');
  assert.equal(cloudflare.hostedHostname({ subdomain: 'panel', slug: 'panel', name: 'Panel' }), '');
  assert.equal(cloudflare.hostedHostname({ subdomain: 'sphere-admin', slug: 'sphere', name: 'SPHERE' }), 'sphere.receptwise.com');
  assert.equal(cloudflare.pagesBlockedReason('sphere-admin.receptwise.com').length > 0, true);
  assert.equal(cloudflare.pagesBlockedReason('panel.receptwise.com').length > 0, true);
  assert.equal(cloudflare.pagesBlockedReason('www.receptwise.com').length > 0, true);
  assert.equal(cloudflare.pagesBlockedReason('api.receptwise.com').length > 0, true);
  assert.equal(cloudflare.pagesBlockedReason('sphere.receptwise.com'), '');
  assert.equal(cloudflare.publishHostname({ subdomain: 'sphere', profile: { domain: 'www.cafe.example' } }), 'www.cafe.example');
  assert.equal(cloudflare.publishHostname({ subdomain: 'sphere', profile: { siteHost: 'hosted', domain: 'www.cafe.example' } }), 'sphere.receptwise.com');
  assert.equal(cloudflare.publishHostname({ subdomain: 'sphere', profile: {} }), 'sphere.receptwise.com');
  assert.equal(cloudflare.effectiveSiteHost({ profile: { domain: 'cafe.example' } }), 'custom');
  assert.equal(cloudflare.effectiveSiteHost({ subdomain: 'sphere' }), 'hosted');
});

test('a hosted receptwise.com name gets a DNS-only CNAME and the apex stays off Pages', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousZone = config.cloudflare.zoneId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  config.cloudflare.zoneId = 'zone-rw';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, name: target.searchParams.get('name'), body });
    if (method === 'GET' && target.pathname.endsWith('/pages/projects/rw-sphere')) return ok({ name: 'rw-sphere' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) return ok({ id: 'dep-hosted' });
    if (method === 'POST' && target.pathname.endsWith('/domains')) return ok({ name: body.name, status: 'pending' });
    if (method === 'GET' && target.pathname.endsWith('/dns_records')) return ok([]);
    if (method === 'POST' && target.pathname === '/client/v4/zones/zone-rw/dns_records') return ok({ id: 'rec-hosted' });
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const result = await cloudflare.deploy({
      project: 'sphere',
      files: { 'index.html': '<p>Sphere</p>' },
      domain: 'sphere.receptwise.com'
    });
    assert.equal(result.status, 'deployed');
    assert.equal(result.domain, 'sphere.receptwise.com');
    assert.match(result.dns, /DNS only/);
    const dns = calls.find((call) => call.method === 'POST' && call.path.endsWith('/dns_records'));
    assert.equal(dns.body.type, 'CNAME');
    assert.equal(dns.body.name, 'sphere.receptwise.com');
    assert.equal(dns.body.content, 'rw-sphere.pages.dev');
    assert.equal(dns.body.proxied, false);
    assert.equal(calls.some((call) => call.body && call.body.name === 'receptwise.com'), false);
    assert.equal(calls.some((call) => call.body && call.body.name === 'sphere-admin.receptwise.com'), false);
    assert.equal(calls.some((call) => call.body && call.body.proxied === true), false);
    const panelHost = await cloudflare.deploy({ project: 'sphere', files: { 'index.html': '<p>Hi</p>' }, domain: 'sphere-admin.receptwise.com' });
    assert.equal(panelHost.domainStatus, 'blocked');
    const apex = await cloudflare.deploy({ project: 'sphere', files: { 'index.html': '<p>Hi</p>' }, domain: 'receptwise.com' });
    assert.equal(apex.domainStatus, 'blocked');
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/domains')).length, 1);
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    config.cloudflare.zoneId = previousZone;
    global.fetch = previousFetch;
  }
});

test('the apex and other receptwise.com names are never attached to Pages', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, body });
    if (method === 'GET' && target.pathname.endsWith('/rw-cafe-site')) return ok({ name: 'rw-cafe-site' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) return ok({ id: 'dep-apex' });
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const apex = await cloudflare.deploy({ project: 'cafe-site', files: { 'index.html': '<p>Hi</p>' }, domain: 'receptwise.com' });
    assert.equal(apex.status, 'deployed');
    assert.equal(apex.domainStatus, 'blocked');
    assert.match(apex.error, /never attached to Pages/);
    const sub = await cloudflare.deploy({ project: 'cafe-site', files: { 'index.html': '<p>Hi</p>' }, domain: 'www.receptwise.com' });
    assert.equal(sub.domainStatus, 'blocked');
    assert.equal(calls.some((call) => call.path.includes('/domains')), false);
    assert.equal(calls.some((call) => call.path.includes('/dns_records')), false);
    assert.equal(calls.some((call) => call.body && call.body.name === 'receptwise.com'), false);
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('a Cloudflare API error is stored and does not throw', async () => {
  const previousToken = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousFetch = global.fetch;
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    if (method === 'GET' && target.pathname.endsWith('/rw-cafe-site')) return ok({ name: 'rw-cafe-site' });
    if (method === 'POST' && target.pathname.endsWith('/deployments')) {
      return json(403, { success: false, errors: [{ message: 'Authentication error' }] });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected' }] });
  };
  try {
    const result = await cloudflare.deploy({ project: 'cafe-site', files: { 'index.html': '<p>Cafe</p>' } });
    assert.equal(result.status, 'error');
    assert.match(result.error, /Authentication error/);
    assert.equal(result.url, '');
  } finally {
    config.cloudflare.token = previousToken;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});
