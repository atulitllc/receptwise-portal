'use strict';
// All configuration comes from environment variables. Third-party integrations stay inert
// (return a clear "not configured" result) until their keys are set.

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

const env = process.env;

const config = {
  port: Number(env.PORT) || 3000,
  production: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL || '',
  // Render sets RENDER_EXTERNAL_URL automatically on web services.
  appBaseUrl: (env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  sessionDays: Number(env.SESSION_DAYS) || 14,
  admin: { email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || '' },
  smsEnabled: bool(env.SMS_ENABLED, false),
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    defaultAreaCodes: (env.TWILIO_AREA_CODES || '781,339,617').split(',').map((s) => s.trim()).filter(Boolean)
  },
  vapi: {
    apiKey: env.VAPI_API_KEY || '',
    baseUrl: (env.VAPI_BASE_URL || 'https://api.vapi.ai').replace(/\/+$/, ''),
    webhookSecret: env.VAPI_WEBHOOK_SECRET || '',
    // Premium defaults approved for the pilot. All overridable without code changes.
    model: env.VAPI_MODEL || 'gpt-4.1',
    voiceProvider: env.VAPI_VOICE_PROVIDER || '11labs',
    voiceId: env.VAPI_VOICE_ID || '',
    voiceModel: env.VAPI_VOICE_MODEL || 'eleven_flash_v2_5',
    transcriberModel: env.VAPI_TRANSCRIBER_MODEL || 'nova-3',
    // Tool IDs of the Google Calendar tools created once in the Vapi dashboard (Integrations > Google Calendar).
    calendarToolIds: (env.VAPI_CALENDAR_TOOL_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxCallSeconds: Number(env.VAPI_MAX_CALL_SECONDS) || 600
  },
  transferToNumber: env.TRANSFER_TO_NUMBER || ''
};

config.twilio.configured = Boolean(config.twilio.accountSid && config.twilio.authToken);
config.vapi.configured = Boolean(config.vapi.apiKey);

module.exports = config;
