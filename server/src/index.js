'use strict';
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const businesses = require('./businesses');
const { createApp } = require('./server');

async function main() {
  await db.migrate();
  await auth.ensureBootstrapAdmin();
  await businesses.seedPilot();
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log('ReceptWise server on :' + config.port,
      '| twilio', config.twilio.configured ? 'on' : 'off',
      '| vapi', config.vapi.configured ? 'on' : 'off',
      '| sms', config.smsEnabled ? 'on' : 'off');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
