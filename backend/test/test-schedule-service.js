import { ScheduleService } from '../src/services/ScheduleService.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const service = new ScheduleService();
const session = {
  scenarioId: 'test',
  scenarioRules: {
    locationCatalog: {
      loc_003: { name: 'Station platform', description: 'rainy platform' },
    },
  },
  locations: [{ id: 'loc_001', name: 'Corridor', description: 'corridor' }],
  playerLocationId: 'loc_001',
  scenarioClock: { currentTime: '00:30', deadline: '01:00', turn: 0, phase: 'hook' },
  scheduledEvents: [
    { id: 'one', at: '00:40', phase: 'investigation', revealsLocations: ['loc_003'], fired: false },
    { id: 'two', at: '00:50', phase: 'crisis', fired: false },
  ],
  evidence: [],
  suspicion: 0,
  combat: null,
};

const first = service.applyNarrativeRuling(session, { time_cost_minutes: 15 });
assert(first.currentTime === '00:45', 'clock should advance by the adjudicated cost');
assert(first.firedEvents.length === 1 && first.firedEvents[0].id === 'one', 'crossed event should fire once');
assert(first.revealedLocations.length === 1 && first.revealedLocations[0].id === 'loc_003', 'scheduled events should reveal their authored locations exactly once');
assert(session.locations.some(location => location.id === 'loc_003'), 'revealed locations should be added to the sidebar location state');
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
pacedSession.sanity = { activeTrauma: { id: 'freeze', pendingTimePenaltyMinutes: 10 } };
const traumaTurn = service.applyNarrativeRuling(pacedSession, { time_cost_minutes: 10 });
assert(traumaTurn.cost === 25 && traumaTurn.traumaCost === 10 && pacedSession.sanity.activeTrauma === null, 'freeze trauma should make the next action take extra time once');

service.applyStateRuling(session, {
  suspicion_delta: 3,
  evidence_changes: [{ id: 'evidence_001', category: 'murder', source: 'door', reliability: 'high', secured: true, description: 'scratch' }],
  combat_update: { active: true, round: 1, objective: 'secure evidence', exitConditions: ['escape'], participants: ['npc_000'] },
  current_location_id: 'loc_003',
});
assert(session.suspicion === 3 && session.evidence[0].secured, 'state rulings should persist evidence and suspicion');
assert(session.combat.objective === 'secure evidence', 'combat ruling should persist');
assert(session.playerLocationId === 'loc_003', 'only discovered location IDs should update the player location');
service.applyStateRuling(session, { current_location_id: 'loc_hidden' });
assert(session.playerLocationId === 'loc_003', 'undiscovered location IDs must not move the player');

const custodySession = {
  scenarioId: 'authored-custody', suspicion: 0, combat: null,
  playerLocationId: 'loc_001', locations: [{ id: 'loc_001', name: '包厢' }],
  evidence: [{ id: 'evidence_001', source: '包厢门锁', discovered: true, secured: false }],
  scenarioRules: {
    clueCatalog: {
      evidence_001: { category: 'murder', source: '包厢门锁', locationId: 'loc_001', keywords: ['门锁', '刮痕'] },
    },
  },
};
service.applyStateRuling(custodySession, {
  evidence_changes: [{ id: 'evidence_001', secured: true }],
}, { userText: '我再次查看门锁刮痕' });
assert(!custodySession.evidence[0].secured, 'model output alone must not secure evidence after passive observation');
service.applyStateRuling(custodySession, {
  evidence_changes: [{ id: 'evidence_001', secured: true }],
}, { userText: '我给门锁刮痕拍照并拓印' });
assert(custodySession.evidence[0].secured, 'explicit preservation action should allow the evidence upgrade');

console.log(`${passed} passed`);
