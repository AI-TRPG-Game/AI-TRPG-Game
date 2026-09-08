import { EndingService } from '../src/services/EndingService.js';
import { SubState, Phase } from '../src/domain/enums.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function makeSession(opts = {}) {
  const npcs = [
    { id: 'npc_000', name: '玩家', hp: 10, maxHp: 10, san: 70, maxSan: 70, importance: 'player', status: 'active', currentState: '初始状态' },
    { id: 'npc_001', name: '同伴', hp: 10, maxHp: 10, san: 55, maxSan: 55, importance: 'key', status: 'active', currentState: '初始状态' },
  ];
  if (opts.extraNpcs) npcs.push(...opts.extraNpcs);

  return {
    npcs,
    phase: Phase.STORY_PLAY,
    subState: SubState.AWAITING_INPUT,
    keyCharacters: ['同伴的角色卡文本'],
    locations: [{ id: 'loc_001', name: '酒肆', description: '描述' }],
    inventory: [{ id: 'inv_001', name: '物品', description: '描述', status: '已获得' }],
    chatRecord: [],
    displayLog: [],
    storyOpeningCache: opts.storyOpeningCache || {
      raw: '{"narration":"故事开幕文本"}',
      parsed: { narration: '故事开幕文本', locations: [], npcs: [], items: [] },
      timestamp: '2026-01-01T00:00:00Z',
    },
    characterInitialStats: opts.characterInitialStats || [
      { npcId: 'npc_000', hp: 10, maxHp: 10, san: 70, maxSan: 70, currentState: '初始状态' },
      { npcId: 'npc_001', hp: 10, maxHp: 10, san: 55, maxSan: 55, currentState: '初始状态' },
    ],
  };
}

const endingService = new EndingService();

// === 测试 shouldTriggerEnding ===
{
  const session = makeSession();
  assert(endingService.shouldTriggerEnding(session) === false, '正常状态不应触发结局');

  session.npcs[0].hp = 0;
  assert(endingService.shouldTriggerEnding(session) === true, 'HP=0 应触发结局');

  session.npcs[0].hp = 10;
  session.npcs[0].san = 0;
  assert(endingService.shouldTriggerEnding(session) === true, 'SAN=0 应触发结局');

  // NPC 清零不触发
  session.npcs[0].san = 70;
  session.npcs[1].hp = 0;
  assert(endingService.shouldTriggerEnding(session) === false, 'NPC 清零不应触发玩家结局');
}

// === 测试 getEndingType ===
{
  assert(endingService.getEndingType({ hp: 0, san: 70 }) === 'death', 'HP=0 应为 death 结局');
  assert(endingService.getEndingType({ hp: 10, san: 0 }) === 'madness', 'SAN=0 应为 madness 结局');
  assert(endingService.getEndingType({ hp: 0, san: 0 }) === 'death', '同时清零优先 death');
}

// === 测试 restartStory ===
{
  const session = makeSession({
    extraNpcs: [
      { id: 'npc_002', name: '路人A', hp: 5, maxHp: 5, san: 40, maxSan: 40, importance: 'supporting', status: 'active', currentState: '受伤' },
      { id: 'npc_003', name: '敌人B', hp: 0, maxHp: 8, san: 30, maxSan: 30, importance: 'supporting', status: 'departed', currentState: '已退场' },
    ],
  });
  // 模拟玩家受伤
  session.npcs[0].hp = 3;
  session.npcs[0].san = 50;
  session.npcs[0].currentState = '受伤状态';
  session.npcs[1].hp = 5;
  session.npcs[1].currentState = '紧张';
  session.optionBuffer = 'A. 旧选项';
  session.pendingDiceFlow = { actions: [] };
  session.activeScene = { eventId: 'old-event' };
  session.combat = { active: true };
  session.finalChoice = 'withdraw';
  session.endingState = { reason: 'death' };
  session.finaleState = { stage: 'complete' };

  endingService.restartStory(session);

  // 玩家/关键角色状态恢复
  assert(session.npcs[0].hp === 10, `玩家 HP 应恢复为 10，实际=${session.npcs[0].hp}`);
  assert(session.npcs[0].san === 70, `玩家 SAN 应恢复为 70，实际=${session.npcs[0].san}`);
  assert(session.npcs[0].currentState === '初始状态', `玩家 currentState 应恢复，实际=${session.npcs[0].currentState}`);
  assert(session.npcs[0].status === 'active', `玩家 status 应恢复为 active，实际=${session.npcs[0].status}`);

  assert(session.npcs[1].hp === 10, `同伴 HP 应恢复为 10，实际=${session.npcs[1].hp}`);
  assert(session.npcs[1].san === 55, `同伴 SAN 应恢复为 55，实际=${session.npcs[1].san}`);

  // 普通 NPC 删除
  assert(session.npcs.length === 2, `应只剩 2 个角色（玩家+同伴），实际=${session.npcs.length}`);

  // locations/inventory 清空
  assert(session.locations.length === 0, `locations 应清空，实际=${session.locations.length}`);
  assert(session.inventory.length === 0, `inventory 应清空，实际=${session.inventory.length}`);

  // 状态恢复
  assert(session.phase === Phase.STORY_PLAY, `phase 应为 STORY_PLAY`);
  assert(session.subState === SubState.AWAITING_INPUT, `subState 应为 AWAITING_INPUT`);
  assert(session.optionBuffer === '' && session.pendingDiceFlow === null && session.activeScene === null, '重开应清理普通选项、待检定和活动场景');
  assert(session.combat === null && session.finalChoice === null && session.endingState === null && session.finaleState === null, '重开应清理战斗与终局状态');
}

// === 测试 injectStoryOpeningMessages ===
{
  const session = makeSession();
  session.chatRecord = [];

  endingService.injectStoryOpeningMessages(session);

  // 应写入 user 消息（重启指示）
  const userMsg = session.chatRecord.find(m => m.role === 'player');
  assert(userMsg, '应写入 player 消息');
  assert(userMsg.content.includes('重新开启'), `player 消息应包含重启指示，实际=${userMsg.content}`);

  // 应写入 assistant 消息（故事开幕，带 parsed + flowType）
  const assistantMsg = session.chatRecord.find(m => m.role === 'kp');
  assert(assistantMsg, '应写入 kp 消息');
  assert(assistantMsg.parsed, 'kp 消息应带 parsed（方案 B+ tool_calls 结构）');
  assert(assistantMsg.flowType === 'STORY_OPENING', `flowType 应为 STORY_OPENING，实际=${assistantMsg.flowType}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
