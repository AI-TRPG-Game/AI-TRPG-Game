export function getSuspicionDisplay(value = 0) {
  const safe = Math.max(0, Math.min(10, Number(value) || 0));
  if (safe >= 8) return { label: '危机', effect: '对手可能公开阻挠或抢夺证据' };
  if (safe >= 6) return { label: '受阻', effect: '嫌疑人会限制行动或转移证据' };
  if (safe >= 3) return { label: '被监视', effect: '调查行动通常额外耗时5分钟' };
  return { label: '未引起注意', effect: '暂未引起有组织的注意' };
}

export function getScenarioPhaseLabel(phase = '') {
  return ({ hook: '开端', investigation: '调查', crisis: '危机', aftermath: '收束', finale: '终局' })[phase]
    || (phase ? '未知阶段' : '未知阶段');
}

export function getSanLabel(value) {
  if (value == null) return '状态不明';
  if (value >= 51) return '稳定';
  if (value >= 46) return '不安';
  if (value >= 31) return '动摇';
  if (value >= 16) return '不稳定';
  if (value > 0) return '濒临崩溃';
  return '疯狂';
}

export function getNpcCondition(npc = {}) {
  if (npc.hp == null || npc.maxHp == null || npc.san == null) return '状态不明';

  const health = npc.hp <= 0
    ? '失去行动能力'
    : npc.hp >= npc.maxHp
      ? '无明显伤势'
      : npc.hp / Math.max(1, npc.maxHp) > 0.5
        ? '受伤'
        : '重伤';
  return `${health} | ${getSanLabel(npc.san)}`;
}
