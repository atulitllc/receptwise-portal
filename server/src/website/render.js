'use strict';
// Turns one business into a static one-page site. HTML is filled here so the published page
// works with JavaScript off. site.json is the same data, kept for a later regeneration.
const fs = require('fs');
const path = require('path');
const { slugify, prettyPhone } = require('../businesses');

const TEMPLATE_ROOT = path.join(__dirname, '..', '..', 'site-templates');

// Eight industry names share two layouts. The accent is the only per-industry difference.
const INDUSTRIES = {
  Restaurant: { template: 'classic', accent: '#c2410c' },
  Clinic: { template: 'classic', accent: '#0369a1' },
  Retail: { template: 'classic', accent: '#6d28d9' },
  'Professional services': { template: 'classic', accent: '#0f766e' },
  'Auto shop': { template: 'modern', accent: '#1d4ed8' },
  Salon: { template: 'modern', accent: '#9d174d' },
  'Home services': { template: 'modern', accent: '#166534' },
  Studio: { template: 'modern', accent: '#4338ca' }
};

const TEMPLATE_IDS = ['classic', 'modern'];

function industryStyle(category) {
  return INDUSTRIES[category] || { template: 'classic', accent: '#0e7c72' };
}

function resolveTemplate(input, category) {
  if (input == null || input === '') return industryStyle(category).template;
  const id = String(input).trim().toLowerCase();
  if (TEMPLATE_IDS.includes(id)) return id;
  const err = new Error('Unknown template. Choose classic or modern.');
  err.status = 400;
  throw err;
}

function repoBaseName(businessName) {
  const slug = slugify(businessName).replace(/-+$/g, '') || 'business';
  return (slug + '-site').slice(0, 100);
}

function plain(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function plainHours(value) {
  if (Array.isArray(value)) return value.map((item) => plain(item)).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    return Object.keys(value).map((key) => {
      const bit = plain(value[key]);
      return bit ? key + ': ' + bit : '';
    }).filter(Boolean).join('\n');
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

function plainAddress(value) {
  if (Array.isArray(value)) return value.map((item) => plain(item)).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return ['line1', 'line2', 'street', 'city', 'region', 'state', 'postal', 'zip']
      .map((key) => plain(value[key])).filter(Boolean).join(', ');
  }
  return plain(value);
}

function httpUrl(value) {
  const v = plain(value);
  if (!/^https?:\/\//i.test(v)) return '';
  try {
    const url = new URL(v);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch (err) {
    return '';
  }
}

function bookingLink(profile) {
  const source = profile || {};
  for (const key of ['bookingLink', 'bookingUrl', 'calendarLink', 'calendarUrl']) {
    const url = httpUrl(source[key]);
    if (url) return url;
  }
  const calendar = source.calendar;
  if (calendar && typeof calendar === 'object') {
    for (const key of ['url', 'link', 'bookingUrl', 'bookingLink']) {
      const url = httpUrl(calendar[key]);
      if (url) return url;
    }
  }
  return '';
}

function serviceItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (typeof item === 'string') {
      const name = plain(item);
      return name ? { name, detail: '', price: '', duration: '', meta: '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const name = plain(item.name || item.title);
    if (!name) return null;
    const duration = plain(item.length || item.duration);
    const price = plain(item.price);
    const detail = plain(item.detail || item.description || item.summary);
    const meta = [duration, price].filter(Boolean).join(' · ');
    return { name, detail, price, duration, meta };
  }).filter(Boolean);
}

function starFields(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { stars: '', starsLabel: '' };
  const s = Math.round(n);
  if (s < 1 || s > 5) return { stars: '', starsLabel: '' };
  return {
    stars: '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s),
    starsLabel: s + ' out of 5 stars'
  };
}

// Only reviews that are already on the business. Nothing is invented.
function reviewItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (typeof item === 'string') {
      const text = plain(item);
      return text ? { text, author: '', when: '', stars: '', starsLabel: '', byline: '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const text = plain(item.text || item.quote || item.body);
    if (!text) return null;
    const author = plain(item.author || item.name);
    const when = plain(item.when || item.date);
    const stars = starFields(item.stars != null ? item.stars : item.rating);
    return {
      text,
      author,
      when,
      stars: stars.stars,
      starsLabel: stars.starsLabel,
      byline: [author, when].filter(Boolean).join(' · ')
    };
  }).filter(Boolean);
}

function blockText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => blockText(item)).filter(Boolean).join('\n\n');
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim();
}

function splitHeadline(text) {
  const words = String(text || '').split(' ').filter(Boolean);
  if (words.length <= 1) return { headlineLead: '', headlineMark: words[0] || '' };
  return { headlineLead: words.slice(0, -1).join(' '), headlineMark: words[words.length - 1] };
}

function phoneFields(e164) {
  const display = prettyPhone(e164);
  const digits = String(e164 || '').replace(/\D/g, '');
  if (!display || digits.length < 10) return { phoneDisplay: '', phoneHref: '' };
  const tel = digits.length === 10 ? '+1' + digits : '+' + digits;
  return { phoneDisplay: display, phoneHref: 'tel:' + tel };
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function onAccent(hex) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return lum > 0.55 ? '#1E2A44' : '#ffffff';
}

function mixWhite(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.round(c + (255 - c) * amount);
  return '#' + [m(r), m(g), m(b)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function buildSite(biz, e164) {
  const profile = (biz && biz.profile) || {};
  const style = industryStyle(biz && biz.category);
  const phone = phoneFields(e164);
  const booking = bookingLink(profile);
  const address = plainAddress(profile.address);
  const accent = /^#[0-9a-fA-F]{6}$/.test(style.accent) ? style.accent : '#0e7c72';
  const name = plain(biz && biz.name) || 'Local business';
  const category = plain(biz && biz.category);
  const city = plain(biz && biz.city);
  const headline = plain(profile.headline || profile.tagline) || name;
  const parts = splitHeadline(headline);
  const about = blockText(profile.about || profile.story || profile.description);
  const hours = plainHours(profile.hours);
  const services = serviceItems(profile.services);
  const reviews = reviewItems(profile.reviews || profile.testimonials);
  const showContact = Boolean(phone.phoneHref || booking);
  const place = city ? ' in ' + city : '';
  let ctaText = '';
  if (phone.phoneHref && booking) ctaText = 'Call ' + name + place + ', or book a time.';
  else if (phone.phoneHref) ctaText = 'Call ' + name + place + '.';
  else if (booking) ctaText = 'Book a time with ' + name + place + '.';
  return {
    name,
    headline,
    headlineLead: parts.headlineLead,
    headlineMark: parts.headlineMark,
    blurb: plain(profile.blurb),
    about,
    category,
    city,
    eyebrow: [category, city].filter(Boolean).join(' · '),
    hours,
    hourLines: hours.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => ({ line })),
    address,
    mapUrl: address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '',
    phoneDisplay: phone.phoneDisplay,
    phoneHref: phone.phoneHref,
    bookingUrl: booking,
    bookHref: booking || phone.phoneHref,
    bookExternal: Boolean(booking),
    services,
    reviews,
    accent,
    accentInk: onAccent(accent),
    accentSoft: mixWhite(accent, 0.88),
    showContact,
    hasNav: Boolean(services.length || about || hours || reviews.length || address || showContact),
    ctaText,
    privacy: name + ' shares this page so people can see services, hours, and how to get in touch. This page does not take form submissions. Do not send medical, financial, or account details here.',
    year: String(new Date().getFullYear())
  };
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

function findEnd(src, from, endLabel) {
  const openName = endLabel.slice(1);
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const start = src.indexOf('{{', i);
    if (start < 0) break;
    const end = src.indexOf('}}', start);
    if (end < 0) break;
    const tag = src.slice(start + 2, end).trim();
    const isOpen = openName === 'each' ? tag.startsWith('#each ') : tag === '#' + openName;
    if (isOpen) depth += 1;
    else if (tag === endLabel) {
      depth -= 1;
      if (depth === 0) return start;
    }
    i = end + 2;
  }
  const err = new Error('Unclosed template block {{' + endLabel + '}}');
  err.status = 500;
  throw err;
}

function renderTemplate(src, data) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('{{', i);
    if (start < 0) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, start);
    const end = src.indexOf('}}', start);
    if (end < 0) {
      out += src.slice(start);
      break;
    }
    const tag = src.slice(start + 2, end).trim();
    const after = end + 2;
    if (tag.startsWith('#each ')) {
      const key = tag.slice(6).trim();
      const closeAt = findEnd(src, after, '/each');
      const inner = src.slice(after, closeAt);
      const list = Array.isArray(data[key]) ? data[key] : [];
      list.forEach((item) => { out += renderTemplate(inner, item || {}); });
      i = closeAt + '{{/each}}'.length;
    } else if (tag.startsWith('#')) {
      const key = tag.slice(1).trim();
      const closeAt = findEnd(src, after, '/' + key);
      const inner = src.slice(after, closeAt);
      if (truthy(data[key])) out += renderTemplate(inner, data);
      i = closeAt + ('{{/' + key + '}}').length;
    } else if (tag.startsWith('/')) {
      i = after;
    } else {
      const value = data[tag];
      out += esc(value == null || typeof value === 'object' ? '' : value);
      i = after;
    }
  }
  return out;
}

function readTemplate(id, name) {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, id, name), 'utf8');
}

function applyAssets(html, css, inlineCss) {
  const tag = inlineCss
    ? '<style>' + String(css).replace(/<\/style/gi, '<\\/style') + '</style>'
    : '<link rel="stylesheet" href="styles.css">';
  return html.replace('<!--ASSETS-->', tag);
}

function renderDocument(site, templateId, { inlineCss } = {}) {
  const id = TEMPLATE_IDS.includes(templateId) ? templateId : 'classic';
  const html = renderTemplate(readTemplate(id, 'index.html'), site);
  let doc = applyAssets(html, readTemplate(id, 'styles.css'), inlineCss);
  if (inlineCss) doc = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  if (/\{\{/.test(doc)) {
    const err = new Error('Unresolved template tag in ' + id);
    err.status = 500;
    throw err;
  }
  return doc;
}

function siteRecord(site, templateId) {
  return {
    name: site.name,
    headline: site.headline,
    blurb: site.blurb,
    about: site.about,
    category: site.category,
    city: site.city,
    hours: site.hours,
    address: site.address,
    mapUrl: site.mapUrl,
    phoneDisplay: site.phoneDisplay,
    phoneHref: site.phoneHref,
    bookingUrl: site.bookingUrl,
    bookHref: site.bookHref,
    services: site.services,
    reviews: site.reviews,
    accent: site.accent,
    template: templateId
  };
}

function renderReadme(site, templateId, pagesUrl) {
  return [
    '# ' + site.name,
    '',
    'Static one-page website (' + templateId + ' design).',
    '',
    'Open `index.html` to preview. The page is already filled in, so it works with JavaScript turned off. `site.json` holds the business details used to build the page.',
    '',
    '## Publish with GitHub Pages',
    '',
    '1. In this repository, open **Settings → Pages**.',
    '2. Under **Build and deployment**, choose **Deploy from a branch**.',
    '3. Branch: **main**. Folder: **/ (root)**. Save.',
    '4. The site address is:',
    '',
    '   ' + pagesUrl,
    '',
    'A pull request does not change the live site until it is merged into `main`.',
    '',
    '`.nojekyll` is included so Pages serves these files as they are.',
    ''
  ].join('\n');
}

function renderFiles(site, templateId, { pagesUrl } = {}) {
  const id = TEMPLATE_IDS.includes(templateId) ? templateId : 'classic';
  const withTemplate = Object.assign({}, site, { template: id });
  return {
    'index.html': renderDocument(withTemplate, id, { inlineCss: false }),
    'styles.css': readTemplate(id, 'styles.css'),
    'site.js': readTemplate(id, 'site.js'),
    'site.json': JSON.stringify(siteRecord(withTemplate, id), null, 2) + '\n',
    'README.md': renderReadme(withTemplate, id, pagesUrl || ''),
    '.nojekyll': ''
  };
}

function previewHtml(site, templateId) {
  const id = TEMPLATE_IDS.includes(templateId) ? templateId : 'classic';
  return renderDocument(Object.assign({}, site, { template: id }), id, { inlineCss: true });
}

module.exports = {
  INDUSTRIES,
  TEMPLATE_IDS,
  TEMPLATE_ROOT,
  industryStyle,
  resolveTemplate,
  repoBaseName,
  buildSite,
  renderTemplate,
  renderFiles,
  previewHtml,
  esc
};
