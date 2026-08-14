import { ScheduleService } from '../src/services/ScheduleService.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const service = new ScheduleService();
const session = {
  scenarioId: 'test',
  scenarioClock: { currentTime: '00:30', deadline: '01:00', turn: 0, phase: 'hook' },
  scheduledEvents: [
    { id: 'one', at: '00:40', phase: 'investigation', fired: false },
    { id: 'two', at: '00:50', phase: 'crisis', fired: false },
  ],
  evidence: [],
  suspicion: 0,
  combat: null,
};

const first = service.applyNarrativeRuling(session, { time_cost_minutes: 15 });
assert(first.currentTime === '00:45', 'clock should advance by the adjudicated cost');
assert(first.firedEvents.length === 1 && first.firedEvents[0].id === 'one', 'crossed event should fire once');
assert(session.scenarioClock.turn === 1 && session.scenarioClock.phase === 'investigation', 'turn and phase should update');
assert(first.cost === 15 && first.currentTime === '00:45', 'turn result should contain the data needed for a visible timer summary');

const second = service.applyNarrativeRuling(session, { time_cost_minutes: 30 });
assert(second.currentTime === '01:00' && second.deadlineReached, 'clock should clamp at deadline');
assert(second.firedEvents.length === 1 && second.firedEvents[0].id === 'two', 'later event should fire once');

const pacedSession = {
  scenarioId: 'paced',
  scenarioRules: { time: { minimumMinutes: 10, maximumMinutes: 60 } },
  scenarioClock: { currentTime: '00:00', deadline: '02:00', turn: 0, phase: 'hook' },
  scheduledEvents: [], evidence: [], suspicion: 0, combat: null,
};
const shortTurn = service.applyNarrativeRuling(pacedSession, { time_cost_minutes: 2 });
assert(shortTurn.cost === 10 && shortTurn.currentTime === '00:10', 'meaningful scenario turns should have a 10-minute minimum');
pacedSession.suspicion = 3;
const watchedTurn = service.applyNarrativeRuling(pacedSession, { time_cost_minutes: 10 });
assert(watchedTurn.cost === 15 && watchedTurn.obstructionCost === 5, 'watched investigators should lose additional time');

service.applyStateRuling(session, {
  suspicion_delta: 3,
  evidence_changes: [{ id: 'evidence_001', category: 'murder', source: 'door', reliability: 'high', secured: true, description: 'scratch' }],
  combat_update: { active: true, round: 1, objective: 'secure evidence', exitConditions: ['escape'], participants: ['npc_000'] },
});
assert(session.suspicion === 3 && session.evidence[0].secured, 'state rulings should persist evidence and suspicion');
assert(session.combat.objective === 'secure evidence', 'combat ruling should persist');

console.log(`${passed} passed`);
