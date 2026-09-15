import assert from 'node:assert/strict';
import { GameUIController } from '../../src/ui/GameUIController.js';

// Exercise the real controller lock transitions without starting a browser/app.
const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => null };
try {
  const preserve = { disabled: true, hasAttribute: name => name === 'data-preserve' };
  const help = { disabled: false, hasAttribute: () => false };
  const ui = Object.create(GameUIController.prototype);
  Object.assign(ui, {
    session: { subState: 'AWAITING_INPUT' }, inputLocked: true,
    promptInput: {}, sendButton: {}, modelProfileSelect: {},
    evidencePanel: { querySelectorAll: () => [preserve, help] },
    _renderOptionButtons() {},
  });
  ui._syncInputControls();
  assert.equal(preserve.disabled, true);
  assert.equal(help.disabled, true);
  ui._setInputLocked(false); // After response render + persistence.
  assert.equal(preserve.disabled, false);
  assert.equal(help.disabled, false);
  assert.equal(ui.sendButton.disabled, false);
  ui._setInputLocked(true); // Repeated clicks cannot submit during a request.
  assert.equal(preserve.disabled, true);
  ui.session.subState = 'DICE_PENDING';
  ui._setInputLocked(false);
  assert.equal(preserve.disabled, true);
  assert.match(preserve.title, /确认或取消/);
  ui.session.subState = 'AWAITING_INPUT'; // Dice cancellation/completion.
  ui._syncInputControls();
  assert.equal(preserve.disabled, false);
  ui.session.subState = 'COMPLETED';
  ui._syncInputControls();
  assert.equal(preserve.disabled, true);
  console.log('Sidebar action lock/unlock regression checks passed');
} finally { globalThis.document = previousDocument; }
