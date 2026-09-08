import { GameSession } from '../src/domain/GameSession.js';
import { FlowType } from '../src/domain/enums.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function narrative(overrides = {}) {
  return JSON.stringify({
    narration: '你继续观察雨夜中的站台。',
    locations: [], npcs: [], items: [], actions: null,
    options: ['A. 观察环境', 'B. 询问乘客', 'C. 检查证据', 'D. 自由行动'],
    time_cost_minutes: 10,
    time_cost_rationale: '观察环境',
    evidence_changes: [], suspicion_delta: 0, combat_update: null,
    ending_recommendation: { should_end: false, reason: '' },
    current_location_id: 'loc_001',
    active_event_ack: null,
    ...overrides,
  });
}

function eventSession(id) {
  return new GameSession({
    id,
    phase: 'STORY_PLAY', subState: 'AWAITING_INPUT', openingDone: true,
    worldSettings: '测试世界', player: '姓名：玩家\nHP：10  SAN：50',
    chatRecord: [{ role: 'player', type: 'prompt', content: '我继续调查' }], displayLog: [],
    locations: [{ id: 'loc_001', name: '站台', description: '' }],
    npcs: [{ id: 'npc_000', name: '玩家', importance: 'player', visibility: 'visible', status: 'active', locationId: 'loc_001', hp: 10, maxHp: 10, san: 50, maxSan: 50, attributes: null }],
    scenarioId: 'resilience-test',
    scenarioRules: { time: { minimumMinutes: 10, maximumMinutes: 60 }, truths: {} },
    scenarioClock: { currentTime: '00:40', deadline: '06:00', turn: 1, phase: 'hook', mode: 'normal' },
    playerLocationId: 'loc_001', evidence: [], suspicion: 0, scenarioFlags: {},
    scheduledEvents: [{
      id: 'broadcast', at: '00:40', priority: 10, placement: { mode: 'global' }, status: 'dormant', fired: false,
      branches: { foreground: { outcome: 'warning_heard', instruction: '播放异常广播。', playerCue: '喇叭里突然传出一段失真的中文警告。' } },
    }],
  });
}

// A wrong acknowledgement consumes one retry and cannot resolve the event
// until the model explicitly confirms the selected event/outcome.
{
  const session = eventSession('ack-retry');
  let calls = 0;
  const provider = {
    model: 'test-model',
    async generate() {
      calls++;
      return {
        content: calls === 1
          ? narrative({ active_event_ack: { event_id: 'wrong', outcome: 'wrong', incorporated: true, perceived_consequence: '错误事件' } })
          : narrative({
            narration: '喇叭里突然传出一段失真的中文警告。',
            active_event_ack: { event_id: 'broadcast', outcome: 'warning_heard', incorporated: true, perceived_consequence: '玩家听到了警告。' },
          }),
        reasoningContent: null, thinkingEnabled: false, hasToolCall: true,
      };
    },
  };
  const repository = new RequestSessionRepository(session.toJSON());
  const orchestrator = new GameOrchestrator({ repository, llmProvider: provider });
  const result = await orchestrator._runLlmFlow(repository.findById(session.id), FlowType.NARRATION_I, '我继续调查');
  const saved = repository.findById(session.id);
  assert(calls === 2, 'mismatched event acknowledgement should retry once');
  assert(saved.scheduledEvents[0].status === 'resolved' && !saved.activeScene, 'event should resolve only after a valid acknowledgement');
  assert(result.debugLogs.some(log => log.type === 'event_acknowledgement_failed'), 'acknowledgement failure should be visible in diagnostics');
  assert(result.debugLogs.some(log => log.type === 'event_retry'), 'event retry should be visible in diagnostics');
  assert(result.debugLogs.some(log => log.type === 'event_resolved'), 'event resolution should be visible in diagnostics');
}

// Permanent noncompliance uses all three attempts, prepends the authored cue,
// and only then commits the event instead of silently dropping it.
{
  const session = eventSession('ack-fallback');
  let calls = 0;
  const provider = {
    model: 'test-model',
    async generate() {
      calls++;
      return { content: narrative(), reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const repository = new RequestSessionRepository(session.toJSON());
  const orchestrator = new GameOrchestrator({ repository, llmProvider: provider });
  const result = await orchestrator._runLlmFlow(repository.findById(session.id), FlowType.NARRATION_I, '我继续调查');
  const saved = repository.findById(session.id);
  assert(calls === 3, 'permanent event noncompliance should use the three-attempt budget');
  assert(result.refinedHtml.includes('喇叭里突然传出一段失真的中文警告'), 'fallback narration should contain the authored in-world cue');
  assert(saved.scheduledEvents[0].status === 'resolved', 'fallback event should commit after its cue is rendered');
  assert(result.debugLogs.some(log => log.type === 'event_fallback'), 'event fallback should be visible in diagnostics');
}

// An incomplete, cliffhanger ending is rejected three times and replaced with
// a deterministic closure that includes every relevant visible NPC.
{
  const session = eventSession('ending-fallback');
  session.scheduledEvents = [];
  session.finalChoice = 'withdraw';
  session.finaleState = { stage: 'generating' };
  session.npcs.push({ id: 'npc_001', name: '许薇', importance: 'key', visibility: 'visible', status: 'active', locationId: 'loc_001', hp: 8, maxHp: 8, san: 40, maxSan: 50, attributes: null });
  let calls = 0;
  const unfinished = JSON.stringify({
    ending_type: 'withdrawal', ending_title: '未完的夜',
    immediate_resolution: '你望向石阶。', player_outcome: '你仍在选择。',
    character_outcomes: [], truth_outcome: '尚未决定。', ending_text: '而你的故事，才刚刚开始。',
    debrief: { hidden_plot: '', important_events: [], evidence_used: [], missed_leads: [], next_try: '' },
  });
  const provider = {
    model: 'test-model',
    async generate() {
      calls++;
      return { content: unfinished, reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const repository = new RequestSessionRepository(session.toJSON());
  const orchestrator = new GameOrchestrator({ repository, llmProvider: provider });
  const response = await orchestrator._triggerEnding(repository.findById(session.id), null, null, null, 'final_choice');
  const saved = repository.findById(session.id);
  assert(calls === 3, 'unfinished ending should use the full retry budget');
  assert(!response.endingText.includes('才刚刚开始') && response.refinedHtml.includes('【结局：'), 'ending fallback should be conclusive and structured');
  assert(response.refinedHtml.includes('许薇') && response.refinedHtml.includes('真相与证据'), 'ending fallback should include relevant NPC and truth outcomes');
  assert(saved.subState === 'RESTART_PENDING' && saved.optionBuffer === '', 'ending fallback should leave no ordinary decision controls');
}

console.log(`${passed} passed`);
