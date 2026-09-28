'use strict';
const db = require('../src/db');
db.migrate().then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
