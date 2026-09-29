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

test('two real designs cover the eight industry names', () => {
  assert.deepEqual(TEMPLATE_IDS, ['classic', 'modern']);
  const names = ['Restaurant', 'Clinic', 'Home services', 'Auto shop', 'Retail', 'Salon', 'Studio', 'Professional services'];
  const used = new Set(names.map((name) => industryStyle(name).template));
  assert.deepEqual([...used].sort(), ['classic', 'modern']);
  names.forEach((name) => assert.match(industryStyle(name).accent, /^#[0-9a-f]{6}$/));
  assert.equal(resolveTemplate('', 'Salon'), 'modern');
  assert.equal(resolveTemplate('CLASSIC', 'Salon'), 'classic');
  assert.throws(() => resolveTemplate('restaurant', 'Salon'), /classic or modern/);
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
  assert.match(classic, /class="tpl-classic"/);
  assert.match(modern, /class="tpl-modern"/);
  assert.doesNotMatch(classic, /tpl-modern/);
  assert.match(classic, /Harbor &amp; Rye/);
  assert.match(classic, /Supper and a good glass of wine/);
  assert.match(classic, /Dinner/);
  assert.match(classic, /90 min · \$45/);
  assert.match(classic, /tel:\+12065550199/);
  assert.match(classic, /href="https:\/\/cal\.example\/harbor" target="_blank"/);
  assert.match(classic, /--accent:#c2410c/);
  assert.match(classic, /id="hours"/);
  assert.match(classic, /Open in Maps/);
  assert.doesNotMatch(classic, /\{\{/);
  assert.doesNotMatch(classic, /<script/i);
  const sparse = buildSite({ name: 'Northline', category: 'Clinic', city: '', profile: { services: [] } }, '');
  const bare = previewHtml(sparse, 'classic');
  assert.match(bare, /Northline/);
  assert.doesNotMatch(bare, /id="hours"/);
  assert.doesNotMatch(bare, /id="services"/);
  assert.doesNotMatch(bare, /id="visit"/);
  assert.doesNotMatch(bare, /id="contact"/);
  assert.doesNotMatch(bare, /class="lead"/);
  assert.doesNotMatch(bare, /Call /);
  const telOnly = buildSite({
    name: 'Maple Street <Auto>',
    category: 'Auto shop',
    profile: { blurb: '' }
  }, '+17815550100');
  const telHtml = previewHtml(telOnly, 'modern');
  assert.match(telHtml, /Maple Street &lt;Auto&gt;/);
  assert.match(telHtml, /href="tel:\+17815550100"/);
  assert.doesNotMatch(telHtml, /target="_blank" rel="noopener">Book now/);
  assert.match(telHtml, />Book now</);
  assert.equal(telOnly.accent, '#1d4ed8');
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
  config.github.token = '';
  let called = false;
  global.fetch = () => { called = true; throw new Error('should not fetch'); };
  try {
    await assert.rejects(() => github.createRepo('atulitllc', 'example-site', 'Website'), (err) => {
      return err.code === 'NOT_CONFIGURED' && err.status === 409 && err.missing.includes('GITHUB_TOKEN');
    });
    assert.equal(called, false);
  } finally {
    config.github.token = previousToken;
    global.fetch = previousFetch;
  }
});

test('github create skips a taken name and the first commit targets main', async () => {
  const previousToken = config.github.token;
  const previousFetch = global.fetch;
  config.github.token = 'test-token';
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    assert.ok(target.startsWith('https://api.github.com/'), target);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: target, method, body, authorization: opts.headers.Authorization });
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
