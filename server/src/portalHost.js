'use strict';
// Host routing for per-business panels. panel.receptwise.com (and the other
// reserved names) stay the main control panel. <slug>.receptwise.com is a customer panel.

const RESERVED = Object.freeze(['panel', 'www', 'api']);
const ROOT = 'receptwise.com';

function classifyHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  const bare = value.replace(/:\d+$/, '');
  if (!bare || bare === ROOT || !bare.endsWith('.' + ROOT)) return { kind: 'primary' };
  const label = bare.slice(0, -(ROOT.length + 1));
  if (!label || label.includes('.')) return { kind: 'primary' };
  if (RESERVED.includes(label)) return { kind: 'primary', reserved: label };
  return { kind: 'customer', label };
}

function notFoundPage(label) {
  const safe = String(label || '').replace(/[^a-z0-9-]/gi, '');
  const host = safe + '.receptwise.com';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Panel not found · ReceptWise</title>' +
    '<style>body{margin:0;background:#f4f7f8;color:#142033;font-family:Georgia,serif}' +
    'main{max-width:36rem;margin:12vh auto;padding:32px;background:#fff;border-radius:16px}' +
    'a{color:#0e7c72}</style></head><body><main>' +
    '<h1>This panel was not found</h1>' +
    '<p>There is no ReceptWise panel at <strong>' + host + '</strong>.</p>' +
    '<p>Check the address with the business, or sign in at <a href="https://panel.receptwise.com">panel.receptwise.com</a>.</p>' +
    '</main></body></html>';
}

module.exports = { RESERVED, ROOT, classifyHost, notFoundPage };
