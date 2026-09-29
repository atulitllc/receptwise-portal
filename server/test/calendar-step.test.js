'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const step = require('../../assets/calendar-step.js');

function textOf(choice) {
  const panel = step.describe(choice);
  return [panel.title, panel.note, panel.button, panel.checklist].concat(panel.steps).join('\n');
}

test('calendar step copy branches by provider', () => {
  const google = step.describe('google');
  assert.equal(google.signIn, true);
  assert.equal(google.button, 'Send the calendar sign-in link');
  assert.match(google.note, /After they approve/);
  assert.equal(google.keyField, false);

  const cal = step.describe('cal');
  assert.equal(cal.provider, 'calcom');
  assert.equal(cal.signIn, false);
  assert.equal(cal.button, '');
  assert.equal(cal.keyField, true);
  assert.equal(cal.eventTypeField, true);
  assert.equal(cal.steps.length, 4);
  assert.match(cal.steps[0], /create an event type/);
  assert.match(cal.steps[0], /20-minute demo/);
  assert.match(cal.steps[1], /Settings > Developer > API keys/);
  assert.match(cal.steps[2], /Paste the API key/);
  assert.match(cal.steps[3], /event type slug or ID/);
  assert.doesNotMatch(textOf('cal'), /sign-in/i);
  assert.equal(step.profile('cal', '20-minute-demo').provider, 'calcom');
  assert.equal(step.profile('cal', '20-minute-demo').calcomEventTypeId, '20-minute-demo');
  assert.equal(Object.hasOwn(step.profile('cal', '20-minute-demo'), 'apiKey'), false);

  assert.equal(step.describe('microsoft').signIn, true);
  assert.match(textOf('microsoft'), /IT admin/);
  assert.match(textOf('microsoft'), /sign-in link/);

  ['square', 'vagaro', 'fresha', 'booksy', 'none'].forEach((choice) => {
    const panel = step.describe(choice);
    assert.equal(panel.signIn, false, choice);
    assert.equal(panel.button, '', choice);
    assert.doesNotMatch(textOf(choice), /sign-in/i, choice);
  });
  assert.match(textOf('none'), /takes a message/);
  assert.match(textOf('none'), /does not book/);
  assert.match(textOf('fresha'), /booking link/);
  assert.match(textOf('booksy'), /booking link/);
  assert.match(textOf('square'), /Plus or Premium/);
  assert.match(textOf('vagaro'), /takes a message/);

  assert.equal(step.choiceValue('calcom'), 'cal');
  assert.deepEqual(step.profile('google'), { provider: 'google' });
  assert.equal(step.choices().some((row) => row.id === 'none' && row.title === 'None / take messages'), true);
});
