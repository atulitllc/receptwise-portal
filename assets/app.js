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

  // Keys in assets/feature-status.js. Tab dots and the bar under the tabs read this.
  var TAB_FEATURES = {
    overview: ["phone_number", "number_search", "test_call", "calendar_connection", "email_domain", "reviews", "social", "website_generator", "billing", "texting"],
    receptionist: ["receptionist", "voice_dropdown", "test_call", "call_log"],
    bookings: ["bookings", "calendar_connection"],
    reviews: ["reviews"],
    social: ["social"],
    website: ["website_generator"],
    outreach: ["outreach"],
    billing: ["billing"],
    settings: ["business_settings"]
  };

  // Wizard step index -> features that appear on that step.
  var STEP_FEATURES = {
    1: ["billing"],
    2: ["number_search"],
    3: ["test_call"],
    4: ["calendar_connection"],
    5: ["receptionist", "voice_dropdown"],
    6: ["social"],
    7: ["website_generator"],
    8: ["texting"]
  };

  var CHECK_FEATURES = {
    number: "phone_number",
    test: "test_call",
    calendar: "calendar_connection",
    texting: "texting",
    email: "email_domain",
    reviews: "reviews",
    gbp: "social",
    social: "social",
    website: "website_generator",
    billing: "billing"
  };

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
    draft: "Setup incomplete",
    waiting: "Waiting on client",
    attention: "Needs attention",
    connected: "Connected",
    pending: "Pending",
    action: "Needs action",
    recorded: "Recorded",
    coming_soon: "Coming soon",
    not_connected: "Not connected",
    saved: "Key saved",
    not_verified: "Not connected",
    attached: "Attached",
    unassigned: "Not attached",
    missing_on_vapi: "Not connected"
  };

  var wizard = defaultWizard();
  var openCheck = "";
  var openCall = "";
  var timers = [];
  var extraCache = null;
  var currentRender = function () {};
  var integrationByBiz = {};
  var calendarByBiz = {};

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
      areaCode: window.RW_LIVE ? "781" : "415",
      chosenNumber: "",
      chosenE164: "",
      numberOptions: [],
      numberStatus: "idle",
      numberError: "",
      lookupNote: "",
      clientDone: false,
      testStatus: "idle",
      testNote: "",
      calendar: "google",
      calcomEventTypeId: "",
      calcomApiKey: "",
      calcomKeySaved: false,
      calcomDemoKey: false,
      greeting: "",
      services: "",
      faqs: "",
      transfer: "",
      voice: "nora",
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
      createdId: "",
      draftId: "",
      saved: false,
      finished: false,
      saving: false
    };
  }

  function voiceList() {
    return (window.RW_VOICES && window.RW_VOICES.length) ? window.RW_VOICES : [{ key: "nora", name: "Nora", description: "Female, American English, calm and natural. Default." }];
  }

  function voiceKey(value) {
    var raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "juniper (warm)" || raw === "harbor (clear)" || raw === "north (calm)" || raw === "sol (bright)" || raw === "juniper" || raw === "harbor" || raw === "north" || raw === "sol") return "nora";
    var list = voiceList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === raw || String(list[i].name || "").toLowerCase() === raw) return list[i].key;
    }
    return "nora";
  }

  function voiceLabel(value) {
    var key = voiceKey(value);
    var list = voiceList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i].name + " — " + list[i].description;
    }
    return "Nora";
  }

  function voiceOptions(selected) {
    var key = voiceKey(selected);
    return voiceList().map(function (voice) {
      return '<option value="' + esc(voice.key) + '"' + (voice.key === key ? " selected" : "") + ">" + esc(voice.name + " — " + voice.description) + "</option>";
    }).join("");
  }

  function loadVoiceCatalog() {
    if (!LIVE) return;
    api("GET", "api/voices").then(function (data) {
      if (!data || !data.voices || !data.voices.length) return;
      var next = data.voices.map(function (voice) { return voice.key; }).join(",");
      var prev = voiceList().map(function (voice) { return voice.key; }).join(",");
      window.RW_VOICES = data.voices;
      if (next !== prev && currentRender) currentRender();
    }).catch(function () {});
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

  // Live mode: the Render server injects window.RW_LIVE (signed-in user + integration status)
  // and real businesses into data.js. On GitHub Pages RW_LIVE is undefined and the demo runs as before.
  var LIVE = !!window.RW_LIVE;
  var numberPick = { bizId: "", areaCode: "", status: "idle", options: [], error: "", chosenE164: "" };

  function isAdmin() {
    return !!(window.RW_LIVE && window.RW_LIVE.user && window.RW_LIVE.user.role === "admin");
  }

  function missingNumberKeys() {
    var ints = (window.RW_LIVE && window.RW_LIVE.integrations) || {};
    var missing = [];
    if (!ints.twilio) missing.push("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN");
    if (!ints.vapi) missing.push("VAPI_API_KEY");
    return missing;
  }

  function emptyNumberCopy(area) {
    var nearby = ["781", "339", "617"].filter(function (code) { return code !== String(area || ""); });
    if (nearby.length < 2) nearby = ["339", "617"];
    return "No numbers available for " + area + ", try a nearby area code like " + nearby[0] + " or " + nearby[1];
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-RW-Client": "portal" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ("Request failed (" + res.status + ")."));
          err.data = data;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function liveFail(err) {
    if (err && err.status === 401) { location.replace("index.html"); return; }
    toast(err && err.message ? err.message : "Something went wrong.");
  }

  function replaceBiz(updated) {
    if (!updated) return;
    var list = window.RW_DATA.businesses || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === updated.id) { list[i] = updated; return; }
    }
    list.push(updated);
  }

  function persistBiz(b, message) {
    return api("PUT", "api/businesses/" + encodeURIComponent(b.id), b).then(function (data) {
      replaceBiz(data.business);
      if (message) toast(message);
      if (currentRender) currentRender();
      return data.business;
    });
  }

  function session() {
    if (LIVE) return window.RW_LIVE.user || null;
    try { return JSON.parse(storageGet("rw_session") || "null"); }
    catch (e) { return null; }
  }

  function createdList() {
    if (LIVE) return [];
    if (extraCache) return extraCache;
    try { extraCache = JSON.parse(storageGet("rw_created") || "[]"); }
    catch (e) { extraCache = []; }
    return extraCache;
  }

  function localGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function localSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { toast("This browser blocked saving the draft."); return false; }
  }

  function draftRecords() {
    try { return JSON.parse(localGet("rw_drafts") || "[]"); }
    catch (e) { return []; }
  }

  function writeDraftRecords(list) {
    localSet("rw_drafts", JSON.stringify(list));
  }

  function upsertDraftRecord(business) {
    var list = draftRecords().filter(function (item) { return item.id !== business.id; });
    list.push(business);
    writeDraftRecords(list);
  }

  function removeDraftRecord(id) {
    writeDraftRecords(draftRecords().filter(function (item) { return item.id !== id; }));
  }

  function allBusinesses() {
    var list = (window.RW_DATA.businesses || []).concat(createdList());
    if (!LIVE) {
      draftRecords().forEach(function (draft) {
        if (!list.some(function (item) { return item.id === draft.id; })) list.push(draft);
      });
    }
    return list;
  }

  function draftActions(b) {
    return '<a class="btn btn-sm btn-primary" href="add.html?draft=' + encodeURIComponent(b.id) + '">Resume setup</a> ' +
      '<button class="btn btn-sm" type="button" data-action="delete-draft" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Delete</button>';
  }

  function setupProgress(b) {
    if (b && b.setupProgress && b.setupProgress.length) return b.setupProgress;
    var phone = (b && b.phone) || {};
    var test = checklistItem(b || {}, "test");
    return [
      { key: "details", label: "Details", done: !!(b && b.name && b.category), step: 0 },
      { key: "receptionist", label: "Receptionist published", done: !!(b && b.assistantPublished), step: 5 },
      { key: "number", label: "Number bought", done: !!(phone.aiNumber), step: 2 },
      { key: "test", label: "Test call", done: test.status === "connected", step: 3 }
    ];
  }

  function draftSetupCard(b) {
    if (!b || b.status !== "draft") return "";
    var rows = setupProgress(b).map(function (item) {
      return '<div class="setting-row"><div><strong>' + esc(item.label) + '</strong><div class="help">' + (item.done ? "Done" : "Not done yet") + "</div></div>" +
        '<a class="btn btn-sm" href="add.html?draft=' + encodeURIComponent(b.id) + "&step=" + encodeURIComponent(item.step) + '">Resume</a></div>';
    }).join("");
    return '<section class="card" style="margin-bottom:14px"><div class="card-h"><h2>Setup incomplete</h2>' +
      '<a class="btn btn-sm btn-primary" href="add.html?draft=' + encodeURIComponent(b.id) + '">Resume setup</a></div><div class="card-b">' +
      rows + '<button class="btn btn-sm" type="button" data-action="delete-draft" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Delete draft</button></div></section>';
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

  function forwardingHelp(carrier, forwardType, aiNumber) {
    var n = digits(aiNumber);
    var missing = n.length < 10;
    if (missing) {
      return { lines: [], off: [], note: "Choose an AI number before sending these codes.", warn: "", number: "", missing: true };
    }
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
    return { lines: lines, off: off, note: note, warn: warn, number: pretty(n), missing: missing };
  }

  function codeBlock(help, alt) {
    if (help.missing) return '<div class="note calm">Forwarding codes appear here once an AI number is chosen.</div>';
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

  var FEATURE_WORD = { real: "Real", mockup: "Mockup", in_progress: "In progress" };

  function featureEntry(key) {
    var all = window.RW_FEATURE_STATUS || {};
    var entry = all[key];
    if (!entry || !FEATURE_WORD[entry.status]) return null;
    return entry;
  }

  // Pill for one feature. Every badge in the panel goes through here.
  function badge(key) {
    var entry = featureEntry(key);
    if (!entry) return "";
    var word = FEATURE_WORD[entry.status];
    var name = entry.label || key;
    var tip = name + " — " + word + (entry.note ? ". " + entry.note : "");
    return '<span class="pill feat ' + entry.status + '" title="' + esc(tip) + '"><i class="feat-dot" aria-hidden="true"></i><span class="feat-name">' + esc(name) + "</span> " + esc(word) + "</span>";
  }

  function featureBar(keys) {
    var html = (keys || []).map(badge).join("");
    return html ? '<div class="feat-bar" aria-label="Feature status">' + html + "</div>" : "";
  }

  // One mini badge per distinct status, for tab and wizard step buttons.
  function statusMarks(keys) {
    var groups = { real: [], in_progress: [], mockup: [] };
    (keys || []).forEach(function (key) {
      var entry = featureEntry(key);
      if (!entry) return;
      groups[entry.status].push(entry.label || key);
    });
    return ["real", "in_progress", "mockup"].map(function (status) {
      var names = groups[status];
      if (!names.length) return "";
      var word = FEATURE_WORD[status];
      return '<span class="feat-mini ' + status + '" title="' + esc(names.join(", ") + " — " + word) + '"><i aria-hidden="true"></i>' + esc(word) + '<span class="sr-only">: ' + esc(names.join(", ")) + "</span></span>";
    }).join("");
  }

  function ensureIntegrations(b) {
    if (!LIVE || !b || !b.id || integrationByBiz[b.id]) return;
    integrationByBiz[b.id] = { pending: true };
    api("GET", "api/businesses/" + encodeURIComponent(b.id) + "/integrations").then(function (data) {
      var map = {};
      (data.accounts || []).forEach(function (account) {
        if (account && account.provider) map[account.provider] = account.status || "";
      });
      integrationByBiz[b.id] = map;
      if ((document.body.dataset.page || "") === "client" && currentTab() === "social") currentRender();
    }).catch(function () {
      integrationByBiz[b.id] = { failed: true };
    });
  }

  function integrationConnected(b, provider) {
    var map = b && integrationByBiz[b.id];
    return !!(map && map[provider] === "connected");
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
    if (LIVE) return '<p class="page-legal">ReceptWise is a product of [Placeholder].</p>';
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
      team: "Team and settings",
      phone: "Phone",
      settings: "Receptionist",
      integrations: "Integrations"
    };
    var groups = [
      ["Main", [
        ["dashboard.html", "Overview", "dashboard"],
        ["phone.html", "Phone", "phone"],
        ["settings.html", "Receptionist", "settings"],
        ["integrations.html", "Integrations", "integrations"],
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
    if (LIVE && window.RW_DATA && window.RW_DATA.metrics) {
      renderLiveDashboard(view);
      return;
    }
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
        "<td>" + (b.status === "draft" ? draftActions(b) : esc(next.text) + "<div class='help'>" + esc(next.owner) + "</div>") + "</td></tr>";
    }).join("");
    var alerts = allAlerts().slice(0, 6).map(function (alert) {
      return '<a class="alert-row" href="client.html?id=' + encodeURIComponent(alert.id) + '"><strong>' + esc(alert.name) + "</strong><span>" + esc(alert.text) + "</span></a>";
    }).join("");
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var counts = LIVE ? (window.RW_DATA.callsByDay || [0, 0, 0, 0, 0, 0, calls]) : [36, 29, 41, 48, 33, 18, calls || 41];
    var max = LIVE ? Math.max(4, Math.max.apply(null, counts)) : 48;
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
        "</td><td>" + esc(b.plan) + "</td><td>" + pill(b.status) + "</td><td>" + progress(b) + "</td><td>" +
        (b.status === "draft" ? draftActions(b) : esc(next.text) + "<div class='help'>" + esc(next.owner) + "</div>") + "</td></tr>";
    }).join("");
    view.innerHTML = '<div class="page-head"><div><h1>Businesses</h1><p class="sub">' + list.length + " shown · pinned pilot stays at the top</p></div>" +
      '<a class="btn btn-primary" href="add.html">Add business</a></div>' +
      '<div class="filters"><div class="chips">' + chip("All", "") + chip("Needs attention", "attention") + chip("Waiting on client", "waiting") +
      chip("Setup incomplete", "draft") + chip("In setup", "setup") + chip("Live", "live") + "</div>" +
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

  function syncAreaCode() {
    var area = String(wizard.areaCode || "").replace(/\D/g, "").slice(0, 3);
    wizard.areaCode = area;
    var listed = wizard.numberOptions && wizard.numberOptions[0] ? digits(wizard.numberOptions[0].e164).slice(0, 3) : "";
    if (listed && area && listed !== area) {
      wizard.numberOptions = [];
      wizard.numberStatus = "idle";
      wizard.numberError = "";
      wizard.chosenE164 = "";
      wizard.chosenNumber = "";
      return;
    }
    var chosenArea = digits(wizard.chosenE164 || wizard.chosenNumber).slice(0, 3);
    if (chosenArea && area && chosenArea !== area) {
      wizard.chosenE164 = "";
      wizard.chosenNumber = "";
    }
  }

  function numberResultBlock(state, pickAction, bizId) {
    if (state.status === "loading") return '<p class="help">Looking up numbers for ' + esc(state.areaCode) + "…</p>";
    if (state.status === "error") return '<p class="error">' + esc(state.error || "Number search failed.") + "</p>";
    if (state.status === "empty") return '<p class="help">' + esc(emptyNumberCopy(state.areaCode)) + "</p>";
    if (!state.options || !state.options.length) return '<p class="help">Enter an area code and choose Show numbers.</p>';
    return '<div class="field"><label>Available numbers</label><div class="choice-grid">' + state.options.map(function (num) {
      var title = num.friendly || pretty(digits(num.e164)) || num.e164;
      var where = [num.locality, num.region].filter(Boolean).join(", ") || "Local voice";
      var on = state.chosenE164 === num.e164 ? " on" : "";
      return '<button class="choice' + on + '" type="button" data-action="' + pickAction + '" data-field="chosenE164" data-value="' + esc(num.e164) + '" data-label="' + esc(title) + '"' +
        (bizId ? ' data-id="' + esc(bizId) + '"' : "") + "><b>" + esc(title) + "</b><span>" + esc(where) + " · " + esc(num.e164) + "</span></button>";
    }).join("") + "</div></div>";
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
        "<li>Receptionist created, with the virtual-assistant disclosure in the greeting</li><li>" +
        (LIVE
          ? (wizard.chosenNumber
            ? esc(wizard.chosenNumber) + " is saved. Buy and connect on Overview purchases it (about $1.15 a month). Nothing has been bought yet."
            : "No AI number chosen yet. Search on Overview, then Buy and connect.")
          : "Number search works in the live control panel.") + "</li>" +
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
      var numberKeys = LIVE ? missingNumberKeys() : [];
      body = '<div class="choice-grid">' +
        choice("phoneMode", "new", "New number", "Callers use a number we buy. Nothing to forward.") +
        choice("phoneMode", "forward", "Forward the current number", "The number on the door stays. Calls roll to the receptionist.") +
        choice("phoneMode", "port", "Move the number to us", "Porting takes days. Forwarding is the usual start.") +
        "</div>" +
        '<div class="field"><label>Area code</label>' + featureBar(["number_search"]) + '<div class="inline">' + input("areaCode", wizard.areaCode, "415") +
        ((!LIVE || (isAdmin() && !numberKeys.length))
          ? '<button class="btn" type="button" data-action="show-numbers"' + (wizard.numberStatus === "loading" ? " disabled" : "") + ">Show numbers</button>"
          : "") +
        "</div>" +
        '<div class="help">Used to list local numbers.</div></div>';
      if (!LIVE) {
        body += '<div class="note calm">Number search works in the live control panel.</div>';
      } else if (numberKeys.length) {
        body += "<p class='banner warn'>Not connected yet. Add " + esc(numberKeys.join(" and ")) + " on the server, then come back.</p>";
      } else if (!isAdmin()) {
        body += '<div class="note">Admins search available numbers. You can continue, and an admin can buy one from Overview.</div>';
      } else {
        body += '<div class="note calm">Searching does not buy a number. It is purchased only when you choose Buy and connect on the business Overview, and a local number costs about $1.15 a month.</div>' +
          numberResultBlock({
            status: wizard.numberStatus,
            error: wizard.numberError,
            areaCode: wizard.areaCode,
            options: wizard.numberOptions,
            chosenE164: wizard.chosenE164
          }, "pick", "");
      }
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
        body += '<div class="note calm">Callers will use ' + esc(wizard.chosenNumber || "the number you pick") + ". Nothing is bought until Buy and connect. Update the website, Google listing, and window once the test call passes.</div>";
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
      var cal = calendarDescribe(wizard.calendar);
      body = '<div class="choice-grid">' + calendarChoices().map(function (item) {
        return choice("calendar", item.id, item.title, item.detail);
      }).join("") + "</div>";
      body += '<div data-calendar-panel>';
      if (cal.steps.length) body += '<ol style="margin:12px 0 12px 1.2em">' + cal.steps.map(function (step) { return "<li>" + esc(step) + "</li>"; }).join("") + "</ol>";
      if (cal.note) body += '<div class="note' + (cal.signIn ? " calm" : "") + '">' + esc(cal.note) + "</div>";
      if (cal.keyField) {
        var keyHelp = wizard.calcomKeySaved
          ? "A key is already stored encrypted. Paste a new key only to replace it."
          : (wizard.calcomDemoKey && !LIVE
            ? "Entered in this session. This demo does not keep the API key."
            : (LIVE ? "Stored encrypted on the live control panel. It is not shown again." : "The live control panel stores this key encrypted. This demo does not keep it."));
        body += field("Cal.com API key", '<input class="ctrl" data-field="calcomApiKey" type="password" autocomplete="off" spellcheck="false" value="' + esc(wizard.calcomApiKey || "") + '" placeholder="Paste the API key">', keyHelp);
      }
      if (cal.eventTypeField) {
        body += field("Event type slug or ID", input("calcomEventTypeId", wizard.calcomEventTypeId, "20-minute-demo"), "Type the slug or ID from Cal.com. Event types are not loaded from Cal.com yet.");
      }
      if (cal.signIn) body += '<button class="btn" type="button" data-action="toast-link">' + esc(cal.button) + "</button>";
      body += "</div>";
    } else if (wizard.step === 5) {
      ensureGreeting();
      body = field("Greeting", textarea("greeting", wizard.greeting), "Always says it is the virtual assistant, and that the call may be recorded.") +
        field("Hours to quote", input("hours", wizard.hours)) +
        field("Services", textarea("services", wizard.services, "Cut | 45 min | $68"), "One service per line: name, length, and price, separated by |.") +
        field("FAQs", textarea("faqs", wizard.faqs, "Do you take walk-ins? Yes, when a chair is open."), "One question per line. You can also attach a text file.") +
        '<div class="field"><label>FAQ file</label><input class="ctrl" type="file" accept=".txt,.md,.csv,text/plain" data-action="faq-file"></div>' +
        '<div class="grid-2">' + field("Transfer-to number", input("transfer", wizard.transfer || wizard.ownerMobile, "(503) 555-0172")) +
        field("Voice " + badge("voice_dropdown"), '<select class="ctrl" data-field="voice">' + voiceOptions(wizard.voice) + "</select>", "Saved on this business. Publish uses this voice.") + "</div>" +
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
        ["Phone", (function () {
          var chosen = wizard.chosenNumber || (LIVE ? "not chosen yet" : "search on the live control panel");
          if (wizard.phoneMode === "new") return "New number " + chosen;
          if (wizard.phoneMode === "port") return "Port " + (wizard.businessNumber || "");
          return "Forward " + (wizard.businessNumber || "current number") + " to " + chosen;
        })()],
        ["Test call", wizard.testStatus === "ok" ? "Confirmed" : wizard.testStatus === "miss" ? "Not working" : "Not run"],
        ["Calendar", calendarTitle(wizard.calendar)],
        ["Voice", voiceLabel(wizard.voice) + (wizard.spanish ? " · English and Spanish" : " · English")],
        ["Website", (wizard.siteChoice === "keep" ? "Keep " : "Build ") + (wizard.domain || wizard.website || "domain not set")],
        ["Texting", "Pending · held for the company tax ID"]
      ];
      body = '<dl class="kvs">' + rows.map(function (row) {
        return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
      }).join("") + "</dl>" +
        '<button class="btn btn-primary" type="button" data-action="create-business">Create business</button>';
    }
    return "<h2>" + esc(STEPS[wizard.step][0]) + "</h2><p class='sub'>" + esc(STEPS[wizard.step][1]) + "</p>" + featureBar(STEP_FEATURES[wizard.step]) + error + '<div style="margin-top:14px">' + body + "</div>";
  }

  function ensurePreviewGreeting() {
    ensureGreeting();
    return wizard.greeting;
  }

  function renderWizard(view) {
    view = view || document.getElementById("view");
    if (!view) return;
    var steps = STEPS.map(function (step, index) {
      return '<button class="step-btn' + (index === wizard.step || (wizard.step === 10 && index === 9) ? " on" : "") + '" type="button" data-action="goto-step" data-step="' + index + '"><i>' + (index + 1) + "</i><span>" + esc(step[0]) + statusMarks(STEP_FEATURES[index]) + "</span></button>";
    }).join("");
    var nav = wizard.step === 10 ? "" : '<div class="wizard-nav"><button class="btn" type="button" data-action="back"' + (wizard.step === 0 || wizard.saving ? " disabled" : "") + '>Back</button>' +
      (wizard.step < 9 ? '<button class="btn btn-primary" type="button" data-action="next"' + (wizard.saving ? " disabled" : "") + ">" + (wizard.saving ? "Saving…" : "Continue") + "</button>" : "<span></span>") + "</div>";
    var savedNote = wizard.saved && wizard.step !== 10 ? '<p class="help">Draft saved. This business stays on the Businesses list as Setup incomplete until you finish.</p>' : "";
    var deleteDraft = wizard.draftId && wizard.step !== 10 ? '<button class="btn btn-sm" type="button" data-action="delete-draft" data-id="' + esc(wizard.draftId) + '" data-name="' + esc(wizard.name || "this draft") + '">Delete draft</button>' : "";
    view.innerHTML = '<div class="page-head"><div><h1>Add business</h1><p class="sub">About ten minutes. The owner only handles the steps a phone company or Google requires.</p>' + savedNote + '</div>' + deleteDraft + "</div>" +
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

  function calendarChoices() {
    return window.RWCalendarStep ? window.RWCalendarStep.choices() : [{ id: "google", title: "Google Calendar", detail: "Owner approves with one sign-in link." }];
  }

  function calendarDescribe(choice) {
    if (window.RWCalendarStep) return window.RWCalendarStep.describe(choice);
    return { provider: "google", signIn: true, title: "Google Calendar", button: "Send the calendar sign-in link", note: "After they approve, the panel reads free times, creates a test booking, and deletes it.", steps: [], keyField: false, eventTypeField: false, checklist: "Sign-in link is ready to send." };
  }

  function calendarTitle(choice) {
    return calendarDescribe(choice).title || choice || "Calendar";
  }

  function calendarSignIn(b) {
    var provider = b && b.calendar && b.calendar.provider;
    if (!provider) return true;
    return calendarDescribe(window.RWCalendarStep ? window.RWCalendarStep.choiceValue(provider) : provider).signIn;
  }

  function takeCalcomKey() {
    var key = String(wizard.calcomApiKey || "").trim();
    wizard.calcomApiKey = "";
    if (key && !LIVE) wizard.calcomDemoKey = true;
    return key;
  }

  function storeCalcomKey(slug, key) {
    if (!key || !LIVE || !slug) return Promise.resolve(null);
    var stepApi = window.RWCalendarStep;
    return api("PUT", "api/businesses/" + encodeURIComponent(slug) + "/calendar", {
      provider: stepApi ? stepApi.providerId(wizard.calendar) : wizard.calendar,
      calcomEventTypeId: wizard.calcomEventTypeId || "",
      apiKey: key
    }).then(function (data) {
      wizard.calcomKeySaved = !!data.calcomKeySaved;
      if (data.business) replaceBiz(data.business);
      return data;
    }, function (err) {
      wizard.calcomApiKey = key;
      throw err;
    });
  }

  function wizardSnapshot() {
    var keep = ["step", "name", "category", "address", "city", "website", "hours", "timezone", "ownerName", "ownerMobile", "ownerEmail", "tier", "plan", "pilot", "multi", "phoneMode", "carrier", "forwardType", "businessNumber", "areaCode", "chosenNumber", "chosenE164", "clientDone", "testStatus", "testNote", "calendar", "calcomEventTypeId", "greeting", "services", "faqs", "transfer", "voice", "spanish", "facebook", "instagram", "gbp", "siteChoice", "domain", "template", "legalName", "taxId", "sampleSms", "consent", "createdId", "draftId"];
    var snap = {};
    keep.forEach(function (key) { snap[key] = wizard[key]; });
    snap.step = wizard.step;
    snap.draftId = wizard.draftId || "";
    return snap;
  }

  function draftRecord() {
    var business = buildBusiness();
    business.id = wizard.draftId || business.id;
    business.status = "draft";
    business.wizardStep = wizard.step;
    business.wizard = wizardSnapshot();
    if (window.RWCalendarStep) business.calendar = window.RWCalendarStep.profile(wizard.calendar, wizard.calcomEventTypeId);
    business.phone = Object.assign({}, business.phone, { aiNumber: "" });
    business.assistantPublished = false;
    business.setupProgress = [
      { key: "details", label: "Details", done: true, step: 0 },
      { key: "receptionist", label: "Receptionist published", done: false, step: 5 },
      { key: "number", label: "Number bought", done: false, step: 2 },
      { key: "test", label: "Test call", done: checklistItem(business, "test").status === "connected", step: 3 }
    ];
    return business;
  }

  function canSaveDraft() {
    return !wizard.finished && wizard.step !== 10 && !!wizard.name.trim() && !!wizard.category;
  }

  function saveDraft() {
    if (!canSaveDraft()) return Promise.resolve(null);
    var key = takeCalcomKey();
    if (!LIVE) {
      if (!wizard.draftId) wizard.draftId = slug(wizard.name.trim());
      var business = draftRecord();
      business.id = wizard.draftId;
      business.wizard.draftId = wizard.draftId;
      upsertDraftRecord(business);
      wizard.saved = true;
      return Promise.resolve(business);
    }
    var body = draftRecord();
    var url = wizard.draftId
      ? "api/businesses/" + encodeURIComponent(wizard.draftId) + "/draft"
      : "api/businesses/draft";
    return api(wizard.draftId ? "PUT" : "POST", url, body).then(function (data) {
      wizard.draftId = data.business.id;
      wizard.saved = true;
      if (data.business && data.business.calcomKeySaved) wizard.calcomKeySaved = true;
      replaceBiz(data.business);
      return storeCalcomKey(wizard.draftId, key).then(function () { return data.business; });
    }, function (err) {
      if (key) wizard.calcomApiKey = key;
      throw err;
    });
  }

  function persistDraftOnLeave() {
    if ((document.body.dataset.page || "") !== "add") return;
    readWizard();
    if (wizard.finished || wizard.step === 10) return;
    if (!wizard.name.trim() || !wizard.category) return;
    if (!wizard.draftId && wizard.step === 0) return;
    var key = takeCalcomKey();
    if (!LIVE) {
      if (!wizard.draftId) wizard.draftId = slug(wizard.name.trim());
      var business = draftRecord();
      business.id = wizard.draftId;
      upsertDraftRecord(business);
      return;
    }
    var body = JSON.stringify(draftRecord());
    var url = wizard.draftId
      ? "api/businesses/" + encodeURIComponent(wizard.draftId) + "/draft"
      : "api/businesses/draft";
    var headers = { "Content-Type": "application/json", "X-RW-Client": "portal" };
    try {
      fetch(url, {
        method: wizard.draftId ? "PUT" : "POST",
        body: body,
        keepalive: true,
        credentials: "same-origin",
        headers: headers
      });
      if (key && wizard.draftId && window.RWCalendarStep) {
        fetch("api/businesses/" + encodeURIComponent(wizard.draftId) + "/calendar", {
          method: "PUT",
          body: JSON.stringify({
            provider: window.RWCalendarStep.providerId(wizard.calendar),
            calcomEventTypeId: wizard.calcomEventTypeId || "",
            apiKey: key
          }),
          keepalive: true,
          credentials: "same-origin",
          headers: headers
        });
      }
    } catch (e) {}
  }

  function afterDraftSave(render) {
    wizard.saving = false;
    if (render) renderWizard();
  }

  function failDraftSave(err, previousStep) {
    wizard.saving = false;
    if (previousStep != null) wizard.step = previousStep;
    wizard.error = (err && err.message) || "Could not save the draft.";
    renderWizard();
    if (LIVE && err && err.status === 401) liveFail(err);
  }

  function resumeDraft() {
    if ((document.body.dataset.page || "") !== "add") return;
    var params = new URLSearchParams(location.search);
    var id = params.get("draft");
    if (!id) return;
    var biz = findBiz(id);
    if (!biz) return;
    var snap = biz.wizard || {};
    wizard = Object.assign(defaultWizard(), snap);
    wizard.draftId = biz.id;
    wizard.saved = true;
    wizard.finished = false;
    wizard.saving = false;
    wizard.error = "";
    wizard.numberError = "";
    wizard.numberOptions = [];
    wizard.numberStatus = "idle";
    if (!wizard.name) wizard.name = biz.name || "";
    if (!wizard.category) wizard.category = biz.category || "";
    if (biz.calendar && biz.calendar.provider && window.RWCalendarStep) {
      wizard.calendar = window.RWCalendarStep.choiceValue(biz.calendar.provider);
      if (biz.calendar.calcomEventTypeId) wizard.calcomEventTypeId = biz.calendar.calcomEventTypeId;
    }
    wizard.calcomKeySaved = !!biz.calcomKeySaved;
    wizard.calcomApiKey = "";
    wizard.calcomDemoKey = false;
    if (wizard.chosenE164) {
      wizard.numberStatus = "ready";
      wizard.numberOptions = [{ e164: wizard.chosenE164, friendly: wizard.chosenNumber || wizard.chosenE164, locality: "Saved choice", region: "" }];
    }
    var requested = params.get("step");
    var step = requested != null && requested !== "" ? Number(requested) : Number(biz.wizardStep != null ? biz.wizardStep : wizard.step);
    wizard.step = Math.max(0, Math.min(9, step || 0));
  }

  function buildBusiness() {
    ensureGreeting();
    syncAreaCode();
    var plan = planByName(wizard.plan);
    var id = slug(wizard.name.trim());
    var textReady = wizard.legalName.trim() && wizard.taxId.trim();
    var testStatus = wizard.testStatus === "ok" ? "connected" : wizard.testStatus === "miss" ? "action" : "pending";
    var forwardStatus = "pending";
    var forwardDetail = "Waiting on the client to dial the code.";
    if (wizard.phoneMode === "new") {
      forwardStatus = "connected";
      forwardDetail = wizard.chosenNumber
        ? "Not used. Callers use the new number " + wizard.chosenNumber + "."
        : "Not used. Callers will use the new number once it is bought.";
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
      calendar: window.RWCalendarStep ? window.RWCalendarStep.profile(wizard.calendar, wizard.calcomEventTypeId) : null,
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
        requestedE164: wizard.chosenE164 || "",
        aiNumber: wizard.chosenNumber || "",
        tests: wizard.testStatus === "idle" ? [] : [{ when: "Just now", result: wizard.testStatus === "ok" ? "Confirmed" : "Not working", note: wizard.testNote || "Run from the add-business wizard." }]
      },
      greeting: wizard.greeting,
      voice: wizard.voice,
      languages: wizard.spanish ? ["English", "Spanish"] : ["English"],
      transfer: wizard.transfer || wizard.ownerMobile || "",
      capabilities: { book: wizard.calendar !== "none", reschedule: wizard.calendar !== "none", cancel: wizard.calendar !== "none", transfer: true, textLink: false },
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
        number: wizard.chosenE164
          ? { status: "pending", detail: wizard.chosenNumber + " is selected. Buy and connect on Overview purchases it for about $1.15 a month.", owner: "Team" }
          : { status: "pending", detail: LIVE ? "No AI number yet. Search on Overview, then Buy and connect." : "Number search works in the live control panel.", owner: "Team" },
        test: { status: testStatus, detail: testStatus === "connected" ? "Greeting matched." : testStatus === "action" ? "Test call did not match." : "Test call has not been run.", owner: "Team" },
        forwarding: { status: forwardStatus, detail: forwardDetail, owner: wizard.phoneMode === "forward" ? "Client" : "Team", next: forwardStatus !== "connected" },
        calendar: { status: "pending", detail: calendarDescribe(wizard.calendar).checklist, owner: wizard.calendar === "none" ? "Team" : "Client" },
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
      var feat = CHECK_FEATURES[item.key] ? badge(CHECK_FEATURES[item.key]) : "";
      return '<div class="check"><button class="check-top" type="button" data-action="toggle-check" data-key="' + esc(item.key) + '"><span class="check-label"><b>' + esc(item.label) +
        "</b>" + feat + "</span>" + pill(item.status) + "</button>" + (open ? '<div class="check-body"><p>' + esc(item.detail) + '</p><p class="help">Owner: ' + esc(item.owner) + "</p>" +
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
    return draftSetupCard(b) + minuteBanner(b) + '<div class="split"><section class="card"><div class="card-h"><h2>Setup checklist</h2><span class="help">' + setupCount(b).done + " of " + setupCount(b).total + ' connected</span></div><div class="card-b checklist">' +
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
    if (item.key === "calendar") {
      if (!calendarSignIn(b)) return '<p class="help">' + esc(calendarDescribe(window.RWCalendarStep ? window.RWCalendarStep.choiceValue((b.calendar && b.calendar.provider) || "none") : "none").checklist) + "</p>";
      return '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + id + '" data-kind="calendar">Send sign-in link</button> <button class="btn btn-sm" type="button" data-action="booking-test" data-id="' + id + '">Run booking test</button>';
    }
    if (item.key === "texting") return '<button class="btn btn-sm" type="button" data-action="texting-status">Check registration</button>';
    if (item.key === "email") return '<button class="btn btn-sm" type="button" data-action="check-email" data-id="' + id + '">Check DNS records</button>';
    if (item.key === "reviews") return '<button class="btn btn-sm" type="button" data-action="open-review" data-id="' + id + '">Review link</button>';
    if (item.key === "gbp" || item.key === "social") return '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + id + '" data-kind="social">Send connect link</button>';
    if (item.key === "website") return '<a class="btn btn-sm" href="#website">Website</a>';
    if (item.key === "billing") return '<button class="btn btn-sm" type="button" data-action="payment-link" data-id="' + id + '">Send payment link</button>';
    if (item.key === "number") {
      if (LIVE && !(b.phone && b.phone.aiNumber)) return aiNumberStep(b);
      return '<button class="btn btn-sm" type="button" data-action="call-receptionist" data-id="' + id + '">Call the number</button>';
    }
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
    return '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Phone and forwarding</h2><span class="feat-row">' + badge("phone_number") + badge("number_search") + '<span class="help">' + esc(phoneStatus(b)) + "</span></span></div><div class='card-b'>" +
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
        }).join("") + (LIVE
          ? '<div class="help">' + esc(call.duration) + (call.flag ? " · " + esc(call.flag) : "") + "</div>" +
            (/^https:\/\//.test(call.recordingUrl || "") ? '<audio controls preload="none" src="' + esc(call.recordingUrl) + '" style="width:100%"></audio>' : "") + "</div>"
          : '<div class="help">Recording sample · kept 90 days. ' + esc(call.duration) + (call.flag ? " · " + esc(call.flag) : "") + "</div>" +
            '<button class="btn btn-sm" type="button" data-action="play-call">Play recording</button><div class="scrub"><i></i></div></div>') : "") + "</div>";
    }).join("") || '<div class="empty">No calls yet.</div>';
    return '<div class="split"><section class="card"><div class="card-h"><h2>Receptionist</h2><span class="feat-row">' + badge("receptionist") + '<span class="pill neutral">Draft until you publish</span></span></div><div class="card-b">' +
      '<div class="field"><label>Greeting</label><textarea class="ctrl" id="greet">' + esc(b.greeting) + "</textarea></div>" +
      '<div class="field"><label>Voice ' + badge("voice_dropdown") + '</label><select class="ctrl" id="voice">' + voiceOptions(b.voice) + '</select><div class="help">Saved on this business. Publish uses this voice.</div></div>' +
      '<p class="help">Languages: ' + esc((b.languages || ["English"]).join(", ")) + ". The assistant always offers a person.</p>" +
      capRow + '<p class="help">Texting a link stays off until registration is approved.</p>' +
      (LIVE ? '<p class="help"><a href="settings.html?id=' + encodeURIComponent(b.id) + '">Edit greeting, hours, and booking rules</a></p>' : '') +
      '<div class="head-actions"><button class="btn" type="button" data-action="save-draft" data-id="' + esc(b.id) + '">Save draft</button>' +
      '<button class="btn btn-primary" type="button" data-action="publish-receptionist" data-id="' + esc(b.id) + '">Publish</button>' +
      '<button class="btn" type="button" data-action="run-greeting-test" data-id="' + esc(b.id) + '">Test call</button>' + badge("test_call") + "</div>" +
      "<h3 style='margin:16px 0 8px'>Services and FAQs</h3><ul>" + (b.services || []).map(function (service) {
        return "<li>" + esc(service.name) + " · " + esc(service.length) + " · " + esc(service.price) + "</li>";
      }).join("") + "</ul>" + (b.faqs || []).map(function (faq) {
        return "<p><strong>" + esc(faq.q) + "</strong><br>" + esc(faq.a) + "</p>";
      }).join("") + '</div></section><section class="card"><div class="card-h"><h2>Call log</h2><span class="feat-row">' + badge("call_log") +
      (LIVE ? '<button class="btn btn-sm" type="button" data-action="live-sync-calls" data-id="' + esc(b.id) + '">Refresh calls</button>' : "") +
      "</span></div><div class='card-b'>" + calls + "</div></section></div>";
  }

  function ensureCalendar(b) {
    if (!LIVE || !b || !b.id || calendarByBiz[b.id]) return;
    calendarByBiz[b.id] = { pending: true };
    api("GET", "api/businesses/" + encodeURIComponent(b.id) + "/google-calendar").then(function (data) {
      calendarByBiz[b.id] = data || { failed: true };
      if ((document.body.dataset.page || "") === "client" && currentTab() === "bookings") currentRender();
    }).catch(function () {
      calendarByBiz[b.id] = { failed: true };
      if ((document.body.dataset.page || "") === "client" && currentTab() === "bookings") currentRender();
    });
  }

  function calendarSection(b) {
    var head = '<section class="card" id="google-calendar" style="margin-bottom:12px"><div class="card-h"><h2>Calendar</h2>' + badge("calendar_connection") + '</div><div class="card-b">';
    if (!LIVE) {
      return head +
        '<p class="banner warn">Using the shared demo calendar</p>' +
        '<p class="help">Google Calendar is not configured. This demo does not connect Google.</p>' +
        '<button class="btn" type="button" disabled>Connect Google Calendar</button></div></section>';
    }
    ensureCalendar(b);
    var cal = calendarByBiz[b.id];
    if (!cal || cal.pending) return head + '<p class="help">Loading calendar…</p></div></section>';
    if (cal.failed) return head + '<p class="banner bad">Could not load calendar status.</p></div></section>';
    var warn = cal.warning ? '<p class="banner warn">' + esc(cal.warning) + "</p>" : "";
    if (!cal.configured) {
      var missing = (cal.missing || []).join(", ");
      return head + warn +
        '<p class="help">Google Calendar is not configured' + (missing ? " (" + esc(missing) + ")" : "") + ".</p>" +
        '<button class="btn" type="button" disabled>Connect Google Calendar</button></div></section>';
    }
    if (cal.connected) {
      var name = cal.calendarName || cal.calendarId || "calendar";
      return head + '<p class="banner ok">Connected · ' + esc(name) + (cal.email ? " · " + esc(cal.email) : "") + "</p>" +
        '<button class="btn" type="button" data-action="calendar-disconnect" data-id="' + esc(b.id) + '">Disconnect</button></div></section>';
    }
    var options = (cal.calendars || []).map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.summary || item.id) + (item.primary ? " (primary)" : "") + "</option>";
    }).join("");
    var pick = cal.authorized
      ? (options
        ? '<div class="field"><label for="calendar-choice">Calendar</label><select class="ctrl" id="calendar-choice">' + options + "</select></div>" +
          '<button class="btn btn-primary" type="button" data-action="calendar-save" data-id="' + esc(b.id) + '">Use this calendar</button>'
        : '<p class="help">' + esc(cal.calendarsError || "No calendars were returned. Reconnect Google Calendar.") + "</p>")
      : "";
    return head + warn +
      '<button class="btn btn-primary" type="button" data-action="calendar-connect" data-id="' + esc(b.id) + '">' +
      (cal.authorized ? "Reconnect Google Calendar" : "Connect Google Calendar") + "</button>" + pick + "</div></section>";
  }

  function tabBookings(b) {
    var rows = (b.bookings || []).map(function (booking) {
      return "<tr><td>" + esc(booking.when) + "</td><td>" + esc(booking.customer) + "</td><td>" + esc(booking.service) + "</td><td>" + esc(booking.source) + "</td><td>" + esc(booking.status) + "</td></tr>";
    }).join("");
    return calendarSection(b) +
      '<section class="card"><div class="card-h"><h2>Upcoming</h2>' + badge("bookings") + '</div><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Source</th><th>Status</th></tr></thead><tbody>' +
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
      '<div class="split"><section class="card"><div class="card-b"><h2>Review link</h2>' + badge("reviews") + '<p class="help">' + esc(b.reviewLink || "No link on file yet.") + "</p>" +
      '<div class="head-actions"><button class="btn btn-sm" type="button" data-action="open-review" data-id="' + esc(b.id) + '">Open link</button>' +
      '<button class="btn btn-sm" type="button" data-action="copy-code" data-code="' + esc(b.reviewLink || "") + '">Copy</button></div>' +
      '<div class="qr" aria-hidden="true"></div><p class="help">Sample code for the review link. Send after the visit, one reminder at most.</p>' +
      '<label class="setting-row"><span>Send after each completed visit</span><button class="switch on" type="button" data-action="toggle-local" aria-pressed="true"><i></i></button></label>' +
      '<label class="setting-row"><span>One reminder</span><button class="switch on" type="button" data-action="toggle-local" aria-pressed="true"><i></i></button></label>' +
      "</div></section><div>" + cards + "</div></div>";
  }

  function tabSocial(b) {
    var accounts = b.socialAccounts || {};
    ensureIntegrations(b);
    function row(label, value, provider) {
      var saved = !!(value && String(value).trim());
      var really = integrationConnected(b, provider);
      var help = really ? "Connected" + (saved ? " · " + value : "") : (saved ? String(value) : "Not connected");
      var aside = really
        ? pill("connected")
        : saved
          ? '<span class="pill neutral">Handle saved, not connected</span>'
          : '<button class="btn btn-sm" type="button" data-action="send-link" data-id="' + esc(b.id) + '" data-kind="social">Connect</button>';
      return "<div class='setting-row'><div><strong>" + esc(label) + "</strong><div class='help'>" + esc(help) + "</div></div>" + aside + "</div>";
    }
    var posts = (b.posts || []).map(function (post) {
      return "<tr><td>" + esc(post.when) + "</td><td>" + esc(post.channel) + "</td><td>" + esc(post.text) + "</td><td>" + esc(post.status) + "</td></tr>";
    }).join("");
    return (LIVE ? '<p class="help" style="margin-bottom:8px"><a href="integrations.html?id=' + encodeURIComponent(b.id) + '">Open Integrations for a real connection status</a></p>' : '') +
      '<section class="card" style="margin-bottom:12px"><div class="card-h"><h2>Accounts</h2>' + badge("social") + '</div><div class="card-b">' +
      row("Facebook", accounts.facebook, "facebook") + row("Instagram", accounts.instagram, "instagram") + row("Google Business Profile", accounts.gbp, "google_business") +
      '<button class="btn" type="button" data-action="new-post" data-id="' + esc(b.id) + '">New draft</button></div></section>' +
      '<section class="card"><div class="card-h"><h2>Posts</h2>' + badge("social") + '</div><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Channel</th><th>Post</th><th>Status</th></tr></thead><tbody>' +
      (posts || '<tr><td colspan="4"><div class="empty">No posts yet.</div></td></tr>') + "</tbody></table></div></section>";
  }

  var siteTemplatePick = {};
  var SITE_SUGGEST = {
    Restaurant: "classic",
    Clinic: "classic",
    Retail: "classic",
    "Professional services": "classic",
    "Auto shop": "modern",
    Salon: "modern",
    "Home services": "modern",
    Studio: "modern"
  };

  function liveAdmin() {
    return !!(LIVE && window.RW_LIVE && window.RW_LIVE.user && window.RW_LIVE.user.role === "admin");
  }

  function chosenSiteTemplate(b) {
    var picked = siteTemplatePick[b.id];
    if (picked === "classic" || picked === "modern") return picked;
    var stored = b.generatedWebsite && b.generatedWebsite.template;
    if (stored === "classic" || stored === "modern") return stored;
    return SITE_SUGGEST[b.category] || "classic";
  }

  function templateChoice(b, id, title, detail) {
    var on = chosenSiteTemplate(b) === id ? " on" : "";
    return '<button class="choice' + on + '" type="button" data-action="pick-site-template" data-id="' + esc(b.id) + '" data-template="' + id + '"><b>' +
      esc(title) + "</b><span>" + esc(detail) + "</span></button>";
  }

  function tabWebsite(b) {
    var site = b.generatedWebsite || null;
    var admin = liveAdmin();
    var githubReady = !!(LIVE && window.RW_LIVE && window.RW_LIVE.integrations && window.RW_LIVE.integrations.github);
    var banner = "";
    if (LIVE && admin && !githubReady) banner = '<div class="banner warn">Needs GITHUB_TOKEN on Render</div>';
    else if (LIVE && !admin) banner = '<div class="banner warn">Only an admin can generate the website.</div>';
    else if (!LIVE) banner = '<div class="note">Generating a GitHub repository runs on the live control panel. This demo does not create a repo.</div>';
    var suggested = SITE_SUGGEST[b.category] || "classic";
    var urlLabel = (site && site.pagesUrl) || "Not generated yet";
    var preview = admin
      ? '<iframe class="site-frame" id="site-preview" title="Website preview for ' + esc(b.name) + '" sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe>'
      : '<div class="mini-site"><strong>' + esc(b.name) + "</strong><p>" + esc(b.blurb || b.category || "") + "</p><p class='help'>" +
        (LIVE ? "An admin sees the real template in this frame." : "On the live panel, this frame shows the real Classic or Modern template.") + "</p></div>";
    var links = "";
    if (site && site.repoUrl) {
      links = '<div style="margin-top:12px"><p><a href="' + esc(site.repoUrl) + '" target="_blank" rel="noopener">' + esc(site.repoFullName || "GitHub repository") + "</a></p>" +
        '<p><a href="' + esc(site.pagesUrl) + '" target="_blank" rel="noopener">GitHub Pages URL</a></p>' +
        "<p class='help'>That is the address GitHub Pages would use after you publish. This panel does not host the site.</p>" +
        (site.lastPrUrl ? '<p><a href="' + esc(site.lastPrUrl) + '" target="_blank" rel="noopener">Latest pull request</a></p><p class="help">Regenerate commits to a new branch and opens a pull request. It does not overwrite main.</p>' : "") +
        "</div>";
    }
    var button = "";
    if (!LIVE || admin) {
      button = site && site.repoUrl
        ? '<button class="btn btn-primary" type="button" data-action="regenerate-website" data-id="' + esc(b.id) + '">Regenerate</button>'
        : '<button class="btn btn-primary" type="button" data-action="generate-website" data-id="' + esc(b.id) + '">Generate website</button>';
    }
    var phone = (b.phone && b.phone.aiNumber) ? "Call uses the AI number " + b.phone.aiNumber + "." : "No AI number is on file, so the call button is left off.";
    return '<div class="split"><div class="browser"><div class="browser-bar"><i></i><i></i><i></i><span class="url">' + esc(urlLabel) + "</span></div>" + preview + "</div>" +
      '<section class="card"><div class="card-b">' + banner +
      "<h2>Website</h2>" + badge("website_generator") + "<p class='help'>Two real designs: Classic and Modern. The eight industry names are not eight layouts. They pick an accent color and a suggested design.</p>" +
      "<p class='sub'>" + esc(b.category || "This business") + " suggests " + (suggested === "modern" ? "Modern" : "Classic") + ". You can choose either.</p>" +
      '<div class="choice-grid">' +
      templateChoice(b, "classic", "Classic", "Warm page, rounded buttons, large call button.") +
      templateChoice(b, "modern", "Modern", "Dark hero, sharp type, accent bar.") +
      "</div>" +
      '<div class="head-actions">' + button + "</div>" +
      links +
      "<p class='help'>" + esc(phone) + " Book now uses a saved booking or calendar link, or the AI number when there is no link.</p>" +
      "</div></section></div>";
  }

  var previewSeq = 0;
  function loadSitePreview(b) {
    if (!liveAdmin() || !b) return;
    var frame = document.getElementById("site-preview");
    if (!frame) return;
    var seq = ++previewSeq;
    frame.srcdoc = '<!DOCTYPE html><p style="font-family:system-ui,sans-serif;padding:16px;color:#3c4b5f">Loading preview…</p>';
    api("GET", "api/businesses/" + encodeURIComponent(b.id) + "/website/preview?template=" + encodeURIComponent(chosenSiteTemplate(b))).then(function (data) {
      if (seq !== previewSeq) return;
      var node = document.getElementById("site-preview");
      if (node && data && data.html) node.srcdoc = data.html;
    }).catch(function (err) {
      if (seq !== previewSeq) return;
      var node = document.getElementById("site-preview");
      if (!node) return;
      var message = err && err.data && err.data.code === "NOT_CONFIGURED" ? "Needs GITHUB_TOKEN on Render" : (err && err.message) || "Preview failed.";
      node.srcdoc = '<!DOCTYPE html><p style="font-family:system-ui,sans-serif;padding:16px;color:#3c4b5f">' + esc(message) + "</p>";
    });
  }

  function websiteFail(err) {
    var missing = err && err.data && err.data.missing;
    if (err && err.data && err.data.code === "NOT_CONFIGURED" && missing && missing.indexOf("GITHUB_TOKEN") !== -1) {
      toast("Needs GITHUB_TOKEN on Render");
      return;
    }
    liveFail(err);
  }

  function tabOutreach(b) {
    var rows = (b.campaigns || []).map(function (campaign) {
      return "<tr><td>" + esc(campaign.name) + "</td><td>" + esc(campaign.channel) + "</td><td>" + esc(campaign.when) + "</td><td>" + campaign.sent + "</td><td>" + campaign.clicked + "</td><td>" + campaign.bookings + "</td><td>" + esc(campaign.status) + "</td></tr>";
    }).join("");
    return '<div class="note">Only people who gave this business their email or number, with the date and source recorded. Emails include an unsubscribe link and the business’s postal address. Text replies of STOP are honored immediately. Texts stay off until registration is approved.</div>' +
      '<div class="head-actions" style="margin:12px 0">' + badge("outreach") + '<button class="btn" type="button" data-action="import-contacts" data-id="' + esc(b.id) + '">Import customers</button>' +
      '<button class="btn" type="button" data-action="new-campaign">New campaign</button>' +
      '<button class="btn btn-primary" type="button" data-action="test-send">Send a test</button></div>' +
      '<p class="help">' + (b.contacts || 0) + " contacts · " + (b.suppressed || 0) + " suppressed</p>" +
      '<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Campaign</th><th>Channel</th><th>When</th><th>Sent</th><th>Clicked</th><th>Bookings</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7"><div class="empty">No campaigns yet.</div></td></tr>') + "</tbody></table></div></section>";
  }

  function tabBilling(b) {
    var cost = estimate(b);
    return minuteBanner(b) + '<div class="split"><section class="card"><div class="card-b"><h2>' + esc(b.plan) + "</h2>" + badge("billing") + "<p class='sub'>" + esc(b.tier) + " · " + (b.pilot ? "Pilot, $0" : money(b.price) + " a month") + "</p>" +
      '<dl class="kvs" style="margin-top:12px"><dt>Setup fee</dt><dd>' + (b.setupFee ? money(b.setupFee) : "$0 waived") + "</dd><dt>Trial</dt><dd>" + esc(b.trial || "None") +
      "</dd><dt>Next invoice</dt><dd>" + esc(b.nextInvoice || "—") + "</dd><dt>Card</dt><dd>" + esc(b.card || "—") + "</dd><dt>Minutes</dt><dd>" + minuteCell(b) + "</dd></dl>" +
      '<button class="btn" type="button" data-action="payment-link" data-id="' + esc(b.id) + '">Send card update link</button></div></section>' +
      '<section class="card"><div class="card-h"><h2>Our cost this month</h2><span class="help">Estimate</span></div><div class="card-b"><dl class="kvs">' +
      "<dt>AI minutes</dt><dd>" + money2(cost.minutes) + "</dd><dt>Phone number</dt><dd>" + money2(cost.number) + "</dd><dt>Texts</dt><dd>" + money2(cost.texts) +
      "</dd><dt>Card fees</dt><dd>" + money2(cost.stripe) + "</dd><dt>Total cost</dt><dd>" + money2(cost.total) + "</dd><dt>What we keep</dt><dd>" + money2(cost.keep) +
      "</dd></dl><p class='help'>Minutes at about $0.125. Number at $2. Card fees at 2.9% + 30¢ plus 0.7% for subscriptions. Texting fees stay at $0 until registration is on.</p></div></section></div>";
  }

  function tabSettings(b) {
    return '<section class="card"><div class="card-h"><h2>Settings</h2>' + badge("business_settings") + '</div><div class="card-b"><div class="grid-2">' +
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
      view.innerHTML = '<div class="card"><div class="empty">' + (LIVE ? "That business was not found." : "That business is not in the sample data.") + ' <a href="clients.html">Back to businesses</a></div></div>' + legal();
      return;
    }
    if (title) title.textContent = b.name;
    document.title = b.name + " · ReceptWise";
    noteCalendarReturn();
    var tab = currentTab();
    var tabs = TABS.map(function (item) {
      return '<a class="tab' + (item[0] === tab ? " on" : "") + '" href="#' + item[0] + '">' + esc(item[1]) + statusMarks(TAB_FEATURES[item[0]]) + "</a>";
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
      '<div class="head-actions">' + (b.status === "draft" ? '<a class="btn btn-primary" href="add.html?draft=' + encodeURIComponent(b.id) + '">Resume setup</a>' : '') +
      '<button class="btn" type="button" data-action="call-receptionist" data-id="' + esc(b.id) + '">Call the receptionist</button>' +
      '<button class="btn btn-primary" type="button" data-action="send-steps" data-id="' + esc(b.id) + '">Send owner their steps</button></div></section>' +
      '<nav class="tabs">' + tabs + "</nav>" + featureBar(TAB_FEATURES[tab]) + body + legal();
    if (tab === "website") loadSitePreview(b);
  }

  function noteCalendarReturn() {
    if (!LIVE) return;
    var params = new URLSearchParams(location.search);
    var flag = params.get("calendar");
    if (!flag) return;
    if (flag === "connected") toast("Google account connected. Choose which calendar to use.");
    else if (flag === "error") toast(params.get("message") || "Google Calendar connection failed.");
    params.delete("calendar");
    params.delete("message");
    var id = params.get("id");
    if (id) delete calendarByBiz[id];
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash);
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
    var admin = !LIVE || (window.RW_LIVE && window.RW_LIVE.user && window.RW_LIVE.user.role === "admin");
    var exportCard = '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Export data</h2></div><div class="card-b">' +
      '<p class="help">Download clients, receptionist settings, calls, and activity. Passwords and connected-account tokens are left out. On the free Render database, download this before the 30-day expiry.</p>' +
      (LIVE && admin
        ? '<div class="head-actions"><a class="btn btn-primary" href="api/export?format=json">Export data</a><a class="btn" href="api/export?format=sql">Export SQL</a></div>'
        : LIVE
          ? '<p class="help">An admin can download the backup.</p>'
          : '<button class="btn btn-primary" type="button" data-action="export-demo">Export data</button>') +
      "</div></section>";
    view.innerHTML = '<div class="page-head"><div><h1>Team and settings</h1><p class="sub">' +
      (admin ? "You are signed in as an admin, so billing costs are visible." : "Team access. Billing costs and data export stay with an admin.") +
      '</p></div>' +
      '<button class="btn btn-primary" type="button" data-action="invite-open">Invite teammate</button></div>' +
      '<div class="split"><section class="card"><div class="card-h"><h2>Team</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Role</th><th>Access</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section><div class='stack'><section class='card'><div class='card-h'><h2>Company</h2></div><div class='card-b'><dl class='kvs'>" +
      "<dt>Legal entity</dt><dd>[Placeholder]</dd><dt>Product</dt><dd>ReceptWise</dd><dt>Texting</dt><dd>Off until the final company tax ID is on file</dd><dt>Calls</dt><dd>Can be set up now</dd></dl></div></section>" +
      '<section class="card"><div class="card-h"><h2>Notifications</h2></div><div class="card-b">' + switches + "</div></section></div></div>" +
      '<section class="card" style="margin-top:14px"><div class="card-h"><h2>Planned connections</h2></div><div class="card-b">' + tools + "</div></section>" +
      exportCard + legal();
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
      '<p class="legal">ReceptWise is a product of [Placeholder].' + (LIVE ? "" : " This is a clickable prototype with sample data.") + '</p></section>' +
      '<section class="login-panel"><form class="login-card" data-action="login"><h2>Sign in</h2><p class="sub">Internal team only.</p>' +
      '<div class="field" style="margin-top:16px"><label for="email">Email</label><input class="ctrl" id="email" name="email" type="email" autocomplete="username" placeholder="you@receptwise.example"></div>' +
      '<div class="field"><label for="password">Password</label><input class="ctrl" id="password" name="password" type="password" autocomplete="current-password" placeholder="' + (LIVE ? "Password" : "Any password") + '"></div>' +
      '<button class="btn btn-primary" type="submit" style="width:100%">Sign in</button><p class="help">' + (LIVE ? "Team accounts only. Ask an admin for access." : "This prototype accepts any email and password.") + '</p></form></section></div>' +
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
      if (el.dataset.field === "chosenE164") wizard.chosenNumber = el.dataset.label || el.dataset.value || "";
      if (el.dataset.field === "tier") {
        wizard.plan = { Solo: "Starter", Small: "Growth", Growing: "Pro" }[el.dataset.value] || wizard.plan;
      }
      if (el.dataset.field === "category" && !wizard.template) wizard.template = el.dataset.value;
      wizard.error = "";
      renderWizard();
    },
    "show-numbers": function () {
      readWizard();
      syncAreaCode();
      toast("Number search works in the live control panel.");
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
      syncAreaCode();
      if (digits(wizard.chosenNumber).length < 10) {
        toast("Choose an AI number before sending forwarding codes.");
        return;
      }
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
      if (wizard.saving) return;
      if (wizard.step > 0) wizard.step -= 1;
      wizard.error = "";
      if (wizard.step === 5) ensureGreeting();
      wizard.saving = true;
      saveDraft().then(function () { afterDraftSave(true); }).catch(function (err) { failDraftSave(err); });
    },
    next: function () {
      readWizard();
      syncAreaCode();
      if (wizard.saving) return;
      wizard.error = "";
      if (wizard.step === 0 && !wizard.name.trim()) wizard.error = "Enter the business name.";
      else if (wizard.step === 0 && !wizard.category) wizard.error = "Choose a business type.";
      else if (wizard.step === 2 && LIVE && wizard.numberOptions && wizard.numberOptions.length && !wizard.chosenE164) wizard.error = "Pick one of the available numbers. It is not bought until Buy and connect.";
      else if (wizard.step === 2 && wizard.phoneMode === "forward" && digits(wizard.businessNumber).length < 10) wizard.error = "Enter the 10-digit business number to forward.";
      if (wizard.error) { renderWizard(); return; }
      if (wizard.step === 1 && wizard.multi) {
        wizard.tier = "Growing";
        wizard.plan = "Pro";
      }
      var previous = wizard.step;
      if (wizard.step < 9) wizard.step += 1;
      if (wizard.step === 5) ensureGreeting();
      wizard.saving = true;
      renderWizard();
      saveDraft().then(function () { afterDraftSave(true); }).catch(function (err) { failDraftSave(err, previous); });
    },
    "goto-step": function (el) {
      readWizard();
      if (wizard.saving) return;
      var nextStep = Number(el.dataset.step) || 0;
      if (wizard.step === 0 && nextStep !== 0) {
        if (!wizard.name.trim()) wizard.error = "Enter the business name.";
        else if (!wizard.category) wizard.error = "Choose a business type.";
        if (wizard.error) { renderWizard(); return; }
      }
      var previous = wizard.step;
      wizard.step = nextStep;
      wizard.error = "";
      if (wizard.step === 5) ensureGreeting();
      if (!(wizard.name.trim() && wizard.category) || (previous === 0 && nextStep === 0 && !wizard.draftId)) {
        renderWizard();
        return;
      }
      wizard.saving = true;
      saveDraft().then(function () { afterDraftSave(true); }).catch(function (err) { failDraftSave(err, previous); });
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
      business.status = "setup";
      if (wizard.draftId) business.id = wizard.draftId;
      removeDraftRecord(business.id);
      var all = createdList();
      all.push(business);
      extraCache = all;
      storageSet("rw_created", JSON.stringify(all));
      wizard.finished = true;
      wizard.createdId = business.id;
      wizard.step = 10;
      toast(business.name + " added.");
      renderWizard();
    },
    "delete-draft": function (el) {
      var name = el.dataset.name || "this draft";
      openModal("Delete this draft?", "<p><strong>" + esc(name) + "</strong> will be removed from the Businesses list. A draft has not bought a number or published a receptionist.</p>",
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="confirm-delete-draft" data-id="' + esc(el.dataset.id || "") + '">Delete draft</button>');
    },
    "confirm-delete-draft": function (el) {
      var id = el.dataset.id || "";
      function done() {
        closeModal();
        toast("Draft deleted.");
        if (wizard.draftId === id) {
          wizard = defaultWizard();
          if ((document.body.dataset.page || "") === "add") {
            history.replaceState(null, "", "add.html");
            renderWizard();
            return;
          }
        }
        if (currentRender) currentRender();
      }
      if (LIVE) {
        api("DELETE", "api/businesses/" + encodeURIComponent(id)).then(function () {
          var list = window.RW_DATA.businesses || [];
          window.RW_DATA.businesses = list.filter(function (item) { return item.id !== id; });
          done();
        }).catch(liveFail);
        return;
      }
      removeDraftRecord(id);
      done();
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
    "pick-site-template": function (el) {
      if (el.dataset.template !== "classic" && el.dataset.template !== "modern") return;
      siteTemplatePick[el.dataset.id] = el.dataset.template;
      currentRender();
    },
    "generate-website": function () {
      toast("Generating a GitHub repository runs on the live control panel.");
    },
    "regenerate-website": function () {
      toast("Updating the repository runs on the live control panel.");
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
    "add-faq": function () {
      var list = document.getElementById("faq-list");
      if (list) list.insertAdjacentHTML("beforeend", faqRow("", ""));
    },
    "remove-faq": function (el) {
      var row = el.closest(".faq-row");
      if (row) row.remove();
    },
    "save-settings": function () {
      toast("This demo does not update the live receptionist.");
    },
    "record-integration": function () {
      toast("This demo does not connect accounts.");
    },
    "trello-save-key": function () { toast("This demo does not connect Trello."); },
    "trello-test": function () { toast("This demo does not connect Trello."); },
    "trello-save-rules": function () { toast("This demo does not connect Trello."); },
    "trello-remove": function () { toast("This demo does not connect Trello."); },
    "export-demo": function () { toast("This demo does not export data."); },
    "remove-integration": function () {
      toast("This demo does not connect accounts.");
    },
    "sync-dashboard": function () {
      toast("This demo does not sync calls.");
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

  function ensureNumberPick(b) {
    if (!b) return;
    if (numberPick.bizId === b.id) return;
    var requested = (b.phone && b.phone.requestedE164) || "";
    var area = digits(requested).slice(0, 3) || "781";
    numberPick = {
      bizId: b.id,
      areaCode: area,
      status: requested ? "ready" : "idle",
      options: requested ? [{ e164: requested, friendly: pretty(digits(requested)) || requested, locality: "Saved choice", region: "" }] : [],
      error: "",
      chosenE164: requested
    };
  }

  function refreshNumbers(b) {
    if (currentRender) currentRender();
    var back = document.getElementById("modal-back");
    if (back && back.classList.contains("open") && b) numberModal(b);
  }

  function aiNumberStep(b) {
    ensureNumberPick(b);
    var missing = missingNumberKeys();
    if (missing.length) {
      return "<p class='banner warn'>Not connected yet. Add " + esc(missing.join(" and ")) + " on the server, then come back.</p>";
    }
    if (!isAdmin()) return '<p class="help">Admins only.</p>';
    var loading = numberPick.status === "loading";
    return '<div class="number-search"><p class="help">Searching does not buy a number. It is purchased only when you choose Buy and connect, and a local number costs about $1.15 a month. Texting stays off.</p>' +
      '<div class="field"><label>Area code</label><div class="inline"><input class="ctrl" data-number-area value="' + esc(numberPick.areaCode || "") + '" placeholder="781">' +
      '<button class="btn" type="button" data-action="show-biz-numbers" data-id="' + esc(b.id) + '"' + (loading ? " disabled" : "") + ">Show numbers</button></div></div>" +
      numberResultBlock(numberPick, "pick-biz-number", b.id) +
      '<button class="btn btn-primary" type="button" data-action="live-provision" data-id="' + esc(b.id) + '"' + (loading ? " disabled" : "") + ">Buy and connect</button></div>";
  }

  function numberModal(b) {
    if (b.phone && b.phone.aiNumber) {
      openModal("Receptionist test call", "<p>The receptionist will call you from <strong>" + esc(b.phone.aiNumber) + "</strong>. Answer to hear the greeting.</p>" +
        '<div class="field"><label for="test-to">Your phone</label><input class="ctrl" id="test-to" placeholder="(617) 555-0100"></div>',
        '<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="button" data-action="live-test-call" data-id="' + esc(b.id) + '">Call me</button>');
      return;
    }
    openModal("Get an AI number", aiNumberStep(b), '<button class="btn" type="button" data-action="close-modal">Close</button>');
  }

  var liveActions = {
    "calendar-connect": function (el) {
      api("POST", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/google-calendar/start").then(function (data) {
        if (data && data.url) location.href = data.url;
        else toast("Google Calendar did not return a sign-in link.");
      }).catch(liveFail);
    },
    "calendar-save": function (el) {
      var choice = document.getElementById("calendar-choice");
      if (!choice || !choice.value) { toast("Choose a calendar."); return; }
      api("PUT", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/google-calendar", { calendarId: choice.value }).then(function (data) {
        calendarByBiz[el.dataset.id] = data;
        toast(data.calendarName ? "Using " + data.calendarName + "." : "Calendar saved.");
        if (currentRender) currentRender();
      }).catch(liveFail);
    },
    "calendar-disconnect": function (el) {
      api("DELETE", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/google-calendar").then(function (data) {
        calendarByBiz[el.dataset.id] = data;
        toast("Google Calendar disconnected.");
        if (currentRender) currentRender();
      }).catch(liveFail);
    },
    "sign-out": function () {
      api("POST", "api/auth/logout").catch(function () {}).then(function () { location.href = "index.html"; });
    },
    "create-business": function () {
      readWizard();
      if (!wizard.name.trim() || !wizard.category) {
        wizard.step = 0;
        wizard.error = "Name and business type are required before creating the business.";
        renderWizard();
        return;
      }
      wizard.finished = true;
      var body = buildBusiness();
      var req = wizard.draftId
        ? api("POST", "api/businesses/" + encodeURIComponent(wizard.draftId) + "/draft/finish", body)
        : api("POST", "api/businesses", body);
      req.then(function (data) {
        replaceBiz(data.business);
        wizard.createdId = data.business.id;
        wizard.draftId = data.business.id;
        wizard.step = 10;
        toast(data.business.name + " added.");
        renderWizard();
      }).catch(function (err) {
        wizard.finished = false;
        liveFail(err);
      });
    },
    "save-draft": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var greet = document.getElementById("greet");
      var voice = document.getElementById("voice");
      if (greet) b.greeting = greet.value;
      if (voice) b.voice = voice.value;
      persistBiz(b, "Draft saved. Publish when callers should hear it.").catch(liveFail);
    },
    "publish-receptionist": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      var greet = document.getElementById("greet");
      var voice = document.getElementById("voice");
      if (greet) b.greeting = greet.value;
      if (voice) b.voice = voice.value;
      persistBiz(b).then(function () {
        return api("POST", "api/businesses/" + encodeURIComponent(b.id) + "/assistant/publish");
      }).then(function () {
        toast("Published. Callers now hear this greeting.");
      }).catch(function (err) {
        if (err.data && err.data.code === "NOT_CONFIGURED") toast("Saved. Not published: " + err.message);
        else liveFail(err);
      });
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
      persistBiz(b, "Settings saved.").catch(liveFail);
    },
    "pause-biz": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      b.paused = !b.paused;
      persistBiz(b, b.paused ? "Receptionist paused." : "Receptionist resumed.").catch(liveFail);
    },
    "call-receptionist": function (el) {
      var b = findBiz(el.dataset.id);
      if (b) numberModal(b);
    },
    "run-greeting-test": function (el) {
      var b = findBiz(el.dataset.id);
      if (b) numberModal(b);
    },
    "show-numbers": function () {
      readWizard();
      syncAreaCode();
      if (!isAdmin()) {
        wizard.numberStatus = "error";
        wizard.numberError = "Admins only.";
        renderWizard();
        return;
      }
      var missing = missingNumberKeys();
      if (missing.length) {
        wizard.numberStatus = "error";
        wizard.numberError = "Not connected yet. Add " + missing.join(" and ") + ".";
        renderWizard();
        return;
      }
      if (String(wizard.areaCode || "").length !== 3) {
        wizard.numberStatus = "error";
        wizard.numberError = "Enter a 3-digit area code.";
        renderWizard();
        return;
      }
      wizard.numberStatus = "loading";
      wizard.numberError = "";
      wizard.numberOptions = [];
      renderWizard();
      api("GET", "api/numbers/search?areaCode=" + encodeURIComponent(wizard.areaCode)).then(function (data) {
        var list = data.numbers || [];
        wizard.numberOptions = list;
        wizard.numberStatus = list.length ? "ready" : "empty";
        if (wizard.chosenE164 && !list.some(function (n) { return n.e164 === wizard.chosenE164; })) {
          wizard.chosenE164 = "";
          wizard.chosenNumber = "";
        }
        renderWizard();
      }).catch(function (err) {
        wizard.numberStatus = "error";
        wizard.numberError = (err && err.message) || "Number search failed.";
        wizard.numberOptions = [];
        renderWizard();
      });
    },
    "show-biz-numbers": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      ensureNumberPick(b);
      var root = el.closest(".number-search");
      var box = root ? root.querySelector("[data-number-area]") : null;
      var area = String((box && box.value) || "").replace(/\D/g, "").slice(0, 3);
      numberPick.areaCode = area;
      if (area.length !== 3) {
        numberPick.status = "error";
        numberPick.error = "Enter a 3-digit area code.";
        refreshNumbers(b);
        return;
      }
      numberPick.status = "loading";
      numberPick.error = "";
      numberPick.options = [];
      refreshNumbers(b);
      api("GET", "api/numbers/search?areaCode=" + encodeURIComponent(area)).then(function (data) {
        var list = data.numbers || [];
        numberPick.options = list;
        numberPick.status = list.length ? "ready" : "empty";
        if (numberPick.chosenE164 && !list.some(function (n) { return n.e164 === numberPick.chosenE164; })) numberPick.chosenE164 = "";
        refreshNumbers(b);
      }).catch(function (err) {
        numberPick.status = "error";
        numberPick.error = (err && err.message) || "Number search failed.";
        numberPick.options = [];
        refreshNumbers(b);
      });
    },
    "pick-biz-number": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      ensureNumberPick(b);
      numberPick.chosenE164 = el.dataset.value || "";
      refreshNumbers(b);
    },
    "live-provision": function (el) {
      var b = findBiz(el.dataset.id);
      ensureNumberPick(b);
      var chosen = numberPick.bizId === el.dataset.id ? numberPick.chosenE164 : "";
      if (!chosen) {
        toast("Pick a number first. Searching does not buy one.");
        return;
      }
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/numbers/provision", { e164: chosen }).then(function (data) {
        replaceBiz(data.business);
        closeModal();
        numberPick = { bizId: "", areaCode: "", status: "idle", options: [], error: "", chosenE164: "" };
        toast((data.pretty || chosen) + " is live.");
        currentRender();
      }).catch(function (err) { el.disabled = false; liveFail(err); });
    },
    "live-test-call": function (el) {
      var box = document.getElementById("test-to");
      var to = box ? box.value : "";
      if (digits(to).length < 10) { toast("Enter a 10-digit phone number."); return; }
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/test-call", { to: to }).then(function () {
        closeModal();
        toast("Calling you now. The result shows up in the call log.");
      }).catch(function (err) { el.disabled = false; liveFail(err); });
    },
    "save-settings": function (el) {
      var id = el.dataset.id || pageBizId();
      el.disabled = true;
      api("PUT", "api/businesses/" + encodeURIComponent(id) + "/settings", readSettings()).then(function (data) {
        el.disabled = false;
        if (data.pushed) toast("Saved and pushed to the live receptionist.");
        else toast("Saved. Not pushed" + (data.missing ? ": " + data.missing.join(", ") : "") + ".");
        renderSettings(document.getElementById("view"));
      }).catch(function (err) {
        el.disabled = false;
        toast(err.message);
      });
    },
    "record-integration": function (el) {
      var provider = el.dataset.provider;
      var handle = document.getElementById("handle-" + provider);
      var url = document.getElementById("url-" + provider);
      api("PUT", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/integrations/" + encodeURIComponent(provider), {
        handle: handle ? handle.value : "",
        profileUrl: url ? url.value : ""
      }).then(function () {
        toast("Handle recorded. This is not a live connection.");
        renderIntegrations(document.getElementById("view"));
      }).catch(liveFail);
    },
    "remove-integration": function (el) {
      api("DELETE", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/integrations/" + encodeURIComponent(el.dataset.provider)).then(function () {
        toast("Removed.");
        renderIntegrations(document.getElementById("view"));
      }).catch(liveFail);
    },
    "trello-save-key": function (el) {
      var key = document.getElementById("trello-key");
      var token = document.getElementById("trello-token");
      api("PUT", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/trello/credentials", {
        apiKey: key ? key.value : "",
        token: token ? token.value : ""
      }).then(function () {
        if (key) key.value = "";
        if (token) token.value = "";
        toast("Key saved on the server.");
        renderIntegrations(document.getElementById("view"));
      }).catch(liveFail);
    },
    "trello-test": function (el) {
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/trello/test").then(function (data) {
        toast(data.memberName ? "Connected as " + data.memberName + "." : "Connection succeeded.");
        renderIntegrations(document.getElementById("view"));
      }).catch(function (err) { el.disabled = false; liveFail(err); });
    },
    "trello-save-rules": function (el) {
      var board = document.getElementById("trello-board");
      var list = document.getElementById("trello-list");
      var booking = document.getElementById("trello-booking");
      var missed = document.getElementById("trello-missed");
      api("PUT", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/trello", {
        boardId: board ? board.value : "",
        listId: list ? list.value : "",
        rules: { booking: !!(booking && booking.checked), missedCall: !!(missed && missed.checked) }
      }).then(function () {
        toast("Board and rules saved.");
        renderIntegrations(document.getElementById("view"));
      }).catch(liveFail);
    },
    "trello-remove": function (el) {
      api("DELETE", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/trello/credentials").then(function () {
        toast("Saved Trello key removed.");
        renderIntegrations(document.getElementById("view"));
      }).catch(liveFail);
    },
    "sync-dashboard": function (el) {
      el.disabled = true;
      api("POST", "api/calls/sync", {}).then(function (data) {
        toast("Synced " + (data.synced || 0) + " calls.");
        location.reload();
      }).catch(function (err) {
        el.disabled = false;
        liveFail(err);
      });
    },
    "live-sync-calls": function (el) {
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(el.dataset.id) + "/calls/sync").then(function (data) {
        replaceBiz(data.business);
        toast(data.synced + " calls checked.");
        currentRender();
      }).catch(function (err) { el.disabled = false; liveFail(err); });
    },
    "generate-website": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(b.id) + "/website/generate", { template: chosenSiteTemplate(b) }).then(function (data) {
        replaceBiz(data.business);
        toast(data.pagesEnabled ? "Website repository created." : "Website repository created. Turn on GitHub Pages from the repository settings.");
        currentRender();
      }).catch(function (err) {
        el.disabled = false;
        websiteFail(err);
      });
    },
    "regenerate-website": function (el) {
      var b = findBiz(el.dataset.id);
      if (!b) return;
      el.disabled = true;
      api("POST", "api/businesses/" + encodeURIComponent(b.id) + "/website/regenerate", { template: chosenSiteTemplate(b) }).then(function (data) {
        replaceBiz(data.business);
        toast("Pull request opened. Main was not overwritten.");
        currentRender();
      }).catch(function (err) {
        el.disabled = false;
        websiteFail(err);
      });
    }
  };
  if (LIVE) Object.keys(liveActions).forEach(function (key) { actions[key] = liveActions[key]; });

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
    } else if (el.dataset.action === "trello-board") {
      if (!LIVE) return;
      var listBox = document.getElementById("trello-list");
      if (listBox) listBox.innerHTML = '<option value="">Loading lists…</option>';
      loadTrelloLists(el.dataset.id || pageBizId(), el.value, "");
    } else if (el.dataset.action === "go-business") {
      var pageName = document.body.dataset.page || "phone";
      var file = pageName === "settings" ? "settings.html" : pageName === "integrations" ? "integrations.html" : "phone.html";
      location.href = file + "?id=" + encodeURIComponent(el.value);
    } else if (el.dataset.action === "cap-toggle") {
      var business = findBiz(el.dataset.id);
      if (!business) return;
      business.capabilities = business.capabilities || {};
      business.capabilities[el.dataset.cap] = el.checked;
      if (LIVE) persistBiz(business, "Saved. Publish the receptionist to make it live.").catch(liveFail);
      else toast("Saved on the draft. Publish the receptionist to make it live.");
    }
  }

  function onSubmit(event) {
    var form = event.target;
    if (!form || form.dataset.action !== "login") return;
    event.preventDefault();
    var email = (form.email && form.email.value || "").trim();
    if (LIVE) {
      var password = form.password ? form.password.value : "";
      api("POST", "api/auth/login", { email: email, password: password }).then(function () {
        location.href = "dashboard.html";
      }).catch(function (err) { toast(err.message); });
      return;
    }
    storageSet("rw_session", JSON.stringify({ email: email, name: nameFromEmail(email) }));
    location.href = "dashboard.html";
  }

  function pageBizId() {
    var params = new URLSearchParams(location.search);
    var id = params.get("id");
    if (id && findBiz(id)) return id;
    var list = ordered(allBusinesses());
    var pilot = list.filter(function (b) { return b.pilot; })[0];
    return (pilot || list[0] || {}).id || "";
  }

  function bizSelect() {
    var id = pageBizId();
    var opts = ordered(allBusinesses()).map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === id ? " selected" : "") + ">" + esc(b.name) + (b.pilot ? " · Pilot" : "") + "</option>";
    }).join("");
    return '<label class="field" style="margin:0;min-width:220px"><span class="help">Business</span><select class="ctrl" data-action="go-business" aria-label="Business">' + opts + "</select></label>";
  }

  function clock(sec) {
    if (sec == null || sec === "") return "—";
    var s = Math.max(0, Math.round(Number(sec)));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function renderLiveDashboard(view) {
    var m = window.RW_DATA.metrics || {};
    var calls = m.calls || {};
    var answered = m.answered || {};
    var missed = m.missed || {};
    var avg = m.avgDurationSec || {};
    var bookings = m.bookings || {};
    var ints = (window.RW_LIVE && window.RW_LIVE.integrations) || {};
    var banner = ints.vapi ? "" : '<div class="banner warn">Vapi is not connected. Set VAPI_API_KEY to sync calls and push receptionist settings. Calls already stored here still count.</div>';
    var focusCall = "";
    try { focusCall = new URLSearchParams(location.search).get("call") || ""; } catch (e) { focusCall = ""; }
    var recent = (m.recentCalls || []).map(function (call) {
      var who = call.callerName ? esc(call.callerName) + "<div class='help'>" + esc(call.from) + "</div>" : esc(call.from);
      var rec = /^https?:\/\//.test(call.recordingUrl || "") ? '<a href="' + esc(call.recordingUrl) + '" target="_blank" rel="noopener">Play</a>' : "—";
      var tone = call.outcome === "Booked" ? "connected" : call.outcome === "Missed" ? "action" : "neutral";
      var focus = focusCall && focusCall === call.id ? ' class="call-focus"' : "";
      return "<tr" + focus + "><td>" + esc(call.time) + "</td><td>" + who + "</td><td>" + esc(call.businessName || "") + "</td><td>" +
        '<span class="pill ' + tone + '">' + esc(call.outcome || "—") + "</span>" +
        "</td><td>" + esc(call.duration || "—") + "</td><td>" + esc(call.summary || "—") + "</td><td>" + rec + "</td></tr>";
    }).join("");
    var activity = (m.activity || []).map(function (item) {
      return "<div class='setting-row'><div><strong>" + esc(item.businessName || "ReceptWise") + "</strong><div class='help'>" + esc(item.text) + "</div></div><span class='help'>" + esc(item.time) + "</span></div>";
    }).join("");
    var list = ordered(allBusinesses());
    var rows = list.map(function (b) {
      return "<tr><td><a href='client.html?id=" + encodeURIComponent(b.id) + "'>" + esc(b.name) + "</a>" + (b.pilot ? " <span class='pill pilot'>Pilot</span>" : "") +
        (b.status === "draft" ? " " + pill("draft") : "") +
        "</td><td>" + (b.callsToday || 0) + "</td><td>" + (b.bookingsToday || 0) + "</td><td>" + esc(phoneStatus(b)) + "</td><td>" +
        (b.status === "draft" ? draftActions(b) : "<a href='phone.html?id=" + encodeURIComponent(b.id) + "'>Phone</a> · <a href='settings.html?id=" + encodeURIComponent(b.id) + "'>Settings</a>") +
        "</td></tr>";
    }).join("");
    view.innerHTML = '<div class="page-head"><div><h1>Overview</h1><p class="sub">' + esc(todayLabel()) + " · calls stored for the businesses you manage</p></div>" +
      '<div class="head-actions"><button class="btn" type="button" data-action="sync-dashboard">Sync from Vapi</button><a class="btn btn-primary" href="settings.html">Receptionist settings</a></div></div>' +
      banner +
      '<section class="stats"><article class="stat"><em>Calls today</em><b>' + (calls.today || 0) + "</b><span>7 days " + (calls.d7 || 0) + " · 30 days " + (calls.d30 || 0) + "</span></article>" +
      '<article class="stat"><em>Answered, 7 days</em><b>' + (answered.d7 || 0) + "</b><span>Missed " + (missed.d7 || 0) + " · today " + (answered.today || 0) + " answered, " + (missed.today || 0) + " missed</span></article>" +
      '<article class="stat"><em>Avg length, 7 days</em><b>' + clock(avg.d7) + "</b><span>Answered calls · today " + clock(avg.today) + "</span></article>" +
      '<article class="stat"><em>Bookings</em><b>' + (bookings.today || 0) + "</b><span>Confirmed on the call · 7 days " + (bookings.d7 || 0) + " · 30 days " + (bookings.d30 || 0) + "</span></article></section>" +
      '<section class="card"><div class="card-h"><h2>Recent calls</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Caller</th><th>Business</th><th>Outcome</th><th>Duration</th><th>Summary</th><th>Recording</th></tr></thead><tbody>' +
      (recent || '<tr><td colspan="7"><div class="empty">No calls yet. Point the Vapi server URL at this app, or use Sync from Vapi once the API key is set.</div></td></tr>') +
      "</tbody></table></div></section>" +
      '<div class="grid-main" style="margin-top:14px"><section class="card"><div class="card-h"><h2>Businesses</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Business</th><th>Calls today</th><th>Bookings today</th><th>Phone</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5"><div class="empty">No businesses yet.</div></td></tr>') +
      '</tbody></table></div></section><section class="card"><div class="card-h"><h2>Activity</h2></div><div class="card-b">' +
      (activity || '<div class="empty">Calls, bookings, settings changes, and integration changes show up here.</div>') +
      "</div></section></div>" + legal();
    var focused = view.querySelector(".call-focus");
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: "center" });
  }

  function phoneStateBanner(data) {
    if (!data) return "";
    if (data.state === "connected") return '<div class="banner ok">The receptionist number is attached.</div>';
    if (data.state === "error") return '<div class="banner bad">' + esc(data.error || "The phone provider could not be reached.") + "</div>";
    var missing = (data.missing || []).concat(data.twilio === "ready" ? [] : (data.twilioMissing || []));
    var extra = missing.length ? " Missing: " + missing.join(", ") + "." : "";
    return '<div class="banner warn">Not connected.' + esc(extra) + " Live status appears after the keys are set. Nothing here is a guessed connection.</div>";
  }

  function renderPhone(view) {
    var id = pageBizId();
    if (!LIVE) {
      view.innerHTML = '<div class="page-head"><div><h1>Phone</h1>' + featureBar(["phone_number"]) + '<p class="sub">Numbers attached to the receptionist</p></div></div>' +
        '<div class="card"><div class="empty">This demo does not call the phone provider. On the live control panel this page shows the number, the assistant it is attached to, and a clear not-connected state when keys are missing.</div></div>' + legal();
      return;
    }
    if (!id) {
      view.innerHTML = '<div class="card"><div class="empty">Add a business before checking a number.</div></div>' + legal();
      return;
    }
    view.innerHTML = '<p class="sub">Checking the phone line…</p>';
    api("GET", "api/businesses/" + encodeURIComponent(id) + "/phone").then(function (data) {
      var cards = (data.numbers || []).map(function (n) {
        var assistant = n.assistantName || (n.assistantId ? n.assistantId : "No assistant");
        return '<article class="card" style="margin-bottom:12px"><div class="card-b"><div class="phone-num">' + esc(n.pretty || n.e164) + "</div>" +
          "<p class='sub'>" + esc(n.e164 || "") + " · " + esc(n.provider || "twilio") + "</p>" +
          "<div class='pills' style='margin:8px 0'>" + pill(n.status) + "<span class='help'>" + esc(n.statusLabel || "") + "</span></div>" +
          "<dl class='kvs'><dt>Assistant</dt><dd>" + esc(assistant) + "</dd>" +
          (n.twilioStatus ? "<dt>Twilio</dt><dd>" + esc(n.twilioStatus) + "</dd>" : "") +
          "</dl><p class='help'>" + esc(n.detail || "") + "</p></div></article>";
      }).join("");
      view.innerHTML = '<div class="page-head"><div><h1>Phone</h1>' + featureBar(["phone_number"]) + '<p class="sub">The line attached to this receptionist</p></div>' + bizSelect() + "</div>" +
        phoneStateBanner(data) +
        (data.testCallHint ? '<div class="note calm">' + esc(data.testCallHint) + "</div>" : "") +
        (cards || '<div class="card"><div class="empty">No number is on file for this business.</div></div>') + legal();
    }).catch(function (err) {
      view.innerHTML = '<div class="banner bad">' + esc(err.message) + "</div>" + legal();
    });
  }

  var DAY_OPTS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
  var ZONE_OPTS = [
    ["America/New_York", "Eastern Time"], ["America/Chicago", "Central Time"], ["America/Denver", "Mountain Time"],
    ["America/Los_Angeles", "Pacific Time"], ["America/Phoenix", "Arizona Time"], ["America/Anchorage", "Alaska Time"],
    ["Pacific/Honolulu", "Hawaii Time"]
  ];

  function faqRow(q, a) {
    return '<div class="faq-row"><textarea class="ctrl faq-q" placeholder="Question">' + esc(q || "") + '</textarea><textarea class="ctrl faq-a" placeholder="Answer">' +
      esc(a || "") + '</textarea><button class="btn btn-sm" type="button" data-action="remove-faq">Remove</button></div>';
  }

  function settingsForm(payload, id) {
    var s = (payload && payload.settings) || {};
    var days = s.bookableDays || [];
    var dayHtml = DAY_OPTS.map(function (d) {
      return '<label class="day"><input type="checkbox" name="day" value="' + d[0] + '"' + (days.indexOf(d[0]) >= 0 ? " checked" : "") + "> " + d[1] + "</label>";
    }).join("");
    var zones = ZONE_OPTS.map(function (z) {
      return '<option value="' + z[0] + '"' + (s.timezone === z[0] ? " selected" : "") + ">" + z[1] + "</option>";
    }).join("");
    var faqs = (s.faqs && s.faqs.length ? s.faqs : [{ q: "", a: "" }]).map(function (f) { return faqRow(f.q, f.a); }).join("");
    var pushed = payload && payload.lastPushedAt ? '<p class="help">Last pushed ' + esc(String(payload.lastPushedAt)) + ".</p>" : "";
    var hint = payload && payload.testCall ? payload.testCall.hint : "";
    return '<div class="page-head"><div><h1>Receptionist</h1>' + featureBar(["receptionist"]) + '<p class="sub">Saved here, then pushed to the live assistant when Vapi is connected.</p></div>' + bizSelect() + "</div>" +
      (hint ? '<div class="note calm">' + esc(hint) + "</div>" : "") +
      (payload && payload.vapiConfigured ? '<div class="banner ok">Vapi is connected. Saving updates the live greeting and instructions.</div>' : '<div class="banner warn">Vapi is not connected. Settings save in the panel and push after VAPI_API_KEY is set.</div>') +
      '<section class="card"><div class="card-b">' +
      '<div class="field"><label for="set-name">Business name</label><input class="ctrl" id="set-name" value="' + esc(s.businessName || "") + '"></div>' +
      '<div class="field"><label for="set-greeting">Greeting</label><textarea class="ctrl" id="set-greeting">' + esc(s.greeting || "") + "</textarea><div class='help'>This is the first thing the receptionist says.</div></div>" +
      '<div class="grid-2"><div class="field"><label for="set-hours">Business hours</label><input class="ctrl" id="set-hours" value="' + esc(s.hours || "") + '"></div>' +
      '<div class="field"><label for="set-timezone">Time zone</label><select class="ctrl" id="set-timezone">' + zones + "</select></div></div>" +
      "<h3>Booking</h3>" +
      '<div class="grid-3"><div class="field"><label for="set-length">Appointment length (minutes)</label><input class="ctrl" id="set-length" type="number" min="5" max="240" value="' + esc(s.appointmentMinutes || 20) + '"></div>' +
      '<div class="field"><label for="set-buffer">Buffer (minutes)</label><input class="ctrl" id="set-buffer" type="number" min="0" max="120" value="' + esc(s.bufferMinutes || 0) + '"></div>' +
      '<div class="field"><label for="set-transfer">Transfer to a person</label><input class="ctrl" id="set-transfer" value="' + esc(s.transferNumber || "") + '" placeholder="Optional"></div></div>' +
      '<div class="field"><label>Bookable days</label><div class="days">' + dayHtml + "</div></div>" +
      '<div class="grid-2"><div class="field"><label for="set-start">Bookable from</label><input class="ctrl" id="set-start" type="time" value="' + esc(s.bookableStart || "09:00") + '"></div>' +
      '<div class="field"><label for="set-end">Bookable until</label><input class="ctrl" id="set-end" type="time" value="' + esc(s.bookableEnd || "18:00") + '"></div></div>' +
      '<div class="field"><label>FAQ</label><div id="faq-list">' + faqs + '</div><button class="btn btn-sm" type="button" data-action="add-faq">Add FAQ</button></div>' +
      '<div class="field"><label for="set-notes">Notes</label><textarea class="ctrl" id="set-notes" placeholder="Anything else the receptionist should know">' + esc(s.notes || "") + "</textarea></div>" +
      pushed +
      '<div class="head-actions"><button class="btn btn-primary" type="button" data-action="save-settings" data-id="' + esc(id) + '">Save and push</button></div>' +
      "</div></section>" + legal();
  }

  function renderSettings(view) {
    var id = pageBizId();
    if (!LIVE) {
      var sample = findBiz(id);
      view.innerHTML = settingsForm({
        settings: {
          businessName: sample ? sample.name : "",
          greeting: sample ? sample.greeting : "",
          hours: sample ? sample.hours : "",
          timezone: "America/Los_Angeles",
          appointmentMinutes: 20,
          bufferMinutes: 0,
          bookableDays: ["mon", "tue", "wed", "thu", "fri"],
          bookableStart: "09:00",
          bookableEnd: "18:00",
          transferNumber: sample ? sample.transfer : "",
          faqs: sample ? sample.faqs : [],
          notes: ""
        },
        vapiConfigured: false,
        testCall: { hint: "This demo does not place a call." }
      }, id) ;
      return;
    }
    if (!id) {
      view.innerHTML = '<div class="card"><div class="empty">Add a business before editing the receptionist.</div></div>' + legal();
      return;
    }
    view.innerHTML = '<p class="sub">Loading settings…</p>';
    api("GET", "api/businesses/" + encodeURIComponent(id) + "/settings").then(function (data) {
      view.innerHTML = settingsForm(data, id);
    }).catch(function (err) {
      view.innerHTML = '<div class="banner bad">' + esc(err.message) + "</div>" + legal();
    });
  }

  function readSettings() {
    var days = [];
    document.querySelectorAll('input[name="day"]:checked').forEach(function (el) { days.push(el.value); });
    var faqs = [];
    document.querySelectorAll("#faq-list .faq-row").forEach(function (row) {
      var q = row.querySelector(".faq-q");
      var a = row.querySelector(".faq-a");
      if ((q && q.value.trim()) || (a && a.value.trim())) faqs.push({ q: q ? q.value.trim() : "", a: a ? a.value.trim() : "" });
    });
    var len = document.getElementById("set-length");
    var buf = document.getElementById("set-buffer");
    return {
      businessName: (document.getElementById("set-name") || {}).value || "",
      greeting: (document.getElementById("set-greeting") || {}).value || "",
      hours: (document.getElementById("set-hours") || {}).value || "",
      timezone: (document.getElementById("set-timezone") || {}).value || "",
      appointmentMinutes: Number(len && len.value),
      bufferMinutes: Number(buf && buf.value),
      bookableDays: days,
      bookableStart: (document.getElementById("set-start") || {}).value || "",
      bookableEnd: (document.getElementById("set-end") || {}).value || "",
      transferNumber: (document.getElementById("set-transfer") || {}).value || "",
      faqs: faqs,
      notes: (document.getElementById("set-notes") || {}).value || ""
    };
  }

  function trelloGuide(open) {
    return '<details class="card guide"' + (open ? " open" : "") + '><summary>How to get your Trello key and token</summary><div class="card-b"><ol>' +
      '<li>Sign in to Trello and open <a href="https://trello.com/power-ups/admin" target="_blank" rel="noopener">Power-Up admin</a>.</li>' +
      "<li>Create a Power-Up, or open one you already use for this panel. Copy its API key.</li>" +
      '<li>Open the key\'s authorize link in the same browser. Put your key in place of YOUR_KEY:' +
      '<div class="code">https://trello.com/1/authorize?expiration=never&amp;name=ReceptWise&amp;scope=read,write&amp;response_type=token&amp;key=YOUR_KEY</div>' +
      "Allow access. Trello shows a token. Copy it. Treat the token like a password.</li>" +
      "<li>Paste the API key and the token below and save them. Or set TRELLO_API_KEY and TRELLO_TOKEN on the server instead of pasting. A pasted key is encrypted on the server and is not shown again.</li>" +
      "<li>Click Test connection. Choose the board and the list where cards should go. Turn on cards for new bookings, missed calls, or both, and save.</li>" +
      "</ol></div></details>";
  }

  function optionList(items, selected, blank) {
    var html = '<option value="">' + esc(blank) + "</option>";
    (items || []).forEach(function (item) {
      html += '<option value="' + esc(item.id) + '"' + (item.id === selected ? " selected" : "") + ">" + esc(item.name) + "</option>";
    });
    return html;
  }

  function loadTrelloLists(id, boardId, selected) {
    var list = document.getElementById("trello-list");
    if (!list || !boardId) return;
    api("GET", "api/businesses/" + encodeURIComponent(id) + "/trello/boards/" + encodeURIComponent(boardId) + "/lists").then(function (data) {
      list.innerHTML = optionList(data.lists, selected, "Choose a list");
    }).catch(liveFail);
  }

  function loadTrelloBoards(id, trello) {
    if (!trello || !trello.configured) return;
    api("GET", "api/businesses/" + encodeURIComponent(id) + "/trello/boards").then(function (data) {
      var board = document.getElementById("trello-board");
      if (!board) return;
      board.innerHTML = optionList(data.boards, trello.boardId, "Choose a board");
      if (trello.boardId) loadTrelloLists(id, trello.boardId, trello.listId);
    }).catch(liveFail);
  }

  function trelloCard(trello, id) {
    var t = trello || { status: "not_connected", statusLabel: "Not connected", rules: { booking: true, missedCall: true } };
    var who = t.memberName ? esc(t.memberName) + (t.memberUsername ? " (@" + esc(t.memberUsername) + ")" : "") : esc(t.statusLabel || "Not connected");
    var note = '<p class="help">Paste a key and token, or set TRELLO_API_KEY and TRELLO_TOKEN on the server. Nothing is marked connected until Test connection succeeds.</p>';
    if (t.status === "connected" && t.boardName && t.listName) note = '<p class="help">Cards go to ' + esc(t.boardName) + " / " + esc(t.listName) + ".</p>";
    else if (t.status === "connected") note = '<p class="help">Choose a board and a list so new bookings and missed calls can open cards.</p>';
    else if (t.source === "env") note = '<p class="help">Using the server key. Test the connection, then choose a board and a list.</p>';
    else if (t.source === "saved") note = '<p class="help">The key is saved on the server and is not shown here. Test the connection before choosing a board.</p>';
    var keyHolder = t.source === "saved" ? "Saved. Paste a new key to replace it." : "From the Power-Up admin page";
    var tokenHolder = t.source === "saved" ? "Saved. Paste a new token to replace it." : "From the authorize link";
    var remove = t.source === "saved" ? ' <button class="btn btn-sm" type="button" data-action="trello-remove" data-id="' + esc(id) + '">Remove saved key</button>' : "";
    var rules = t.rules || {};
    return trelloGuide(!t.configured) +
      '<article class="card int-card"><div class="card-b"><div class="setting-row"><div><h2>Trello</h2><div class="help">' + who + "</div></div>" + pill(t.status || "not_connected") + "</div>" +
      note +
      '<div class="grid-2"><div class="field"><label for="trello-key">API key</label><input class="ctrl" id="trello-key" type="password" autocomplete="off" placeholder="' + esc(keyHolder) + '"></div>' +
      '<div class="field"><label for="trello-token">Token</label><input class="ctrl" id="trello-token" type="password" autocomplete="off" placeholder="' + esc(tokenHolder) + '"></div></div>' +
      '<div class="head-actions"><button class="btn btn-sm" type="button" data-action="trello-save-key" data-id="' + esc(id) + '">Save key</button>' +
      '<button class="btn btn-primary btn-sm" type="button" data-action="trello-test" data-id="' + esc(id) + '">Test connection</button>' + remove + "</div>" +
      '<div class="grid-2" style="margin-top:12px"><div class="field"><label for="trello-board">Board</label><select class="ctrl" id="trello-board" data-action="trello-board" data-id="' + esc(id) + '"><option value="' + esc(t.boardId || "") + '">' + esc(t.boardName || "Load boards after a successful test") + "</option></select></div>" +
      '<div class="field"><label for="trello-list">List</label><select class="ctrl" id="trello-list"><option value="' + esc(t.listId || "") + '">' + esc(t.listName || "Choose a board first") + "</option></select></div></div>" +
      '<div class="checks"><label class="day"><input type="checkbox" id="trello-booking"' + (rules.booking !== false ? " checked" : "") + "> Create a card for each new booking</label>" +
      '<label class="day"><input type="checkbox" id="trello-missed"' + (rules.missedCall !== false ? " checked" : "") + "> Create a card for each missed call</label></div>" +
      '<button class="btn btn-sm" type="button" data-action="trello-save-rules" data-id="' + esc(id) + '">Save board and rules</button>' +
      '<p class="help">A booking card is updated when the time or summary changes. A missed-call card is created once. The key and token stay on the server.</p>' +
      "</div></article>";
  }

  function integrationCard(account, id) {
    var soon = account.status === "coming_soon";
    var manual = "";
    if (!soon && account.status !== "connected") {
      manual = '<div class="grid-2"><div class="field"><label>Handle</label><input class="ctrl" id="handle-' + esc(account.provider) + '" value="' + esc(account.handle || "") + '" placeholder="@name"></div>' +
        '<div class="field"><label>Profile URL</label><input class="ctrl" id="url-' + esc(account.provider) + '" value="' + esc(account.profileUrl || "") + '" placeholder="https://"></div></div>' +
        '<button class="btn btn-sm" type="button" data-action="record-integration" data-id="' + esc(id) + '" data-provider="' + esc(account.provider) + '">Save handle</button>';
    }
    var remove = account.status === "connected" || account.status === "recorded"
      ? ' <button class="btn btn-sm" type="button" data-action="remove-integration" data-id="' + esc(id) + '" data-provider="' + esc(account.provider) + '">Remove</button>' : "";
    var connect = account.canConnect
      ? '<a class="btn btn-primary btn-sm" href="api/integrations/meta/start?business=' + encodeURIComponent(id) + '">Connect with Meta</a> ' : "";
    var note = soon ? '<p class="help">Not available yet.</p>'
      : account.provider === "google_business" ? '<p class="help">Google sign-in is not available yet. A saved listing is a note, not a connection.</p>'
      : account.status === "recorded" ? '<p class="help">Recorded by the team. This is not an authorized connection.</p>'
      : "";
    return '<article class="card int-card"><div class="card-b"><div class="setting-row"><div><h2>' + esc(account.label) + '</h2><div class="help">' +
      esc(account.accountName || account.statusLabel || "") + "</div></div>" + pill(account.status) + "</div>" + note +
      '<div class="head-actions">' + connect + remove + "</div>" + manual + "</div></article>";
  }

  function renderIntegrations(view) {
    var id = pageBizId();
    var params = new URLSearchParams(location.search);
    var flash = params.get("connected") ? '<div class="banner ok">Meta returned a connection. The account name below is what the provider sent.</div>' : "";
    if (params.get("error")) flash = '<div class="banner bad">' + esc(params.get("error")) + "</div>";
    if (!LIVE) {
      view.innerHTML = '<div class="page-head"><div><h1>Integrations</h1><p class="sub">Social accounts for this business</p></div></div>' +
        '<div class="banner warn">Needs Meta app setup on the live control panel. This demo does not connect Instagram, Facebook, Google, or Trello.</div>' +
        trelloGuide(true) +
        '<article class="card int-card"><div class="card-b"><h2>Trello</h2><p class="help">Not connected. This demo does not store a key or open cards.</p></div></article>' +
        '<article class="card int-card"><div class="card-b"><h2>Instagram</h2><p class="help">Not connected</p></div></article>' +
        '<article class="card int-card"><div class="card-b"><h2>Facebook</h2><p class="help">Not connected</p></div></article>' +
        '<article class="card int-card"><div class="card-b"><h2>Google Business Profile</h2><p class="help">Not connected</p></div></article>' +
        '<article class="card int-card"><div class="card-b"><h2>LinkedIn, X, TikTok, YouTube</h2>' + pill("coming_soon") + "<p class='help'>Coming soon.</p></div></article>" + legal();
      return;
    }
    if (!id) {
      view.innerHTML = '<div class="card"><div class="empty">Add a business before connecting accounts.</div></div>' + legal();
      return;
    }
    view.innerHTML = '<p class="sub">Loading integrations…</p>';
    api("GET", "api/businesses/" + encodeURIComponent(id) + "/integrations").then(function (data) {
      var setup = "";
      if (!data.metaApp) setup = '<div class="banner warn">Needs Meta app setup. Set META_APP_ID and META_APP_SECRET. You can still record a handle and profile URL. That does not connect the account.</div>';
      else if (!data.encryption) setup = '<div class="banner warn">The Meta app is set, but TOKEN_ENCRYPTION_KEY is missing, so tokens cannot be stored.</div>';
      else if (!data.redirectReady) setup = '<div class="banner warn">Set APP_BASE_URL so the Meta redirect URL can be built.</div>';
      view.innerHTML = '<div class="page-head"><div><h1>Integrations</h1><p class="sub">Connected only after the provider says so</p></div>' + bizSelect() + "</div>" +
        flash + setup + trelloCard(data.trello, id) + (data.accounts || []).map(function (account) { return integrationCard(account, id); }).join("") + legal();
      loadTrelloBoards(id, data.trello);
    }).catch(function (err) {
      view.innerHTML = '<div class="banner bad">' + esc(err.message) + "</div>" + legal();
    });
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
      else if (page === "phone") renderPhone(view);
      else if (page === "settings") renderSettings(view);
      else if (page === "integrations") renderIntegrations(view);
      refreshBell();
    };
    if (page === "add") resumeDraft();
    currentRender();
    loadVoiceCatalog();
    if (page === "add") window.addEventListener("pagehide", persistDraftOnLeave);
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
