'use strict';
// Domains card. Cloudflare and Render are mocked. These tests never call the network.
const test = require('node:test');
const assert = require('node:assert');

const config = require('../src/config');
const domains = require('../src/domains');

function json(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers && headers[String(name).toLowerCase()] || null; } },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function cf(result) {
  return json(200, { success: true, result });
}

function saveConfig() {
  return {
    token: config.cloudflare.token,
    accountId: config.cloudflare.accountId,
    zoneId: config.cloudflare.zoneId,
    apiKey: config.render.apiKey,
    serviceId: config.render.serviceId,
    fetch: global.fetch
  };
}

function restore(saved) {
  config.cloudflare.token = saved.token;
  config.cloudflare.accountId = saved.accountId;
  config.cloudflare.zoneId = saved.zoneId;
  config.render.apiKey = saved.apiKey;
  config.render.serviceId = saved.serviceId;
  global.fetch = saved.fetch;
}

function enable() {
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  config.cloudflare.zoneId = 'zone-rw';
  config.render.apiKey = 'rnd-key';
  config.render.serviceId = 'srv-1';
}

function biz(overrides) {
  return Object.assign({
    id: 4,
    slug: 'harbor-cafe',
    profile: { domain: '' }
  }, overrides || {});
}

function site() {
  return { cloudflare_project: 'rw-cafe-site', repo_full_name: 'atulitllc/cafe-site' };
}

test('panel address uses the subdomain when present and rejects reserved labels', () => {
  assert.equal(domains.panelAddress('harbor-cafe'), 'https://harbor-cafe-admin.receptwise.com');
  assert.equal(domains.panelAddress('sphere'), 'https://sphere-admin.receptwise.com');
  assert.equal(domains.panelAddress('panel'), '');
  assert.equal(domains.isPanelHost('sphere-admin'), true);
  assert.equal(domains.panelSlug({ subdomain: 'Sphere', slug: 'sphere-bakery' }), 'sphere');
  assert.deepEqual(domains.RESERVED, ['panel', 'www', 'api']);
  assert.equal(domains.panelAddress('not a host'), '');
});

test('missing env says Not configured and does not call Cloudflare or Render', async () => {
  const saved = saveConfig();
  config.cloudflare.token = 'cf-token';
  config.cloudflare.accountId = 'account-1';
  config.cloudflare.zoneId = '';
  config.render.apiKey = '';
  config.render.serviceId = '';
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return json(200, '<html>Sign in</html>');
  };
  try {
    const result = await domains.collect(biz(), site(), { write: false });
    assert.equal(result.configured, false);
    assert.equal(result.message, 'Not configured');
    assert.equal(result.website.message, 'Not configured');
    assert.equal(result.render.message, 'Not configured');
    assert.equal(result.panel.url, 'https://harbor-cafe-admin.receptwise.com');
    assert.equal(result.panel.health.ok, true);
    assert.equal(result.panel.health.detail, 'OK');
    assert.equal(calls.some((url) => url.includes('api.cloudflare.com') || url.includes('api.render.com')), false);
  } finally {
    restore(saved);
  }
});

test('a Cloudflare 1000 page is reported as an error', async () => {
  const saved = saveConfig();
  config.cloudflare.token = '';
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return json(530, '<html><title>Error 1000 Ray ID</title><span class="cf-error-code">1000</span></html>', { 'cf-error-code': '1000' });
  };
  try {
    const result = await domains.collect(biz({ slug: 'sphere' }), null, { write: true });
    assert.equal(result.configured, false);
    assert.equal(result.panel.health.ok, false);
    assert.match(result.panel.health.detail, /Cloudflare 1000/);
    assert.equal(calls.some((url) => url.includes('api.cloudflare.com') || url.includes('api.render.com')), false);
  } finally {
    restore(saved);
  }
});

test('receptwise.com and reserved panel names are not attached to Pages', async () => {
  const saved = saveConfig();
  enable();
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, body, host: target.hostname });
    if (target.hostname.endsWith('receptwise.com')) return json(200, '<html>ok</html>');
    if (target.hostname === 'api.render.com' && method === 'GET' && target.pathname === '/v1/services/srv-1') {
      return json(200, { serviceDetails: { url: 'https://receptwise-portal.onrender.com' } });
    }
    if (target.hostname === 'api.render.com' && method === 'GET' && target.pathname.endsWith('/custom-domains')) return json(200, []);
    if (target.hostname === 'api.render.com' && method === 'POST' && target.pathname.endsWith('/custom-domains')) {
      assert.equal(body.name, '*.receptwise.com');
      return json(201, { name: body.name });
    }
    if (target.hostname === 'api.cloudflare.com' && method === 'GET' && target.pathname.endsWith('/dns_records')) return cf([]);
    if (target.hostname === 'api.cloudflare.com' && method === 'POST' && target.pathname.endsWith('/dns_records')) {
      assert.equal(body.name, '*.receptwise.com');
      assert.equal(body.proxied, false);
      assert.equal(body.content, 'receptwise-portal.onrender.com');
      return cf({ id: 'wild-1' });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const apex = await domains.collect(biz({ profile: { domain: 'https://receptwise.com' } }), site(), { write: true });
    assert.match(apex.website.message, /never attached to Pages/);
    assert.equal(apex.website.verification, 'blocked');
    const reserved = await domains.collect(biz({
      slug: 'sphere-admin',
      profile: { domain: 'panel.receptwise.com' }
    }), site(), { write: true });
    assert.equal(reserved.panel.reserved, true);
    assert.match(reserved.panel.reservedNote, /reserved/);
    assert.match(reserved.website.message, /never attached to Pages/);
    const pagesPosts = calls.filter((call) => call.method === 'POST' && call.path.includes('/pages/projects') && call.path.endsWith('/domains'));
    assert.equal(pagesPosts.length, 0);
    const dnsPosts = calls.filter((call) => call.method === 'POST' && call.path.endsWith('/dns_records'));
    dnsPosts.forEach((call) => {
      assert.equal(call.body.name, '*.receptwise.com');
      assert.notEqual(call.body.name, 'receptwise.com');
      assert.notEqual(call.body.name, 'panel.receptwise.com');
      assert.notEqual(call.body.name, 'sphere-admin.receptwise.com');
    });
    const renderPosts = calls.filter((call) => call.host === 'api.render.com' && call.method === 'POST');
    renderPosts.forEach((call) => assert.equal(call.body.name, '*.receptwise.com'));
    assert.equal(renderPosts.some((call) => call.body.name === 'receptwise.com'), false);
  } finally {
    restore(saved);
  }
});

test('a customer domain in our account is attached and the CNAME is created', async () => {
  const saved = saveConfig();
  enable();
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, name: target.searchParams.get('name'), body });
    if (target.hostname.endsWith('receptwise.com') && target.hostname !== 'api.cloudflare.com') return json(200, '<html>ok</html>');
    if (target.hostname === 'api.render.com' && method === 'GET' && target.pathname === '/v1/services/srv-1') {
      return json(200, { serviceDetails: { url: 'https://receptwise-portal.onrender.com' } });
    }
    if (target.hostname === 'api.render.com' && target.pathname.endsWith('/custom-domains') && method === 'GET') {
      return json(200, [{ customDomain: { name: '*.receptwise.com' } }]);
    }
    if (method === 'GET' && target.pathname.endsWith('/dns_records') && target.searchParams.get('name') === '*.receptwise.com') {
      return cf([{ id: 'wild-1', type: 'CNAME', name: '*.receptwise.com', content: 'receptwise-portal.onrender.com', proxied: false }]);
    }
    if (method === 'POST' && target.pathname.endsWith('/pages/projects/rw-cafe-site/domains')) {
      assert.equal(body.name, 'www.cafe.example');
      return cf({ name: 'www.cafe.example', status: 'pending' });
    }
    if (method === 'GET' && target.pathname === '/client/v4/zones') {
      if (target.searchParams.get('name') === 'cafe.example') return cf([{ id: 'zone-cafe', name: 'cafe.example' }]);
      return cf([]);
    }
    if (method === 'POST' && target.pathname === '/client/v4/zones/zone-cafe/dns_records') {
      assert.equal(body.type, 'CNAME');
      assert.equal(body.name, 'www.cafe.example');
      assert.equal(body.content, 'rw-cafe-site.pages.dev');
      assert.equal(body.proxied, true);
      return cf({ id: 'rec-cafe' });
    }
    if (method === 'GET' && target.pathname.endsWith('/domains/www.cafe.example')) {
      return cf({
        name: 'www.cafe.example',
        status: 'pending',
        verification_data: { status: 'pending' },
        validation_data: { status: 'pending', method: 'txt', txt_name: '_cf-custom-hostname.www.cafe.example', txt_value: 'token-1' }
      });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const result = await domains.collect(biz({ profile: { domain: 'https://www.cafe.example/order' } }), site(), { write: true });
    assert.equal(result.website.domain, 'www.cafe.example');
    assert.equal(result.website.created, true);
    assert.match(result.website.dns, /was created/);
    assert.equal(result.website.verification, 'pending');
    assert.equal(result.website.ssl, 'pending');
    assert.equal(result.website.records[0].content, 'rw-cafe-site.pages.dev');
    assert.equal(result.website.records[1].type, 'TXT');
    assert.equal(result.website.records[1].content, 'token-1');
    assert.equal(result.render.proxied, false);
    assert.ok(calls.some((call) => call.method === 'POST' && call.path.endsWith('/domains')));
    assert.ok(calls.some((call) => call.method === 'POST' && call.path === '/client/v4/zones/zone-cafe/dns_records'));
  } finally {
    restore(saved);
  }
});

test('a customer domain outside our account lists the records and does not write DNS', async () => {
  const saved = saveConfig();
  enable();
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push(method + ' ' + target.pathname);
    if (target.hostname.endsWith('receptwise.com') && target.hostname !== 'api.cloudflare.com') return json(200, '<html>ok</html>');
    if (target.hostname === 'api.render.com' && method === 'GET' && target.pathname === '/v1/services/srv-1') {
      return json(200, { serviceDetails: { url: 'https://receptwise-portal.onrender.com' } });
    }
    if (target.hostname === 'api.render.com' && target.pathname.endsWith('/custom-domains')) {
      return json(200, [{ name: '*.receptwise.com' }]);
    }
    if (method === 'GET' && target.pathname.endsWith('/dns_records')) {
      return cf([{ id: 'wild-1', type: 'CNAME', name: '*.receptwise.com', content: 'receptwise-portal.onrender.com', proxied: false }]);
    }
    if (method === 'POST' && target.pathname.endsWith('/domains')) return cf({ name: 'cafe.example', status: 'pending' });
    if (method === 'GET' && target.pathname === '/client/v4/zones') return cf([]);
    if (method === 'GET' && target.pathname.endsWith('/domains/cafe.example')) {
      return cf({ name: 'cafe.example', status: 'pending', verification_data: { status: 'active' }, validation_data: { status: 'active' } });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const result = await domains.collect(biz({ profile: { domain: 'cafe.example' } }), null, { write: true });
    assert.equal(result.website.project, '');
    assert.equal(result.website.message, 'Generate the website first.');
    assert.equal(calls.some((line) => line.includes('/pages/')), false);
    const withSite = await domains.collect(biz({ profile: { domain: 'cafe.example' } }), site(), { write: true });
    assert.equal(withSite.website.domain, 'cafe.example');
    assert.equal(withSite.website.created, false);
    assert.equal(withSite.website.dns, 'Add a CNAME for cafe.example pointing to rw-cafe-site.pages.dev.');
    assert.equal(withSite.website.records[0].type, 'CNAME');
    assert.equal(withSite.website.records[0].content, 'rw-cafe-site.pages.dev');
    assert.equal(withSite.website.verification, 'active');
    assert.equal(withSite.website.ssl, 'active');
    assert.equal(calls.some((line) => line.includes('/dns_records') && line.startsWith('POST')), false);
  } finally {
    restore(saved);
  }
});

test('a business without a custom domain is attached at {slug}.receptwise.com, DNS only', async () => {
  const saved = saveConfig();
  enable();
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, name: target.searchParams.get('name'), body });
    if (target.hostname.endsWith('receptwise.com') && target.hostname !== 'api.cloudflare.com') return json(200, '<html>ok</html>');
    if (target.hostname === 'api.render.com' && method === 'GET' && target.pathname === '/v1/services/srv-1') {
      return json(200, { serviceDetails: { url: 'https://receptwise-portal.onrender.com' } });
    }
    if (target.hostname === 'api.render.com' && target.pathname.endsWith('/custom-domains') && method === 'GET') {
      return json(200, [{ name: '*.receptwise.com' }]);
    }
    if (method === 'GET' && target.pathname.endsWith('/dns_records') && target.searchParams.get('name') === '*.receptwise.com') {
      return cf([{ id: 'wild-1', type: 'CNAME', name: '*.receptwise.com', content: 'receptwise-portal.onrender.com', proxied: false }]);
    }
    if (method === 'GET' && target.pathname.endsWith('/dns_records') && target.searchParams.get('name') === 'sphere.receptwise.com') {
      return cf([{ id: 'site-1', type: 'CNAME', name: 'sphere.receptwise.com', content: 'old.pages.dev', proxied: true }]);
    }
    if (method === 'PATCH' && target.pathname.endsWith('/dns_records/site-1')) {
      assert.equal(body.proxied, false);
      assert.equal(body.name, 'sphere.receptwise.com');
      assert.equal(body.content, 'rw-cafe-site.pages.dev');
      return cf({ id: 'site-1', proxied: false });
    }
    if (method === 'POST' && target.pathname.endsWith('/pages/projects/rw-cafe-site/domains')) {
      assert.equal(body.name, 'sphere.receptwise.com');
      return cf({ name: body.name, status: 'active' });
    }
    if (method === 'GET' && target.pathname.endsWith('/domains/sphere.receptwise.com')) {
      return cf({ name: 'sphere.receptwise.com', status: 'active', verification_data: { status: 'active' }, validation_data: { status: 'active' } });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const business = biz({
      slug: 'sphere-bakery',
      subdomain: 'sphere',
      name: 'SPHERE',
      profile: { domain: '', siteHost: 'hosted' }
    });
    const result = await domains.collect(business, site(), { write: true });
    assert.equal(result.website.hostedHostname, 'sphere.receptwise.com');
    assert.equal(result.website.hostedUrl, 'https://sphere.receptwise.com');
    assert.equal(result.website.domain, 'sphere.receptwise.com');
    assert.equal(result.website.siteHost, 'hosted');
    assert.notEqual(result.website.domain, result.panel.url.replace('https://', ''));
    assert.equal(result.panel.url, 'https://sphere-admin.receptwise.com');
    assert.equal(result.website.records[0].proxied, false);
    assert.equal(result.website.records[0].content, 'rw-cafe-site.pages.dev');
    assert.match(result.website.dns, /DNS only/);
    assert.equal(calls.some((call) => call.body && call.body.name === 'receptwise.com'), false);
    assert.equal(calls.some((call) => call.body && call.body.name === 'sphere-admin.receptwise.com'), false);
    assert.ok(calls.some((call) => call.body && call.body.name === 'sphere.receptwise.com' && call.body.proxied === false));
    assert.equal(calls.some((call) => call.body && call.body.proxied === true), false);
    const reserved = await domains.collect(biz({
      slug: 'panel',
      subdomain: 'panel',
      name: 'Panel',
      profile: { domain: '' }
    }), site(), { write: false });
    assert.equal(reserved.website.hostedHostname, '');
    assert.equal(reserved.website.domain, '');
    assert.match(reserved.website.message, /No website domain/);
  } finally {
    restore(saved);
  }
});

test('re-check creates the Render wildcard and turns a proxied record DNS-only', async () => {
  const saved = saveConfig();
  enable();
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, path: target.pathname, body });
    if (target.hostname.endsWith('receptwise.com') && target.hostname !== 'api.cloudflare.com') return json(200, '<html>ok</html>');
    if (method === 'GET' && target.pathname === '/v1/services/srv-1') {
      return json(200, { serviceDetails: { url: 'https://receptwise-portal.onrender.com' } });
    }
    if (method === 'GET' && target.pathname.endsWith('/custom-domains')) return json(200, []);
    if (method === 'POST' && target.pathname.endsWith('/custom-domains')) {
      assert.notEqual(body.name, 'receptwise.com');
      return json(201, { name: body.name });
    }
    if (method === 'GET' && target.pathname.endsWith('/dns_records')) {
      return cf([{ id: 'wild-9', type: 'CNAME', name: '*.receptwise.com', content: 'old.example', proxied: true }]);
    }
    if (method === 'PATCH' && target.pathname.endsWith('/dns_records/wild-9')) {
      assert.equal(body.proxied, false);
      assert.equal(body.content, 'receptwise-portal.onrender.com');
      assert.equal(body.name, '*.receptwise.com');
      return cf({ id: 'wild-9', proxied: false, content: body.content, name: body.name });
    }
    return json(500, { success: false, errors: [{ message: 'unexpected ' + method + ' ' + target.pathname }] });
  };
  try {
    const read = await domains.collect(biz(), null, { write: false });
    assert.match(read.render.message, /proxied/);
    assert.equal(calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
    const result = await domains.collect(biz(), null, { write: true });
    assert.equal(result.render.proxied, false);
    assert.match(result.render.message, /DNS only/);
    assert.ok(calls.some((call) => call.method === 'POST' && call.path.endsWith('/custom-domains') && call.body.name === '*.receptwise.com'));
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.body.proxied === false));
    assert.equal(calls.some((call) => call.body && call.body.name === 'receptwise.com'), false);
    assert.equal(calls.some((call) => call.path.includes('/pages/')), false);
  } finally {
    restore(saved);
  }
});
