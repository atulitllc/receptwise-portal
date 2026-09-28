'use strict';
const db = require('./db');

async function record(userId, businessId, action, detail) {
  await db.query(
    'INSERT INTO audit_log (user_id, business_id, action, detail) VALUES ($1, $2, $3, $4)',
    [userId || null, businessId || null, action, detail || {}]
  );
}

module.exports = { record };
