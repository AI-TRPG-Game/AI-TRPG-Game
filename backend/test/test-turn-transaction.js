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
// deadline enters the finale gate. Active danger continues at a frozen 06:00;
// only a later explicit final choice is allowed to start ENDING_GEN.
{
  const calls = [];
  const activeEventNarration = JSON.stringify({
    narration: '检定已经完成，行动后果在这里落定，但眼前的对手仍在逼近。',
    locations: [], npcs: [], items: [], actions: null,
    options: ['A. 处理证据', 'B. 登车', 'C. 留下', 'D. 自由行动'],
    time_cost_minutes: 0, time_cost_rationale: '', evidence_changes: [],
    suspicion_delta: 0,
    combat_update: { active: true, round: 2, objective: '摆脱围堵', exitConditions: ['成功撤离'], participants: ['npc_000'] },
    ending_recommendation: { should_end: false, reason: '' }, current_location_id: 'loc_001',
    active_event_ack: { event_id: 'last_action_event', outcome: 'last_action', incorporated: true, perceived_consequence: '对手仍在逼近。' },
  });
  const resolvedDangerNarration = JSON.stringify({
    narration: '你借着汽笛声摆脱围堵，眼前的直接危险终于结束。',
    locations: [], npcs: [], items: [], actions: null,
    options: ['A. 继续调查', 'B. 查看车站', 'C. 休息', 'D. 自由行动'],
    time_cost_minutes: 30, time_cost_rationale: '突破围堵', evidence_changes: [],
    suspicion_delta: 0,
    combat_update: { active: false, round: 2, objective: '摆脱围堵', exitConditions: ['成功撤离'], participants: ['npc_000'] },
    ending_recommendation: { should_end: true, reason: '普通模型试图结束' }, current_location_id: 'loc_001',
    active_event_ack: null,
  });
  const endingResult = JSON.stringify({
    ending_type: 'truth_sunk',
    ending_title: '灰烬中的名字',
    immediate_resolution: '你已经摆脱最后的围堵，并在列车启动前作出选择。',
    player_outcome: '你带着伤势登上列车，幸存下来，但不得不承受沉默的代价。',
    character_outcomes: [],
    truth_outcome: '名单被烧毁，本局中的真相无法公开。',
    ending_text: '钟声压过雨声，本次调查明确结束。',
    debrief: { hidden_plot: '', important_events: [], evidence_used: [], missed_leads: [], next_try: '' },
  });
  const provider = {
    model: 'test-model',
    async generate(assembled) {
      calls.push(assembled.flowType);
      return {
        content: assembled.flowType === 'ENDING_GEN'
          ? endingResult
          : (assembled.flowType === 'NARRATION_II' ? activeEventNarration : resolvedDangerNarration),
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
    scenarioClock: { currentTime: '05:35', deadline: '06:00', turn: 10, phase: 'aftermath', mode: 'normal' },
    playerLocationId: 'loc_001', evidence: [], suspicion: 0, scenarioFlags: {},
    scheduledEvents: [{ id: 'last_action_event', at: '05:50', placement: { mode: 'global' }, branches: { foreground: { outcome: 'last_action' } }, status: 'queued', fired: false }],
    activeScene: { kind: 'foreground', eventId: 'last_action_event', branchKey: 'foreground', outcome: 'last_action', locationId: 'loc_001', playerCue: '对手仍在逼近。' },
    combat: { active: true, round: 1, objective: '摆脱围堵', exitConditions: ['成功撤离'], participants: ['npc_000'] },
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
      turnRuling: { time_cost_minutes: 25, time_cost_rationale: '最后行动耗时', current_location_id: 'loc_001' },
    },
  });
  const deadlineRepo = new RequestSessionRepository(deadlineSession.toJSON());
  const deadlineOrchestrator = new GameOrchestrator({ repository: deadlineRepo, llmProvider: provider });
  let response = await deadlineOrchestrator.confirmDice(deadlineSession.id);
  assert(calls.join(',') === 'NARRATION_II', 'deadline should not invoke ending generation after the post-roll narration');
  assert(response.session.scenarioClock.currentTime === '06:00' && response.session.scenarioClock.mode === 'finale', 'completed roll turn should freeze the clock at the deadline');
  assert(response.session.scheduledEvents[0].status === 'resolved', 'active event should commit before the finale gate');
  assert(response.session.finaleState.stage === 'resolve_scene' && response.session.subState === 'AWAITING_INPUT', 'active combat should remain playable at the finale gate');
  assert(response.session.optionBuffer.includes('处理证据'), 'combat-stage ordinary actions should remain until danger is resolved');
  assert(
    response.result.refinedHtml.includes('检定已经完成') && !response.result.refinedHtml.includes('结局：'),
    'deadline response should show the resolved action without an ending card'
  );

  response = await deadlineOrchestrator.handleMessage(deadlineSession.id, '我借汽笛声摆脱围堵');
  assert(calls.join(',') === 'NARRATION_II,NARRATION_I', 'resolving finale combat should use normal narration without ending generation');
  assert(response.session.scenarioClock.currentTime === '06:00', 'combat resolution in finale mode should cost no clock time');
  assert(response.session.finaleState.stage === 'decision' && response.session.optionBuffer.includes('最终决定：公开真相'), 'resolved danger should replace ordinary options with server-authored final choices');
  assert(!response.result.refinedHtml.includes('继续调查'), 'ordinary model-generated options should be removed once the finale decision activates');

  response = await deadlineOrchestrator.handleMessage(deadlineSession.id, '我还没想好');
  assert(calls.join(',') === 'NARRATION_II,NARRATION_I', 'ambiguous finale text should not call the model');
  assert(response.session.finaleState.stage === 'decision' && response.session.subState === 'AWAITING_INPUT', 'ambiguous finale text should re-present the decision stage');

  response = await deadlineOrchestrator.handleMessage(deadlineSession.id, '选项C');
  assert(calls.join(',') === 'NARRATION_II,NARRATION_I,ENDING_GEN', 'only an explicit final choice should invoke ending generation');
  assert(response.session.subState === 'RESTART_PENDING' && response.session.finaleState.stage === 'complete', 'valid finale choice should produce a completed ending');
  assert(response.session.optionBuffer === '' && response.session.pendingDiceFlow === null && response.session.combat === null, 'ending generation should clear ordinary controls and pending danger state');
  assert(
    response.result.refinedHtml.includes('【结局：灰烬中的名字】')
      && response.result.refinedHtml.includes('真相与证据')
      && response.result.refinedHtml.includes('主持人复盘（含剧透）'),
    'structured ending should render a conclusive card followed by a spoiler debrief'
  );

  const noCombatSeed = deadlineSession.toJSON();
  noCombatSeed.id = 'direct-deadline-turn';
  noCombatSeed.subState = 'AWAITING_INPUT';
  noCombatSeed.pendingDiceFlow = null;
  noCombatSeed.chatRecord = [];
  noCombatSeed.displayLog = [];
  noCombatSeed.activeScene = null;
  noCombatSeed.scheduledEvents = [];
  noCombatSeed.combat = null;
  noCombatSeed.scenarioClock = { currentTime: '05:55', deadline: '06:00', turn: 10, phase: 'aftermath', mode: 'normal' };
  const noCombatCalls = [];
  const noCombatProvider = {
    model: 'test-model',
    async generate(assembled) {
      noCombatCalls.push(assembled.flowType);
      return { content: resolvedDangerNarration, reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const directRepo = new RequestSessionRepository(noCombatSeed);
  const directOrchestrator = new GameOrchestrator({ repository: directRepo, llmProvider: noCombatProvider });
  const directResponse = await directOrchestrator.handleMessage(noCombatSeed.id, '执行最后一次无需检定的行动');
  assert(noCombatCalls.join(',') === 'NARRATION_I', 'no-combat deadline turn should not invoke ending generation');
  assert(directResponse.session.finaleState.stage === 'decision' && directResponse.session.optionBuffer.includes('最终决定'), 'no-combat deadline should enter the decision stage immediately');
  assert(!directResponse.result.refinedHtml.includes('继续调查'), 'no-combat deadline should discard ordinary model options immediately');
}

console.log(`${passed} passed`);
