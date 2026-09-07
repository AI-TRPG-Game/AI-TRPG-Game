import { ScenarioProgressService } from '../src/services/ScenarioProgressService.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const service = new ScenarioProgressService();
const session = {
  suspicion: 0,
  evidence: [],
  npcs: [{ id: 'npc_000', hp: 11, san: 60 }],
  playerLocationId: 'loc_001',
  locations: [{ id: 'loc_001', name: 'train corridor', description: '' }],
  scenarioRules: {
    sanEvents: {
      at_platform: { at: '00:40', locationId: 'loc_003', severity: 'major' },
      in_corridor: { at: '00:40', locationId: 'loc_001', severity: 'unease' },
    },
    clueCatalog: {
      a: { category: 'murder', source: 'a', reliability: 'high', description: 'a', truths: ['murder'] },
      b: { category: 'coverup', source: 'b', reliability: 'high', description: 'b', truths: ['coverup'] },
      c: { category: 'survivor', source: 'c', reliability: 'high', description: 'c', truths: ['survivor'] },
      d: { category: 'culprit', source: 'd', reliability: 'high', description: 'd', truths: ['culprit'] },
    },
    truths: { murder: ['a'], coverup: ['b'], survivor: ['c'], culprit: ['d'] },
  },
};

session.scenarioClock = { currentTime: '00:40' };
assert(service.getAvailableSanEvents(session).map(event => event.id).join(',') === 'in_corridor', 'SAN events should only be available at the player current location');

service.applyEvidenceChanges(session, [{ id: 'fake', secured: true }]);
assert(session.evidence.length === 0, 'catalogued scenarios must reject invented evidence IDs');
service.applyEvidenceChanges(session, ['a', 'b', 'c'].map(id => ({ id, secured: true })));
let truth = service.evaluateTruth(session);
assert(truth.truthKnown && !truth.truthProvable && truth.factCount === 3, 'three proven facts should enable a deliberate early resolution but not full proof');
assert(!service.canAcceptRecommendedEnding(session), 'the truth alone must not end the game before the player makes a final choice');
session.chatRecord = [{ role: 'player', content: 'I publish the evidence and expose the case.' }];
assert(service.canAcceptRecommendedEnding(session), 'a player final choice plus sufficient truth should allow an early ending');
assert(session.finalChoice === 'expose', 'an explicit final commitment should be stored as structured state');
session.chatRecord = [{ role: 'player', content: 'Should I publish the evidence?' }];
assert(!service.canAcceptRecommendedEnding(session), 'a question about publishing must not be mistaken for a final choice');
session.chatRecord = [{ role: 'player', content: 'I do not publish the evidence.' }];
assert(!service.canAcceptRecommendedEnding(session), 'a negated ending statement must not be mistaken for a final choice');
service.applyEvidenceChanges(session, [{ id: 'd', secured: true }]);
truth = service.evaluateTruth(session);
session.finalChoice = 'expose';
assert(truth.truthProvable && service.chooseEndingType(session, 'player exposes the case') === 'truth_exposed', 'proof plus an expose choice should produce the truth-exposed ending');
session.finalChoice = 'destroy';
assert(service.chooseEndingType(session, 'player destroys the case') === 'truth_sunk', 'full proof must not override a player choice to destroy the truth');
session.finalChoice = 'preserve';
assert(service.chooseEndingType(session, 'player preserves the case') === 'forbidden_cargo', 'preserving the evidence should produce the forbidden-cargo ending');

assert(service.getSanState(50).id === 'uneasy', 'SAN 50 should be uneasy');
assert(service.getSanState(45).id === 'shaken', 'SAN 45 should be shaken and gain an early penalty');
assert(service.getSanState(30).id === 'unstable', 'SAN 30 should be unstable');
assert(service.getSanState(15).id === 'critical', 'SAN 15 should be critical, not madness');
assert(service.getSuspicionState(6).id === 'obstructed', 'suspicion 6 should obstruct the investigator');

console.log(`${passed} passed`);
