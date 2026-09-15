import assert from 'node:assert/strict';
import { GameSession } from '../src/domain/GameSession.js';
import { forceFinaleClosure, completeFinaleAction, playerActionMinutes, enforceDeparture } from '../src/services/FinaleDirector.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';
import { BIRCH_STATION_TUTORIAL as def } from '../src/scenarios/birchStation.js';
import { ScheduleService } from '../src/services/ScheduleService.js';

const seed = { id: 'finale-check', phase: 'STORY_PLAY', subState: 'AWAITING_INPUT', scenarioId: def.id,
  scenarioClock: { mode: 'finale', currentTime: '06:00', deadline: '06:00' }, scenarioRules: { pacingVersion: 1 },
  combat: { active: true, objective: '逃离', participants: ['npc_000', 'npc_001'] },
  finaleState: { stage: 'resolve_scene', completedActions: 2 },
  evidence: [{ id: 'evidence_001', secured: true }],
};
const session = new GameSession(structuredClone(seed));
assert.equal(session.finaleState.completedActions, 2);
assert.equal(session.scenarioRules.pacingVersion, 1, 'old saves retain pacing');
const repo = new RequestSessionRepository(session.toJSON());
const engine = new GameOrchestrator({ repository: repo, llmProvider: {} });
const active = repo.findById(seed.id);
active.pendingDiceFlow = { actions: [], rollbackState: engine._captureTurnRollback(active), rollbackChatLen: active.chatRecord.length, rollbackDisplayLen: active.displayLog.length };
active.subState = 'DICE_PENDING';
assert.equal(engine.cancelDice(active.id).session.finaleState.completedActions, 2, 'cancellation preserves budget');
completeFinaleAction(session, '继续抵抗');
assert.equal(session.finaleState.completedActions, 3);
assert.equal(session.combat, null);
assert.equal(session.evidence.length, 1);
assert.equal(session.evidence[0].secured, true);
assert.equal(session.finaleState.crisisSnapshot.participants.length, 2);
const success = new GameSession(structuredClone(seed));
success.finaleState.lastCheck = { success: true };
completeFinaleAction(success, '尝试逃离');
assert.equal(success.finaleState.resolutionOutcome.kind, 'successful_exit');
const surrender = new GameSession(structuredClone(seed));
surrender.inventory = [{ id: 'held', name: '原始名单', status: '已获得' }, { id: 'other', name: '录音笔', status: '已获得' }];
forceFinaleClosure(surrender, '交出原始名单');
assert.equal(surrender.inventory[0].status, '已失去');
assert.equal(surrender.inventory[1].status, '已获得');
assert.equal(playerActionMinutes({ combat: null }, '进入候车厅'), 10);
assert.equal(playerActionMinutes({ combat: null }, '拍照保全刮痕'), 15);
assert.equal(playerActionMinutes({ combat: null }, '逐页抄录档案'), 20);
assert.ok(!enforceDeparture(session, { narration: '你登上雾港号。', options: ['A. 登车离开'] }).narration.includes('登上'));
const complete = new GameSession({ ...seed, finaleState: { stage: 'complete' } });
assert.equal(complete.subState, 'RESTART_PENDING');
const finalRepo = new RequestSessionRepository({ ...seed, combat: null, finaleState: { stage: 'decision' }, optionBuffer: 'A. 最终决定：公开真相\nB. 最终决定：保全并带走证据\nC. 最终决定：销毁或压下真相\nD. 最终决定：撤离白桦站' });
const finalEngine = new GameOrchestrator({ repository: finalRepo, llmProvider: { generate() { throw Error('must not call'); } } });
assert.equal((await finalEngine.handleMessage(seed.id, '选项A和C')).session.finaleState.stage, 'decision');
assert.equal((await finalEngine.handleMessage(seed.id, 'A B')).session.finaleState.stage, 'decision');
const scheduler = new ScheduleService();
const timed = new GameSession({ ...structuredClone(def), id: 'timing-check', phase: 'STORY_PLAY',
  scenarioRules: { ...structuredClone(def.scenarioRules), pacingVersion: 2 },
  scenarioId: def.id, playerLocationId: 'loc_001', scenarioClock: { currentTime: '03:20', deadline: '06:00', turn: 10, mode: 'normal' },
  scheduledEvents: structuredClone(def.scheduledEvents.filter(event => event.id === 'records_0240')) });
const cue = scheduler.prepareTurn(timed).activeScene;
assert.equal(cue.branchKey, 'nearby', 'late remote announcement must still offer an intervention window');
timed.scenarioClock.turn++; // Complete the action which first announces the event.
scheduler.commitActiveScene(timed);
timed.scenarioClock.turn++;
assert.equal(scheduler.commitActiveScene(timed).awaitingResponse, true);
assert.equal(timed.scheduledEvents[0].fired, false, 'first response must not exhaust the remote window');
timed.scenarioClock.turn++;
assert.ok(scheduler.commitActiveScene(timed).event, 'second response can resolve the announced development');
console.log('Finale recovery, budget, cancellation, surrender, departure, and conflicting-choice tests passed');
