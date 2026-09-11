import { GameSession } from '../src/domain/GameSession.js';
import { FlowType } from '../src/domain/enums.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function richNarration(opening = '你继续观察雨夜中的站台。') {
  const beats = [
    opening,
    '雨水沿着站牌边缘连成细线，风把远处的汽笛声推回候车厅。你没有急着向前，而是先确认脚下泥水、门边刮痕和走廊里残留的气味，避免遗漏刚才行动造成的细微变化。',
    '壁灯的光在玻璃上晃动，附近的人各自保持着不自然的沉默。有人刻意避开你的目光，也有人盯着你装证据的口袋；这些反应没有直接给出答案，却让彼此的立场比之前更加清楚。',
    '你把已经确认的事实逐条记进随身笔记，并将推测与亲眼所见分开。这样做花费了一些时间，却保住了后续核对的可能，也使一段先前显得无关紧要的说辞重新进入调查范围。',
    '列车连接处传来金属轻响，随后又被雨声掩盖。你循声看去，只来得及捕捉到一道退入阴影的轮廓。对方没有立刻现身，说明眼前仍有主动询问、保护资料或改变位置的机会。',
    '空气里的煤烟味逐渐变重，候车厅外的积水也开始向排水沟回流。环境变化提示某处设备已经运转，而这与刚才听见的动静可能来自同一个方向，值得在下一步行动中验证。',
    '你最后检查了一遍退路和身边人物的状态。当前行动已经取得明确结果，但更关键的问题仍需由你选择处理方式：继续追查声音来源，向在场者施压，或者先把手里的材料变成能够带离车站的可靠记录。',
    '远处钟面被闪电照亮片刻，指针提醒你每一次停留都会压缩余下时间。你没有得到凭空出现的结论，只得到几条可以实际追踪的新方向，而下一次行动将决定其中哪一条能够留下证据。',
    '门外忽然掠过一阵比雨声更整齐的脚步，停在看不见的位置。你侧耳分辨片刻，确认对方没有继续靠近，但这份克制本身就是警告：调查已经引起注意，接下来公开行动会付出更高代价。',
    '你将现场重新划分为几个可以核验的部分，把尚未查清的痕迹留在原位，也给可能的证人留下退路。如此一来，无论选择追出去还是继续谈话，都不会让刚获得的信息因为仓促转身而彻底断线。',
  ];
  return beats.join('\n\n');
}

function narrative(overrides = {}) {
  return JSON.stringify({
    narration: richNarration(),
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
            narration: richNarration('喇叭里突然传出一段失真的中文警告。'),
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

// A turn that crosses an event boundary appends the authored cue and choices
// to that same response, but leaves resolution for the player's next action.
{
  const session = eventSession('boundary-cue');
  session.scenarioClock.currentTime = '00:45';
  session.scheduledEvents[0].at = '00:50';
  session.scheduledEvents[0].status = 'dormant';
  const provider = {
    model: 'test-model',
    async generate() {
      return { content: narrative({ time_cost_minutes: 10 }), reasoningContent: null, thinkingEnabled: false, hasToolCall: true };
    },
  };
  const repository = new RequestSessionRepository(session.toJSON());
  const orchestrator = new GameOrchestrator({ repository, llmProvider: provider });
  const result = await orchestrator._runLlmFlow(repository.findById(session.id), FlowType.NARRATION_I, '我继续等待并观察');
  const saved = repository.findById(session.id);
  assert(result.refinedHtml.includes('喇叭里突然传出一段失真的中文警告'), 'crossed cue should appear in the same rendered response');
  assert(result.parsed.options[0].includes('观察') && saved.optionBuffer.includes('D. 自由行动'), 'crossed event should replace ordinary choices with authored response choices');
  assert(saved.activeScene?.announcedAtBoundary && saved.scheduledEvents[0].status === 'queued' && !saved.scheduledEvents[0].fired, 'boundary event should remain unresolved until the next player action');
  assert(result.debugLogs.some(log => log.type === 'event_boundary_staged'), 'same-response boundary staging should be visible in diagnostics');
}

// Narration length is a soft quality guarantee with one rewrite. A short but
// structurally safe response remains playable without paying for a third call.
{
  const session = eventSession('length-fallback');
  session.scheduledEvents = [];
  let calls = 0;
  const provider = {
    model: 'test-model',
    async generate() {
      calls++;
      return {
        content: narrative({ narration: '你检查了门边，确认走廊暂时安全。' }),
        reasoningContent: null, thinkingEnabled: false, hasToolCall: true,
      };
    },
  };
  const repository = new RequestSessionRepository(session.toJSON());
  const orchestrator = new GameOrchestrator({ repository, llmProvider: provider });
  const result = await orchestrator._runLlmFlow(repository.findById(session.id), FlowType.NARRATION_I, '我等待片刻');
  assert(calls === 2 && result.refinedHtml.includes('确认走廊暂时安全'), 'persistently short safe narration should retry once and then remain playable');
  assert(result.debugLogs.some(log => log.type === 'narration_length_validation_failed')
    && result.debugLogs.some(log => log.type === 'narration_length_fallback'), 'length retry and fallback should be visible in diagnostics');

  const preDice = JSON.parse(narrative({
    narration: '你把手掌贴在冰冷门板上，先听见门后有缓慢而克制的呼吸声。走廊灯光被风吹得摇晃，许薇退到墙边，为你留出接近门锁的位置。你检查锁舌与门框，发现刮痕还很新，若要在不惊动里面那个人的情况下打开搭扣，必须控制工具碰撞的声音。雨点敲打车顶，掩护了最轻微的金属摩擦，却也让你难以判断门后的人是否移动。许薇屏住呼吸，指向锁舌下方一道更深的划痕，提醒你那里可能是受力点。你握稳细铁片，沿缝隙试探阻力；真正结果仍取决于接下来的动作是否足够精准。',
    actions: [{ action_type: 'skill_check', trigger: 'player' }], options: null,
  }));
  assert(orchestrator._validateFlowSemantics(repository.findById(session.id), FlowType.NARRATION_I, preDice, 'major').ok, 'valid shorter pre-dice setup should not be forced to major-scene length');
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
