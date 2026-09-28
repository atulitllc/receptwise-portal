'use strict';
const db = require('./db');
const config = require('./config');
const vapi = require('./integrations/vapi');
const twilio = require('./integrations/twilio');
const businesses = require('./businesses');

function hint(e164) {
  const pretty = e164 ? businesses.prettyPhone(e164) : '';
  return pretty ? 'Call ' + pretty + ' to hear the receptionist.' : 'No receptionist number is on file yet.';
}

function localCard(row, assistantId) {
  const pretty = businesses.prettyPhone(row.e164);
  return {
    e164: row.e164,
    pretty,
    vapiPhoneNumberId: row.vapi_phone_number_id || null,
    assistantId: assistantId || null,
    assistantName: null,
    provider: row.provider || 'twilio',
    status: 'not_verified',
    statusLabel: 'Not connected',
    detail: 'Saved on file. Set VAPI_API_KEY to confirm this number is attached to the receptionist.',
    twilioStatus: null,
    source: 'database'
  };
}

// Pure shaping so tests can cover the not-connected and attached states without HTTP.
function presentNumbers({ vapiConfigured, twilioConfigured, missingVapi, missingTwilio, localRows, remoteNumbers, assistant, assistantRemote, twilioByE164, error }) {
  const assistantId = (assistant && assistant.vapi_assistant_id) || '';
  const locals = localRows || [];
  const first = locals[0];
  const base = {
    vapi: vapiConfigured ? 'ready' : 'not_connected',
    twilio: twilioConfigured ? 'ready' : 'not_connected',
    missing: missingVapi || [],
    twilioMissing: missingTwilio || [],
    assistant: {
      id: assistantId || null,
      name: (assistantRemote && assistantRemote.name) || null,
      verified: Boolean(vapiConfigured && assistantRemote)
    },
    testCallHint: hint(first && first.e164),
    error: error || null
  };

  if (!vapiConfigured) {
    return Object.assign(base, {
      state: 'not_connected',
      numbers: locals.map((row) => localCard(row, assistantId))
    });
  }
  if (error) {
    return Object.assign(base, {
      state: 'error',
      numbers: locals.map((row) => {
        const card = localCard(row, assistantId);
        card.detail = 'Could not reach Vapi. The number on file is shown without a live check.';
        return card;
      })
    });
  }

  const wantedIds = new Set(locals.map((row) => row.vapi_phone_number_id).filter(Boolean));
  const wantedNums = new Set(locals.map((row) => row.e164));
  const remote = (remoteNumbers || []).filter((n) => {
    return (assistantId && n.assistantId === assistantId) || wantedIds.has(n.id) || wantedNums.has(n.number);
  });
  const seen = new Set();
  const numbers = remote.map((n) => {
    seen.add(n.number);
    const attached = Boolean(assistantId && n.assistantId === assistantId);
    const twilioStatus = (twilioByE164 && twilioByE164[n.number]) || null;
    let detail = attached
      ? 'This number is attached to the receptionist.'
      : 'Vapi has this number, but it is not attached to this receptionist.';
    if (!twilioConfigured) detail += ' Twilio status was not checked because the Twilio keys are missing.';
    else if (twilioStatus === 'lookup_failed') detail += ' Twilio lookup failed.';
    else if (twilioStatus) detail += ' Twilio status: ' + twilioStatus + '.';
    return {
      e164: n.number,
      pretty: businesses.prettyPhone(n.number),
      vapiPhoneNumberId: n.id || null,
      assistantId: n.assistantId || null,
      assistantName: (assistantRemote && n.assistantId === assistantRemote.id && assistantRemote.name) || null,
      provider: n.provider || 'twilio',
      status: attached ? 'attached' : 'unassigned',
      statusLabel: attached ? 'Attached to the receptionist' : 'Not attached to this receptionist',
      detail,
      twilioStatus,
      source: 'vapi'
    };
  });

  locals.forEach((row) => {
    if (seen.has(row.e164)) return;
    numbers.push({
      e164: row.e164,
      pretty: businesses.prettyPhone(row.e164),
      vapiPhoneNumberId: row.vapi_phone_number_id || null,
      assistantId: assistantId || null,
      assistantName: (assistantRemote && assistantRemote.name) || null,
      provider: row.provider || 'twilio',
      status: 'missing_on_vapi',
      statusLabel: 'Not connected',
      detail: 'This number is on file, but Vapi did not return it.',
      twilioStatus: (twilioByE164 && twilioByE164[row.e164]) || null,
      source: 'database'
    });
  });

  const attached = numbers.some((n) => n.status === 'attached');
  const state = attached ? 'connected' : (numbers.length ? 'partial' : 'not_connected');
  return Object.assign(base, { state, numbers, testCallHint: hint((numbers[0] && numbers[0].e164) || (first && first.e164)) });
}

async function liveNumbers(biz) {
  const [phones, assistants] = await Promise.all([
    db.query("SELECT * FROM phone_numbers WHERE business_id = $1 AND status <> 'released' ORDER BY id", [biz.id]),
    db.query('SELECT * FROM assistants WHERE business_id = $1', [biz.id])
  ]);
  const assistant = assistants.rows[0] || null;
  const missingVapi = config.vapi.configured ? [] : ['VAPI_API_KEY'];
  const missingTwilio = [];
  if (!config.twilio.accountSid) missingTwilio.push('TWILIO_ACCOUNT_SID');
  if (!config.twilio.authToken) missingTwilio.push('TWILIO_AUTH_TOKEN');

  if (!config.vapi.configured) {
    return presentNumbers({
      vapiConfigured: false,
      twilioConfigured: config.twilio.configured,
      missingVapi,
      missingTwilio,
      localRows: phones.rows,
      assistant
    });
  }

  let remoteNumbers = [];
  let assistantRemote = null;
  let error = null;
  try {
    const list = await vapi.listPhoneNumbers();
    const raw = Array.isArray(list) ? list : (list.results || list.data || []);
    remoteNumbers = raw.map((n) => ({
      id: n.id,
      number: n.number || n.phoneNumber || '',
      assistantId: n.assistantId || null,
      provider: n.provider || 'twilio',
      name: n.name || '',
      status: n.status || ''
    }));
    if (assistant && assistant.vapi_assistant_id) {
      try { assistantRemote = await vapi.getAssistant(assistant.vapi_assistant_id); }
      catch (err) { assistantRemote = null; }
    }
  } catch (err) {
    error = err.message;
  }

  const twilioByE164 = {};
  if (!error && config.twilio.configured) {
    const targets = new Set(phones.rows.map((row) => row.e164));
    remoteNumbers.forEach((n) => { if (n && n.number) targets.add(n.number); });
    for (const e164 of targets) {
      try {
        const found = await twilio.findNumber(e164);
        twilioByE164[e164] = found ? (found.status || 'in-use') : 'not_found';
      } catch (err) {
        twilioByE164[e164] = 'lookup_failed';
      }
    }
  }

  const view = presentNumbers({
    vapiConfigured: true,
    twilioConfigured: config.twilio.configured,
    missingVapi,
    missingTwilio,
    localRows: phones.rows,
    remoteNumbers,
    assistant,
    assistantRemote,
    twilioByE164,
    error
  });

  const attached = view.numbers.find((n) => n.status === 'attached');
  if (attached) {
    await businesses.setStep(biz.id, 'number', 'connected',
      attached.pretty + ' is attached to ' + (attached.assistantName || 'the receptionist') + '.',
      { e164: attached.e164 });
  }
  return view;
}

module.exports = { presentNumbers, liveNumbers };
