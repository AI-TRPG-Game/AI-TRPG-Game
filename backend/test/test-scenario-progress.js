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
  scenarioRules: {
    clueCatalog: {
      a: { category: 'murder', source: 'a', reliability: 'high', description: 'a', truths: ['murder'] },
      b: { category: 'coverup', source: 'b', reliability: 'high', description: 'b', truths: ['coverup'] },
      c: { category: 'survivor', source: 'c', reliability: 'high', description: 'c', truths: ['survivor'] },
      d: { category: 'culprit', source: 'd', reliability: 'high', description: 'd', truths: ['culprit'] },
    },
    truths: { murder: ['a'], coverup: ['b'], survivor: ['c'], culprit: ['d'] },
  },
};

service.applyEvidenceChanges(session, [{ id: 'fake', secured: true }]);
assert(session.evidence.length === 0, 'catalogued scenarios must reject invented evidence IDs');
service.applyEvidenceChanges(session, ['a', 'b', 'c'].map(id => ({ id, secured: true })));
let truth = service.evaluateTruth(session);
assert(truth.truthKnown && !truth.truthProvable && truth.factCount === 3, 'three proven facts should enable a deliberate early resolution but not full proof');
assert(!service.canAcceptRecommendedEnding(session), 'the truth alone must not end the game before the player makes a final choice');
session.chatRecord = [{ role: 'player', content: 'I publish the evidence and expose the case.' }];
assert(service.canAcceptRecommendedEnding(session), 'a player final choice plus sufficient truth should allow an early ending');
service.applyEvidenceChanges(session, [{ id: 'd', secured: true }]);
truth = service.evaluateTruth(session);
assert(truth.truthProvable && service.chooseEndingType(session, 'player exposes the case') === 'truth_exposed', 'all authored facts should produce a deterministic truth-exposed ending');

assert(service.getSanState(49).id === 'uneasy', 'SAN 49 should be uneasy');
assert(service.getSanState(40).id === 'shaken', 'SAN 40 should be shaken');
assert(service.getSanState(20).id === 'unstable', 'SAN 20 should be unstable');
assert(service.getSuspicionState(6).id === 'obstructed', 'suspicion 6 should obstruct the investigator');

console.log(`${passed} passed`);
