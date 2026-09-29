'use strict';
// Per-business Vapi voices. The UI list is assets/voices.js; the ids here are what publish sends.
// A male voice is omitted: Vapi's voice library requires an API key, so no male id was verified.
const PUBLIC = require('../../assets/voices.js');

const DETAILS = {
  nora: { provider: 'cartesia', voiceId: 'f4c1a0b2-669d-403f-b440-4b34b34856aa', model: 'sonic-2', language: 'en' },
  sarah: { provider: '11labs', voiceId: 'EXAVITQu4vr4xnSDxMaL', model: 'eleven_flash_v2_5' },
  jessica: { provider: '11labs', voiceId: 'cgSgspJ2msm6clMCkdW9', model: 'eleven_flash_v2_5' },
  laura: { provider: '11labs', voiceId: 'FGY2WhTYpPnrIDTdsKH5', model: 'eleven_flash_v2_5' },
  lily: { provider: '11labs', voiceId: 'pFZP5JQG7iQjIQuC4Bku', model: 'eleven_flash_v2_5' }
};

const FAKES = new Set([
  'juniper (warm)', 'harbor (clear)', 'north (calm)', 'sol (bright)',
  'juniper', 'harbor', 'north', 'sol'
]);

for (const voice of PUBLIC) {
  if (!DETAILS[voice.key]) throw new Error('Voice ' + voice.key + ' has no Vapi id.');
}

function list() {
  return PUBLIC.map((voice) => Object.assign({ isDefault: voice.key === 'nora' }, voice, DETAILS[voice.key]));
}

function publicList() {
  return list().map((voice) => ({
    key: voice.key,
    name: voice.name,
    description: voice.description,
    gender: voice.gender,
    isDefault: voice.isDefault
  }));
}

// Catalog key, or nora for a retired mockup name. Empty when nothing was stored.
function storedKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (FAKES.has(lower)) return 'nora';
  const hit = PUBLIC.find((voice) => voice.key === lower || voice.name.toLowerCase() === lower);
  return hit ? hit.key : '';
}

// Null means "no business choice" so the caller can use the env voice.
function forPayload(value) {
  const key = storedKey(value);
  if (!key) return null;
  const detail = DETAILS[key];
  return {
    provider: detail.provider,
    voiceId: detail.voiceId,
    model: detail.model,
    language: detail.language || ''
  };
}

module.exports = { list, publicList, storedKey, forPayload, FAKES };
