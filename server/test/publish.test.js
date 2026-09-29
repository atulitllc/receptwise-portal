'use strict';
// Generate and regenerate against Postgres, with GitHub and Cloudflare HTTP mocked.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://rw:rwlocal@127.0.0.1:5432/rw_test';
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.CLOUDFLARE_ACCOUNT_ID = '';

const { describe, test, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const config = require('../src/config');
const businesses = require('../src/businesses');
const github = require('../src/website/github');
const websites = require('../src/website/service');

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function installFetch({ pagesFail, emptyRepo } = {}) {
  const seen = [];
  const calls = [];
  seen.calls = calls;
  const projects = new Set();
  let blobs = 0;
  global.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method || 'GET';
    let body = null;
    if (typeof opts.body === 'string') {
      try { body = JSON.parse(opts.body); } catch (e) { body = null; }
    }
    seen.push(method + ' ' + target.hostname + target.pathname);
    calls.push({ method, path: target.pathname, body });
    if (target.hostname === 'api.github.com') {
      if (method === 'GET' && target.pathname === '/user') return json(200, { login: 'member-bot' });
      if (method === 'GET' && target.pathname.endsWith('/git/ref/heads/main')) return json(200, { object: { sha: 'mainsha' } });
      if (method === 'GET' && target.pathname.endsWith('/git/commits/mainsha')) return json(200, { tree: { sha: 'maintree' } });
      if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(target.pathname)) return json(404, { message: 'Not Found' });
      if (method === 'POST' && target.pathname === '/orgs/atulitllc/repos') {
        const body = JSON.parse(opts.body);
        return json(201, { name: body.name, full_name: 'atulitllc/' + body.name, html_url: 'https://github.com/atulitllc/' + body.name });
      }
      if (method === 'POST' && target.pathname.endsWith('/git/blobs')) {
        blobs += 1;
        if (emptyRepo && blobs === 1) return json(409, { message: 'Git Repository is empty.' });
        return json(201, { sha: 'blob' + blobs });
      }
      if (method === 'PUT' && target.pathname.includes('/contents/')) {
        if (!emptyRepo) return json(500, { message: 'contents API is only for an empty repository' });
        if (body && Object.prototype.hasOwnProperty.call(body, 'sha')) return json(422, { message: 'unexpected sha' });
        return json(201, { commit: { sha: 'seedsha' } });
      }
      if (method === 'POST' && target.pathname.endsWith('/git/trees')) return json(201, { sha: 'tree' });
      if (method === 'POST' && target.pathname.endsWith('/git/commits')) return json(201, { sha: 'commit' });
      if (method === 'POST' && target.pathname.endsWith('/git/refs')) return json(201, { ref: 'refs/heads/main' });
      if (method === 'GET' && target.pathname.endsWith('/git/ref/heads/main')) return json(200, { object: { sha: 'mainsha' } });
      if (method === 'GET' && target.pathname.endsWith('/git/commits/mainsha')) return json(200, { tree: { sha: 'maintree' } });
      if (method === 'POST' && target.pathname.endsWith('/pulls')) {
        return json(201, { html_url: 'https://github.com/atulitllc/example/pull/4', number: 4 });
      }
      if (method === 'POST' && target.pathname.endsWith('/pages')) return json(201, { html_url: 'https://atulitllc.github.io/example/' });
      if (method === 'PATCH') return json(200, {});
      return json(404, { message: 'unexpected github ' + method + ' ' + target.pathname });
    }
    if (target.hostname === 'api.cloudflare.com') {
      const projectMatch = target.pathname.match(/\/pages\/projects\/([^/]+)$/);
      if (method === 'GET' && projectMatch) {
        const name = decodeURIComponent(projectMatch[1]);
        if (!projects.has(name)) return json(404, { success: false, errors: [{ message: 'Project not found' }] });
        return json(200, { success: true, result: { name, production_branch: 'main' } });
      }
      if (method === 'POST' && target.pathname.endsWith('/pages/projects')) {
        const body = JSON.parse(opts.body);
        projects.add(body.name);
        return json(200, { success: true, result: { name: body.name, production_branch: body.production_branch } });
      }
      if (method === 'POST' && target.pathname.endsWith('/deployments')) {
        if (pagesFail) return json(403, { success: false, errors: [{ message: 'Authentication error' }] });
        return json(200, { success: true, result: { id: 'dep', url: 'https://preview.pages.dev' } });
      }
      if (method === 'POST' && target.pathname.endsWith('/domains')) {
        const body = JSON.parse(opts.body);
        return json(200, { success: true, result: { name: body.name, status: 'pending' } });
      }
      if (method === 'GET' && target.pathname === '/client/v4/zones') {
        return json(200, { success: true, result: [{ id: 'zone-1', name: 'dual-example.com' }] });
      }
      if (method === 'GET' && target.pathname.endsWith('/dns_records')) return json(200, { success: true, result: [] });
      if (method === 'POST' && target.pathname.endsWith('/dns_records')) return json(200, { success: true, result: { id: 'rec' } });
      return json(500, { success: false, errors: [{ message: 'unexpected cloudflare ' + method + ' ' + target.pathname }] });
    }
    return json(500, { message: 'unexpected host' });
  };
  return seen;
}

async function makeBiz(name, domain) {
  const row = await businesses.createBusiness({
    name,
    category: 'Restaurant',
    city: 'Seattle, WA',
    domain: domain || '',
    blurb: 'Supper.'
  }, null);
  return businesses.getBySlug(row.slug);
}

describe('dual publish', { concurrency: 1 }, () => {
after(async () => { await db.close(); });

test('generate publishes GitHub and Cloudflare from the same files', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = 'cf-test';
  config.cloudflare.accountId = 'account-1';
  const seen = installFetch();
  const biz = await makeBiz('Dual Publish ' + Date.now(), 'www.dual-example.com');
  try {
    const created = await websites.generate(biz, 'classic', null);
    assert.match(created.pagesUrl, /^https:\/\/atulitllc\.github\.io\/dual-publish-/);
    assert.equal(created.cloudflare.status, 'deployed');
    assert.match(created.cloudflare.url, /^https:\/\/rw-dual-publish-.*\.pages\.dev$/);
    assert.equal(created.cloudflare.domain, 'www.dual-example.com');
    assert.equal(created.cloudflare.domainStatus, 'pending');
    assert.match(created.cloudflare.dns, /rw-dual-publish-/);
    assert.equal(created.business.generatedWebsite.cloudflareStatus, 'deployed');
    assert.equal(created.business.generatedWebsite.repoFullName.startsWith('atulitllc/'), true);
    const again = await websites.regenerate(biz, null, 'classic');
    assert.match(again.prUrl, /\/pull\/4$/);
    assert.equal(again.cloudflare.status, 'deployed');
    assert.ok(seen.some((line) => line.startsWith('POST api.github.com/orgs/atulitllc/repos')));
    assert.ok(seen.filter((line) => line.includes('api.cloudflare.com') && line.endsWith('/deployments')).length >= 2);
    assert.equal(seen.some((line) => line.includes('/user/repos')), false);
    assert.equal(seen.calls.some((call) => call.method === 'PUT'), false);
    const root = seen.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'));
    assert.deepEqual(root.body.parents, []);
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('a business with no custom domain is published at {slug}.receptwise.com', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  const previousZone = config.cloudflare.zoneId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = 'cf-test';
  config.cloudflare.accountId = 'account-1';
  config.cloudflare.zoneId = 'zone-1';
  const seen = installFetch();
  const biz = await makeBiz('Sphere Host ' + Date.now(), '');
  try {
    const created = await websites.generate(biz, 'classic', null);
    const hosted = biz.subdomain + '.receptwise.com';
    assert.equal(created.cloudflare.status, 'deployed');
    assert.equal(created.cloudflare.domain, hosted);
    assert.notEqual(created.cloudflare.domain, biz.subdomain + '-admin.receptwise.com');
    assert.match(created.cloudflare.dns, /DNS only/);
    const attach = seen.calls.find((call) => call.method === 'POST' && call.path.endsWith('/domains'));
    assert.equal(attach.body.name, hosted);
    const dns = seen.calls.find((call) => call.method === 'POST' && call.path.endsWith('/dns_records'));
    assert.equal(dns.body.type, 'CNAME');
    assert.equal(dns.body.name, hosted);
    assert.equal(dns.body.proxied, false);
    assert.match(dns.body.content, /\.pages\.dev$/);
    assert.equal(seen.calls.some((call) => call.body && call.body.name === 'receptwise.com'), false);
    assert.equal(created.business.siteHost, 'hosted');
    assert.equal(created.business.hostedHostname, hosted);
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    config.cloudflare.zoneId = previousZone;
    global.fetch = previousFetch;
  }
});

test('a missing Cloudflare token still publishes GitHub', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = '';
  config.cloudflare.accountId = '';
  const seen = installFetch();
  const biz = await makeBiz('Github Only ' + Date.now(), '');
  try {
    const created = await websites.generate(biz, 'modern', null);
    assert.match(created.pagesUrl, /github\.io/);
    assert.equal(created.cloudflare.status, 'not_configured');
    assert.equal(created.cloudflare.message, 'Cloudflare not configured');
    assert.equal(created.business.generatedWebsite.cloudflareStatus, 'not_configured');
    assert.equal(seen.some((line) => line.includes('api.cloudflare.com')), false);
    assert.ok(seen.some((line) => line.includes('api.github.com') && line.includes('/repos')));
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('a Cloudflare error does not roll back the GitHub repository', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = 'cf-test';
  config.cloudflare.accountId = 'account-1';
  installFetch({ pagesFail: true });
  const biz = await makeBiz('Cf Error ' + Date.now(), 'cf-error.example');
  try {
    const created = await websites.generate(biz, 'classic', null);
    assert.match(created.repoFullName, /^atulitllc\/cf-error-/);
    assert.equal(created.cloudflare.status, 'error');
    assert.match(created.cloudflare.error, /Authentication error/);
    assert.equal(created.business.generatedWebsite.cloudflareStatus, 'error');
    assert.match(created.business.generatedWebsite.cloudflareError, /Authentication error/);
    const kept = await db.query('SELECT repo_full_name FROM business_websites WHERE business_id = $1', [biz.id]);
    assert.equal(kept.rows[0].repo_full_name, created.repoFullName);
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('an empty repository is seeded, then the full site and Cloudflare publish, and regenerate opens a pull request from main', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = 'cf-test';
  config.cloudflare.accountId = 'account-1';
  const seen = installFetch({ emptyRepo: true });
  const biz = await makeBiz('Empty Repo ' + Date.now(), 'www.empty-repo.example');
  try {
    const created = await websites.generate(biz, 'classic', null);
    assert.match(created.repoFullName, /^atulitllc\/empty-repo-/);
    assert.equal(created.cloudflare.status, 'deployed');
    assert.match(created.cloudflare.url, /\.pages\.dev$/);
    const puts = seen.calls.filter((call) => call.method === 'PUT' && call.path.includes('/contents/'));
    assert.equal(puts.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(puts[0].body, 'sha'), false);
    assert.equal(puts[0].body.message, 'Initial commit');
    const siteCommit = seen.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'));
    assert.deepEqual(siteCommit.body.parents, ['mainsha']);
    assert.equal(seen.calls.some((call) => call.method === 'POST' && call.path.endsWith('/git/refs') && call.body.ref === 'refs/heads/main'), false);
    const again = await websites.regenerate(biz, null, 'classic');
    assert.match(again.prUrl, /\/pull\/4$/);
    assert.equal(again.cloudflare.status, 'deployed');
    const updates = seen.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/commits'));
    assert.deepEqual(updates[updates.length - 1].body.parents, ['mainsha']);
    const branch = seen.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/refs'));
    assert.match(branch.body.ref, /^refs\/heads\/site-update-/);
    assert.equal(seen.calls.filter((call) => call.method === 'PUT').length, 1);
    assert.equal(seen.some((line) => line.startsWith('DELETE ')), false);
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});

test('a Cloudflare error on an empty repository still keeps the GitHub repository', async () => {
  await db.migrate();
  const previousFetch = global.fetch;
  const previousToken = config.github.token;
  const previousCf = config.cloudflare.token;
  const previousAccount = config.cloudflare.accountId;
  github.clearOwnerCache();
  config.github.token = 'gh-test';
  config.cloudflare.token = 'cf-test';
  config.cloudflare.accountId = 'account-1';
  const seen = installFetch({ emptyRepo: true, pagesFail: true });
  const biz = await makeBiz('Empty Cf ' + Date.now(), '');
  try {
    const created = await websites.generate(biz, 'modern', null);
    assert.match(created.repoFullName, /^atulitllc\/empty-cf-/);
    assert.equal(created.cloudflare.status, 'error');
    assert.match(created.cloudflare.error, /Authentication error/);
    const kept = await db.query('SELECT repo_full_name FROM business_websites WHERE business_id = $1', [biz.id]);
    assert.equal(kept.rows[0].repo_full_name, created.repoFullName);
    assert.equal(seen.calls.filter((call) => call.method === 'PUT' && call.path.includes('/contents/')).length, 1);
    assert.equal(seen.some((line) => line.startsWith('DELETE ')), false);
  } finally {
    await db.query('DELETE FROM businesses WHERE id = $1', [biz.id]);
    github.clearOwnerCache();
    config.github.token = previousToken;
    config.cloudflare.token = previousCf;
    config.cloudflare.accountId = previousAccount;
    global.fetch = previousFetch;
  }
});
});
