'use strict';
// GitHub REST via fetch. No SDK. Creating a repository and writing files are inert until GITHUB_TOKEN is set.
const config = require('../config');
const { NotConfiguredError, UpstreamError } = require('../integrations/errors');

function assertConfigured() {
  if (!config.github.token) throw new NotConfiguredError('GitHub', ['GITHUB_TOKEN']);
}

function ownerLogin() {
  const owner = String(config.github.owner || config.github.org || 'atulitllc').trim() || 'atulitllc';
  if (!/^[A-Za-z0-9-]+$/.test(owner)) {
    const err = new Error('GITHUB_ORG must be a GitHub username or organization.');
    err.status = 500;
    throw err;
  }
  return owner;
}

// Kept so callers that still say "org" keep working. The value is the repo owner, user or organization.
function orgName() {
  return ownerLogin();
}

function pagesUrlFor(owner, repo) {
  return 'https://' + String(owner).toLowerCase() + '.github.io/' + String(repo).toLowerCase() + '/';
}

// Remember whether this token's user is the configured owner, so we do not call GET /user on every file.
let ownerKind = null;

function clearOwnerCache() {
  ownerKind = null;
}

async function createsReposAsUser(owner) {
  const token = config.github.token;
  const key = String(owner || '').toLowerCase();
  if (ownerKind && ownerKind.token === token && ownerKind.owner === key) return ownerKind.asUser;
  const me = await gh('GET', '/user');
  const login = String(me && me.login || '').toLowerCase();
  const asUser = login.length > 0 && login === key;
  ownerKind = { token, owner: key, asUser };
  return asUser;
}

// attempt 0 is the base name. Later attempts are base-2, base-3, ...
function repoCandidate(base, attempt) {
  const n = Number(attempt) || 0;
  if (n <= 0) return base;
  return base + '-' + (n + 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gh(method, path, body, { retryNotFound } = {}) {
  assertConfigured();
  const attempts = retryNotFound ? 3 : 1;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ghOnce(method, path, body);
    } catch (err) {
      last = err;
      if (!retryNotFound || err.upstreamStatus !== 404 || i === attempts - 1) throw err;
      await sleep(400 * (i + 1));
    }
  }
  throw last;
}

async function ghOnce(method, path, body) {
  const url = 'https://api.github.com' + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + config.github.token,
        'User-Agent': config.userAgent,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    const wrapped = new Error('GitHub could not be reached.');
    wrapped.status = 502;
    wrapped.code = 'UPSTREAM';
    throw wrapped;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch (e) { data = { message: String(text).slice(0, 300) }; }
  }
  if (!res.ok) {
    const err = new UpstreamError('GitHub', res.status, data && data.message ? data : (data || 'HTTP ' + res.status));
    err.github = data;
    if (res.status === 401) {
      err.message = 'GitHub rejected GITHUB_TOKEN.';
    }
    throw err;
  }
  return data;
}

function nameTaken(err) {
  if (!err || err.upstreamStatus !== 422) return false;
  const blob = JSON.stringify(err.github || err.message || '').toLowerCase();
  return blob.includes('already exists') || blob.includes('name already');
}

async function repoExists(owner, name) {
  try {
    await gh('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name));
    return true;
  } catch (err) {
    if (err.upstreamStatus === 404) return false;
    throw err;
  }
}

async function createRepo(owner, name, description) {
  const asUser = await createsReposAsUser(owner);
  const path = asUser ? '/user/repos' : '/orgs/' + encodeURIComponent(owner) + '/repos';
  return gh('POST', path, {
    name,
    description: String(description || '').slice(0, 350),
    private: false,
    visibility: 'public',
    auto_init: false,
    has_issues: false,
    has_projects: false,
    has_wiki: false
  });
}

async function createUniqueRepo(owner, base, description) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const name = repoCandidate(base, attempt);
    if (await repoExists(owner, name)) continue;
    try {
      const repo = await createRepo(owner, name, description);
      return { name, repo };
    } catch (err) {
      if (nameTaken(err)) continue;
      throw err;
    }
  }
  const err = new Error('No free repository name for this GitHub account.');
  err.status = 409;
  throw err;
}

async function deleteRepo(org, name) {
  try {
    await gh('DELETE', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(name));
  } catch (err) {
    // The empty repo is left for a person to delete if GitHub refuses.
  }
}

function encodeBlob(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

async function writeTree(org, repo, files, baseTree) {
  const entries = [];
  for (const path of Object.keys(files)) {
    const blob = await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/blobs', {
      content: encodeBlob(files[path]),
      encoding: 'base64'
    }, { retryNotFound: true });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const body = { tree: entries };
  if (baseTree) body.base_tree = baseTree;
  return gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/trees', body, { retryNotFound: true });
}

// First commit on an empty repo (auto_init false): root commit, then refs/heads/main.
async function initialCommit(org, repo, message, files) {
  const tree = await writeTree(org, repo, files);
  const commit = await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/commits', {
    message,
    tree: tree.sha,
    parents: []
  }, { retryNotFound: true });
  await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/refs', {
    ref: 'refs/heads/main',
    sha: commit.sha
  }, { retryNotFound: true });
  return commit.sha;
}

async function branchCommit(org, repo, { branch, message, files }) {
  const ref = await gh('GET', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/ref/heads/main');
  const parentSha = ref && ref.object && ref.object.sha;
  if (!parentSha) {
    const err = new Error('The repository has no main branch to update.');
    err.status = 409;
    throw err;
  }
  const parent = await gh('GET', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/commits/' + parentSha);
  const baseTree = parent && parent.tree && parent.tree.sha;
  const tree = await writeTree(org, repo, files, baseTree);
  const commit = await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/commits', {
    message,
    tree: tree.sha,
    parents: [parentSha]
  });
  await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/git/refs', {
    ref: 'refs/heads/' + branch,
    sha: commit.sha
  });
  return { sha: commit.sha, parentSha };
}

async function openPullRequest(org, repo, { title, head, base, body }) {
  return gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/pulls', {
    title,
    head,
    base: base || 'main',
    body: body || ''
  });
}

// Best-effort. 409 means Pages is already on. Other failures are returned to the caller.
async function enablePages(org, repo) {
  try {
    return await gh('POST', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo) + '/pages', {
      source: { branch: 'main', path: '/' }
    }, { retryNotFound: true });
  } catch (err) {
    if (err.upstreamStatus === 409) return { already: true };
    throw err;
  }
}

async function setHomepage(org, repo, homepage) {
  try {
    await gh('PATCH', '/repos/' + encodeURIComponent(org) + '/' + encodeURIComponent(repo), { homepage });
  } catch (err) {
    // The repo still exists. The Pages URL is shown in the panel either way.
  }
}

function branchName(date) {
  const stamp = (date || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'site-update-' + stamp;
}

module.exports = {
  assertConfigured,
  ownerLogin,
  orgName,
  clearOwnerCache,
  pagesUrlFor,
  repoCandidate,
  nameTaken,
  repoExists,
  createRepo,
  createUniqueRepo,
  deleteRepo,
  initialCommit,
  branchCommit,
  openPullRequest,
  enablePages,
  setHomepage,
  branchName
};
