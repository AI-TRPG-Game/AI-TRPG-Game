import { GameSession } from '../src/domain/GameSession.js';
import { SubState } from '../src/domain/enums.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const initial = new GameSession({
  id: 'turn-transaction',
  phase: 'STORY_PLAY',
  subState: 'AWAITING_INPUT',
  optionBuffer: 'A. 原选项',
  chatRecord: [{ role: 'kp', type: 'narration', content: '原叙事' }],
  displayLog: [{ role: 'kp', content: '原叙事' }],
  scenarioId: 'test',
  scenarioClock: { currentTime: '02:30', deadline: '06:00', turn: 4, phase: 'investigation' },
  playerLocationId: 'loc_001',
  locations: [{ id: 'loc_001', name: '走廊', description: '' }],
  npcs: [{ id: 'npc_000', name: '玩家', locationId: 'loc_001', hp: 10, maxHp: 10, san: 50, maxSan: 50 }],
  scheduledEvents: [{ id: 'event', at: '02:40', placement: { mode: 'global' }, branches: { foreground: { outcome: 'event' } }, status: 'dormant', fired: false }],
  scenarioFlags: {},
  evidence: [],
  suspicion: 0,
});
const repository = new RequestSessionRepository(initial.toJSON());
const orchestrator = new GameOrchestrator({ repository, llmProvider: {} });
const session = repository.findById(initial.id);
const rollbackState = orchestrator._captureTurnRollback(session);

session.chatRecord.push({ role: 'player', content: '冒险行动' });
session.displayLog.push({ role: 'player', content: '冒险行动' });
session.displayLog.push({ role: 'kp', content: '即将检定的叙事' });
session.optionBuffer = '';
session.scenarioClock.currentTime = '02:50';
session.scenarioClock.turn = 5;
session.scheduledEvents[0].status = 'queued';
session.activeScene = { eventId: 'event', kind: 'foreground' };
session.scenarioFlags.changed = true;
session.subState = SubState.DICE_PENDING;
session.pendingDiceFlow = {
  actions: [{ type: 'skill_check', trigger: 'player' }],
  pendingRaw: '{}',
  rollbackState,
  rollbackChatLen: 2,
  rollbackDisplayLen: 3,
};

const result = orchestrator.cancelDice(session.id);
const restored = result.session;
assert(restored.subState === SubState.AWAITING_INPUT, 'cancel should unlock the turn');
assert(restored.chatRecord.length === 1 && restored.chatRecord[0].content === '原叙事', 'cancel should remove the player intent and pending narration from history');
assert(restored.displayLog.length === 2 && restored.displayLog[0].content === '原叙事', 'cancel should restore display state and then append one cancellation notice');
assert(restored.scenarioClock.currentTime === '02:30' && restored.scenarioClock.turn === 4, 'cancel should restore clock state');
assert(restored.scheduledEvents[0].status === 'dormant' && !restored.activeScene, 'cancel should restore event lifecycle state');
assert(!restored.scenarioFlags.changed && restored.optionBuffer === '', 'cancel should restore scenario flags and deliberately clear stale choices');

// A confirmed check must receive its NARRATION_II result before a crossed
// deadline triggers ENDING_GEN. This guards the old ordering that swallowed the
// promised roll/follow-up as soon as the clock reached 06:00.
{
  const calls = [];
  const narrativeResult = JSON.stringify({
    narration: '检定已经完成，行动后果在这里落定。',
    locations: [], npcs: [], items: [], actions: null,
    options: ['A. 处理证据', 'B. 登车', 'C. 留下', 'D. 自由行动'],
    time_cost_minutes: 0, time_cost_rationale: '', evidence_changes: [],
    suspicion_delta: 0, combat_update: null,
    ending_recommendation: { should_end: false, reason: '' }, current_location_id: 'loc_001',
  });
  const endingResult = JSON.stringify({
    ending_type: 'truth_sunk', ending_text: '钟声压过雨声，本次调查结束。', player_choice: '',
    debrief: { hidden_plot: '', important_events: [], evidence_used: [], missed_leads: [], next_try: '' },
  });
  const provider = {
    model: 'test-model',
    async generate(assembled) {
      calls.push(assembled.flowType);
      return {
        content: assembled.flowType === 'ENDING_GEN' ? endingResult : narrativeResult,
        reasoningContent: null,
        thinkingEnabled: false,
        hasToolCall: true,
      };
    },
  };
  const deadlineSession = new GameSession({
    id: 'deadline-turn', phase: 'STORY_PLAY', subState: 'DICE_PENDING', openingDone: true,
    worldSettings: '测试世界', player: '姓名：玩家\nHP：10  SAN：50',
    chatRecord: [{ role: 'player', type: 'prompt', content: '完成最后一次行动' }],
    displayLog: [], locations: [{ id: 'loc_001', name: '站台', description: '' }],
    npcs: [{ id: 'npc_000', name: '玩家', importance: 'player', locationId: 'loc_001', hp: 10, maxHp: 10, san: 50, maxSan: 50, visibility: 'visible', status: 'active', attributes: null }],
    scenarioId: 'test', scenarioRules: { time: { minimumMinutes: 10, maximumMinutes: 60 }, truths: {} },
    scenarioClock: { currentTime: '05:55', deadline: '06:00', turn: 10, phase: 'aftermath' },
    playerLocationId: 'loc_001', evidence: [], suspicion: 0, scenarioFlags: {},
    scheduledEvents: [{ id: 'last_action_event', at: '05:50', placement: { mode: 'global' }, branches: { foreground: { outcome: 'last_action' } }, status: 'queued', fired: false }],
    activeScene: { kind: 'foreground', eventId: 'last_action_event', branchKey: 'foreground', outcome: 'last_action', locationId: 'loc_001' },
    pendingDiceFlow: {
      actions: [{ type: 'direct', trigger: 'others', changes: [] }],
      pendingRaw: JSON.stringify({
        narration: '你开始最后一次行动。', locations: [], npcs: [], items: [],
        actions: [{ type: 'direct', trigger: 'others', changes: [] }], options: null,
        time_cost_minutes: 10, time_cost_rationale: '最后行动耗时', evidence_changes: [],
        suspicion_delta: 0, combat_update: null,
        ending_recommendation: { should_end: false, reason: '' }, current_location_id: 'loc_001',
      }),
      sourceFlowType: 'NARRATION_I', dialogStage: 'A_CONFIRM', hasS: false,
      turnRuling: { time_cost_minutes: 10, time_cost_rationale: '最后行动耗时', current_location_id: 'loc_001' },
    },
  });
  const directDeadlineSeed = deadlineSession.toJSON();
  const deadlineRepo = new RequestSessionRepository(deadlineSession.toJSON());
  const deadlineOrchestrator = new GameOrchestrator({ repository: deadlineRepo, llmProvider: provider });
  const response = await deadlineOrchestrator.confirmDice(deadlineSession.id);
  assert(calls.join(',') === 'NARRATION_II,ENDING_GEN', 'deadline should be evaluated only after the post-roll narration');
  assert(response.session.scenarioClock.currentTime === '06:00', 'completed roll turn should advance the clock to the deadline');
  assert(response.session.scheduledEvents[0].status === 'resolved', 'active event should commit before the ending is generated');
  assert(response.result.endingTriggered && response.session.subState === 'RESTART_PENDING', 'deadline should still produce a completed ending after the turn resolves');
  assert(
    response.result.refinedHtml.includes('检定已经完成') && response.result.refinedHtml.includes('钟声压过雨声'),
    'live deadline response should show the resolved action before the ending'
  );

  directDeadlineSeed.id = 'direct-deadline-turn';
  directDeadlineSeed.subState = 'AWAITING_INPUT';
  directDeadlineSeed.pendingDiceFlow = null;
  directDeadlineSeed.chatRecord = [];
  directDeadlineSeed.displayLog = [];
  const directRepo = new RequestSessionRepository(directDeadlineSeed);
  const directOrchestrator = new GameOrchestrator({ repository: directRepo, llmProvider: provider });
  const directResponse = await directOrchestrator.handleMessage(directDeadlineSeed.id, '执行最后一次无需检定的行动');
  assert(directResponse.session?.subState === 'RESTART_PENDING', 'direct deadline turn should preserve the normal response envelope');
  assert(
    directResponse.result.refinedHtml.includes('检定已经完成') && directResponse.result.refinedHtml.includes('钟声压过雨声'),
    'direct deadline response should show turn narration before the ending'
  );
}

console.log(`${passed} passed`);
