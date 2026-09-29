/* Carrier instructions and ported-number call flow. Shared by the portal and the server. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RW_FORWARDING = api;
})(typeof window !== 'undefined' ? window : null, function () {
  var CARRIERS = [
    { id: 'att', label: 'AT&T' },
    { id: 'verizon', label: 'Verizon' },
    { id: 'tmobile', label: 'T-Mobile' },
    { id: 'comcast', label: 'Comcast/Xfinity' },
    { id: 'spectrum', label: 'Spectrum' },
    { id: 'ringcentral', label: 'RingCentral/other VoIP' },
    { id: 'other', label: 'Other' }
  ];
  var CARRIER_IDS = CARRIERS.map(function (c) { return c.id; });
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
  // AT&T home phone support publishes *47 plus these codes. 1 ring is not in the table.
  var ATT_HOME_RINGS = { 2: '12', 3: '18', 4: '24', 5: '30', 6: '36' };
  var ASSISTANT_TODO = 'TODO: connect this call to the ReceptWise assistant. Redirecting a Twilio Dial result to the assistant rejects DialCallStatus, so this response does not send the caller there.';

  function toE164(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    if (String(value || '').trim().charAt(0) === '+' && d.length >= 8 && d.length <= 15) return '+' + d;
    return '';
  }

  function national10(value) {
    var e164 = toE164(value) || String(value || '');
    var d = e164.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') return d.slice(1);
    if (d.length === 10) return d;
    return '';
  }

  function formatPhone(value) {
    var ten = national10(value);
    if (!ten) return String(value || '');
    return '(' + ten.slice(0, 3) + ') ' + ten.slice(3, 6) + '-' + ten.slice(6);
  }

  function safeRings(rings) {
    var n = Number(rings);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 6) {
      var err = new Error('Rings must be a whole number from 1 to 6.');
      err.status = 400;
      throw err;
    }
    return n;
  }

  function parseHHMM(value) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function fmtHHMM(mins) {
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  function normalizeHours(input) {
    var out = {};
    if (!input || typeof input !== 'object') return out;
    DAYS.forEach(function (day) {
      var row = input[day];
      if (!row || typeof row !== 'object') return;
      if (row.closed === true || row.closed === 'true') {
        out[day] = { closed: true, open: '', close: '' };
        return;
      }
      var open = parseHHMM(row.open);
      var close = parseHHMM(row.close);
      if (open == null || close == null || open === close) return;
      out[day] = { closed: false, open: fmtHHMM(open), close: fmtHHMM(close) };
    });
    return out;
  }

  function hoursConfigured(hours) {
    if (!hours || typeof hours !== 'object') return false;
    return DAYS.some(function (day) {
      var row = hours[day];
      return row && (row.closed === true || row.open || row.close);
    });
  }

  function zonedClock(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (p) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
    var map = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };
    var hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    return { day: map[parts.weekday] || '', minutes: hour * 60 + Number(parts.minute || 0) };
  }

  // Empty hours mean the business has not set a schedule, so ring-first applies all day.
  function withinHours(hours, timeZone, now) {
    if (!hoursConfigured(hours)) return true;
    var clock = zonedClock(now || new Date(), timeZone);
    var row = hours[clock.day];
    if (!row || row.closed) return false;
    var open = parseHHMM(row.open);
    var close = parseHHMM(row.close);
    if (open == null || close == null) return false;
    if (close > open) return clock.minutes >= open && clock.minutes < close;
    return clock.minutes >= open || clock.minutes < close;
  }

  function step(heading, text, codes, check) {
    return { heading: heading, text: text, codes: codes || [], check: !!check };
  }

  function code(label, value) {
    return { label: label, value: value };
  }

  function instructions(opts) {
    var carrier = CARRIER_IDS.indexOf(opts && opts.carrier) >= 0 ? opts.carrier : 'other';
    var rings = safeRings(opts && opts.rings != null ? opts.rings : 4);
    var seconds = rings * 5;
    var ten = national10(opts && opts.forwardTo);
    var pretty = ten ? formatPhone(ten) : '';
    var target = ten || 'ReceptWiseNumber';
    var missing = !ten;
    var ringNote = 'You saved ' + rings + ' ring' + (rings === 1 ? '' : 's') + ', about ' + seconds + ' seconds. About 5 seconds per ring is a rough guide. The carrier controls the real timer, not ReceptWise.';
    var steps = [];

    if (carrier === 'att') {
      steps.push(step(
        'AT&T wireless',
        'On the business phone, open the Phone app, then Settings, then Calls (some phones say Calling accounts). Open Call forwarding and choose When unanswered. Enter ' + (pretty || 'the ReceptWise number') + ' and turn it on. AT&T device support shows this screen. It does not publish a dial code for When unanswered, and it does not say how to pick ' + rings + ' rings. ' + ringNote,
        [],
        true
      ));
      var home = 'AT&T local home phone service does not publish a self-serve code for Call Forwarding - Don\'t Answer. AT&T says to call 800.288.2020 and ask them to forward unanswered calls to ' + (pretty || 'the ReceptWise number') + '. *72 forwards every call immediately. It is not no-answer forwarding.';
      var homeCodes = [];
      if (ATT_HOME_RINGS[rings]) {
        home += ' To change the ring count on that home line, AT&T says: at the dial tone, dial *47, wait for a second dial tone, then dial ' + ATT_HOME_RINGS[rings] + '. Their published table is 2 rings = 12, 3 = 18, 4 = 24, 5 = 30, 6 = 36.';
        homeCodes.push(code('Home phone ring count (' + rings + ' rings)', '*47 then ' + ATT_HOME_RINGS[rings]));
      } else {
        home += ' Their published ring table starts at 2 rings, so there is no code here for 1 ring.';
      }
      steps.push(step('AT&T home phone', home + ' ' + ringNote, homeCodes, true));
    } else if (carrier === 'verizon') {
      steps.push(step(
        'Verizon mobile',
        'From the business mobile phone, call *71 followed by the 10-digit ReceptWise number, then press call. Verizon support says this forwards only the calls you do not answer. Turn it off by calling *73. *72 forwards every call and the mobile phone will not ring, so do not use *72 for no-answer forwarding. Verizon\'s mobile instructions do not include a code for ' + rings + ' rings. ' + ringNote,
        [code('No-answer forwarding', '*71' + target), code('Turn no-answer forwarding off', '*73')],
        false
      ));
      steps.push(step(
        'Some Verizon home and business voice lines',
        'Verizon\'s calling-features guide and Verizon Business Digital Voice document *92, then the 10-digit number, then #, for Call Forwarding No Answer. Turn that off with *93. Verizon mobile support documents *71, not *92. Check which line you have before you dial. Those guides do not give a code for ' + rings + ' rings. ' + ringNote,
        [code('No-answer forwarding on those lines', '*92' + target + '#'), code('Turn that forwarding off', '*93')],
        true
      ));
    } else if (carrier === 'tmobile') {
      steps.push(step(
        'T-Mobile no-answer forwarding',
        'From the T-Mobile phone, dial **61*1' + target + '# and press call. T-Mobile\'s short-code list calls this forwarding if no reply. Turn it off with ##61#. ' + ringNote,
        [code('Forward if no reply', '**61*1' + target + '#'), code('Turn no-reply forwarding off', '##61#')],
        false
      ));
      steps.push(step(
        'Ring delay',
        'T-Mobile publishes a delay example, **61*18056377243**' + seconds + '#, and says the delay can be 5, 10, 15, 20, 25, or 30 seconds. The number in that example is printed as 18056377243, not as your forwarding number. The code below copies that shape with the ReceptWise number. Check with T-Mobile before you dial it.',
        [code('Delay shape from T-Mobile\'s example', '**61*1' + target + '**' + seconds + '#')],
        true
      ));
    } else if (carrier === 'comcast') {
      steps.push(step(
        'Comcast/Xfinity',
        'Set this in the Xfinity app or on xfinity.com, or call Xfinity support. Turn on no-answer forwarding to ' + (pretty || 'the ReceptWise number') + '. Set the ring count there if the portal offers it. ' + ringNote + ' No dial code is shown here.',
        [],
        true
      ));
    } else if (carrier === 'spectrum') {
      steps.push(step(
        'Spectrum',
        'Change Spectrum voice forwarding in the Spectrum voice portal or app, or with Spectrum support. Send unanswered calls to ' + (pretty || 'the ReceptWise number') + '. ' + ringNote + ' No dial code is shown here.',
        [],
        true
      ));
    } else if (carrier === 'ringcentral') {
      steps.push(step(
        'RingCentral or other VoIP',
        'In the provider\'s admin portal, open the user or the main number and the call-handling settings. Send unanswered calls to ' + (pretty || 'the ReceptWise number') + ' and set the ring time there if you see one. Menu names change. ' + ringNote + ' No dial code is shown here.',
        [],
        true
      ));
    } else {
      steps.push(step(
        'Other phone company',
        'Use your phone company\'s app, website, or support line. Turn on no-answer forwarding to ' + (pretty || 'the ReceptWise number') + '. ' + ringNote + ' No dial code is shown for this choice.',
        [],
        true
      ));
      steps.push(step(
        'GSM no-reply code, if your carrier accepts it',
        'Some mobile lines accept a no-reply code of the form **61*<number>**<seconds>#. That form is not verified for your carrier. Check with your carrier before dialing it.',
        [code('GSM no-reply shape', '**61*' + target + '**' + seconds + '#')],
        true
      ));
    }

    var found = CARRIERS.filter(function (c) { return c.id === carrier; })[0];
    return {
      carrier: carrier,
      carrierLabel: found ? found.label : 'Other',
      rings: rings,
      seconds: seconds,
      forwardTo: pretty,
      missingNumber: missing,
      caveat: 'Check with your carrier. These steps are for no-answer forwarding to the ReceptWise number. The carrier controls how many times the business phone rings.',
      steps: steps
    };
  }

  function instructionsText(opts) {
    var help = instructions(opts);
    var lines = [help.carrierLabel, help.caveat];
    if (help.missingNumber) lines.push('A ReceptWise number is not assigned yet. Replace ReceptWiseNumber after it is.');
    help.steps.forEach(function (item) {
      lines.push(item.heading);
      lines.push(item.text);
      item.codes.forEach(function (itemCode) { lines.push(itemCode.label + ': ' + itemCode.value); });
      if (item.check) lines.push('Check with your carrier.');
    });
    return lines.join('\n');
  }

  function xmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sayHangup(message, todo) {
    var comment = todo ? '<!-- ' + xmlEscape(todo) + ' -->' : '';
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' + comment +
      '<Say>' + xmlEscape(message) + '</Say><Hangup/></Response>';
  }

  // Ported numbers: ring the desk first, then fall through. The assistant handoff is a stub.
  function inboundTwiml(setup, ctx) {
    ctx = ctx || {};
    var dialStatus = String(ctx.dialStatus || '');
    if (!setup || setup.mode !== 'ported') {
      return {
        twiml: sayHangup('Thanks for calling. The receptionist cannot join this call from this step yet.', ASSISTANT_TODO),
        dialed: false,
        handedToAssistant: false,
        reason: 'not_ported'
      };
    }
    if (dialStatus === 'completed' || dialStatus === 'answered') {
      return {
        twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        dialed: false,
        handedToAssistant: false,
        reason: 'answered'
      };
    }
    if (dialStatus) {
      if (!setup.aiEnabled) {
        return {
          twiml: sayHangup('No one is available to take your call right now. Please try again later.', ''),
          dialed: false,
          handedToAssistant: false,
          reason: 'ai_off'
        };
      }
      return {
        twiml: sayHangup('Thanks for calling. The receptionist cannot join this call from this step yet.', ASSISTANT_TODO),
        dialed: false,
        handedToAssistant: false,
        reason: 'assistant_stub'
      };
    }

    var numbers = (setup.ringFirst || []).map(function (row) {
      return toE164(row && (row.e164 || row.number));
    }).filter(Boolean).slice(0, 5);
    var open = withinHours(setup.hours, ctx.timeZone || 'America/New_York', ctx.now || new Date());
    var ai = setup.aiEnabled !== false;
    var afterHoursAi = (setup.afterHours || 'ai_immediate') === 'ai_immediate';

    if (!open && afterHoursAi && ai) {
      return {
        twiml: sayHangup('Thanks for calling. The receptionist cannot join this call from this step yet.', ASSISTANT_TODO),
        dialed: false,
        handedToAssistant: false,
        reason: 'after_hours'
      };
    }
    if (!numbers.length) {
      if (ai) {
        return {
          twiml: sayHangup('Thanks for calling. The receptionist cannot join this call from this step yet.', ASSISTANT_TODO),
          dialed: false,
          handedToAssistant: false,
          reason: 'no_ring_first'
        };
      }
      return {
        twiml: sayHangup('No one is available to take your call right now. Please try again later.', ''),
        dialed: false,
        handedToAssistant: false,
        reason: 'ai_off'
      };
    }

    var timeout = safeRings(setup.rings || 4) * 5;
    var nouns = numbers.map(function (num) { return '<Number>' + xmlEscape(num) + '</Number>'; }).join('');
    var action = ctx.actionUrl ? ' action="' + xmlEscape(ctx.actionUrl) + '" method="POST"' : '';
    var note = ctx.actionUrl ? '' : '<!-- TODO: set APP_BASE_URL so an unanswered dial can fall through. -->';
    return {
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response>' + note + '<Dial timeout="' + timeout + '"' + action + '>' + nouns + '</Dial></Response>',
      dialed: true,
      handedToAssistant: false,
      timeout: timeout,
      reason: open ? 'ring_first' : 'ring_first_ai_off'
    };
  }

  // Twilio signs url + alphabetically sorted POST params with HMAC-SHA1 (base64).
  function twilioSignature(url, params, token) {
    var keys = Object.keys(params || {}).sort();
    var data = String(url || '');
    keys.forEach(function (key) { data += key + params[key]; });
    var crypto = typeof require === 'function' ? require('crypto') : null;
    if (!crypto) throw new Error('Twilio signatures are checked on the server.');
    return crypto.createHmac('sha1', String(token || '')).update(Buffer.from(data, 'utf8')).digest('base64');
  }

  return {
    CARRIERS: CARRIERS,
    DAYS: DAYS,
    DAY_NAMES: DAY_NAMES,
    ASSISTANT_TODO: ASSISTANT_TODO,
    toE164: toE164,
    national10: national10,
    formatPhone: formatPhone,
    ringsToSeconds: function (rings) { return safeRings(rings) * 5; },
    normalizeHours: normalizeHours,
    hoursConfigured: hoursConfigured,
    withinHours: withinHours,
    instructions: instructions,
    instructionsText: instructionsText,
    inboundTwiml: inboundTwiml,
    twilioSignature: twilioSignature
  };
});
