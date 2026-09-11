import { GameSession } from '../src/domain/GameSession.js';
import { SubState } from '../src/domain/enums.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function richNarration(opening) {
  return [
    opening,
    '汽笛的余音沿着潮湿墙壁反复回荡，顶灯在风雨里明灭不定。你先稳住呼吸，确认身后的出口仍然可以通行，也记下对手与证据之间的距离，没有让突如其来的变化抹掉先前掌握的线索。',
    '对面的人没有马上追击。他的视线先落到你的内袋，又移向站台尽头，迟疑暴露了真正目标并非伤害你，而是阻止那些记录离开白桦站。这个短暂停顿给了你调整位置的机会，也让双方的意图变得更清楚。',
    '雨水从破裂窗框斜吹进来，地面积水映出摇晃人影。你借着列车震动挪到立柱旁，既避开正面冲撞，又让手中的资料远离火源。远处传来乘务员关门的喊声，意味着可用路线正在迅速减少。',
    '许薇在门后短促地提醒了一句，声音被汽笛切碎，却足以指出侧面的狭窄通道。你没有替她作决定，只确认她暂时能够行动；她的反应也证明对手尚未控制整段走廊，局势仍有可以利用的缝隙。',
    '你迅速复盘刚才的动作，把擦伤、遗落物和每个人站立的位置一一对应。几处细节互相印证：有人提前熟悉停电后的路线，也有人直到汽笛响起才改变立场。它们还不是完整答案，却足以排除最轻易的谎言。',
    '列车轮下传来缓慢而沉重的咬合声，像整座车站终于从睡梦中翻身。冷风卷着煤灰穿过门缝，提醒你时间已经无法追回。你把能够复核的资料重新收好，并确认最脆弱的一页没有在冲突中遗失。',
    '走廊另一端出现短暂的人影，随后又退回昏暗处。那个人没有靠近，却显然在等待你的选择。你意识到下一步不只影响自己能否离开，也会决定证人是否敢开口，以及剩余记录能不能撑过这场雨。',
    '当最后一阵金属摩擦声停下，你已经看清下一步的代价：继续纠缠可能失去登车窗口，贸然撤退又会暴露证据所在。眼前危险得到了阶段性结果，但接下来仍需在保护资料、争取证人和安全撤离之间作出明确选择。',
  ].join('\n\n');
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

// If the previous committed turn announced an event at a time boundary, a
// canceled response action must return to that announced, unresolved scene.
{
  const announced = new GameSession({
    id: 'boundary-rollback', phase: 'STORY_PLAY', subState: 'AWAITING_INPUT',
    scenarioId: 'test', scenarioClock: { currentTime: '01:15', deadline: '06:00', turn: 3, phase: 'investigation', mode: 'normal' },
    playerLocationId: 'loc_001', locations: [{ id: 'loc_001', name: '走廊' }],
    npcs: [{ id: 'npc_000', name: '玩家', importance: 'player', hp: 10, maxHp: 10, san: 50, maxSan: 50 }],
    scheduledEvents: [{ id: 'blackout', at: '01:10', status: 'queued', fired: false, placement: { mode: 'global' }, branches: { foreground: { outcome: 'dark' } } }],
    activeScene: { kind: 'foreground', eventId: 'blackout', branchKey: 'foreground', outcome: 'dark', locationId: 'loc_001', playerCue: '灯光骤灭。', announcedAtBoundary: true },
    evidence: [], scenarioFlags: {}, suspicion: 0,
  });
  const announcedRepo = new RequestSessionRepository(announced.toJSON());
  const announcedOrchestrator = new GameOrchestrator({ repository: announcedRepo, llmProvider: {} });
  const announcedSession = announcedRepo.findById(announced.id);
  const announcedRollback = announcedOrchestrator._captureTurnRollback(announcedSession);
  announcedSession.activeScene = null;
  announcedSession.scheduledEvents[0].status = 'resolved';
  announcedSession.scheduledEvents[0].fired = true;
  announcedSession.subState = SubState.DICE_PENDING;
  announcedSession.pendingDiceFlow = { actions: [], rollbackState: announcedRollback, rollbackChatLen: 0, rollbackDisplayLen: 0 };
  const canceled = announcedOrchestrator.cancelDice(announced.id).session;
  assert(canceled.activeScene?.announcedAtBoundary && canceled.scheduledEvents[0].status === 'queued' && !canceled.scheduledEvents[0].fired, 'dice cancellation should preserve the previously announced boundary scene');
}

// A confirmed check must receive its NARRATION_II result before a crossed
// deadline enters the finale gate. Active danger continues at a frozen 06:00;
// only a later explicit final choice is allowed to start ENDING_GEN.
{
  const calls = [];
  const activeEventNarration = JSON.stringify({
    narration: richNarration('检定已经完成，行动后果在这里落定，但眼前的对手仍在逼近。'),
    locations: [], npcs: [], items: [], actions: null,
    options: ['A. 处理证据', 'B. 登车', 'C. 留下', 'D. 自由行动'],
    time_cost_minutes: 0, time_cost_rationale: '', evidence_changes: [],
    suspicion_delta: 0,
    combat_update: { active: true, round: 2, objective: '摆脱围堵', exitConditions: ['成功撤离'], participants: ['npc_000'] },
    ending_recommendation: { should_end: false, reason: '' }, current_location_id: 'loc_001',
    active_event_ack: { event_id: 'last_action_event', outcome: 'last_action', incorporated: true, perceived_consequence: '对手仍在逼近。' },
  });
  const resolvedDangerNarration = JSON.stringify({
    narration: richNarration('你借着汽笛声摆脱围堵，眼前的直接危险终于结束。'),
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

  // A persisted session from an older/interrupted build may have a frozen
  // finale clock but no finaleState. It must interpret the action the player
  // actually saw and go straight to ENDING_GEN instead of narrating it again.
  const repairedSeed = noCombatSeed;
  repairedSeed.id = 'repaired-stuck-finale';
  repairedSeed.scenarioClock = { currentTime: '06:00', deadline: '06:00', turn: 20, phase: 'finale', mode: 'finale' };
  repairedSeed.finaleState = null;
  repairedSeed.optionBuffer = 'A. 登上雾港号，带着采访包离开白桦站\nB. 留在站务楼等待\nC. 追入地下\nD. 自由行动';
  repairedSeed.chatRecord = [];
  repairedSeed.displayLog = [];
  const repairedCalls = [];
  const repairedProvider = {
    model: 'test-model',
    async generate(assembled) {
      repairedCalls.push(assembled.flowType);
      return { content: endingResult, reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const repairedRepo = new RequestSessionRepository(repairedSeed);
  const repairedOrchestrator = new GameOrchestrator({ repository: repairedRepo, llmProvider: repairedProvider });
  const repairedResponse = await repairedOrchestrator.handleMessage(repairedSeed.id, '选项A');
  assert(repairedCalls.join(',') === 'ENDING_GEN', 'a repaired finale choice must bypass ordinary narration');
  assert(repairedResponse.session.finalChoice === 'withdraw' && repairedResponse.session.finaleState.stage === 'complete', 'a stale visible boarding choice must retain its withdrawal meaning and complete the ending');

  // If no old option text survived, exact A/B/C/D input still maps against the
  // authoritative finale choices instead of producing an endless re-prompt.
  const missingBufferSeed = { ...repairedSeed, id: 'repaired-empty-buffer', optionBuffer: '', finaleState: null, finalChoice: null, endingState: null, subState: 'AWAITING_INPUT', chatRecord: [], displayLog: [] };
  const missingBufferCalls = [];
  const missingBufferProvider = {
    model: 'test-model',
    async generate(assembled) {
      missingBufferCalls.push(assembled.flowType);
      return { content: endingResult, reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const missingBufferRepo = new RequestSessionRepository(missingBufferSeed);
  const missingBufferOrchestrator = new GameOrchestrator({ repository: missingBufferRepo, llmProvider: missingBufferProvider });
  const missingBufferResponse = await missingBufferOrchestrator.handleMessage(missingBufferSeed.id, '选项A');
  assert(missingBufferCalls.join(',') === 'ENDING_GEN' && missingBufferResponse.session.finalChoice === 'expose', 'bare finale option A must be recognized without relying on a persisted option buffer');

  const idempotentRepo = new RequestSessionRepository(missingBufferSeed);
  const idempotentOrchestrator = new GameOrchestrator({ repository: idempotentRepo, llmProvider: {} });
  const idempotentSession = idempotentRepo.findById(missingBufferSeed.id);
  idempotentSession.finaleState = null;
  idempotentSession.optionBuffer = '';
  idempotentSession.displayLog = [];
  idempotentSession.chatRecord = [];
  idempotentOrchestrator._enterFinale(idempotentSession, {});
  idempotentOrchestrator._enterFinale(idempotentSession, {});
  assert(idempotentSession.finaleState.stage === 'decision' && idempotentSession.optionBuffer.includes('最终决定'), 'idempotent finale entry must repair missing decision state');
  assert(idempotentSession.displayLog.filter(entry => entry.content?.includes('【终局抉择】')).length === 1, 'idempotent finale entry must not duplicate the decision announcement');
}

console.log(`${passed} passed`);
