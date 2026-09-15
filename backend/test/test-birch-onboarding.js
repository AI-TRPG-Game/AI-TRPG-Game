import { BIRCH_STATION_TUTORIAL } from '../src/scenarios/birchStation.js';
import { ScenarioProgressService } from '../src/services/ScenarioProgressService.js';
import { DamageResolver } from '../src/services/DamageResolver.js';
import { GameSession } from '../src/domain/GameSession.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const definition = BIRCH_STATION_TUTORIAL;
assert(definition.opening.narration.includes('苏棠') && definition.opening.narration.includes('林晚'), 'opening should introduce all scheduled named characters');
assert(definition.npcs.some(npc => npc.name === '苏棠' && npc.visibility === 'visible'), 'Su Tang should be a visible authored NPC');
assert(definition.npcs.some(npc => npc.name === '林晚' && npc.visibility === 'visible'), 'Lin Wan should be a visible authored NPC');
assert(definition.npcs.some(npc => npc.name === '程岳' && npc.visibility === 'hidden'), 'Cheng Yue should remain hidden until revealed');

const oldEvent = structuredClone(definition.scheduledEvents[0]);
delete oldEvent.branches.foreground.playerCue;
const migrated = new GameSession({
  scenarioId: definition.id,
  scenarioRules: structuredClone(definition.scenarioRules),
  scenarioClock: { currentTime: '00:40', deadline: '06:00', turn: 1, phase: 'hook' },
  scheduledEvents: [oldEvent],
  activeScene: { kind: 'foreground', eventId: oldEvent.id, branchKey: 'foreground', outcome: oldEvent.branches.foreground.outcome, locationId: 'loc_001' },
  locations: structuredClone(definition.locations),
});
assert(migrated.scenarioClock.mode === 'normal' && migrated.finaleState === null, 'older saves should migrate to normal clock mode with no finale state');
assert(migrated.scheduledEvents[0].branches.foreground.playerCue && migrated.activeScene.playerCue, 'older Birch Station event snapshots should regain authored player cues');

const stuckFinale = new GameSession({
  scenarioId: definition.id,
  scenarioRules: structuredClone(definition.scenarioRules),
  scenarioClock: { currentTime: '06:00', deadline: '06:00', turn: 20, phase: 'aftermath', mode: 'finale' },
  finaleState: null,
  optionBuffer: 'A. 登上雾港号离开白桦站\nB. 等待\nC. 追下去\nD. 自由行动',
  combat: null,
  locations: structuredClone(definition.locations),
});
assert(stuckFinale.finaleState?.stage === 'decision', 'a frozen legacy finale must recover into the decision stage');
assert(stuckFinale.optionBuffer.startsWith('A. 登上雾港号'), 'recovery should preserve one visible legacy choice buffer for semantic interpretation');

const emptyFinale = new GameSession({
  scenarioClock: { currentTime: '06:00', deadline: '06:00', turn: 20, phase: 'aftermath', mode: 'normal' },
  finaleState: null,
  optionBuffer: '',
  combat: null,
});
assert(emptyFinale.scenarioClock.mode === 'finale' && emptyFinale.finaleState?.stage === 'decision', 'a save at the deadline must enter finale mode even if its old mode was normal');
assert(emptyFinale.optionBuffer.includes('最终决定：公开真相'), 'a recovered finale without choices must receive canonical final choices');

const service = new ScenarioProgressService();
const session = {
  scenarioRules: definition.scenarioRules,
  evidence: definition.evidence.map(evidence => ({ ...evidence })),
};
let progress = service.getEvidenceProgress(session);
assert(progress.discovered === 2 && progress.secured === 0 && progress.total === 8, 'authored evidence progress should distinguish discovered and secured clues');
const inferred = service.inferEvidenceChanges({ ...session, playerLocationId: 'loc_001' }, '检查尸体手臂上的针孔');
assert(inferred.some(change => change.id === 'evidence_003'), 'authored clue rules should infer a newly discovered clue from a matching action');
service.applyEvidenceChanges(session, [{ id: 'evidence_006', secured: false }]);
progress = service.getEvidenceProgress(session);
assert(progress.discovered === 3 && progress.secured === 0, 'finding a clue should increase discovered progress without proving it');
service.applyEvidenceChanges(session, [{ id: 'evidence_006', secured: true }]);
progress = service.getEvidenceProgress(session);
assert(progress.secured === 1, 'explicitly securing a clue should increase secured progress');

const resolver = new DamageResolver();
const sanSession = {
  scenarioId: definition.id,
  scenarioClock: { currentTime: '00:40' },
  scenarioRules: { sanEvents: { signal: { at: '00:40', severity: 'unease', target: 'player', label: '信号灯' } } },
  sanity: { state: 'stable', resolvedEventIds: [], traumaHistory: [], activeTrauma: null },
  suspicion: 0,
  npcs: [{ id: 'npc_000', name: '调查记者', importance: 'player', hp: 11, maxHp: 11, san: 60, maxSan: 60, status: 'active' }],
};
const sanResult = resolver.resolve(sanSession, { actions: [{ type: 'sancheck', target: 'player', san_event_id: 'signal', san_severity: 'unease' }] });
assert(sanResult.systemMessages[0].includes('调查记者'), 'player SAN messages should use the player identity instead of an internal NPC id');

console.log(`${passed} passed`);
