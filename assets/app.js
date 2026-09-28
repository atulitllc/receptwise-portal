/* Shared chrome, sample interactions, and page rendering for the prototype. */
(function () {
  var STEPS = [
    ["Business", "Name, type, and hours"],
    ["Plan", "Size tier and price"],
    ["Phone", "New number or forwarding"],
    ["Test call", "Confirm the greeting"],
    ["Calendar", "Where bookings land"],
    ["Receptionist", "Greeting, services, voice"],
    ["Social", "Pages to connect"],
    ["Website", "Keep or build"],
    ["Texting", "Registration status"],
    ["Review", "Create the business"]
  ];

  var TABS = [
    ["overview", "Overview"],
    ["receptionist", "Receptionist"],
    ["bookings", "Bookings"],
    ["reviews", "Reviews"],
    ["social", "Social"],
    ["website", "Website"],
    ["outreach", "Outreach"],
    ["billing", "Billing"],
    ["settings", "Settings"]
  ];

  var CAT_COLOR = {
    Restaurant: "#c2410c",
    Clinic: "#0369a1",
    "Auto shop": "#1d4ed8",
    Salon: "#9d174d",
    "Home services": "#166534",
    Retail: "#6d28d9",
    "Professional services": "#0e7c72"
  };

  var STATUS_LABEL = {
    live: "Live",
    setup: "In setup",
    waiting: "Waiting on client",
    attention: "Needs attention",
    connected: "Connected",
    pending: "Pending",
    action: "Needs action"
  };

  var wizard = defaultWizard();
  var openCheck = "";
  var openCall = "";
  var timers = [];
  var extraCache = null;
  var currentRender = function () {};

  function defaultWizard() {
    return {
      step: 0,
      name: "",
      category: "",
      address: "",
      city: "",
      website: "",
      hours: "Mon–Fri 9:00 AM – 5:00 PM",
      timezone: "Pacific Time",
      ownerName: "",
      ownerMobile: "",
      ownerEmail: "",
      tier: "Small",
      plan: "Growth",
      pilot: false,
      multi: false,
      phoneMode: "forward",
      carrier: "verizon",
      forwardType: "missed",
      businessNumber: "",
      areaCode: "415",
      chosenNumber: "(415) 555-0148",
      lookupNote: "",
      clientDone: false,
      testStatus: "idle",
      testNote: "",
      calendar: "google",
      greeting: "",
      services: "",
      faqs: "",
      transfer: "",
      voice: "Juniper (warm)",
      spanish: false,
      facebook: "",
      instagram: "",
      gbp: "",
      siteChoice: "build",
      domain: "",
      template: "",
      legalName: "",
      taxId: "",
      sampleSms: "Your appointment is confirmed. Reply STOP to opt out.",
      consent: "Number collected at booking",
      error: "",
      createdId: ""
    };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function money(n) {
    return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function money2(n) {
    return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function digits(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.slice(0, 10);
  }

  function pretty(d) {
    if (!d || d.length !== 10) return d || "";
    return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  }

  function storageGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { sessionStorage.setItem(key, value); return true; }
    catch (e) { toast("This browser blocked saving the session."); return false; }
  }

  function session() {
    try { return JSON.parse(storageGet("rw_session") || "null"); }
    catch (e) { return null; }
  }

  function createdList() {
    if (extraCache) return extraCache;
    try { extraCache = JSON.parse(storageGet("rw_created") || "[]"); }
    catch (e) { extraCache = []; }
    return extraCache;
  }

  function allBusinesses() {
    return (window.RW_DATA.businesses || []).concat(createdList());
  }

  function findBiz(id) {
    var list = allBusinesses();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function ordered(list) {
    return list.slice().sort(function (a, b) {
      return (b.pilot === true) - (a.pilot === true);
    });
  }

  function checklistItem(b, key) {
    var rows = b.checklist || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i];
    return { key: key, label: key, status: "pending", detail: "", owner: "Team" };
  }

  function setupCount(b) {
    var done = (b.checklist || []).filter(function (item) { return item.status === "connected"; }).length;
    return { done: done, total: (b.checklist || []).length || 11 };
  }

  function nextAction(b) {
    var open = (b.checklist || []).filter(function (item) { return item.status !== "connected"; });
    var actionsOnly = open.filter(function (item) { return item.status === "action"; });
    var pool = actionsOnly.length ? actionsOnly : open;
    if (!pool.length) return { text: "None. Setup is confirmed.", owner: "—", detail: "" };
    var marked = pool.filter(function (item) { return item.next; })[0];
    var hit = marked || pool[0];
    return { text: hit.label, owner: hit.owner || "Team", detail: hit.detail || "" };
  }

  function phoneStatus(b) {
    var forwarding = checklistItem(b, "forwarding");
    if (!b.phone || b.phone.mode === "new") return "New number active";
    if (b.phone.mode === "port") return "Port in progress";
    if (forwarding.status === "connected") return "Forwarding confirmed";
    if (forwarding.status === "action") return "Forwarding needs action";
    return "Forwarding pending";
  }

  function heat(used, cap) {
    var pct = cap ? used / cap : 0;
    if (pct >= 1) return "over";
    if (pct >= 0.8) return "hot";
    return "";
  }

  function allAlerts() {
    var out = [];
    allBusinesses().forEach(function (b) {
      (b.checklist || []).forEach(function (item) {
        if (item.status === "action") {
          out.push({ id: b.id, name: b.name, text: item.detail || item.label });
        }
      });
      if (b.minutesCap && b.minutesUsed / b.minutesCap >= 0.8) {
        var pct = Math.round((b.minutesUsed / b.minutesCap) * 100);
        out.push({
          id: b.id,
          name: b.name,
          text: b.minutesUsed.toLocaleString() + " of " + b.minutesCap.toLocaleString() + " minutes used (" + pct + "%)."
        });
      }
    });
    return out;
  }

  function estimate(b) {
    var minutes = (b.minutesUsed || 0) * 0.125;
    var number = 2;
    var texts = (b.texts || 0) * 0.012;
    var price = b.pilot ? 0 : (b.price || 0);
    var stripe = price ? price * 0.029 + 0.3 + price * 0.007 : 0;
    var total = minutes + number + texts + stripe;
    return { minutes: minutes, number: number, texts: texts, stripe: stripe, total: total, keep: price - total, price: price };
  }

  function planByName(name) {
    var plans = window.RW_DATA.plans || [];
    for (var i = 0; i < plans.length; i++) if (plans[i].name === name) return plans[i];
    return plans[1] || plans[0];
  }

  function candidates(area) {
    var a = String(area || "").replace(/\D/g, "").slice(0, 3);
    if (a.length < 3) a = "415";
    return ["(" + a + ") 555-0148", "(" + a + ") 555-0162", "(" + a + ") 555-0190"];
  }

  function forwardingHelp(carrier, forwardType, aiNumber) {
    var n = digits(aiNumber);
    if (n.length < 10) n = "4155550148";
    var lines = [];
    var off = [];
    var note = "Dial this from the business phone itself, then place the test call.";
    var warn = "";
    if (carrier === "verizon") {
      if (forwardType === "all") lines.push(["Forward all calls", "*72" + n]);
      else lines.push(["Forward missed calls (no answer or busy)", "*71" + n]);
      off.push(["Turn forwarding off", "*73"]);
    } else if (carrier === "att-mobile") {
      warn = "On a mobile phone, *67 alone hides caller ID. It is not a forwarding code. Use the full code shown here.";
      if (forwardType === "all") lines.push(["Forward all calls", "**21*" + n + "#"]);
      else {
        lines.push(["No answer", "**61*" + n + "#"]);
        lines.push(["Busy", "**67*" + n + "#"]);
        lines.push(["Unreachable", "**62*" + n + "#"]);
      }
      off.push(["Clear no-answer", "##61#"]);
      off.push(["Clear busy", "##67#"]);
      off.push(["Clear unreachable", "##62#"]);
      off.push(["Clear forward-all", "##21#"]);
      off.push(["Clear every forward", "##002#"]);
    } else if (carrier === "att-landline") {
      note = "AT&T business landline codes are dialed from that line. Confirm with a test call every time.";
      if (forwardType === "all") lines.push(["Forward all calls", "*72" + n]);
      else {
        lines.push(["Forward when busy", "*62"]);
        lines.push(["Check no-answer status", "*61*"]);
      }
      off.push(["Turn off forward-all", "*73"]);
      off.push(["Turn off busy forward", "*63"]);
    } else if (carrier === "tmobile") {
      warn = "On a mobile phone, *67 alone hides caller ID. T-Mobile busy forwarding uses the longer **67*1 number # form.";
      var n1 = "1" + n;
      if (forwardType === "all") lines.push(["Forward all calls", "**21*" + n1 + "#"]);
      else {
        lines.push(["No answer", "**61*" + n1 + "#"]);
        lines.push(["Busy", "**67*" + n1 + "#"]);
        lines.push(["Unreachable", "**62*" + n1 + "#"]);
      }
      off.push(["Clear no-answer", "##61#"]);
      off.push(["Clear busy", "##67#"]);
      off.push(["Clear unreachable", "##62#"]);
      off.push(["Clear forward-all", "##21#"]);
      off.push(["Clear every forward", "##004#"]);
    } else {
      note = "Cable, internet phone, and office systems (Comcast, Spectrum, RingCentral, and others) are changed in the provider's website or app. Forward those calls to " + pretty(n) + ".";
    }
    return { lines: lines, off: off, note: note, warn: warn, number: pretty(n) };
  }

  function codeBlock(help, alt) {
    var html = '<div class="code-card"><strong>Dial from the business phone</strong>';
    html += '<p class="help">AI number used in these codes: ' + esc(help.number) + "</p>";
    help.lines.forEach(function (line) {
      html += codeRow(line[0], line[1]);
    });
    if (alt && alt.lines && alt.lines.length) {
      html += '<p class="help" style="margin-top:8px">The other forwarding choice</p>';
      alt.lines.forEach(function (line) {
        html += codeRow(line[0], line[1]);
      });
    }
    if (help.off.length) {
      html += '<p class="help" style="margin-top:8px">Turn forwarding off</p>';
      help.off.forEach(function (line) {
        html += codeRow(line[0], line[1]);
      });
    }
    html += '<p class="help">' + esc(help.note) + "</p></div>";
    if (help.warn) html += '<div class="note">' + esc(help.warn) + "</div>";
    return html;
  }

  function codePair(carrier, forwardType, aiNumber) {
    var help = forwardingHelp(carrier, forwardType, aiNumber);
    var other = forwardType === "all" ? "missed" : "all";
    var alt = help.lines.length ? forwardingHelp(carrier, other, aiNumber) : null;
    return codeBlock(help, alt);
  }

  function codeRow(label, code) {
    return '<div class="code-line"><span>' + esc(label) + '</span><span><span class="code">' + esc(code) +
      '</span> <button class="btn btn-sm" type="button" data-action="copy-code" data-code="' + esc(code) + '">Copy</button></span></div>';
  }

  function pill(status) {
    var label = STATUS_LABEL[status] || status || "—";
    return '<span class="pill ' + esc(status || "neutral") + '">' + esc(label) + "</span>";
  }

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
    return parts.map(function (part) { return part.charAt(0).toUpperCase(); }).join("") || "?";
  }

  function colorFor(category) {
    return CAT_COLOR[category] || "#0e7c72";
  }

  function todayLabel() {
    try {
      return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    } catch (e) {
      return "Today";
    }
  }

  function legal() {
    return '<p class="page-legal">ReceptWise is a product of [Placeholder]. Sample data. Nothing here places a real call or charges a card.</p>';
  }

  function later(ms, fn) {
    var id = setTimeout(fn, ms);
    timers.push(id);
  }

  function clearTimers() {
    timers.forEach(function (id) { clearTimeout(id); });
    timers = [];
  }

  function toast(message) {
    var wrap = document.getElementById("toasts");
    if (!wrap) return;
    var node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.textContent = message;
    wrap.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.remove(); }, 3200);
  }

  function openModal(title, body, actionsHtml) {
    var back = document.getElementById("modal-back");
    if (!back) return;
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(title) + "</h3><div>" +
      body + '</div><div class="modal-actions">' + (actionsHtml || '<button class="btn" type="button" data-action="close-modal">Close</button>') +
      "</div></div>";
    back.classList.add("open");
  }

  function closeModal() {
    var back = document.getElementById("modal-back");
    if (!back) return;
    back.classList.remove("open");
    back.innerHTML = "";
  }

  function copyText(text) {
    function ok() { toast("Copied."); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else fallback();
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); ok(); }
      catch (e) { toast("Code: " + text); }
      area.remove();
    }
  }

  function iconSearch() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5e6d80" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  }

  function iconBell() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#142033" stroke-width="1.8" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  }

  function shell(page) {
    var user = session() || { name: "Maya Chen", email: "" };
    var active = page === "client" ? "clients" : page;
    var titles = {
      dashboard: "Overview",
      clients: "Businesses",
      add: "Add business",
      client: "Business",
      billing: "Billing and plans",
      team: "Team and settings"
    };
    var groups = [
      ["Main", [
        ["dashboard.html", "Overview", "dashboard"],
        ["clients.html", "Businesses", "clients"],
        ["add.html", "Add business", "add"]
      ]],
      ["Account", [
        ["billing.html", "Billing and plans", "billing"],
        ["team.html", "Team and settings", "team"]
      ]]
    ];
    var nav = groups.map(function (group) {
      return '<div class="nav-label">' + group[0] + "</div>" + group[1].map(function (item) {
        return '<a class="nav-link' + (item[2] === active ? " active" : "") + '" href="' + item[0] + '"' +
          (item[2] === active ? ' aria-current="page"' : "") + ">" + item[1] + "</a>";
      }).join("");
    }).join("");
    var alerts = allAlerts();
    var q = "";
    try { q = new URLSearchParams(location.search).get("q") || ""; } catch (e) { q = ""; }
    return '<div class="app"><aside class="sidebar">' +
      '<a class="brand" href="dashboard.html"><img class="brand-mark" src="assets/favicon.svg" alt=""><div><div class="brand-name">Recept<span>Wise</span></div><div class="brand-sub">Control panel</div></div></a>' +
      nav +
      '<div class="side-spacer"></div>' +
      '<div class="side-user"><div class="avatar me">' + esc(initials(user.name)) + "</div><div><strong>" + esc(user.name) +
      '</strong><span>Admin</span></div><button type="button" data-action="sign-out">Sign out</button></div></aside>' +
      '<div class="main"><header class="topbar"><h1 id="top-title">' + esc(titles[page] || "ReceptWise") + "</h1>" +
      '<form class="search" action="clients.html" method="get">' + iconSearch() +
      '<input name="q" value="' + esc(q) + '" placeholder="Search businesses" aria-label="Search businesses"></form>' +
      '<div class="bell-wrap"><button class="icon-btn" type="button" data-action="toggle-bell" aria-label="Alerts">' + iconBell() +
      (alerts.length ? '<span class="badge">' + alerts.length + "</span>" : "") + "</button>" +
      '<div id="bell-panel" class="bell-panel"></div></div>' +
      '<a class="avatar me" href="team.html">' + esc(initials(user.name)) + "</a></header>" +
      '<div class="content" id="view"></div></div></div>' +
      '<div id="modal-back" class="modal-back"></div><div id="toasts" class="toasts"></div>';
  }

  function refreshBell() {
    var panel = document.getElementById("bell-panel");
    var alerts = allAlerts();
    if (!panel) return;
    var badge = document.querySelector(".icon-btn .badge");
    if (alerts.length) {
      if (!badge) {
        var btn = document.querySelector(".icon-btn");
        if (btn) {
          var span = document.createElement("span");
          span.className = "badge";
          span.textContent = String(alerts.length);
          btn.appendChild(span);
        }
      } else badge.textContent = String(alerts.length);
    } else if (badge) badge.remove();
    panel.innerHTML = alerts.length ? alerts.map(function (alert) {
      return '<a href="client.html?id=' + encodeURIComponent(alert.id) + '"><strong>' + esc(alert.name) + "</strong><span>" + esc(alert.text) + "</span></a>";
    }).join("") : '<div class="empty">No alerts.</div>';
  }

  function mark(name, category) {
    return '<span class="who-mark" style="background:' + colorFor(category) + '">' + esc(initials(name)) + "</span>";
  }

  function progress(b) {
    var count = setupCount(b);
    var pct = Math.round((count.done / count.total) * 100);
    return '<span class="progress"><i style="width:' + pct + '%"></i></span>' + count.done + " of " + count.total;
  }

  function minuteCell(b) {
    var pct = b.minutesCap ? Math.min(100, Math.round((b.minutesUsed / b.minutesCap) * 100)) : 0;
    return b.minutesUsed + " / " + b.minutesCap + '<div class="usage ' + heat(b.minutesUsed, b.minutesCap) + '"><i style="width:' + pct + '%"></i></div>';
  }

  function renderDashboard(view) {
    var list = ordered(allBusinesses());
    var calls = list.reduce(function (sum, b) { return sum + (b.callsToday || 0); }, 0);
    var bookings = list.reduce(function (sum, b) { return sum + (b.bookingsToday || 0); }, 0);
    var live = list.filter(function (b) { return b.status === "live"; }).length;
    var look = list.filter(function (b) {
      return (b.checklist || []).some(function (item) { return item.status === "action"; }) || (b.minutesCap && b.minutesUsed / b.minutesCap >= 0.8);
    }).length;
    var rows = list.map(function (b) {
      var next = nextAction(b);
      return "<tr><td><div class='who'>" + mark(b.name, b.category) + "<div><a href='client.html?id=" + encodeURIComponent(b.id) + "'>" + esc(b.name) +
        "</a><div class='pills'>" + pill(b.status) + (b.pilot ? '<span class="pill pilot">Pilot</span>' : "") + "</div>" +
        "<div class='help'>" + (b.callsToday || 0) + " calls · " + (b.bookingsToday || 0) + " booked today</div></div></div></td>" +
        "<td>" + esc(b.plan) + "<div class='help'>" + esc(b.tier) + " · " + money(b.pilot ? 0 : b.price) + "</div></td>" +
        "<td>" + progress(b) + "</td><td>" + esc(phoneStatus(b)) + "</td><td>" + minuteCell(b) + "</td>" +
        "<td>" + esc(next.text) + "<div class='help'>" + esc(next.owner) + "</div></td></tr>";
    }).join("");
    var alerts = allAlerts().slice(0, 6).map(function (alert) {
      return '<a class="alert-row" href="client.html?id=' + encodeURIComponent(alert.id) + '"><strong>' + esc(alert.name) + "</strong><span>" + esc(alert.text) + "</span></a>";
    }).join("");
    var max = 48;
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var counts = [36, 29, 41, 48, 33, 18, calls || 41];
    var bars = counts.map(function (n, i) {
      var d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return '<div class="bar-col' + (i === 6 ? " today" : "") + '"><i style="height:' + Math.max(8, Math.round((n / max) * 100)) + '%"></i><em>' + days[d.getDay()] + "</em></div>";
    }).join("");
    var feed = (window.RW_DATA.feed || []).map(function (item) {
      var biz = findBiz(item.businessId);
      var name = biz ? biz.name : "Business";
      return "<div class='setting-row'><div><strong>" + esc(name) + "</strong><div class='help'>" + esc(item.text) + "</div></div><span class='help'>" + esc(item.time) + "</span></div>";
    }).join("");
    view.innerHTML = '<div class="page-head"><div><h1>Overview</h1><p class="sub">' + esc(todayLabel()) + " · " + live + " live · " + (list.length - live) + ' still moving through setup</p></div>' +
      '<div class="head-actions"><a class="btn" href="clients.html">All businesses</a><a class="btn btn-primary" href="add.html">Add business</a></div></div>' +
      '<section class="stats"><article class="stat"><em>Businesses</em><b>' + list.length + '</b><span>ReceptWise is pilot client 1</span></article>' +
      '<article class="stat"><em>Calls today</em><b>' + calls + '</b><span>Answered across the book</span></article>' +
      '<article class="stat"><em>Bookings today</em><b>' + bookings + '</b><span>From calls and the websites</span></article>' +
      '<article class="stat"><em>Need a look</em><b>' + look + '</b><span>Setup problems or minutes at 80%</span></article></section>' +
      '<div class="grid-main"><section class="card"><div class="card-h"><h2>Clients</h2><a href="clients.html">Filter the list</a></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Business</th><th>Plan</th><th>Setup</th><th>Phone</th><th>Minutes</th><th>Next action</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section><div class='stack'><section class='card'><div class='card-h'><h2>Alerts</h2></div><div class='card-b alert-list'>" +
      (alerts || '<div class="empty">Nothing needs you right now.</div>') + "</div></section>" +
      '<section class="card"><div class="card-h"><h2>Calls, last 7 days</h2></div><div class="card-b"><div class="bars">' + bars + "</div></div></section></div></div>" +
      '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Latest activity</h2></div><div class="card-b">' + feed + "</div></section>" + legal();
  }

  function clientQuery() {
    var params = new URLSearchParams(location.search);
    return {
      q: params.get("q") || "",
      type: params.get("type") || "",
      tier: params.get("tier") || "",
      status: params.get("status") || ""
    };
  }

  function clientsHref(overrides) {
    var current = clientQuery();
    Object.keys(overrides || {}).forEach(function (key) { current[key] = overrides[key]; });
    var params = new URLSearchParams();
    Object.keys(current).forEach(function (key) { if (current[key]) params.set(key, current[key]); });
    var text = params.toString();
    return "clients.html" + (text ? "?" + text : "");
  }

  function renderClients(view) {
    var filters = clientQuery();
    var types = [];
    allBusinesses().forEach(function (b) { if (types.indexOf(b.category) === -1) types.push(b.category); });
    types.sort();
    var list = ordered(allBusinesses()).filter(function (b) {
      var blob = (b.name + " " + b.city + " " + b.category + " " + (b.owner && b.owner.name || "")).toLowerCase();
      if (filters.q && blob.indexOf(filters.q.toLowerCase()) === -1) return false;
      if (filters.type && b.category !== filters.type) return false;
      if (filters.tier && b.tier !== filters.tier) return false;
      if (filters.status && b.status !== filters.status) return false;
      return true;
    });
    function chip(label, status) {
      var on = (filters.status || "") === status;
      return '<a class="chip' + (on ? " on" : "") + '" href="' + clientsHref({ status: status }) + '">' + label + "</a>";
    }
    function options(values, current, allLabel) {
      return '<option value="">' + allLabel + "</option>" + values.map(function (value) {
        var val = Array.isArray(value) ? value[0] : value;
        var label = Array.isArray(value) ? value[1] : value;
        return '<option value="' + esc(val) + '"' + (val === current ? " selected" : "") + ">" + esc(label) + "</option>";
      }).join("");
    }
    var rows = list.map(function (b) {
      var next = nextAction(b);
      return "<tr><td><div class='who'>" + mark(b.name, b.category) + "<div><a href='client.html?id=" + encodeURIComponent(b.id) + "'>" + esc(b.name) +
        "</a><div class='help'>" + esc(b.city) + (b.pilot ? " · Pilot" : "") + "</div></div></div></td><td>" + esc(b.category) + "</td><td>" + esc(b.tier) +
        "</td><td>" + esc(b.plan) + "</td><td>" + pill(b.status) + "</td><td>" + progress(b) + "</td><td>" + esc(next.text) +
        "<div class='help'>" + esc(next.owner) + "</div></td></tr>";
    }).join("");
    view.innerHTML = '<div class="page-head"><div><h1>Businesses</h1><p class="sub">' + list.length + " shown · pinned pilot stays at the top</p></div>" +
      '<a class="btn btn-primary" href="add.html">Add business</a></div>' +
      '<div class="filters"><div class="chips">' + chip("All", "") + chip("Needs attention", "attention") + chip("Waiting on client", "waiting") +
      chip("In setup", "setup") + chip("Live", "live") + "</div>" +
      '<select class="ctrl" style="width:auto" data-action="go-filter" data-key="type" aria-label="Business type">' + options(types, filters.type, "All types") + "</select>" +
      '<select class="ctrl" style="width:auto" data-action="go-filter" data-key="tier" aria-label="Size tier">' + options([["Solo", "Solo · 1–3"], ["Small", "Small · 4–15"], ["Growing", "Growing · 16+"]], filters.tier, "All tiers") + "</select>" +
      (filters.q || filters.type || filters.tier || filters.status ? '<a class="btn btn-sm" href="clients.html">Clear</a>' : "") + "</div>" +
      '<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Business</th><th>Type</th><th>Tier</th><th>Plan</th><th>Status</th><th>Setup</th><th>Next action</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7"><div class="empty">No businesses match these filters.</div></td></tr>') +
      "</tbody></table></div></section>" + legal();
  }

  function readWizard() {
    var root = document.getElementById("view");
    if (!root) return;
    root.querySelectorAll("input[data-field], select[data-field], textarea[data-field]").forEach(function (el) {
      var key = el.dataset.field;
      if (el.type === "checkbox") wizard[key] = el.checked;
      else if (el.type === "radio") { if (el.checked) wizard[key] = el.value; }
      else wizard[key] = el.value;
    });
  }

  function syncNumber() {
    var area = String(wizard.areaCode || "").replace(/\D/g, "").slice(0, 3);
    if (area.length < 3) return;
    wizard.areaCode = area;
    var list = candidates(area);
    if (digits(wizard.chosenNumber).slice(0, 3) !== area) wizard.chosenNumber = list[0];
  }

  function ensureGreeting() {
    if (wizard.greeting && wizard.greeting.trim()) return;
    var name = wizard.name.trim() || "the business";
    wizard.greeting = "Thanks for calling " + name + ". I'm the virtual assistant, and this call may be recorded. I can answer questions, book a time, or reach a person.";
  }

  function choice(field, value, title, detail) {
    var on = wizard[field] === value ? " on" : "";
    return '<button class="choice' + on + '" type="button" data-action="pick" data-field="' + esc(field) + '" data-value="' + esc(value) + '"><b>' +
      esc(title) + "</b><span>" + esc(detail) + "</span></button>";
  }

  function field(label, inner, help) {
    return '<div class="field"><label>' + label + "</label>" + inner + (help ? '<div class="help">' + help + "</div>" : "") + "</div>";
  }

  function input(key, value, placeholder, type) {
    return '<input class="ctrl" data-field="' + key + '" value="' + esc(value || "") + '" placeholder="' + esc(placeholder || "") + '" type="' + (type || "text") + '">';
  }

  function textarea(key, value, placeholder) {
    return '<textarea class="ctrl" data-field="' + key + '" placeholder="' + esc(placeholder || "") + '">' + esc(value || "") + "</textarea>";
  }

  function wizardBody() {
    if (wizard.step === 10) {
      var created = findBiz(wizard.createdId);
      var name = created ? created.name : wizard.name;
      return '<h2>' + esc(name) + ' is in the panel</h2><p class="sub">These steps are simulated in the prototype. The business stays in this browser until you close the tab.</p>' +
        '<div class="banner ok" style="margin-top:12px">Welcome note queued for the owner, with one link per step they still have to do.</div><ul>' +
        "<li>Receptionist created, with the virtual-assistant disclosure in the greeting</li><li>Number " + esc(wizard.chosenNumber) + " attached</li>" +
        "<li>Booking page started</li><li>Texting registration held until the final company tax ID is on file</li>" +
        "<li>Email sender drafted</li><li>Website draft started</li><li>Billing customer created" + (wizard.pilot ? " · pilot, setup fee waived" : "") + "</li></ul>" +
        '<div class="head-actions"><a class="btn btn-primary" href="client.html?id=' + encodeURIComponent(wizard.createdId) + '">Open the business</a>' +
        '<button class="btn" type="button" data-action="reset-wizard">Add another</button><a class="btn" href="dashboard.html">Back to overview</a></div>';
    }
    var error = wizard.error ? '<p class="error">' + esc(wizard.error) + "</p>" : "";
    var body = "";
    if (wizard.step === 0) {
      body = '<div class="grid-2">' + field("Business name", input("name", wizard.name, "Harbor & Rye")) +
        field("City", input("city", wizard.city, "Portland, OR")) + "</div>" +
        '<div class="field"><label>Business type</label><div class="choice-grid">' +
        [["Restaurant", "Tables, takeout, hours"], ["Clinic", "Visits only. No health details on the call."], ["Home services", "Arrival windows and job types"], ["Auto shop", "Diagnostics and service bays"], ["Retail", "Hours, products, and visits"], ["Salon", "Services, stylists, and prices"], ["Studio", "Classes and private sessions"], ["Professional services", "Calls, demos, and follow-up"]].map(function (item) {
          return choice("category", item[0], item[0], item[1]);
        }).join("") + "</div></div>" +
        field("Street address", input("address", wizard.address, "418 Lantern Street")) +
        '<div class="grid-2">' + field("Website", input("website", wizard.website, "example.com")) +
        field("Time zone", '<select class="ctrl" data-field="timezone">' + ["Pacific Time", "Mountain Time", "Central Time", "Eastern Time", "Arizona"].map(function (zone) {
          return '<option' + (wizard.timezone === zone ? " selected" : "") + ">" + zone + "</option>";
        }).join("") + "</select>") + "</div>" +
        field("Hours", input("hours", wizard.hours, "Tue–Sun 4:00 PM – 10:00 PM")) +
        '<div class="grid-2">' + field("Owner name", input("ownerName", wizard.ownerName, "Elena Vasquez")) +
        field("Owner mobile", input("ownerMobile", wizard.ownerMobile, "(503) 555-0172")) + "</div>" +
        field("Owner email", input("ownerEmail", wizard.ownerEmail, "owner@business.example", "email")) +
        (wizard.category === "Clinic" ? '<div class="note">Clinics need a HIPAA agreement before any health details are collected. The receptionist should only book and take messages.</div>' : "");
    } else if (wizard.step === 1) {
      body = '<div class="choice-grid">' +
        choice("tier", "Solo", "Solo · Starter · $199", "1–3 staff · 250 minutes") +
        choice("tier", "Small", "Small · Growth · $399", "4–15 staff · 1,000 minutes · recommended") +
        choice("tier", "Growing", "Growing · Pro · $599", "16+ staff or more than one location") +
        "</div>" +
        '<label class="setting-row"><span><strong>More than one location</strong><div class="help">A second location uses the Growing tier and the Pro plan.</div></span><input data-field="multi" type="checkbox"' + (wizard.multi ? " checked" : "") + "></label>" +
        '<label class="setting-row"><span><strong>Pilot business</strong><div class="help">Setup fee of $299 is waived, and the first 30 days are $0.</div></span><input data-field="pilot" type="checkbox"' + (wizard.pilot ? " checked" : "") + "></label>" +
        '<p class="help">Size tiers are the working proposal: Solo to Starter, Small to Growth, Growing to Pro. Setup is $299 unless this is a pilot.</p>';
    } else if (wizard.step === 2) {
      var numbers = candidates(wizard.areaCode);
      body = '<div class="choice-grid">' +
        choice("phoneMode", "new", "New number", "Callers use a number we buy. Nothing to forward.") +
        choice("phoneMode", "forward", "Forward the current number", "The number on the door stays. Calls roll to the receptionist.") +
        choice("phoneMode", "port", "Move the number to us", "Porting takes days. Forwarding is the usual start.") +
        "</div>" +
        '<div class="field"><label>Area code</label><div class="inline">' + input("areaCode", wizard.areaCode, "415") +
        '<button class="btn" type="button" data-action="show-numbers">Show numbers</button></div><div class="help">Used to list local numbers.</div></div>' +
        '<div class="field"><label>AI receptionist number</label><div class="choice-grid">' + numbers.map(function (num) {
          return choice("chosenNumber", num, num, "Local · voice");
        }).join("") + "</div></div>";
      if (wizard.phoneMode === "forward") {
        body += field("Current business number", input("businessNumber", wizard.businessNumber, "(503) 555-0172")) +
          '<div class="grid-2"><div class="field"><label>Phone company</label><select class="ctrl" data-field="carrier">' +
          [["verizon", "Verizon mobile"], ["att-mobile", "AT&T mobile"], ["att-landline", "AT&T business landline"], ["tmobile", "T-Mobile"], ["other", "Cable, internet, or office system"]].map(function (opt) {
            return '<option value="' + opt[0] + '"' + (wizard.carrier === opt[0] ? " selected" : "") + ">" + opt[1] + "</option>";
          }).join("") + '</select></div><div class="field"><label>What to forward</label><select class="ctrl" data-field="forwardType">' +
          '<option value="missed"' + (wizard.forwardType === "missed" ? " selected" : "") + ">Missed calls only</option>" +
          '<option value="all"' + (wizard.forwardType !== "missed" ? " selected" : "") + ">All calls</option></select></div></div>" +
          '<button class="btn btn-sm" type="button" data-action="lookup-carrier">Not sure — look up the line</button>' +
          (wizard.lookupNote ? '<div class="note calm">' + esc(wizard.lookupNote) + "</div>" : "") +
          codePair(wizard.carrier, wizard.forwardType, wizard.chosenNumber) +
          '<button class="btn" type="button" data-action="send-forward-instructions">Send these instructions to the client</button>';
      } else if (wizard.phoneMode === "port") {
        body += '<div class="note">Forwarding is the recommended start. Porting needs a signed transfer, a bill from the last 30 days, and usually 5 to 15 days. Offer it after a few months, not on day one.</div>' +
          field("Name on the phone bill", input("legalName", wizard.legalName, "Exactly as the carrier has it")) +
          field("Account number", input("taxId", wizard.taxId, "From a recent bill")) +
          '<div class="field"><label>Recent bill</label><input class="ctrl" type="file" data-action="bill-file"></div>';
      } else {
        body += '<div class="note calm">Callers will use ' + esc(wizard.chosenNumber || "the number you pick") + ". Update the website, Google listing, and window once the test call passes.</div>";
      }
    } else if (wizard.step === 3) {
      var target = wizard.phoneMode === "forward" ? (wizard.businessNumber || "the business number") : wizard.chosenNumber;
      var how = wizard.phoneMode === "forward"
        ? (wizard.forwardType === "all" ? "The test calls the business number directly." : "The test lets the business phone ring without anyone answering, then expects the receptionist to pick up.")
        : "The test calls the AI number and checks that the greeting matches.";
      body = "<p>" + esc(how) + "</p><p class='sub'>Target: " + esc(target) + "</p>";
      if (wizard.phoneMode === "forward") {
        body += '<button class="btn" type="button" data-action="client-done">' + (wizard.clientDone ? "Client says done" : "Waiting on the client to dial") + "</button>";
      }
      body += '<div class="head-actions" style="margin-top:12px"><button class="btn btn-primary" type="button" data-action="place-test"' +
        (wizard.testStatus === "calling" ? " disabled" : "") + ">" + (wizard.testStatus === "calling" ? "Calling…" : "Place test call") + "</button>" +
        '<button class="btn" type="button" data-action="place-test-miss">Simulate a miss</button></div>';
      if (wizard.testStatus === "ok") {
        body += '<div class="banner ok">Forwarding or the new number is confirmed. The receptionist answered and the greeting matched.</div><div class="line"><b>Greeting heard</b>' + esc(wizard.greeting || ensurePreviewGreeting()) + "</div>";
      } else if (wizard.testStatus === "miss") {
        body += '<div class="banner bad">Not working. The receptionist did not pick up within about 45 seconds.</div><ul><li>The code was typed wrong.</li><li>It was dialed from a different line.</li><li>This phone company needs its website or app instead of a code.</li></ul>';
      }
    } else if (wizard.step === 4) {
      body = '<div class="choice-grid">' +
        choice("calendar", "google", "Google Calendar", "Owner approves with one sign-in link.") +
        choice("calendar", "microsoft", "Microsoft Outlook", "Some work accounts need an IT admin.") +
        choice("calendar", "cal", "Create a cal.com page", "Free booking page linked to their calendar.") +
        choice("calendar", "square", "Square Appointments", "Works when they pay for Plus or Premium.") +
        choice("calendar", "vagaro", "Vagaro", "Needs their paid plan and a short review.") +
        choice("calendar", "fresha", "Fresha", "No public connection. Text their booking link.") +
        choice("calendar", "booksy", "Booksy", "No public connection. Text their booking link.") +
        "</div>" +
        (wizard.calendar === "fresha" || wizard.calendar === "booksy" ? '<div class="note">The receptionist cannot book inside the call. It texts the business’s own booking link instead.</div>' : '<div class="note calm">After they approve, the panel reads free times, creates a test booking, and deletes it.</div>') +
        '<button class="btn" type="button" data-action="toast-link">Send the calendar sign-in link</button>';
    } else if (wizard.step === 5) {
      ensureGreeting();
      body = field("Greeting", textarea("greeting", wizard.greeting), "Always says it is the virtual assistant, and that the call may be recorded.") +
        field("Hours to quote", input("hours", wizard.hours)) +
        field("Services", textarea("services", wizard.services, "Cut | 45 min | $68"), "One service per line: name, length, and price, separated by |.") +
        field("FAQs", textarea("faqs", wizard.faqs, "Do you take walk-ins? Yes, when a chair is open."), "One question per line. You can also attach a text file.") +
        '<div class="field"><label>FAQ file</label><input class="ctrl" type="file" accept=".txt,.md,.csv,text/plain" data-action="faq-file"></div>' +
        '<div class="grid-2">' + field("Transfer-to number", input("transfer", wizard.transfer || wizard.ownerMobile, "(503) 555-0172")) +
        field("Voice", '<select class="ctrl" data-field="voice">' + ["Juniper (warm)", "Harbor (clear)", "North (calm)", "Sol (bright)"].map(function (voice) {
          return '<option' + (wizard.voice === voice ? " selected" : "") + ">" + esc(voice) + "</option>";
        }).join("") + "</select>") + "</div>" +
        '<label class="setting-row"><span><strong>Spanish as well as English</strong><div class="help">Optional. English is always on.</div></span><input data-field="spanish" type="checkbox"' + (wizard.spanish ? " checked" : "") + "></label>";
      if (wizard.category === "Clinic") body += '<div class="note">Do not collect symptoms, insurance numbers, or other health details on this line.</div>';
    } else if (wizard.step === 6) {
      body = field("Facebook Page", input("facebook", wizard.facebook, "Page name or link")) +
        field("Instagram", input("instagram", wizard.instagram, "@thebusiness")) +
        field("Google Business Profile", input("gbp", wizard.gbp, "Listing name")) +
        '<div class="note calm">The owner approves Facebook, Instagram, and Google themselves. For other businesses’ pages, Meta app review is still required, so early clients can post through a scheduler.</div>' +
        '<button class="btn" type="button" data-action="toast-link">Send social connect links</button>';
    } else if (wizard.step === 7) {
      var templates = ["Restaurant", "Clinic", "Home services", "Auto shop", "Retail", "Salon", "Studio", "Professional services"];
      if (!wizard.template) wizard.template = wizard.category || "Professional services";
      body = '<div class="choice-grid">' + choice("siteChoice", "build", "Build a new site", "One-page template with call, book, and chat.") +
        choice("siteChoice", "keep", "Keep their site", "Point the domain when they control DNS.") + "</div>" +
        field("Domain", input("domain", wizard.domain || wizard.website, "theirbusiness.example")) +
        '<div class="field"><label>Template</label><div class="choice-grid">' + templates.map(function (item) {
          return choice("template", item, item, "Hours, services, and photos from this wizard");
        }).join("") + "</div></div>";
    } else if (wizard.step === 8) {
      var ready = wizard.legalName.trim() && wizard.taxId.trim();
      body = '<div class="banner warn">Texting stays off until the final company tax ID is on file. The legal entity during development is [Placeholder]. Calls can go ahead. Email is used instead of texts.</div>' +
        field("Legal name", input("legalName", wizard.legalName, "Name that will be registered")) +
        field("Tax ID", input("taxId", wizard.taxId, "Collected now, not submitted")) +
        field("Sample text", textarea("sampleSms", wizard.sampleSms)) +
        field("How customers agree", input("consent", wizard.consent, "Number collected at booking")) +
        '<div class="code-card"><strong>Registration status</strong><p>' + pill(ready ? "pending" : "action") +
        "</p><p class='help'>" + (ready ? "Details are saved. Brand and campaign submission waits on the company tax ID." : "Legal name and tax ID are still missing, and submission also waits on the company tax ID.") + "</p>" +
        '<button class="btn btn-sm" type="button" data-action="texting-status">Check status</button></div>';
    } else {
      ensureGreeting();
      var plan = planByName(wizard.plan);
      var rows = [
        ["Business", wizard.name || "Not set"],
        ["Type", wizard.category || "Not set"],
        ["Tier and plan", wizard.tier + " · " + wizard.plan + " · " + money(wizard.pilot ? 0 : (plan ? plan.price : 0)) + (wizard.pilot ? " pilot" : "/mo")],
        ["Setup fee", wizard.pilot ? "$0 · waived" : "$299"],
        ["Phone", wizard.phoneMode === "new" ? "New number " + wizard.chosenNumber : wizard.phoneMode === "port" ? "Port " + (wizard.businessNumber || "") : "Forward " + (wizard.businessNumber || "current number") + " to " + wizard.chosenNumber],
        ["Test call", wizard.testStatus === "ok" ? "Confirmed" : wizard.testStatus === "miss" ? "Not working" : "Not run"],
        ["Calendar", wizard.calendar],
        ["Voice", wizard.voice + (wizard.spanish ? " · English and Spanish" : " · English")],
        ["Website", (wizard.siteChoice === "keep" ? "Keep " : "Build ") + (wizard.domain || wizard.website || "domain not set")],
        ["Texting", "Pending · held for the company tax ID"]
      ];
      body = '<dl class="kvs">' + rows.map(function (row) {
        return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
      }).join("") + "</dl>" +
        '<button class="btn btn-primary" type="button" data-action="create-business">Create business</button>';
    }
    return "<h2>" + esc(STEPS[wizard.step][0]) + "</h2><p class='sub'>" + esc(STEPS[wizard.step][1]) + "</p>" + error + '<div style="margin-top:14px">' + body + "</div>";
  }

  function ensurePreviewGreeting() {
    ensureGreeting();
    return wizard.greeting;
  }

  function renderWizard(view) {
    view = view || document.getElementById("view");
    if (!view) return;
    var steps = STEPS.map(function (step, index) {
      return '<button class="step-btn' + (index === wizard.step || (wizard.step === 10 && index === 9) ? " on" : "") + '" type="button" data-action="goto-step" data-step="' + index + '"><i>' + (index + 1) + "</i><span>" + esc(step[0]) + "</span></button>";
    }).join("");
    var nav = wizard.step === 10 ? "" : '<div class="wizard-nav"><button class="btn" type="button" data-action="back"' + (wizard.step === 0 ? " disabled" : "") + '>Back</button>' +
      (wizard.step < 9 ? '<button class="btn btn-primary" type="button" data-action="next">Continue</button>' : "<span></span>") + "</div>";
    view.innerHTML = '<div class="page-head"><div><h1>Add business</h1><p class="sub">About ten minutes. The owner only handles the steps a phone company or Google requires.</p></div></div>' +
      '<div class="wizard"><aside class="step-list">' + steps + '</aside><section class="wizard-panel">' + wizardBody() + nav + "</section></div>" + legal();
  }

  function slug(name) {
    var base = String(name || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
    var id = base;
    var n = 2;
    while (findBiz(id)) id = base + "-" + (n++);
    return id;
  }

  function parseServices(text) {
    var rows = String(text || "").split("\n").map(function (line) {
      var parts = line.split("|").map(function (part) { return part.trim(); });
      if (!parts[0]) return null;
      return { name: parts[0], length: parts[1] || "—", price: parts[2] || "—" };
    }).filter(Boolean);
    return rows.length ? rows : [{ name: "Appointment", length: "30 min", price: "—" }];
  }

  function parseFaqs(text) {
    var lines = String(text || "").split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return [{ q: "What are your hours?", a: wizard.hours || "See the business hours." }];
    return lines.map(function (line) {
      var parts = line.split("?");
      if (parts.length > 1 && parts[0]) return { q: parts[0].trim() + "?", a: parts.slice(1).join("?").trim() || "We'll answer that on the call." };
      return { q: line, a: "We'll answer that on the call." };
    });
  }

  function makeChecklist(map) {
    var defs = [["number", "AI number"], ["test", "Receptionist test call"], ["forwarding", "Forwarding"], ["calendar", "Calendar"], ["texting", "Texting registration"], ["email", "Email domain"], ["reviews", "Google review link"], ["gbp", "Google Business Profile"], ["social", "Facebook and Instagram"], ["website", "Website"], ["billing", "Billing"]];
    return defs.map(function (def) {
      var row = map[def[0]] || { status: "pending", detail: "Not started", owner: "Team" };
      return { key: def[0], label: def[1], status: row.status, detail: row.detail, owner: row.owner, next: row.next };
    });
  }

  function buildBusiness() {
    ensureGreeting();
    syncNumber();
    var plan = planByName(wizard.plan);
    var id = slug(wizard.name.trim());
    var textReady = wizard.legalName.trim() && wizard.taxId.trim();
    var testStatus = wizard.testStatus === "ok" ? "connected" : wizard.testStatus === "miss" ? "action" : "pending";
    var forwardStatus = "pending";
    var forwardDetail = "Waiting on the client to dial the code.";
    if (wizard.phoneMode === "new") {
      forwardStatus = "connected";
      forwardDetail = "Not used. Callers use the new number " + wizard.chosenNumber + ".";
    } else if (wizard.phoneMode === "port") {
      forwardDetail = "Port packet started. Forwarding is still the faster path if they want calls live this week.";
    } else if (wizard.testStatus === "ok") {
      forwardStatus = "connected";
      forwardDetail = "Test call reached the receptionist.";
    } else if (wizard.testStatus === "miss") {
      forwardStatus = "action";
      forwardDetail = "Test call did not reach the receptionist.";
    }
    var staff = wizard.tier === "Solo" ? 2 : wizard.tier === "Growing" ? 18 : 8;
    return {
      id: id,
      name: wizard.name.trim(),
      category: wizard.category,
      city: wizard.city || "—",
      address: wizard.address || "—",
      website: wizard.domain || wizard.website || id + ".example",
      hours: wizard.hours,
      timezone: wizard.timezone,
      staff: staff,
      locations: wizard.multi ? 2 : 1,
      tier: wizard.tier,
      plan: wizard.plan,
      price: plan ? plan.price : 399,
      minutesCap: plan ? plan.minutes : 1000,
      minutesUsed: 0,
      texts: 0,
      callsToday: 0,
      bookingsToday: 0,
      status: "setup",
      pilot: !!wizard.pilot,
      setupFee: wizard.pilot ? 0 : 299,
      card: wizard.pilot ? "Pilot · no card charged" : "Payment link not sent",
      nextInvoice: wizard.pilot ? "Pilot · $0 for 30 days" : "Payment link not sent",
      trial: wizard.pilot ? "Day 1 of 30 · $0" : "None",
      owner: {
        name: wizard.ownerName || "Owner",
        mobile: wizard.ownerMobile || "",
        email: wizard.ownerEmail || ""
      },
      phone: {
        mode: wizard.phoneMode,
        carrier: wizard.carrier,
        forwardType: wizard.forwardType,
        businessNumber: wizard.businessNumber,
        aiNumber: wizard.chosenNumber,
        tests: wizard.testStatus === "idle" ? [] : [{ when: "Just now", result: wizard.testStatus === "ok" ? "Confirmed" : "Not working", note: wizard.testNote || "Run from the add-business wizard." }]
      },
      greeting: wizard.greeting,
      voice: wizard.voice,
      languages: wizard.spanish ? ["English", "Spanish"] : ["English"],
      transfer: wizard.transfer || wizard.ownerMobile || "",
      capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
      services: parseServices(wizard.services),
      faqs: parseFaqs(wizard.faqs),
      blurb: wizard.name.trim() + " · " + wizard.category,
      template: wizard.template || wizard.category,
      domainStatus: "Draft only. Domain not checked yet.",
      reviewLink: "",
      socialAccounts: { facebook: wizard.facebook, instagram: wizard.instagram, gbp: wizard.gbp },
      bookings: [],
      calls: [],
      reviews: [],
      posts: [],
      campaigns: [],
      contacts: 0,
      suppressed: 0,
      activity: [{ time: "Just now", text: "Added in the control panel." }],
      checklist: makeChecklist({
        number: { status: "connected", detail: wizard.chosenNumber + " is attached to the receptionist.", owner: "Team" },
        test: { status: testStatus, detail: testStatus === "connected" ? "Greeting matched." : testStatus === "action" ? "Test call did not match." : "Test call has not been run.", owner: "Team" },
        forwarding: { status: forwardStatus, detail: forwardDetail, owner: wizard.phoneMode === "forward" ? "Client" : "Team", next: forwardStatus !== "connected" },
        calendar: { status: "pending", detail: wizard.calendar === "cal" ? "cal.com page drafted. Connect a calendar before going live." : "Sign-in link is ready to send.", owner: "Client" },
        texting: { status: textReady ? "pending" : "action", detail: "Texting stays off until the final company tax ID is on file.", owner: "Team", next: forwardStatus === "connected" },
        email: { status: "pending", detail: "SPF and DKIM are not checked yet.", owner: "Team" },
        reviews: { status: "pending", detail: "Google review link is not on file.", owner: "Team" },
        gbp: { status: "pending", detail: wizard.gbp ? "Listing noted: " + wizard.gbp + ". Access is not confirmed." : "Listing not provided.", owner: "Client" },
        social: { status: "pending", detail: "Facebook and Instagram are not connected yet.", owner: "Client" },
        website: { status: "pending", detail: wizard.siteChoice === "keep" ? "Waiting on the domain record." : "Template selected. Not published.", owner: "Team" },
        billing: { status: wizard.pilot ? "connected" : "pending", detail: wizard.pilot ? "$0 pilot. Setup fee waived." : "Payment link has not been sent.", owner: wizard.pilot ? "Team" : "Client" }
      })
    };
  }

  function currentTab() {
    var hash = (location.hash || "#overview").replace("#", "");
    for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === hash) return hash;
    return "overview";
  }

  function stars(n) {
    var full = "★★★★★".slice(0, n);
    var empty = "☆☆☆☆☆".slice(0, 5 - n);
    return full + empty;
  }

  function tabOverview(b) {
    var alerts = (b.checklist || []).filter(function (item) { return item.status === "action"; }).map(function (item) {
      return "<div class='setting-row'><div><strong>" + esc(item.label) + "</strong><div class='help'>" + esc(item.detail) + "</div></div>" + pill("action") + "</div>";
    }).join("");
    if (b.minutesCap && b.minutesUsed / b.minutesCap >= 0.8) {
      alerts += "<div class='setting-row'><div><strong>Minutes</strong><div class='help'>" + b.minutesUsed + " of " + b.minutesCap + " used.</div></div>" + pill("pending") + "</div>";
    }
    var checks = (b.checklist || []).map(function (item) {
      var open = openCheck === item.key;
      return '<div class="check"><button class="check-top" type="button" data-action="toggle-check" data-key="' + esc(item.key) + '"><b>' + esc(item.label) +
        "</b>" + pill(item.status) + "</button>" + (open ? '<div class="check-body"><p>' + esc(item.detail) + '</p><p class="help">Owner: ' + esc(item.owner) + "</p>" +
        checkAction(b, item) + "</div>" : "") + "</div>";
    }).join("");
    var activity = (b.activity || []).map(function (item) {
      return "<div class='setting-row'><div>" + esc(item.text) + "</div><span class='help'>" + esc(item.time) + "</span></div>";
    }).join("") || '<div class="empty">No activity yet.</div>';
    var facts = [
      ["Owner", (b.owner && b.owner.name) || "—"],
      ["Mobile", (b.owner && b.owner.mobile) || "—"],
      ["Email", (b.owner && b.owner.email) || "—"],
      ["Address", b.address || "—"],
      ["Hours", b.hours || "—"],
      ["Staff", (b.staff || "—") + " · " + (b.locations || 1) + " location" + ((b.locations || 1) > 1 ? "s" : "")],
      ["Plan", b.tier + " · " + b.plan + " · " + (b.pilot ? "$0 pilot" : money(b.price) + "/mo")]
    ];
    return minuteBanner(b) + '<div class="split"><section class="card"><div class="card-h"><h2>Setup checklist</h2><span class="help">' + setupCount(b).done + " of " + setupCount(b).total + ' connected</span></div><div class="card-b checklist">' +
      checks + '</div></section><div class="stack"><section class="card"><div class="card-h"><h2>Needs action</h2></div><div class="card-b">' + (alerts || '<div class="empty">Nothing is blocked.</div>') +
      '</div></section><section class="card"><div class="card-h"><h2>Activity</h2></div><div class="card-b">' + activity +
      '</div></section><section class="card"><div class="card-h"><h2>Business</h2></div><div class="card-b"><dl class="kvs">' + facts.map(function (row) {
        return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
      }).join("") + "</dl></div></section></div></div>" + phonePanel(b);
  }

  function checkAction(b, item) {
    var id = esc(b.id);
    if (item.key === "test") return '<button class="btn btn-sm" type="button" data-action="run-greeting-test" data-id="' + id + '">Run test call</button>';
    if (item.key === "forwarding") return '<button class="btn btn-sm" type="button" data-action="forward-test" data-id="' + id + '">Run forwarding test</button>';
    if (item.key === "calendar") return '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + id + '" data-kind="calendar">Send sign-in link</button> <button class="btn btn-sm" type="button" data-action="booking-test" data-id="' + id + '">Run booking test</button>';
    if (item.key === "texting") return '<button class="btn btn-sm" type="button" data-action="texting-status">Check registration</button>';
    if (item.key === "email") return '<button class="btn btn-sm" type="button" data-action="check-email" data-id="' + id + '">Check DNS records</button>';
    if (item.key === "reviews") return '<button class="btn btn-sm" type="button" data-action="open-review" data-id="' + id + '">Review link</button>';
    if (item.key === "gbp" || item.key === "social") return '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + id + '" data-kind="social">Send connect link</button>';
    if (item.key === "website") return '<button class="btn btn-sm" type="button" data-action="check-domain" data-id="' + id + '">Check domain</button>';
    if (item.key === "billing") return '<button class="btn btn-sm" type="button" data-action="payment-link" data-id="' + id + '">Send payment link</button>';
    if (item.key === "number") return '<button class="btn btn-sm" type="button" data-action="call-receptionist" data-id="' + id + '">Call the number</button>';
    return "";
  }

  function phonePanel(b) {
    var phone = b.phone || {};
    var tests = (phone.tests || []).map(function (test) {
      return "<tr><td>" + esc(test.when) + "</td><td>" + esc(test.result) + "</td><td>" + esc(test.note) + "</td></tr>";
    }).join("");
    var codes = "";
    if (phone.mode === "forward") {
      codes = codePair(phone.carrier || "verizon", phone.forwardType || "missed", phone.aiNumber) +
        '<button class="btn btn-sm" type="button" data-action="send-forward-live" data-id="' + esc(b.id) + '">Send instructions to the client</button> ';
    } else if (phone.mode === "port") {
      codes = '<div class="note">Porting is in progress. Keep forwarding until the number moves, so the business does not miss calls.</div>';
    } else {
      codes = '<div class="note calm">This business publishes the new number ' + esc(phone.aiNumber || "") + ". No forwarding code is required.</div>";
    }
    return '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Phone and forwarding</h2><span class="help">' + esc(phoneStatus(b)) + '</span></div><div class="card-b">' +
      '<dl class="kvs"><dt>AI number</dt><dd>' + esc(phone.aiNumber || "—") + "</dd><dt>Business number</dt><dd>" + esc(phone.businessNumber || "—") + "</dd><dt>Mode</dt><dd>" +
      esc(phone.mode === "forward" ? "Forward existing number" : phone.mode === "port" ? "Port the number" : "New number") + "</dd></dl>" + codes +
      '<button class="btn btn-sm btn-primary" type="button" data-action="forward-test" data-id="' + esc(b.id) + '">Run forwarding test</button>' +
      '<div class="table-wrap" style="margin-top:10px"><table class="data"><thead><tr><th>When</th><th>Result</th><th>Note</th></tr></thead><tbody>' +
      (tests || '<tr><td colspan="3"><div class="empty">No test calls yet.</div></td></tr>') + "</tbody></table></div></div></section>";
  }

  function minuteBanner(b) {
    if (!b.minutesCap) return "";
    var pct = b.minutesUsed / b.minutesCap;
    if (pct >= 1) return '<div class="banner bad">100% of the ' + b.minutesCap + "-minute cap is used. An overage price is not set yet.</div>";
    if (pct >= 0.8) return '<div class="banner warn">' + Math.round(pct * 100) + "% of the minute cap is used (" + b.minutesUsed + " of " + b.minutesCap + "). Warnings start at 80% and 100%. An overage price is not set yet.</div>";
    return "";
  }

  function tabReceptionist(b) {
    var caps = b.capabilities || {};
    var capRow = ["book", "reschedule", "cancel", "transfer", "textLink"].map(function (key) {
      var labels = { book: "Book", reschedule: "Reschedule", cancel: "Cancel", transfer: "Transfer", textLink: "Text a booking link" };
      return '<label class="setting-row"><span>' + labels[key] + '</span><input type="checkbox" data-action="cap-toggle" data-id="' + esc(b.id) + '" data-cap="' + key + '"' + (caps[key] ? " checked" : "") + (key === "textLink" ? " disabled" : "") + "></label>";
    }).join("");
    var calls = (b.calls || []).map(function (call, index) {
      var open = openCall === String(index);
      return '<div class="call"><button class="call-top" type="button" data-action="toggle-call" data-key="' + index + '"><span><strong>' + esc(call.time) + "</strong> · " + esc(call.from) +
        "<div class='help'>" + esc(call.summary) + "</div></span><span>" + pill(call.outcome === "Booked" ? "connected" : call.flag ? "action" : "neutral") + "</span></button>" +
        (open ? '<div class="transcript">' + (call.lines || []).map(function (line) {
          return '<div class="line"><b>' + esc(line[0]) + "</b>" + esc(line[1]) + "</div>";
        }).join("") + '<div class="help">Recording sample · kept 90 days. ' + esc(call.duration) + (call.flag ? " · " + esc(call.flag) : "") + "</div>" +
        '<button class="btn btn-sm" type="button" data-action="play-call">Play recording</button><div class="scrub"><i></i></div></div>' : "") + "</div>";
    }).join("") || '<div class="empty">No calls yet.</div>';
    return '<div class="split"><section class="card"><div class="card-h"><h2>Receptionist</h2><span class="pill neutral">Draft until you publish</span></div><div class="card-b">' +
      '<div class="field"><label>Greeting</label><textarea class="ctrl" id="greet">' + esc(b.greeting) + "</textarea></div>" +
      '<div class="field"><label>Voice</label><select class="ctrl" id="voice">' + ["Juniper (warm)", "Harbor (clear)", "North (calm)", "Sol (bright)"].map(function (voice) {
        return "<option" + (b.voice === voice ? " selected" : "") + ">" + esc(voice) + "</option>";
      }).join("") + "</select></div>" +
      '<p class="help">Languages: ' + esc((b.languages || ["English"]).join(", ")) + ". The assistant always offers a person.</p>" +
      capRow + '<p class="help">Texting a link stays off until registration is approved.</p>' +
      '<div class="head-actions"><button class="btn" type="button" data-action="save-draft" data-id="' + esc(b.id) + '">Save draft</button>' +
      '<button class="btn btn-primary" type="button" data-action="publish-receptionist" data-id="' + esc(b.id) + '">Publish</button>' +
      '<button class="btn" type="button" data-action="run-greeting-test" data-id="' + esc(b.id) + '">Test call</button></div>' +
      "<h3 style='margin:16px 0 8px'>Services and FAQs</h3><ul>" + (b.services || []).map(function (service) {
        return "<li>" + esc(service.name) + " · " + esc(service.length) + " · " + esc(service.price) + "</li>";
      }).join("") + "</ul>" + (b.faqs || []).map(function (faq) {
        return "<p><strong>" + esc(faq.q) + "</strong><br>" + esc(faq.a) + "</p>";
      }).join("") + '</div></section><section class="card"><div class="card-h"><h2>Call log</h2></div><div class="card-b">' + calls + "</div></section></div>";
  }

  function tabBookings(b) {
    var rows = (b.bookings || []).map(function (booking) {
      return "<tr><td>" + esc(booking.when) + "</td><td>" + esc(booking.customer) + "</td><td>" + esc(booking.service) + "</td><td>" + esc(booking.source) + "</td><td>" + esc(booking.status) + "</td></tr>";
    }).join("");
    return '<div class="head-actions" style="margin-bottom:12px"><button class="btn btn-primary" type="button" data-action="booking-test" data-id="' + esc(b.id) + '">Run booking test</button>' +
      '<button class="btn" type="button" data-action="send-link" data-id="' + esc(b.id) + '" data-kind="calendar">Send calendar link</button></div>' +
      '<section class="card"><div class="card-h"><h2>Upcoming</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Source</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5"><div class="empty">No upcoming bookings.</div></td></tr>') + "</tbody></table></div></section>";
  }

  function tabReviews(b) {
    var cards = (b.reviews || []).map(function (review, index) {
      return '<article class="card" style="margin-bottom:10px"><div class="card-b"><strong>' + esc(review.author) + '</strong> <span class="stars">' + stars(review.stars) + "</span>" +
        '<div class="help">' + esc(review.when) + "</div><p>" + esc(review.text) + "</p>" +
        '<div class="field"><label>Draft reply</label><textarea class="ctrl" data-draft="' + index + '">' + esc(review.draft) + "</textarea></div>" +
        (review.posted ? '<span class="pill connected">Posted</span>' : '<button class="btn btn-primary btn-sm" type="button" data-action="approve-review" data-id="' + esc(b.id) + '" data-index="' + index + '">Approve and post</button>') +
        "</div></article>";
    }).join("") || '<div class="card"><div class="empty">No reviews yet. Each customer gets the same request. Unhappy customers are not filtered out.</div></div>';
    return '<div class="banner ok">The same request goes to every customer. ReceptWise does not ask “were you happy?” first, and it does not offer rewards for reviews.</div>' +
      '<div class="split"><section class="card"><div class="card-b"><h2>Review link</h2><p class="help">' + esc(b.reviewLink || "No link on file yet.") + "</p>" +
      '<div class="head-actions"><button class="btn btn-sm" type="button" data-action="open-review" data-id="' + esc(b.id) + '">Open link</button>' +
      '<button class="btn btn-sm" type="button" data-action="copy-code" data-code="' + esc(b.reviewLink || "") + '">Copy</button></div>' +
      '<div class="qr" aria-hidden="true"></div><p class="help">Sample code for the review link. Send after the visit, one reminder at most.</p>' +
      '<label class="setting-row"><span>Send after each completed visit</span><button class="switch on" type="button" data-action="toggle-local" aria-pressed="true"><i></i></button></label>' +
      '<label class="setting-row"><span>One reminder</span><button class="switch on" type="button" data-action="toggle-local" aria-pressed="true"><i></i></button></label>' +
      "</div></section><div>" + cards + "</div></div>";
  }

  function tabSocial(b) {
    var accounts = b.socialAccounts || {};
    function row(label, value) {
      var connected = !!value;
      return "<div class='setting-row'><div><strong>" + label + "</strong><div class='help'>" + esc(connected ? "Read back: " + value : "Not connected") + "</div></div>" +
        (connected ? pill("connected") : '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + esc(b.id) + '" data-kind="social">Connect</button>') + "</div>";
    }
    var posts = (b.posts || []).map(function (post) {
      return "<tr><td>" + esc(post.when) + "</td><td>" + esc(post.channel) + "</td><td>" + esc(post.text) + "</td><td>" + esc(post.status) + "</td></tr>";
    }).join("");
    return '<section class="card" style="margin-bottom:12px"><div class="card-b">' + row("Facebook", accounts.facebook) + row("Instagram", accounts.instagram) + row("Google Business Profile", accounts.gbp) +
      '<button class="btn" type="button" data-action="new-post" data-id="' + esc(b.id) + '">New draft</button></div></section>' +
      '<section class="card"><div class="card-h"><h2>Posts</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Channel</th><th>Post</th><th>Status</th></tr></thead><tbody>' +
      (posts || '<tr><td colspan="4"><div class="empty">No posts yet.</div></td></tr>') + "</tbody></table></div></section>";
  }

  function tabWebsite(b) {
    return '<div class="split"><div class="browser"><div class="browser-bar"><i></i><i></i><i></i><span class="url">' + esc(b.website || "draft") + '</span></div><div class="mini-site"><strong>' +
      esc(b.name) + "</strong><p>" + esc(b.blurb || b.category) + "</p><p class='help'>" + esc(b.hours || "") + "</p><div class='mini-actions'><span class='btn btn-sm'>Call</span><span class='btn btn-sm btn-primary'>Book</span></div></div></div>" +
      '<section class="card"><div class="card-b"><h2>' + esc(b.template || "Template") + " template</h2><p class='sub'>" + esc(b.domainStatus || "") + "</p>" +
      '<div class="head-actions" style="margin-top:12px"><button class="btn btn-primary" type="button" data-action="publish-site" data-id="' + esc(b.id) + '">Publish</button>' +
      '<button class="btn" type="button" data-action="check-domain" data-id="' + esc(b.id) + '">Check domain</button>' +
      '<button class="btn" type="button" data-action="toast-chat" data-id="' + esc(b.id) + '">Chat button settings</button></div>' +
      "<p class='help'>Click-to-call uses " + esc((b.phone && b.phone.aiNumber) || "the AI number") + ". Book opens the calendar. Chat is the website widget.</p></div></section></div>";
  }

  function tabOutreach(b) {
    var rows = (b.campaigns || []).map(function (campaign) {
      return "<tr><td>" + esc(campaign.name) + "</td><td>" + esc(campaign.channel) + "</td><td>" + esc(campaign.when) + "</td><td>" + campaign.sent + "</td><td>" + campaign.clicked + "</td><td>" + campaign.bookings + "</td><td>" + esc(campaign.status) + "</td></tr>";
    }).join("");
    return '<div class="note">Only people who gave this business their email or number, with the date and source recorded. Emails include an unsubscribe link and the business’s postal address. Text replies of STOP are honored immediately. Texts stay off until registration is approved.</div>' +
      '<div class="head-actions" style="margin:12px 0"><button class="btn" type="button" data-action="import-contacts" data-id="' + esc(b.id) + '">Import customers</button>' +
      '<button class="btn" type="button" data-action="new-campaign">New campaign</button>' +
      '<button class="btn btn-primary" type="button" data-action="test-send">Send a test</button></div>' +
      '<p class="help">' + (b.contacts || 0) + " contacts · " + (b.suppressed || 0) + " suppressed</p>" +
      '<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Campaign</th><th>Channel</th><th>When</th><th>Sent</th><th>Clicked</th><th>Bookings</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7"><div class="empty">No campaigns yet.</div></td></tr>') + "</tbody></table></div></section>";
  }

  function tabBilling(b) {
    var cost = estimate(b);
    return minuteBanner(b) + '<div class="split"><section class="card"><div class="card-b"><h2>' + esc(b.plan) + "</h2><p class='sub'>" + esc(b.tier) + " · " + (b.pilot ? "Pilot, $0" : money(b.price) + " a month") + "</p>" +
      '<dl class="kvs" style="margin-top:12px"><dt>Setup fee</dt><dd>' + (b.setupFee ? money(b.setupFee) : "$0 waived") + "</dd><dt>Trial</dt><dd>" + esc(b.trial || "None") +
      "</dd><dt>Next invoice</dt><dd>" + esc(b.nextInvoice || "—") + "</dd><dt>Card</dt><dd>" + esc(b.card || "—") + "</dd><dt>Minutes</dt><dd>" + minuteCell(b) + "</dd></dl>" +
      '<button class="btn" type="button" data-action="payment-link" data-id="' + esc(b.id) + '">Send card update link</button></div></section>' +
      '<section class="card"><div class="card-h"><h2>Our cost this month</h2><span class="help">Estimate</span></div><div class="card-b"><dl class="kvs">' +
      "<dt>AI minutes</dt><dd>" + money2(cost.minutes) + "</dd><dt>Phone number</dt><dd>" + money2(cost.number) + "</dd><dt>Texts</dt><dd>" + money2(cost.texts) +
      "</dd><dt>Card fees</dt><dd>" + money2(cost.stripe) + "</dd><dt>Total cost</dt><dd>" + money2(cost.total) + "</dd><dt>What we keep</dt><dd>" + money2(cost.keep) +
      "</dd></dl><p class='help'>Minutes at about $0.125. Number at $2. Card fees at 2.9% + 30¢ plus 0.7% for subscriptions. Texting fees stay at $0 until registration is on.</p></div></section></div>";
  }

  function tabSettings(b) {
    return '<section class="card"><div class="card-b"><div class="grid-2">' +
      '<div class="field"><label>Hours</label><input class="ctrl" data-set="hours" value="' + esc(b.hours || "") + '"></div>' +
      '<div class="field"><label>Time zone</label><input class="ctrl" data-set="timezone" value="' + esc(b.timezone || "") + '"></div>' +
      '<div class="field"><label>Transfer-to number</label><input class="ctrl" data-set="transfer" value="' + esc(b.transfer || "") + '"></div>' +
      '<div class="field"><label>Owner mobile</label><input class="ctrl" data-set="mobile" value="' + esc((b.owner && b.owner.mobile) || "") + '"></div></div>' +
      '<label class="setting-row"><span><strong>Pause the receptionist</strong><div class="help">Calls would ring the transfer number instead. Sample only.</div></span>' +
      '<button class="switch' + (b.paused ? " on" : "") + '" type="button" data-action="pause-biz" data-id="' + esc(b.id) + '" aria-pressed="' + (b.paused ? "true" : "false") + '"><i></i></button></label>' +
      '<div class="head-actions"><button class="btn btn-primary" type="button" data-action="save-business" data-id="' + esc(b.id) + '">Save settings</button></div></div></section>';
  }

  function renderClient(view) {
    view = view || document.getElementById("view");
    if (!view) return;
    var params = new URLSearchParams(location.search);
    var b = findBiz(params.get("id"));
    var title = document.getElementById("top-title");
    if (!b) {
      if (title) title.textContent = "Business";
      view.innerHTML = '<div class="card"><div class="empty">That business is not in the sample data. <a href="clients.html">Back to businesses</a></div></div>' + legal();
      return;
    }
    if (title) title.textContent = b.name;
    document.title = b.name + " · ReceptWise";
    var tab = currentTab();
    var tabs = TABS.map(function (item) {
      return '<a class="tab' + (item[0] === tab ? " on" : "") + '" href="#' + item[0] + '">' + item[1] + "</a>";
    }).join("");
    var body = tab === "receptionist" ? tabReceptionist(b)
      : tab === "bookings" ? tabBookings(b)
      : tab === "reviews" ? tabReviews(b)
      : tab === "social" ? tabSocial(b)
      : tab === "website" ? tabWebsite(b)
      : tab === "outreach" ? tabOutreach(b)
      : tab === "billing" ? tabBilling(b)
      : tab === "settings" ? tabSettings(b)
      : tabOverview(b);
    view.innerHTML = '<section class="card client-head"><div class="client-ident"><div class="avatar" style="background:' + colorFor(b.category) + '">' + esc(initials(b.name)) +
      "</div><div><h1 class='client-title'>" + esc(b.name) + "</h1><p class='sub'>" + esc(b.category) + " · " + esc(b.city) + " · " + esc((b.owner && b.owner.name) || "") +
      "</p><div class='pills'>" + pill(b.status) + '<span class="pill neutral">' + esc(b.plan) + "</span>" + (b.pilot ? '<span class="pill pilot">Pilot</span>' : "") + "</div></div></div>" +
      '<div class="head-actions"><button class="btn" type="button" data-action="call-receptionist" data-id="' + esc(b.id) + '">Call the receptionist</button>' +
      '<button class="btn btn-primary" type="button" data-action="send-steps" data-id="' + esc(b.id) + '">Send owner their steps</button></div></section>' +
      '<nav class="tabs">' + tabs + "</nav>" + body + legal();
  }

  function renderBilling(view) {
    var plans = window.RW_DATA.plans || [];
    var cards = plans.map(function (plan) {
      return '<article class="card plan' + (plan.recommended ? " rec" : "") + '">' + (plan.recommended ? '<span class="ribbon pill pilot">Recommended</span>' : "") +
        "<p class='help'>" + esc(plan.tier) + " · " + esc(plan.staff) + "</p><h2>" + esc(plan.name) + "</h2><div class='price'>" + money(plan.price) + "<span>/mo</span></div>" +
        "<p class='help'>" + plan.minutes.toLocaleString() + " call minutes</p><ul>" + plan.features.map(function (feature) {
          return "<li>" + esc(feature) + "</li>";
        }).join("") + "</ul></article>";
    }).join("");
    var rows = ordered(allBusinesses()).map(function (b) {
      var cost = estimate(b);
      return "<tr><td><a href='client.html?id=" + encodeURIComponent(b.id) + "#billing'>" + esc(b.name) + "</a>" + (b.pilot ? " <span class='pill pilot'>Pilot</span>" : "") +
        "</td><td>" + esc(b.tier) + "</td><td>" + esc(b.plan) + "</td><td>" + money(b.pilot ? 0 : b.price) + "</td><td>" + minuteCell(b) +
        "</td><td>" + money2(cost.total) + "</td><td>" + money2(cost.keep) + "</td></tr>";
    }).join("");
    var roll = allBusinesses().reduce(function (sum, b) {
      var cost = estimate(b);
      sum.revenue += cost.price;
      sum.cost += cost.total;
      return sum;
    }, { revenue: 0, cost: 0 });
    view.innerHTML = '<div class="page-head"><div><h1>Billing and plans</h1><p class="sub">Setup is $299 once, waived for pilots. The first 30 days of a pilot are $0.</p></div></div>' +
      '<div class="plan-grid">' + cards + "</div>" +
      '<div class="note">Social posting and website builds are part of the pilot work. A separate price for them is not set yet. Minute overage pricing is not set yet either. Admins can see cost and what we keep. Team members would not see this rollup.</div>' +
      '<section class="stats"><article class="stat"><em>Revenue this month</em><b>' + money(roll.revenue) + "</b><span>Pilots at $0</span></article>" +
      '<article class="stat"><em>Estimated cost</em><b>' + money(roll.cost) + "</b><span>Minutes, numbers, and card fees</span></article>" +
      '<article class="stat"><em>What we keep</em><b>' + money(roll.revenue - roll.cost) + "</b><span>Before fixed tools</span></article>" +
      '<article class="stat"><em>Texting</em><b>Off</b><span>Waiting on the company tax ID</span></article></section>' +
      '<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Business</th><th>Tier</th><th>Plan</th><th>Price</th><th>Minutes</th><th>Est. cost</th><th>We keep</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section>" + legal();
  }

  function prefs() {
    var defaults = { weekly: true, minutes: true, report: true, approve: true };
    try { return Object.assign(defaults, JSON.parse(storageGet("rw_prefs") || "{}")); }
    catch (e) { return defaults; }
  }

  function renderTeam(view) {
    var invites = [];
    try { invites = JSON.parse(storageGet("rw_invites") || "[]"); } catch (e) { invites = []; }
    var people = (window.RW_DATA.team || []).concat(invites);
    var rows = people.map(function (person) {
      return "<tr><td><div class='who'><span class='who-mark' style='background:#0e7c72'>" + esc(initials(person.name)) + "</span><div><strong>" + esc(person.name) +
        "</strong><div class='help'>" + esc(person.email) + "</div></div></div></td><td>" + esc(person.role) + "</td><td>" + esc(person.scope) + "</td></tr>";
    }).join("");
    var switches = [
      ["weekly", "Re-check forwarding once a week"],
      ["minutes", "Warn at 80% and 100% of minutes"],
      ["report", "Email owners a one-page monthly report"],
      ["approve", "Hold review replies until someone approves them"]
    ].map(function (item) {
      var on = prefs()[item[0]];
      return '<div class="setting-row"><span>' + item[1] + '</span><button class="switch' + (on ? " on" : "") + '" type="button" data-action="toggle-switch" data-key="' + item[0] + '" aria-pressed="' + (on ? "true" : "false") + '"><i></i></button></div>';
    }).join("");
    var tools = ["Retell for the receptionist and numbers", "Twilio later, for texting", "cal.com and Google or Microsoft calendars", "Resend for email", "Buffer for social posts", "Cloudflare Pages for websites", "Stripe for subscriptions"].map(function (tool) {
      return "<div class='setting-row'><span>" + tool + "</span><span class='pill pending'>Not connected in this prototype</span></div>";
    }).join("");
    view.innerHTML = '<div class="page-head"><div><h1>Team and settings</h1><p class="sub">You are signed in as an admin, so billing costs are visible.</p></div>' +
      '<button class="btn btn-primary" type="button" data-action="invite-open">Invite teammate</button></div>' +
      '<div class="split"><section class="card"><div class="card-h"><h2>Team</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Role</th><th>Access</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section><div class='stack'><section class='card'><div class='card-h'><h2>Company</h2></div><div class='card-b'><dl class='kvs'>" +
      "<dt>Legal entity</dt><dd>[Placeholder]</dd><dt>Product</dt><dd>ReceptWise</dd><dt>Texting</dt><dd>Off until the final company tax ID is on file</dd><dt>Calls</dt><dd>Can be set up now</dd></dl></div></section>" +
      '<section class="card"><div class="card-h"><h2>Notifications</h2></div><div class="card-b">' + switches + "</div></section></div></div>" +
      '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Planned connections</h2></div><div class="card-b">' + tools + "</div></section>" + legal();
  }

  function renderLogin() {
    if (session()) {
      location.replace("dashboard.html");
      return;
    }
    document.getElementById("app").innerHTML = '<div class="login"><section class="login-brand"><div class="brand"><img class="brand-mark" src="assets/favicon.svg" alt=""><div><div class="brand-name">Recept<span>Wise</span></div><div class="brand-sub">Control panel</div></div></div>' +
      "<h1>Set up a local business without leaving the panel.</h1><p>Phone, receptionist, calendar, reviews, social, and website. One monthly bill for the owner.</p><ul>" +
      "<li>Answer calls, book the open time, and hand off when someone asks for a person</li><li>Forward the number already on the door, or buy a new one</li>" +
      "<li>Track every connection: confirmed, pending, or needs action</li></ul>" +
      '<p class="legal">ReceptWise is a product of [Placeholder]. This is a clickable prototype with sample data.</p></section>' +
      '<section class="login-panel"><form class="login-card" data-action="login"><h2>Sign in</h2><p class="sub">Internal team only.</p>' +
      '<div class="field" style="margin-top:16px"><label for="email">Email</label><input class="ctrl" id="email" name="email" type="email" autocomplete="username" placeholder="you@receptwise.example"></div>' +
      '<div class="field"><label for="password">Password</label><input class="ctrl" id="password" name="password" type="password" autocomplete="current-password" placeholder="Any password"></div>' +
      '<button class="btn btn-primary" type="submit" style="width:100%">Sign in</button><p class="help">This prototype accepts any email and password.</p></form></section></div>' +
      '<div id="modal-back" class="modal-back"></div><div id="toasts" class="toasts"></div>';
  }

  function nameFromEmail(email) {
    if (!email) return "Maya Chen";
    var local = email.split("@")[0].replace(/[._+-]+/g, " ").trim();
    if (!local) return "Maya Chen";
    return local.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function instructionText(carrier, forwardType, aiNumber, businessName) {
    var help = forwardingHelp(carrier, forwardType, aiNumber);
    var lines = help.lines.map(function (line) { return line[0] + ": " + line[1]; }).join("\n");
    var off = help.off.map(function (line) { return line[0] + ": " + line[1]; }).join("\n");
    return "ReceptWise forwarding for " + (businessName || "your business") + "\n\nDial from the business phone:\n" + lines +
      (off ? "\n\nTo turn it off later:\n" + off : "") + "\n\nReply DONE when finished. We will place a test call.\n" + help.note;
  }

  var actions = {
    "sign-out": function () {
      try { sessionStorage.removeItem("rw_session"); } catch (e) {}
      location.href = "index.html";
    },
    "toggle-bell": function () {
      var panel = document.getElementById("bell-panel");
      if (panel) panel.classList.toggle("open");
    },
    "close-modal": function () { closeModal(); },
    "close-refresh": function () { closeModal(); currentRender(); },
    "copy-code": function (el) { copyText(el.dataset.code || ""); },
    pick: function (el) {
      readWizard();
      wizard[el.dataset.field] = el.dataset.value;
      if (el.dataset.field === "tier") {
        wizard.plan = { Solo: "Starter", Small: "Growth", Growing: "Pro" }[el.dataset.value] || wizard.plan;
      }
      if (el.dataset.field === "category" && !wizard.template) wizard.template = el.dataset.value;
      wizard.error = "";
      renderWizard();
    },
    "show-numbers": function () {
      readWizard();
      syncNumber();
      toast("Numbers updated for area code " + wizard.areaCode + ".");
      renderWizard();
    },
    "lookup-carrier": function () {
      readWizard();
      later(700, function () {
        wizard.carrier = "verizon";
        wizard.lookupNote = "Line lookup suggests Verizon mobile. Confirm with the client before anyone dials.";
        toast("Lookup suggests Verizon mobile.");
        renderWizard();
      });
    },
    "send-forward-instructions": function () {
      readWizard();
      syncNumber();
      var text = instructionText(wizard.carrier, wizard.forwardType, wizard.chosenNumber, wizard.name || "this business");
      openModal("Instructions for the client", "<p>This is the message we would text. They dial it from the business phone.</p><pre class='code' style='white-space:pre-wrap'>" + esc(text) + "</pre>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="copy-code" data-code="' + esc(text) + '">Copy message</button>');
    },
    "send-forward-live": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var text = instructionText(b.phone.carrier, b.phone.forwardType, b.phone.aiNumber, b.name);
      openModal("Instructions for " + b.owner.name, "<pre class='code' style='white-space:pre-wrap'>" + esc(text) + "</pre>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="copy-code" data-code="' + esc(text) + '">Copy message</button>');
    },
    "client-done": function () {
      readWizard();
      wizard.clientDone = !wizard.clientDone;
      toast(wizard.clientDone ? "Marked done. Place the test call." : "Cleared. Still waiting on the client.");
      renderWizard();
    },
    "place-test": function () {
      readWizard();
      ensureGreeting();
      wizard.testStatus = "calling";
      renderWizard();
      later(1400, function () {
        wizard.testStatus = "ok";
        wizard.testNote = "The receptionist answered and the greeting matched.";
        if (wizard.step === 3) renderWizard();
        toast("Test call confirmed.");
      });
    },
    "place-test-miss": function () {
      readWizard();
      wizard.testStatus = "miss";
      wizard.testNote = "No answer within 45 seconds.";
      toast("Marked as not working.");
      renderWizard();
    },
    "toast-link": function () {
      toast("Sign-in link ready. The owner approves access. We never ask for a password.");
    },
    "texting-status": function () {
      openModal("Texting registration", "<p><strong>Pending.</strong> Brand and campaign registration stay off until the final company tax ID is on file. During development the legal entity is [Placeholder].</p><p>The receptionist can still answer calls. Email goes out instead of texts.</p>",
        '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
    },
    back: function () {
      readWizard();
      if (wizard.step > 0) wizard.step -= 1;
      wizard.error = "";
      renderWizard();
    },
    next: function () {
      readWizard();
      syncNumber();
      wizard.error = "";
      if (wizard.step === 0 && !wizard.name.trim()) wizard.error = "Enter the business name.";
      else if (wizard.step === 0 && !wizard.category) wizard.error = "Choose a business type.";
      else if (wizard.step === 2 && !wizard.chosenNumber) wizard.error = "Choose the AI receptionist number.";
      else if (wizard.step === 2 && wizard.phoneMode === "forward" && digits(wizard.businessNumber).length < 10) wizard.error = "Enter the 10-digit business number to forward.";
      if (wizard.error) { renderWizard(); return; }
      if (wizard.step === 1 && wizard.multi) {
        wizard.tier = "Growing";
        wizard.plan = "Pro";
      }
      if (wizard.step < 9) wizard.step += 1;
      if (wizard.step === 5) ensureGreeting();
      renderWizard();
    },
    "goto-step": function (el) {
      readWizard();
      wizard.step = Number(el.dataset.step) || 0;
      wizard.error = "";
      if (wizard.step === 5) ensureGreeting();
      renderWizard();
    },
    "reset-wizard": function () {
      wizard = defaultWizard();
      renderWizard();
    },
    "create-business": function () {
      readWizard();
      if (!wizard.name.trim() || !wizard.category) {
        wizard.step = 0;
        wizard.error = "Name and business type are required before creating the business.";
        renderWizard();
        return;
      }
      var business = buildBusiness();
      var all = createdList();
      all.push(business);
      storageSet("rw_created", JSON.stringify(all));
      wizard.createdId = business.id;
      wizard.step = 10;
      toast(business.name + " added.");
      renderWizard();
    },
    "toggle-check": function (el) {
      openCheck = openCheck === el.dataset.key ? "" : el.dataset.key;
      currentRender();
    },
    "toggle-call": function (el) {
      openCall = openCall === el.dataset.key ? "" : el.dataset.key;
      currentRender();
    },
    "call-receptionist": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      openModal("Call the receptionist", "<p>Calling <strong>" + esc(b.phone.aiNumber) + "</strong>. This prototype does not place a carrier call.</p><div class='line'><b>Greeting</b>" + esc(b.greeting) + "</div><div class='scrub'><i></i></div>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="play-greeting">Play greeting</button>');
    },
    "play-greeting": function (el) {
      var bar = el.closest(".modal") && el.closest(".modal").querySelector(".scrub");
      if (bar) {
        bar.classList.remove("play");
        void bar.offsetWidth;
        bar.classList.add("play");
      }
      toast("Playing the sample greeting.");
    },
    "play-call": function (el) {
      var bar = el.parentElement.querySelector(".scrub");
      if (bar) {
        bar.classList.remove("play");
        void bar.offsetWidth;
        bar.classList.add("play");
      }
      toast("Playing the sample recording.");
    },
    "send-steps": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var pending = (b.checklist || []).filter(function (item) { return item.status !== "connected"; });
      var list = pending.length ? pending.map(function (item) {
        return "<li><strong>" + esc(item.label) + "</strong> · " + esc(item.owner) + "<div class='help'>" + esc(item.detail) + "</div></li>";
      }).join("") : "<li>Nothing is waiting. We'll still send the monthly report.</li>";
      openModal("Steps for " + b.owner.name, "<p>One message, with a link for each step only the owner can do.</p><ul>" + list + "</ul>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="mark-sent">Mark as sent</button>');
    },
    "mark-sent": function () {
      closeModal();
      toast("Owner steps marked as sent.");
    },
    "forward-test": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var target = (b.phone && (b.phone.mode === "forward" ? b.phone.businessNumber : b.phone.aiNumber)) || "the number";
      openModal("Forwarding test", "<p>Calling " + esc(target) + " from the ReceptWise test number…</p>");
      later(1100, function () {
        var item = checklistItem(b, "forwarding");
        if (b.phone && b.phone.mode === "new") {
          openModal("Forwarding test", "<p class='banner ok'>This business uses a new number, so there is nothing to forward. A test call to " + esc(b.phone.aiNumber) + " would check the greeting instead.</p>",
            '<button class="btn btn-primary" type="button" data-action="close-refresh">Done</button>');
          return;
        }
        if (item.status === "action") {
          openModal("Forwarding test", "<p><strong>Not working.</strong> The receptionist did not pick up within 45 seconds.</p><ul><li>The code was typed wrong.</li><li>It was dialed from a different line.</li><li>This phone company needs its website instead of a code.</li></ul>",
            '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="confirm-forward" data-id="' + esc(b.id) + '">Client redialed — confirm</button>');
        } else {
          item.status = "connected";
          item.detail = "Forwarding test confirmed just now.";
          b.phone.tests = b.phone.tests || [];
          b.phone.tests.unshift({ when: "Just now", result: "Confirmed", note: "The receptionist answered the test call." });
          openModal("Forwarding test", "<p class='banner ok'>Confirmed. The receptionist answered, and the call record matches the test number.</p>",
            '<button class="btn btn-primary" type="button" data-action="close-refresh">Done</button>');
        }
      });
    },
    "confirm-forward": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var item = checklistItem(b, "forwarding");
      item.status = "connected";
      item.detail = "Forwarding confirmed after the client redialed.";
      b.phone.tests = b.phone.tests || [];
      b.phone.tests.unshift({ when: "Just now", result: "Confirmed", note: "Retry succeeded." });
      closeModal();
      toast("Forwarding marked confirmed.");
      currentRender();
    },
    "run-greeting-test": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      openModal("Receptionist test call", "<p>Calling " + esc(b.phone.aiNumber) + "…</p>");
      later(1100, function () {
        var item = checklistItem(b, "test");
        item.status = "connected";
        item.detail = "Greeting matched just now.";
        b.phone.tests = b.phone.tests || [];
        b.phone.tests.unshift({ when: "Just now", result: "Confirmed", note: "Greeting matched." });
        openModal("Receptionist test call", "<p class='banner ok'>The receptionist answered. The greeting matched.</p><div class='line'>" + esc(b.greeting) + "</div>",
          '<button class="btn btn-primary" type="button" data-action="close-refresh">Done</button>');
      });
    },
    "send-link": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var kind = el.dataset.kind || "connect";
      var link = "https://receptwise.example/connect/" + b.id + "/" + kind;
      openModal("Sign-in link", "<p>Send this to " + esc(b.owner.name) + ". They approve access on their own account. We never take their password.</p><p class='code'>" + esc(link) + "</p>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="copy-code" data-code="' + esc(link) + '">Copy link</button>');
    },
    "booking-test": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var item = checklistItem(b, "calendar");
      openModal("Booking test", "<p>Reading free times…</p>");
      later(900, function () {
        if (item.status === "action") {
          openModal("Booking test", "<p><strong>Needs action.</strong> " + esc(item.detail) + "</p>",
            '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        } else {
          item.status = "connected";
          item.detail = "Free times were readable. A test booking was created and deleted.";
          openModal("Booking test", "<p class='banner ok'>Calendar connected. A test booking was created and then deleted.</p>",
            '<button class="btn btn-primary" type="button" data-action="close-refresh">Done</button>');
        }
      });
    },
    "check-email": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var item = checklistItem(b, "email");
      openModal("Email domain", "<p>Looking up SPF and DKIM for " + esc(b.website) + "…</p>");
      later(800, function () {
        if (item.status === "connected") {
          openModal("Email domain", "<p class='banner ok'>Verified. SPF and DKIM were found.</p>", '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        } else {
          openModal("Email domain", "<p><strong>Not verified.</strong> Paste this SPF record, then check again.</p><p class='code'>v=spf1 include:send.example ~all</p>",
            '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        }
      });
    },
    "check-domain": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var item = checklistItem(b, "website");
      openModal("Domain check", "<p>Loading " + esc(b.website) + " over a secure connection…</p>");
      later(800, function () {
        if (item.status === "connected") {
          openModal("Domain check", "<p class='banner ok'>Website is live. The padlock check passed.</p>", '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        } else if (item.status === "action") {
          openModal("Domain check", "<p><strong>Needs action.</strong> " + esc(item.detail) + "</p>", '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        } else {
          openModal("Domain check", "<p>The site is still a draft, so the business domain does not show our padlock yet.</p>", '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
        }
      });
    },
    "publish-site": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var item = checklistItem(b, "website");
      if (item.status === "action") {
        toast("Draft published. The domain record still has to change before the padlock check passes.");
        return;
      }
      item.status = "connected";
      item.detail = b.website + " loads with a padlock.";
      b.domainStatus = item.detail;
      toast("Website published.");
      currentRender();
    },
    "toast-chat": function () {
      openModal("Chat and call button", "<p>The site shows a call button to the AI number and a chat widget. Chat on the free starter tool covers the website first. Instagram and Facebook messages wait on a later approval.</p>",
        '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
    },
    "open-review": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      openModal("Google review link", b.reviewLink ? "<p>This opens the review form for " + esc(b.name) + ". Same link for every customer.</p><p class='code'>" + esc(b.reviewLink) + "</p>" : "<p>No review link is on file yet. Add it from the Google Business Profile, or create it from the listing.</p>",
        '<button class="btn btn-primary" type="button" data-action="close-modal">Close</button>');
    },
    "approve-review": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var review = b.reviews[Number(el.dataset.index)];
      var box = document.querySelector('[data-draft="' + el.dataset.index + '"]');
      if (review && box) review.draft = box.value;
      if (review) review.posted = true;
      toast("Reply approved.");
      currentRender();
    },
    "save-draft": function (el) {
      var b = findBiz(el.dataset.id);
      var greet = document.getElementById("greet");
      var voice = document.getElementById("voice");
      if (b && greet) b.greeting = greet.value;
      if (b && voice) b.voice = voice.value;
      toast("Draft saved. Publish when callers should hear it.");
    },
    "publish-receptionist": function (el) {
      var b = findBiz(el.dataset.id);
      var greet = document.getElementById("greet");
      var voice = document.getElementById("voice");
      if (b && greet) b.greeting = greet.value;
      if (b && voice) b.voice = voice.value;
      toast("Published. Callers now hear this greeting.");
    },
    "payment-link": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var link = "https://receptwise.example/pay/" + b.id;
      openModal("Payment link", "<p>Sample link for " + esc(b.owner.name) + ". " + (b.pilot ? "The pilot is $0 and the setup fee is waived." : "This would open a card form for the " + esc(b.plan) + " plan.") + "</p><p class='code'>" + esc(link) + "</p>",
        '<button class="btn" type="button" data-action="close-modal">Close</button><button class="btn btn-primary" type="button" data-action="copy-code" data-code="' + esc(link) + '">Copy link</button>');
    },
    "toggle-local": function (el) {
      var on = el.classList.toggle("on");
      el.setAttribute("aria-pressed", on ? "true" : "false");
      toast(on ? "Turned on." : "Turned off.");
    },
    "toggle-switch": function (el) {
      var settings = prefs();
      settings[el.dataset.key] = !settings[el.dataset.key];
      storageSet("rw_prefs", JSON.stringify(settings));
      toast(settings[el.dataset.key] ? "Turned on." : "Turned off.");
      currentRender();
    },
    "pause-biz": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      b.paused = !b.paused;
      toast(b.paused ? "Receptionist paused for this session." : "Receptionist resumed.");
      currentRender();
    },
    "save-business": function (el) {
      var b = findBiz(el.dataset.id);
      var root = document.getElementById("view");
      if (!b || !root) return;
      b.hours = root.querySelector("[data-set=hours]").value;
      b.timezone = root.querySelector("[data-set=timezone]").value;
      b.transfer = root.querySelector("[data-set=transfer]").value;
      b.owner = b.owner || {};
      b.owner.mobile = root.querySelector("[data-set=mobile]").value;
      toast("Settings saved for this session.");
    },
    "import-contacts": function () {
      openModal("Import customers", '<p class="help">Include a consent column, plus the date and source. Rows without consent are skipped.</p><textarea class="ctrl" id="import-box" placeholder="name, email, consent, date"></textarea>',
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="do-import">Import</button>');
    },
    "do-import": function () {
      closeModal();
      toast("3 sample contacts imported. 1 row skipped for missing consent.");
    },
    "new-campaign": function () {
      openModal("New campaign", '<div class="field"><label>Name</label><input class="ctrl" id="camp-name" value="We miss you"></div><div class="field"><label>Message</label><textarea class="ctrl" id="camp-body">It has been a while. Reply STOP to opt out.</textarea></div>',
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="save-campaign">Save draft</button>');
    },
    "save-campaign": function () {
      closeModal();
      toast("Campaign saved as a draft. It will not send until you schedule it.");
    },
    "test-send": function () {
      var user = session();
      toast("Test email queued" + (user && user.email ? " to " + user.email : "") + ".");
    },
    "new-post": function (el) {
      var b = findBiz(el.dataset.id);
      openModal("Post draft", '<div class="field"><label>Channel</label><select class="ctrl" id="post-channel"><option>Instagram</option><option>Facebook</option><option>Google Business Profile</option></select></div><div class="field"><label>Post</label><textarea class="ctrl" id="post-body">' + esc(b ? b.blurb : "") + "</textarea></div>",
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="save-post" data-id="' + esc(el.dataset.id) + '">Save draft</button>');
    },
    "save-post": function (el) {
      var b = findBiz(el.dataset.id);
      var channel = document.getElementById("post-channel");
      var body = document.getElementById("post-body");
      if (b) {
        b.posts = b.posts || [];
        b.posts.unshift({ when: "Draft", channel: channel ? channel.value : "Instagram", text: body ? body.value : "", status: "Draft" });
      }
      closeModal();
      toast("Draft saved for owner approval.");
      currentRender();
    },
    "invite-open": function () {
      openModal("Invite a teammate", '<div class="field"><label>Name</label><input class="ctrl" id="inv-name"></div><div class="field"><label>Email</label><input class="ctrl" id="inv-email" type="email"></div><div class="field"><label>Role</label><select class="ctrl" id="inv-role"><option>Team</option><option>Admin</option></select></div>',
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="invite-save">Send invite</button>');
    },
    "invite-save": function () {
      var nameEl = document.getElementById("inv-name");
      var emailEl = document.getElementById("inv-email");
      var roleEl = document.getElementById("inv-role");
      var name = (nameEl && nameEl.value.trim()) || "New teammate";
      var email = (emailEl && emailEl.value.trim()) || "teammate@receptwise.example";
      var role = roleEl ? roleEl.value : "Team";
      var list = [];
      try { list = JSON.parse(storageGet("rw_invites") || "[]"); } catch (e) { list = []; }
      list.push({ name: name, email: email, role: role, scope: "Invite pending" });
      storageSet("rw_invites", JSON.stringify(list));
      closeModal();
      toast("Invite saved in this browser session.");
      currentRender();
    }
  };

  function onClick(event) {
    if (event.target && event.target.id === "modal-back") {
      closeModal();
      return;
    }
    var el = event.target.closest ? event.target.closest("[data-action]") : null;
    if (!el) {
      var panel = document.getElementById("bell-panel");
      if (panel && !(event.target.closest && event.target.closest(".bell-wrap"))) panel.classList.remove("open");
      return;
    }
    var fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName !== "INPUT") event.preventDefault();
    fn(el, event);
  }

  function onChange(event) {
    var el = event.target;
    if (!el || !el.dataset) return;
    if (el.dataset.action === "go-filter") {
      var overrides = {};
      overrides[el.dataset.key] = el.value;
      location.href = clientsHref(overrides);
    } else if (el.dataset.action === "faq-file" && el.files && el.files[0]) {
      var reader = new FileReader();
      reader.onload = function () {
        readWizard();
        wizard.faqs = String(reader.result || "").slice(0, 2000);
        toast("FAQ file loaded into the draft.");
        renderWizard();
      };
      reader.onerror = function () { toast("Could not read that file."); };
      reader.readAsText(el.files[0]);
    } else if (el.dataset.action === "bill-file") {
      toast(el.files && el.files[0] ? "Bill attached for the port request." : "No file selected.");
    } else if (el.dataset.action === "cap-toggle") {
      var business = findBiz(el.dataset.id);
      if (!business) return;
      business.capabilities = business.capabilities || {};
      business.capabilities[el.dataset.cap] = el.checked;
      toast("Saved on the draft. Publish the receptionist to make it live.");
    }
  }

  function onSubmit(event) {
    var form = event.target;
    if (!form || form.dataset.action !== "login") return;
    event.preventDefault();
    var email = (form.email && form.email.value || "").trim();
    storageSet("rw_session", JSON.stringify({ email: email, name: nameFromEmail(email) }));
    location.href = "dashboard.html";
  }

  function boot() {
    if (!window.RW_DATA) {
      document.getElementById("app").textContent = "Sample data did not load.";
      return;
    }
    clearTimers();
    var page = document.body.dataset.page || "login";
    if (page === "login") {
      renderLogin();
      return;
    }
    if (!session()) {
      location.replace("index.html");
      return;
    }
    document.getElementById("app").innerHTML = shell(page);
    currentRender = function () {
      var view = document.getElementById("view");
      if (!view) return;
      if (page === "dashboard") renderDashboard(view);
      else if (page === "clients") renderClients(view);
      else if (page === "add") renderWizard(view);
      else if (page === "client") renderClient(view);
      else if (page === "billing") renderBilling(view);
      else if (page === "team") renderTeam(view);
      refreshBell();
    };
    currentRender();
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeModal();
  });
  window.addEventListener("hashchange", function () {
    if ((document.body.dataset.page || "") === "client") currentRender();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
