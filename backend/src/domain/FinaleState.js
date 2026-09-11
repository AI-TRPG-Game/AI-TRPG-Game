export const FINALE_OPTIONS = [
  'A. 最终决定：公开真相',
  'B. 最终决定：保全并带走证据',
  'C. 最终决定：销毁或压下真相',
  'D. 最终决定：撤离白桦站',
];

export const FINALE_OPTION_BUFFER = FINALE_OPTIONS.join('\n');

const FINALE_CHOICE_BY_LETTER = Object.freeze({
  A: 'expose',
  B: 'preserve',
  C: 'destroy',
  D: 'withdraw',
});

const TERMINAL_STAGES = new Set(['generating', 'complete']);

function toMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isFinaleClock(clock) {
  if (!clock) return false;
  if (clock.mode === 'finale') return true;
  const current = toMinutes(clock.currentTime);
  const deadline = toMinutes(clock.deadline);
  return current !== null && deadline !== null && current >= deadline;
}

/**
 * Repair persisted sessions that reached the deadline but lack a usable finale
 * stage. Keep a non-empty legacy option buffer for one request so the action the
 * player actually saw can still be interpreted; ambiguous input will replace it
 * with the canonical finale choices.
 */
export function repairFinaleState(session) {
  if (!isFinaleClock(session?.scenarioClock)) {
    return { repaired: false, stage: session?.finaleState?.stage || null };
  }

  const clockWasFinale = session.scenarioClock.mode === 'finale';
  session.scenarioClock.mode = 'finale';
  session.scenarioClock.phase = 'finale';

  const previousStage = session.finaleState?.stage || null;
  if (TERMINAL_STAGES.has(previousStage)) {
    session.optionBuffer = '';
    session.pendingDiceFlow = null;
    session.combat = null;
    return { repaired: !clockWasFinale, stage: previousStage };
  }

  const stage = session.combat?.active ? 'resolve_scene' : 'decision';
  session.finaleState = {
    ...(session.finaleState || {}),
    stage,
    enteredAt: session.finaleState?.enteredAt || session.scenarioClock.currentTime,
    reason: session.finaleState?.reason || 'deadline',
  };

  if (stage === 'decision') {
    session.pendingDiceFlow = null;
    if (!String(session.optionBuffer || '').trim()) {
      session.optionBuffer = FINALE_OPTION_BUFFER;
    }
  }

  return {
    repaired: !clockWasFinale || previousStage !== stage,
    previousStage,
    stage,
  };
}

export function detectFinaleOptionChoice(text = '') {
  const match = String(text).trim().match(/^(?:选项|选择)?\s*([A-D])\s*[。.!！]?$/i);
  return match ? FINALE_CHOICE_BY_LETTER[match[1].toUpperCase()] : null;
}
