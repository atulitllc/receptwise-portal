/* ReceptWise first-party beacon. No cookies. Posts one JSON event to this app. */
(function () {
  var script = document.currentScript;
  if (!script) {
    var tags = document.getElementsByTagName('script');
    for (var i = tags.length - 1; i >= 0; i--) {
      if ((tags[i].src || '').indexOf('/analytics.js') !== -1) { script = tags[i]; break; }
    }
  }
  if (!script) return;
  var site = script.getAttribute('data-site') || '';
  if (!site) return;
  var endpoint = script.src.replace(/\/analytics\.js(?:\?.*)?$/, '/api/public/analytics/event');

  function clip(value, max) {
    return String(value || '').replace(/^\s+|\s+$/g, '').slice(0, max);
  }

  function param(name) {
    var query = location.search || '';
    var match = new RegExp('[?&]' + name + '=([^&]*)').exec(query);
    if (!match) return '';
    try { return decodeURIComponent(match[1].replace(/\+/g, ' ')).slice(0, 80); }
    catch (e) { return ''; }
  }

  function pathNow() {
    var path = (location.pathname || '/') + (location.hash || '');
    path = path.split('?')[0];
    if (!path || path.charAt(0) !== '/') path = '/' + path;
    return path.slice(0, 200);
  }

  function send(event, extra) {
    var body = {
      site_key: site,
      event: event,
      path: pathNow(),
      referrer: clip(document.referrer, 500),
      utm_source: param('utm_source'),
      utm_medium: param('utm_medium'),
      utm_campaign: param('utm_campaign'),
      hp: ''
    };
    if (extra && extra.label) body.meta = { label: clip(extra.label, 80) };
    var payload = JSON.stringify(body);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'text/plain' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
    } catch (e) { /* fall through to fetch */ }
    try {
      if (!window.fetch) return;
      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
        body: payload
      }).catch(function () {});
    } catch (e2) { /* analytics must not break the page */ }
  }

  function track(event, extra) {
    if (!event) return;
    send(String(event), extra || null);
  }

  window.rwAnalytics = { track: track, site: site };

  function pageview() { send('pageview'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageview);
  else pageview();
  window.addEventListener('hashchange', pageview);

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('a, button') : null;
    if (!el) return;
    if (el.hasAttribute('data-rw-browser-call') || (el.className && String(el.className).indexOf('btn-browser-call') !== -1)) {
      send('browser_call');
      return;
    }
    var href = el.getAttribute('href') || '';
    var className = String(el.className || '');
    if (/^tel:/i.test(href) || className.indexOf('btn-call') !== -1 || el.hasAttribute('data-rw-call')) {
      send('call_click');
    }
  }, true);
})();
