'use strict';
const db = require('../db');
const businesses = require('../businesses');
const audit = require('../audit');
const github = require('./github');
const cloudflare = require('./cloudflare');
const { buildSite, resolveTemplate, repoBaseName, renderFiles, previewHtml } = require('./render');

async function activeE164(businessId) {
  const { rows } = await db.query(
    "SELECT e164 FROM phone_numbers WHERE business_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1",
    [businessId]
  );
  return rows[0] ? rows[0].e164 : '';
}

async function getRow(businessId) {
  const { rows } = await db.query('SELECT * FROM business_websites WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

async function siteFor(biz, templateId) {
  const e164 = await activeE164(biz.id);
  const site = buildSite(biz, e164);
  site.template = templateId;
  return site;
}

async function preview(biz, templateInput) {
  const templateId = resolveTemplate(templateInput, biz.category);
  const site = await siteFor(biz, templateId);
  return { template: templateId, html: previewHtml(site, templateId) };
}

function publicRepo(created, org, name) {
  const fullName = (created && created.full_name) || (org + '/' + name);
  const repoUrl = (created && created.html_url) || ('https://github.com/' + org + '/' + name);
  return { fullName, repoUrl };
}

async function publishCloudflare(files, repoName, biz) {
  try {
    return await cloudflare.deploy({
      project: repoName,
      files,
      domain: cloudflare.customDomain(biz)
    });
  } catch (err) {
    return {
      status: 'error',
      project: '',
      url: '',
      domain: '',
      domainStatus: '',
      dns: '',
      error: (err && err.message) || 'Cloudflare deploy failed.',
      message: (err && err.message) || 'Cloudflare deploy failed.'
    };
  }
}

async function saveCloudflare(businessId, result) {
  const deployed = result && result.status === 'deployed';
  await db.query(
    `UPDATE business_websites
     SET cloudflare_project = $2,
         cloudflare_url = $3,
         cloudflare_domain = $4,
         cloudflare_domain_status = $5,
         cloudflare_dns = $6,
         cloudflare_error = $7,
         cloudflare_status = $8,
         cloudflare_deployed_at = CASE WHEN $9::boolean THEN now() ELSE cloudflare_deployed_at END,
         updated_at = now()
     WHERE business_id = $1`,
    [
      businessId,
      (result && result.project) || '',
      (result && result.url) || '',
      (result && result.domain) || '',
      (result && result.domainStatus) || '',
      (result && result.dns) || '',
      (result && result.error) || '',
      (result && result.status) || '',
      deployed
    ]
  );
}

function cloudflareSentence(result) {
  if (!result || result.status === 'not_configured') return ' Cloudflare not configured.';
  if (result.status === 'deployed') {
    let sentence = ' Cloudflare Pages: ' + result.url + '.';
    if (result.domain) sentence += ' Custom domain ' + result.domain + ' (' + (result.domainStatus || 'pending') + ').';
    if (result.error) sentence += ' ' + result.error;
    return sentence;
  }
  return ' Cloudflare deploy did not finish: ' + (result.error || 'unknown error') + '.';
}

async function generate(biz, templateInput, userId) {
  github.assertConfigured();
  const templateId = resolveTemplate(templateInput, biz.category);
  const existing = await getRow(biz.id);
  if (existing) {
    const err = new Error('This business already has a website repository. Regenerate to open a pull request.');
    err.status = 409;
    throw err;
  }
  const owner = github.ownerLogin();
  const site = await siteFor(biz, templateId);
  const base = repoBaseName(biz.name);
  const created = await github.createUniqueRepo(owner, base, 'Website for ' + site.name);
  const pagesUrl = github.pagesUrlFor(owner, created.name);
  const files = renderFiles(site, templateId, { pagesUrl });
  const { fullName, repoUrl } = publicRepo(created.repo, owner, created.name);
  try {
    await github.initialCommit(owner, created.name, 'Add ' + site.name + ' website', files);
  } catch (err) {
    await github.deleteRepo(owner, created.name);
    throw err;
  }
  let pagesEnabled = false;
  try {
    await github.enablePages(owner, created.name);
    pagesEnabled = true;
  } catch (err) {
    pagesEnabled = false;
  }
  await github.setHomepage(owner, created.name, pagesUrl);
  await db.query(
    `INSERT INTO business_websites (business_id, repo_full_name, repo_url, pages_url, template, last_generated_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [biz.id, fullName, repoUrl, pagesUrl, templateId]
  );
  const cf = await publishCloudflare(files, created.name, biz);
  await saveCloudflare(biz.id, cf);
  const detail = (pagesEnabled
    ? 'Repository ' + fullName + ' is ready. GitHub Pages was requested. The site address is ' + pagesUrl + '.'
    : 'Repository ' + fullName + ' is ready. Turn on GitHub Pages (branch main, folder /) to publish. The site address will be ' + pagesUrl + '.')
    + cloudflareSentence(cf);
  await businesses.setStep(biz.id, 'website', 'action', detail, { repo: fullName, cloudflare: cf.status });
  await audit.record(userId, biz.id, 'website.generate', { repo: fullName, template: templateId, pagesEnabled, cloudflare: cf.status, cloudflareUrl: cf.url || '' });
  const fresh = await businesses.getBySlug(biz.slug);
  return {
    repoFullName: fullName,
    repoUrl,
    pagesUrl,
    template: templateId,
    pagesEnabled,
    prUrl: '',
    cloudflare: cf,
    business: await businesses.toUi(fresh)
  };
}

async function regenerate(biz, userId, templateInput) {
  github.assertConfigured();
  const row = await getRow(biz.id);
  if (!row) {
    const err = new Error('Generate a website before regenerating.');
    err.status = 409;
    throw err;
  }
  const templateId = templateInput ? resolveTemplate(templateInput, biz.category) : resolveTemplate(row.template, biz.category);
  const owner = github.ownerLogin();
  const repoName = String(row.repo_full_name || '').split('/')[1];
  if (!repoName) {
    const err = new Error('The saved repository name is missing.');
    err.status = 409;
    throw err;
  }
  const site = await siteFor(biz, templateId);
  const pagesUrl = row.pages_url || github.pagesUrlFor(owner, repoName);
  const files = renderFiles(site, templateId, { pagesUrl });
  const branch = github.branchName(new Date());
  await github.branchCommit(owner, repoName, {
    branch,
    message: 'Update ' + site.name + ' website',
    files
  });
  const pr = await github.openPullRequest(owner, repoName, {
    title: 'Update ' + site.name + ' website',
    head: branch,
    base: 'main',
    body: 'Regenerated the one-page site (' + templateId + ' design) from the current business details. Main stays as it is until this pull request is merged.'
  });
  const prUrl = pr.html_url || '';
  await db.query(
    `UPDATE business_websites
     SET template = $2, pages_url = $3, last_generated_at = now(), last_pr_url = $4, updated_at = now()
     WHERE business_id = $1`,
    [biz.id, templateId, pagesUrl, prUrl]
  );
  const cf = await publishCloudflare(files, repoName, biz);
  await saveCloudflare(biz.id, cf);
  await businesses.setStep(biz.id, 'website', 'action',
    'Pull request opened for ' + row.repo_full_name + '. Main is unchanged until it is merged. ' + prUrl + cloudflareSentence(cf),
    { repo: row.repo_full_name, prUrl, cloudflare: cf.status });
  await audit.record(userId, biz.id, 'website.regenerate', { repo: row.repo_full_name, template: templateId, prUrl, cloudflare: cf.status, cloudflareUrl: cf.url || '' });
  const fresh = await businesses.getBySlug(biz.slug);
  return {
    repoFullName: row.repo_full_name,
    repoUrl: row.repo_url,
    pagesUrl,
    template: templateId,
    prUrl,
    cloudflare: cf,
    business: await businesses.toUi(fresh)
  };
}

module.exports = { preview, generate, regenerate, getRow };
