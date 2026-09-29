'use strict';
// Renderer and GitHub client tests. These never create a real repository.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const github = require('../src/website/github');
const { UpstreamError } = require('../src/integrations/errors');
const {
  TEMPLATE_IDS, TEMPLATE_ROOT, industryStyle, resolveTemplate, repoBaseName,
  buildSite, renderFiles, previewHtml
} = require('../src/website/render');

function sampleBiz(extra) {
  return Object.assign({
    name: 'Harbor & Rye',
    category: 'Restaurant',
    city: 'Seattle, WA',
    profile: {
      blurb: 'Supper and a good glass of wine.',
      hours: 'Tue–Sun 5:00 PM – 10:00 PM',
      address: '12 Pike St, Seattle, WA',
      services: [{ name: 'Dinner', length: '90 min', price: '$45' }, { name: 'Wine', price: 'glass' }],
      bookingUrl: 'https://cal.example/harbor'
    }
  }, extra || {});
}

function filesUnder(dir) {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

test('two real designs cover every business type', () => {
  assert.deepEqual(TEMPLATE_IDS, ['classic', 'modern']);
  const names = ['Restaurant', 'Clinic', 'Dental', 'Home services', 'Auto shop', 'HVAC', 'Retail', 'Salon', 'Studio', 'Professional services'];
  const used = new Set(names.map((name) => industryStyle(name).template));
  assert.deepEqual([...used].sort(), ['classic', 'modern']);
  names.forEach((name) => assert.match(industryStyle(name).accent, /^#[0-9a-f]{6}$/));
  assert.equal(resolveTemplate('', 'Salon'), 'modern');
  assert.equal(resolveTemplate('', 'Dental'), 'classic');
  assert.equal(resolveTemplate('', 'HVAC'), 'modern');
  assert.equal(resolveTemplate('CLASSIC', 'Salon'), 'classic');
  assert.throws(() => resolveTemplate('restaurant', 'Salon'), /classic or modern/);
  assert.equal(industryStyle('').accent, '#0e7c72');
  assert.equal(industryStyle('Cafe').template, 'classic');
  assert.equal(industryStyle('Medical').accent, industryStyle('Clinic').accent);
  assert.equal(industryStyle('Spa').accent, industryStyle('Salon').accent);
});

test('repository slug appends -site and then -2, -3', () => {
  assert.equal(repoBaseName('Harbor & Rye'), 'harbor-and-rye-site');
  assert.equal(repoBaseName(''), 'business-site');
  assert.equal(github.repoCandidate('harbor-and-rye-site', 0), 'harbor-and-rye-site');
  assert.equal(github.repoCandidate('harbor-and-rye-site', 1), 'harbor-and-rye-site-2');
  assert.equal(github.repoCandidate('harbor-and-rye-site', 2), 'harbor-and-rye-site-3');
  assert.equal(github.branchName(new Date('2026-09-29T03:47:00.000Z')), 'site-update-20260929T034700Z');
});

test('rendered page is filled in HTML and omits missing sections', () => {
  const full = buildSite(sampleBiz(), '+12065550199');
  assert.equal(full.accent, '#c2410c');
  assert.equal(full.phoneDisplay, '(206) 555-0199');
  assert.equal(full.phoneHref, 'tel:+12065550199');
  assert.equal(full.bookHref, 'https://cal.example/harbor');
  const classic = previewHtml(full, 'classic');
  const modern = previewHtml(full, 'modern');
  assert.match(classic, /class="tpl-classic /);
  assert.match(modern, /class="tpl-modern /);
  assert.doesNotMatch(classic, /tpl-modern/);
  assert.match(classic, /Harbor &amp; Rye/);
  assert.match(classic, /Supper and a good glass of wine/);
  assert.match(classic, /Dinner/);
  assert.match(classic, /90 min/);
  assert.match(classic, /\$45/);
  assert.match(modern, /90 min/);
  assert.match(modern, /\$45/);
  assert.match(classic, /tel:\+12065550199/);
  assert.match(classic, /href="https:\/\/cal\.example\/harbor" target="_blank"/);
  assert.match(classic, /--accent:#c2410c/);
  assert.match(classic, /id="hours"/);
  assert.match(classic, /Open in Maps/);
  assert.match(classic, /nav-toggle/);
  assert.match(classic, /class="site-header"/);
  assert.match(classic, /class="wave"/);
  assert.match(modern, /hero-dark/);
  assert.match(modern, /nav-toggle/);
  assert.doesNotMatch(classic, /id="reviews"/);
  assert.doesNotMatch(classic, /id="about"/);
  assert.match(classic, /does not take form submissions/);
  assert.doesNotMatch(classic, /\{\{/);
  assert.doesNotMatch(classic, /<script/i);
  assert.doesNotMatch(modern, /\{\{/);
  const sparse = buildSite({ name: 'Northline', category: 'Clinic', city: '', profile: { services: [] } }, '');
  const bare = previewHtml(sparse, 'classic');
  assert.match(bare, /Northline/);
  assert.equal(sparse.servicesPlaceholder, true);
  assert.match(bare, /id="services"/);
  assert.match(bare, /edit this/);
  assert.doesNotMatch(bare, /\$\d/);
  assert.doesNotMatch(bare, /id="hours"/);
  assert.doesNotMatch(bare, /id="visit"/);
  assert.doesNotMatch(bare, /id="contact"/);
  assert.doesNotMatch(bare, /id="about"/);
  assert.doesNotMatch(bare, /id="reviews"/);
  assert.doesNotMatch(bare, /class="lead"/);
  assert.doesNotMatch(bare, /Call /);
  assert.doesNotMatch(bare, /We accept insurance/);
  assert.match(bare, /does not take form submissions/);
  const telOnly = buildSite({
    name: 'Maple Street <Auto>',
    category: 'Auto shop',
    profile: { blurb: '' }
  }, '+17815550100');
  const telHtml = previewHtml(telOnly, 'modern');
  assert.match(telHtml, /Maple Street &lt;Auto&gt;/);
  assert.match(telHtml, /href="tel:\+17815550100"/);
  assert.doesNotMatch(telHtml, /target="_blank" rel="noopener">Ask for a quote/);
  assert.match(telHtml, />Ask for a quote</);
  assert.equal(telOnly.servicesPlaceholder, true);
  assert.equal(telOnly.accent, '#1d4ed8');
});

test('business type changes palette, order, tone, and placeholders', () => {
  const { PRESETS, presetFor } = require('../src/website/types');
  assert.equal(PRESETS.length, 10);
  assert.equal(presetFor('').accent, '#0e7c72');
  assert.equal(presetFor('Yoga').category, 'Studio');

  const dental = buildSite({ name: 'Bright Smile', category: 'Dental', city: 'Austin, TX' }, '');
  assert.equal(dental.accent, '#1d6fbf');
  assert.equal(dental.servicesPlaceholder, true);
  assert.equal(dental.reviews.length, 0);
  assert.ok(dental.services.every((item) => !item.price && item.placeholder));
  assert.match(dental.services.map((item) => item.name).join(' '), /Cleanings/);
  const dentalHtml = previewHtml(dental, 'classic');
  const dentalModern = previewHtml(dental, 'modern');
  assert.match(dentalHtml, /tone-dental/);
  assert.match(dentalHtml, /class="motif"/);
  assert.match(dentalHtml, /--paper:#f7fbff/);
  assert.match(dentalModern, /tone-dental/);
  assert.match(dentalHtml, /Cleanings \(edit this\)/);
  const dentalBooked = previewHtml(buildSite({
    name: 'Bright Smile',
    category: 'Dental',
    profile: { bookingUrl: 'https://book.example/smile' }
  }, ''), 'classic');
  assert.match(dentalBooked, /Book a visit/);
  assert.doesNotMatch(dentalHtml, /\$\d/);
  assert.doesNotMatch(dentalHtml, /id="reviews"/);
  assert.doesNotMatch(dentalHtml, /licensed/i);

  const hvac = buildSite({ name: 'North Air', category: 'HVAC', city: 'Denver, CO' }, '+13035550100');
  const hvacHtml = previewHtml(hvac, 'modern');
  const hvacClassic = previewHtml(hvac, 'classic');
  assert.match(hvacHtml, /btn-emergency/);
  assert.match(hvacHtml, /Emergency call/);
  assert.match(hvacClassic, /btn-emergency/);
  assert.ok(hvacHtml.indexOf('id="contact"') < hvacHtml.indexOf('id="services"'));
  assert.match(hvacHtml, /24\/7 repair \(edit this\)/);
  assert.doesNotMatch(hvacHtml, /\$\d/);
  assert.equal(hvac.reviews.length, 0);

  const home = previewHtml(buildSite({ name: 'Pine', category: 'Home services' }, '+15555550100'), 'modern');
  assert.doesNotMatch(home, /Licensed and insured/);
  assert.match(home, /edit this/);
  assert.match(home, /Ask about an estimate/);

  const salon = buildSite({
    name: 'Lumen',
    category: 'Salon',
    profile: { services: [{ name: 'Cut', price: '$68' }], bookingUrl: 'https://book.example/lumen' }
  }, '');
  assert.equal(salon.servicesPlaceholder, false);
  assert.equal(salon.services[0].name, 'Cut');
  const salonHtml = previewHtml(salon, 'modern');
  assert.match(salonHtml, /btn-emphasis/);
  assert.match(salonHtml, />Book now</);
  assert.match(salonHtml, /\$68/);
  assert.ok(salonHtml.indexOf('id="services"') < salonHtml.indexOf('id="contact"'));

  const restaurant = buildSite(sampleBiz(), '+12065550199');
  assert.equal(restaurant.servicesPlaceholder, false);
  const restaurantHtml = previewHtml(restaurant, 'classic');
  assert.match(restaurantHtml, /Menu highlights/);
  assert.match(restaurantHtml, /Reserve or order/);
  assert.ok(restaurantHtml.indexOf('id="services"') < restaurantHtml.indexOf('id="hours"'));
  assert.ok(restaurantHtml.indexOf('id="hours"') < restaurantHtml.indexOf('id="visit"'));
  assert.match(restaurantHtml, /tone-restaurant/);

  const unknown = buildSite({ name: 'Oak', category: '' }, '');
  assert.equal(unknown.accent, '#0e7c72');
  assert.match(previewHtml(unknown, 'classic'), /tone-neutral/);
  assert.match(previewHtml(unknown, 'modern'), /tone-neutral/);
});

test('about and reviews render only from business data', () => {
  const rich = buildSite({
    name: 'Harbor & Rye',
    category: 'Restaurant',
    city: 'Seattle, WA',
    profile: {
      blurb: 'Supper and a good glass of wine.',
      headline: 'A short menu and a long evening',
      about: 'Twelve tables, one window, and a kitchen that closes when the food runs out.',
      hours: 'Tue–Fri 5:00 PM – 10:00 PM\nSat–Sun 4:00 PM – 10:00 PM',
      address: '12 Pike St, Seattle, WA',
      services: [{ name: 'Dinner', length: '90 min', price: '$45', detail: 'A set menu.' }],
      reviews: [
        { author: 'Dana Whitfield', stars: 5, when: 'Sep 26', text: 'Easy to get a table and the staff was kind.' },
        { text: '' }
      ],
      bookingUrl: 'https://cal.example/harbor'
    }
  }, '+12065550199');
  assert.equal(rich.reviews.length, 1);
  assert.equal(rich.hourLines.length, 2);
  const html = previewHtml(rich, 'classic');
  assert.match(html, /A short menu and a long/);
  assert.match(html, />evening</);
  assert.match(html, /Twelve tables, one window/);
  assert.match(html, /id="about"/);
  assert.match(html, /id="reviews"/);
  assert.match(html, /Easy to get a table and the staff was kind\./);
  assert.match(html, /Dana Whitfield/);
  assert.match(html, /5 out of 5 stars/);
  assert.match(html, /A set menu\./);
  assert.match(html, /Tue–Fri 5:00 PM – 10:00 PM/);
  assert.equal((html.match(/id="reviews"/g) || []).length, 1);
  const modern = previewHtml(rich, 'modern');
  assert.match(modern, /id="reviews"/);
  assert.match(modern, /Dana Whitfield/);
  assert.doesNotMatch(modern, /class="wave"/);
  const saved = JSON.parse(renderFiles(rich, 'modern', { pagesUrl: 'https://example.github.io/harbor-site/' })['site.json']);
  assert.equal(saved.headline, 'A short menu and a long evening');
  assert.equal(saved.reviews[0].author, 'Dana Whitfield');
  assert.equal(saved.about.includes('Twelve tables'), true);
});

test('generated files keep site.json and do not call the network', () => {
  const previous = global.fetch;
  global.fetch = () => { throw new Error('renderer must not use the network'); };
  try {
    const site = buildSite(sampleBiz(), '+12065550199');
    const files = renderFiles(site, 'classic', { pagesUrl: 'https://atulitllc.github.io/harbor-and-rye-site/' });
    assert.ok(files['index.html'].includes('Harbor &amp; Rye'));
    assert.ok(files['index.html'].includes('href="styles.css"'));
    assert.ok(files['index.html'].indexOf('<main') < files['index.html'].indexOf('<script'));
    const saved = JSON.parse(files['site.json']);
    assert.equal(saved.name, 'Harbor & Rye');
    assert.equal(saved.template, 'classic');
    assert.equal(saved.services[0].name, 'Dinner');
    assert.match(files['README.md'], /Settings → Pages/);
    assert.match(files['README.md'], /https:\/\/atulitllc\.github\.io\/harbor-and-rye-site\//);
    assert.equal(files['.nojekyll'], '');
    const banned = /\[Placeholder\]|\bReceptWise\b|\bAtulit\b/i;
    Object.keys(files).forEach((name) => assert.doesNotMatch(files[name], banned, name));
    assert.doesNotMatch(previewHtml(site, 'modern'), banned);
  } finally {
    global.fetch = previous;
  }
});

test('bundled templates do not name the platform or leave a placeholder', () => {
  const banned = /\[Placeholder\]|\bReceptWise\b|\bAtulit\b/i;
  const paths = filesUnder(TEMPLATE_ROOT);
  assert.ok(paths.some((file) => file.endsWith(path.join('classic', 'index.html'))));
  assert.ok(paths.some((file) => file.endsWith(path.join('modern', 'styles.css'))));
  paths.forEach((file) => assert.doesNotMatch(fs.readFileSync(file, 'utf8'), banned, file));
});

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : JSON.stringify(body)) };
}

test('github client is inert without GITHUB_TOKEN and does not call fetch', async () => {
  const previousToken = config.github.token;
  const previousFetch = global.fetch;
  github.clearOwnerCache();
  config.github.token = '';
  let called = false;
  global.fetch = () => { called = true; throw new Error('should not fetch'); };
  try {
    await assert.rejects(() => github.createRepo('atulitllc', 'example-site', 'Website'), (err) => {
      return err.code === 'NOT_CONFIGURED' && err.status === 409 && err.missing.includes('GITHUB_TOKEN');
    });
    assert.equal(called, false);
  } finally {
    github.clearOwnerCache();
    config.github.token = previousToken;
    global.fetch = previousFetch;
  }
});

test('GITHUB_OWNER is the repo owner when it is set', () => {
  const previousOwner = config.github.owner;
  const previousOrg = config.github.org;
  config.github.owner = 'atulitllc';
  config.github.org = 'some-org';
  try {
    assert.equal(github.ownerLogin(), 'atulitllc');
    assert.equal(github.orgName(), 'atulitllc');
  } finally {
    config.github.owner = previousOwner;
    config.github.org = previousOrg;
  }
});

test('creates the repository on the user or in the organization', async () => {
  const previousToken = config.github.token;
  const previousFetch = global.fetch;
  config.github.token = 'test-token';
  const seen = [];
  function install(login) {
    github.clearOwnerCache();
    seen.length = 0;
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      seen.push(method + ' ' + new URL(target).pathname);
      if (method === 'GET' && new URL(target).pathname === '/user') return json(200, { login });
      if (method === 'GET' && new URL(target).pathname.startsWith('/repos/')) return json(404, { message: 'Not Found' });
      if (method === 'POST' && (new URL(target).pathname === '/user/repos' || new URL(target).pathname === '/orgs/atulitllc/repos')) {
        assert.equal(body.auto_init, false);
        assert.equal(body.private, false);
        assert.equal(body.name, 'cafe-site');
        return json(201, { full_name: 'atulitllc/cafe-site', html_url: 'https://github.com/atulitllc/cafe-site' });
      }
      return json(500, { message: 'unexpected ' + method + ' ' + target });
    };
  }
  try {
    install('AtulitLLC');
    const asUser = await github.createUniqueRepo('atulitllc', 'cafe-site', 'Website for Cafe');
    assert.equal(asUser.repo.full_name, 'atulitllc/cafe-site');
    assert.ok(seen.includes('GET /user'));
    assert.ok(seen.includes('POST /user/repos'));
    assert.equal(seen.some((line) => line.includes('/orgs/')), false);
    install('member-bot');
    const asOrg = await github.createUniqueRepo('atulitllc', 'cafe-site', 'Website for Cafe');
    assert.equal(asOrg.name, 'cafe-site');
    assert.ok(seen.includes('POST /orgs/atulitllc/repos'));
    assert.equal(seen.some((line) => line === 'POST /user/repos'), false);
  } finally {
    github.clearOwnerCache();
    config.github.token = previousToken;
    global.fetch = previousFetch;
  }
});

test('github create skips a taken name and the first commit targets main', async () => {
  const previousToken = config.github.token;
  const previousFetch = global.fetch;
  github.clearOwnerCache();
  config.github.token = 'test-token';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    assert.ok(target.startsWith('https://api.github.com/'), target);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: target, method, body, authorization: opts.headers.Authorization });
    if (method === 'GET' && new URL(target).pathname === '/user') return json(200, { login: 'member-bot' });
    if (method === 'GET' && target.endsWith('/repos/atulitllc/harbor-and-rye-site')) return json(200, { name: 'harbor-and-rye-site' });
    if (method === 'GET' && target.endsWith('/repos/atulitllc/harbor-and-rye-site-2')) {
      return json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && target.endsWith('/orgs/atulitllc/repos')) {
      assert.equal(body.auto_init, false);
      assert.equal(body.private, false);
      assert.equal(body.name, 'harbor-and-rye-site-2');
      return json(201, { full_name: 'atulitllc/harbor-and-rye-site-2', html_url: 'https://github.com/atulitllc/harbor-and-rye-site-2' });
    }
    if (method === 'POST' && target.endsWith('/git/blobs')) return json(201, { sha: 'blob' + calls.length });
    if (method === 'POST' && target.endsWith('/git/trees')) return json(201, { sha: 'tree1' });
    if (method === 'POST' && target.endsWith('/git/commits')) return json(201, { sha: 'commit1' });
    if (method === 'POST' && target.endsWith('/git/refs')) return json(201, { ref: body.ref });
    if (method === 'GET' && target.endsWith('/git/ref/heads/main')) return json(200, { object: { sha: 'mainsha' } });
    if (method === 'GET' && target.endsWith('/git/commits/mainsha')) return json(200, { sha: 'mainsha', tree: { sha: 'maintree' } });
    if (method === 'POST' && target.endsWith('/pulls')) return json(201, { html_url: 'https://github.com/atulitllc/harbor-and-rye-site-2/pull/3', number: 3 });
    if (method === 'POST' && target.endsWith('/pages')) return json(409, { message: 'GitHub Pages already enabled' });
    return json(404, { message: 'unexpected ' + method + ' ' + target });
  };
  try {
    const created = await github.createUniqueRepo('atulitllc', 'harbor-and-rye-site', 'Website for Harbor & Rye');
    assert.equal(created.name, 'harbor-and-rye-site-2');
    assert.equal(created.repo.full_name, 'atulitllc/harbor-and-rye-site-2');
    assert.ok(calls.every((call) => call.authorization === 'Bearer test-token'));
    const sha = await github.initialCommit('atulitllc', created.name, 'Add website', {
      'index.html': '<p>Harbor</p>',
      '.nojekyll': ''
    });
    assert.equal(sha, 'commit1');
    const commit = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/commits'));
    assert.deepEqual(commit.body.parents, []);
    const ref = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/refs'));
    assert.equal(ref.body.ref, 'refs/heads/main');
    assert.equal(ref.body.sha, 'commit1');
    calls.length = 0;
    await github.branchCommit('atulitllc', created.name, {
      branch: 'site-update-20260929T034700Z',
      message: 'Update website',
      files: { 'index.html': '<p>Updated</p>' }
    });
    const update = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/commits'));
    assert.deepEqual(update.body.parents, ['mainsha']);
    const tree = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    assert.equal(tree.body.base_tree, 'maintree');
    const branchRef = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/refs'));
    assert.equal(branchRef.body.ref, 'refs/heads/site-update-20260929T034700Z');
    const pr = await github.openPullRequest('atulitllc', created.name, {
      title: 'Update website', head: 'site-update-20260929T034700Z', base: 'main', body: 'Regenerated.'
    });
    assert.match(pr.html_url, /\/pull\/3$/);
    const pages = await github.enablePages('atulitllc', created.name);
    assert.equal(pages.already, true);
    assert.equal(github.pagesUrlFor('AtulitLLC', 'Harbor-And-Rye-Site-2'), 'https://atulitllc.github.io/harbor-and-rye-site-2/');
  } finally {
    github.clearOwnerCache();
    config.github.token = previousToken;
    global.fetch = previousFetch;
  }
});

test('a 422 that is not a name collision is not treated as taken', () => {
  const err = new UpstreamError('GitHub', 422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists' }] });
  err.github = { message: 'Repository creation failed.', errors: [{ message: 'name already exists' }] };
  assert.equal(github.nameTaken(err), true);
  const other = new UpstreamError('GitHub', 422, { message: 'Visibility is disabled' });
  other.github = { message: 'Visibility is disabled' };
  assert.equal(github.nameTaken(other), false);
});
