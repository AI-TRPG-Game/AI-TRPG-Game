import { DamageResolver } from '../src/services/DamageResolver.js';
import { diceService } from '../src/services/DiceService.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function makeSession(npcs = []) {
  return {
    npcs: JSON.parse(JSON.stringify(npcs)),
    keyCharacters: [],
  };
}

function makeNpc(id, hp, maxHp, san, maxSan, opts = {}) {
  return {
    id, name: opts.name || id, baseDescription: '', currentState: '',
    importance: opts.importance || 'supporting',
    hp, maxHp, san, maxSan,
    visibility: opts.visibility || 'visible',
    status: 'active',
    attributes: null,
    firstSeenAt: 0, lastUpdatedAt: 0,
  };
}

const resolver = new DamageResolver();

assert(resolver._sanPenaltyDice({ scenarioId: 'tutorial', npcs: [makeNpc('npc_000', 10, 10, 45, 60, { importance: 'player' })] }) === 1,
  'SAN 45 should apply one penalty die to player skill checks');
assert(resolver._sanPenaltyDice({ scenarioId: 'tutorial', npcs: [makeNpc('npc_000', 10, 10, 30, 60, { importance: 'player' })] }) === 2,
  'SAN 30 should apply two penalty dice to player skill checks');

// === 场景A：纯技能检定（无 HP/SAN 变化） ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '攀爬', skill_point: 60, bonus_dice: 0, penalty_dice: 0,
        on_success: [], on_fail: [],
        on_critical_success: [], on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(result.systemMessages.length >= 1, '场景A应生成至少1条系统消息');
  assert(result.systemMessages[0].includes('攀爬'), '系统消息应包含技能名');
  assert(result.systemMessages[0].includes('技能投掷结果'), `场景A 应为 A 结果格式，实际=${result.systemMessages[0]}`);
  assert(result.systemMessages[0].includes('最终结果'), `场景A 应包含"最终结果"，实际=${result.systemMessages[0]}`);
  assert(!result.playerDied, '场景A玩家不应死亡');
  assert(result.departedNpcs.length === 0, '场景A无NPC退场');
  assert(session.npcs[0].hp === 10, '场景A HP不应变化');
}

// === 场景B：SAN 检定 ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [{ type: 'sancheck', trigger: 'others', target: 'player' }]
  };
  const result = resolver.resolve(session, parsed);
  assert(result.systemMessages.length >= 1, '场景B应生成系统消息');
  assert(result.systemMessages[0].includes('直视了不可直视之物'), `场景B 应为 B 结果格式，实际=${result.systemMessages[0]}`);
  // SAN 应有变化（1d3 或 1d6）
  assert(session.npcs[0].san < 70, `SAN 应减少，实际=${session.npcs[0].san}`);
}

// === 场景C：直接伤害 ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 1, diceSides: 4, diceBonus: 0, effect: 'damage' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp < 10, `HP 应减少，实际=${session.npcs[0].hp}`);
  assert(result.systemMessages[0].includes('变化'), `场景C 应为 C2 格式，实际=${result.systemMessages[0]}`);
  assert(result.systemMessages[0].includes('当前 HP'), `场景C 应显示"当前 HP"，实际=${result.systemMessages[0]}`);
}

// === 场景C2：直接治疗 ===
{
  const session = makeSession([makeNpc('npc_000', 5, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 1, diceSides: 3, diceBonus: 0, effect: 'heal' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp > 5, `HP 应增加，实际=${session.npcs[0].hp}`);
  assert(session.npcs[0].hp <= 10, `HP 不应超过 maxHp，实际=${session.npcs[0].hp}`);
}

// === 场景D1：玩家攻击 NPC（成功才伤害） ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'}),
    makeNpc('npc_002', 8, 8, 50, 50, {name:'敌人'}),
  ]);
  // skill_point=100 保证成功
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '斗殴', skill_point: 100, bonus_dice: 0, penalty_dice: 0,
        on_success: [{ target: 'npc_002', attr: 'hp', diceCount: 1, diceSides: 8, diceBonus: 0, effect: 'damage' }],
        on_fail: [],
        on_critical_success: [], on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[1].hp < 8, `NPC HP 应减少，实际=${session.npcs[1].hp}`);
}

// === 场景D2：NPC 攻击玩家（玩家闪避失败才受伤） ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  // skill_point=0 保证失败
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '闪避', skill_point: 0, bonus_dice: 0, penalty_dice: 0,
        on_success: [],
        on_fail: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 6, diceBonus: 0, effect: 'damage' }],
        on_critical_success: [], on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp < 10, `玩家 HP 应减少（闪避失败），实际=${session.npcs[0].hp}`);
}

// === 场景D3：治愈术（成功加血+失败伤害） ===
{
  const session = makeSession([makeNpc('npc_000', 5, 10, 70, 70, {importance:'player', name:'玩家'})]);
  // skill_point=100 保证成功 → 加血
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '急救', skill_point: 100, bonus_dice: 0, penalty_dice: 0,
        on_success: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 3, diceBonus: 0, effect: 'heal' }],
        on_fail: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 4, diceBonus: 0, effect: 'damage' }],
        on_critical_success: [], on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp > 5, `成功时应加血，实际=${session.npcs[0].hp}`);
}

// === 场景E1：多检定组合 ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'}),
    makeNpc('npc_002', 8, 8, 50, 50, {name:'敌人A'}),
  ]);
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '斗殴', skill_point: 100, bonus_dice: 0, penalty_dice: 0,
        on_success: [{ target: 'npc_002', attr: 'hp', diceCount: 1, diceSides: 8, diceBonus: 0, effect: 'damage' }],
        on_fail: [],
        on_critical_success: [], on_critical_failure: [] },
      { type: 'skill_check', trigger: 'player', skill_name: '闪避', skill_point: 0, bonus_dice: 0, penalty_dice: 0,
        on_success: [],
        on_fail: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 6, diceBonus: 0, effect: 'damage' }],
        on_critical_success: [], on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[1].hp < 8, `敌人A 应受伤，实际=${session.npcs[1].hp}`);
  assert(session.npcs[0].hp < 10, `玩家应受伤（闪避失败），实际=${session.npcs[0].hp}`);
}

// === 场景E2：群体 sancheck ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'}),
    makeNpc('npc_001', 10, 10, 55, 55, {importance:'key', name:'同伴'}),
  ]);
  const parsed = {
    actions: [
      { type: 'sancheck', trigger: 'others', target: 'player' },
      { type: 'sancheck', trigger: 'others', target: 'npc_001' }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].san < 70, `玩家 SAN 应减少，实际=${session.npcs[0].san}`);
  assert(session.npcs[1].san < 55, `同伴 SAN 应减少，实际=${session.npcs[1].san}`);
}

// === 场景E3：剧本 SAN 事件强制使用作者定义的严重度与目标 ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 60, 60, {importance:'player', name:'玩家'}),
    makeNpc('npc_001', 10, 10, 55, 55, {importance:'key', name:'同伴'}),
  ]);
  session.scenarioId = 'authored';
  session.scenarioClock = { currentTime: '01:10' };
  session.scenarioRules = { sanEvents: {
    recorded_horror: { at: '01:10', severity: 'major', target: 'player', label: '异常录音' },
  } };
  session.sanity = { state: 'stable', resolvedEventIds: [], traumaHistory: [], activeTrauma: null };
  const result = resolver.resolve(session, { actions: [{
    type: 'sancheck', trigger: 'others', target: 'npc_001', san_severity: 'unease', san_event_id: 'recorded_horror',
  }] });
  assert(session.npcs[0].san < 60 && session.npcs[1].san === 55, 'authored SAN event should target the authored player target, not the LLM target');
  assert(session.sanity.resolvedEventIds.includes('recorded_horror'), 'authored SAN event should only resolve once and be persisted');
  assert(result.systemMessages[0].includes('severity: major'), 'authored SAN event severity should override the LLM value');
}

// === 场景E4：单次重度 SAN 损失立刻引发创伤后果 ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 60, 60, {importance:'player', name:'玩家'})]);
  session.scenarioId = 'tutorial';
  session.suspicion = 0;
  const originalRoll = diceService.rollWithBonusPenalty;
  const originalFormula = diceService.rollFormula;
  const originalDie = diceService.rollDie;
  try {
    diceService.rollWithBonusPenalty = () => ({ value: 100 });
    diceService.rollFormula = () => 5;
    diceService.rollDie = () => 2;
    const result = resolver.resolve(session, { actions: [{ type: 'sancheck', trigger: 'others', target: 'player', san_severity: 'major' }] });
    assert(session.suspicion === 1, 'panic trauma should immediately add suspicion');
    assert(session.sanity.activeTrauma?.id === 'panic', 'heavy SAN loss should persist its acute trauma');
    assert(result.systemMessages.some(message => message.includes('急性创伤')), 'acute trauma should be visible in system messages');
  } finally {
    diceService.rollWithBonusPenalty = originalRoll;
    diceService.rollFormula = originalFormula;
    diceService.rollDie = originalDie;
  }
}

// === HP 钳制测试 ===
{
  const session = makeSession([makeNpc('npc_000', 2, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 0, diceSides: 0, diceBonus: 100, effect: 'damage' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp === 0, `HP 应钳制到 0，实际=${session.npcs[0].hp}`);
  assert(result.playerDied, '玩家 HP 归零应触发结局');
}

// === 治疗不超过 maxHp ===
{
  const session = makeSession([makeNpc('npc_000', 9, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 1, diceSides: 100, diceBonus: 0, effect: 'heal' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp === 10, `治疗不应超过 maxHp=10，实际=${session.npcs[0].hp}`);
}

// === NPC 清零标记 departed ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'}),
    makeNpc('npc_002', 2, 8, 50, 50, {name:'敌人'}),
  ]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'npc_002', attr: 'hp', diceCount: 0, diceSides: 0, diceBonus: 100, effect: 'damage' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[1].hp === 0, `NPC HP 应为 0`);
  assert(session.npcs[1].status === 'departed', `NPC 应标记 departed，实际=${session.npcs[1].status}`);
  assert(result.departedNpcs.includes('npc_002'), 'departedNpcs 应包含 npc_002');
  assert(!result.playerDied, 'NPC 死亡不应触发玩家结局');
}

// === 状态词测试 ===
assert(resolver.getStatusWord('hp', 2) === '轻微受伤', `HP 2 应为轻微受伤，实际=${resolver.getStatusWord('hp', 2)}`);
assert(resolver.getStatusWord('hp', 5) === '受重伤', `HP 5 应为受重伤，实际=${resolver.getStatusWord('hp', 5)}`);
assert(resolver.getStatusWord('hp', 10) === '致命重创', `HP 10 应为致命重创，实际=${resolver.getStatusWord('hp', 10)}`);
assert(resolver.getStatusWord('san', 3) === '头晕目眩', `SAN 3 应为头晕目眩，实际=${resolver.getStatusWord('san', 3)}`);
assert(resolver.getStatusWord('san', 5) === '暂时疯狂', `SAN 5 应为暂时疯狂，实际=${resolver.getStatusWord('san', 5)}`);

// === 场景F：大成功/大失败 trigger 分发验证 ===
// 注意：roll 是随机的，这里只验证消息格式正确
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'skill_check', trigger: 'player', skill_name: '侦查', skill_point: 100, bonus_dice: 0, penalty_dice: 0,
        on_success: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 4, diceBonus: 0, effect: 'damage' }],
        on_fail: [],
        on_critical_success: [{ target: 'player', attr: 'hp', diceCount: 1, diceSides: 3, diceBonus: 0, effect: 'heal' }],
        on_critical_failure: [] }
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(result.systemMessages[0].includes('侦查'), '场景F消息应包含技能名');
  assert(result.systemMessages[0].includes('最终结果'), '场景F消息应为 A 结果格式');
}

// === 场景G：direct(trigger=player) 归 C2 结果 ===
{
  const session = makeSession([makeNpc('npc_000', 5, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'player', changes: [
          { target: 'player', attr: 'hp', diceCount: 1, diceSides: 3, diceBonus: 0, effect: 'heal' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp > 5, `场景G HP 应增加，实际=${session.npcs[0].hp}`);
  assert(result.systemMessages[0].includes('变化'), `场景G 应为 C2 格式，实际=${result.systemMessages[0]}`);
  assert(result.systemMessages[0].includes('当前 HP'), `场景G 应显示当前 HP，实际=${result.systemMessages[0]}`);
}

// === 场景H：sancheck 消息格式（B 结果，玩家主语"你"） ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [{ type: 'sancheck', trigger: 'others', target: 'player' }]
  };
  const result = resolver.resolve(session, parsed);
  assert(result.systemMessages[0].includes('直视了不可直视之物'), `场景H 应为 B 结果格式，实际=${result.systemMessages[0]}`);
  assert(result.systemMessages[0].includes('你'), `场景H 玩家 sancheck 主语应为"你"，实际=${result.systemMessages[0]}`);
}

// === 场景I：NPC sancheck 消息格式（B 结果，NPC 主语） ===
{
  const session = makeSession([
    makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'}),
    makeNpc('npc_001', 10, 10, 55, 55, {importance:'key', name:'同伴'}),
  ]);
  const parsed = {
    actions: [{ type: 'sancheck', trigger: 'others', target: 'npc_001' }]
  };
  const result = resolver.resolve(session, parsed);
  assert(result.systemMessages[0].includes('直视了不可直视之物'), `场景I 应为 B 结果格式，实际=${result.systemMessages[0]}`);
  // NPC 主语应为 NPC 名字而非"你"
  assert(!result.systemMessages[0].startsWith('【你 '), `场景I NPC sancheck 主语不应为"你"，实际=${result.systemMessages[0]}`);
}

// === 场景J：固定值变化（diceCount=0） ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 0, diceSides: 0, diceBonus: 3, effect: 'damage' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp === 7, `固定值 3 点伤害后 HP 应为 7，实际=${session.npcs[0].hp}`);
  assert(result.systemMessages[0].includes('3'), `固定值消息应包含数值 3，实际=${result.systemMessages[0]}`);
}

// === 场景K：diceCount 和 diceBonus 同时为 0 的非法情况 ===
{
  const session = makeSession([makeNpc('npc_000', 10, 10, 70, 70, {importance:'player', name:'玩家'})]);
  const parsed = {
    actions: [
      { type: 'direct', trigger: 'others', changes: [
          { target: 'player', attr: 'hp', diceCount: 0, diceSides: 0, diceBonus: 0, effect: 'damage' }
      ]}
    ]
  };
  const result = resolver.resolve(session, parsed);
  assert(session.npcs[0].hp === 10, `非法变化应保持 HP 不变，实际=${session.npcs[0].hp}`);
  assert(result.systemMessages[0].includes('变化失败'), `应返回失败消息，实际=${result.systemMessages[0]}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
