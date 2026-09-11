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

export function getGamePhaseLabel(phase = '') {
  return ({
    WORLD_SETTING: '世界观设定',
    CHARACTER_SETTING: '角色设定',
    KEY_CHARACTER_SETTING: '关键角色设定',
    STORY_PLAY: '故事进行中',
  })[phase] || '未知阶段';
}

export function getGameSubStateLabel(subState = '') {
  return ({
    AWAITING_INPUT: '等待行动',
    LLM_STREAMING: '主持人思考中',
    DICE_PENDING: '等待检定确认',
    SUMMARIZING: '整理剧情中',
    ENDING_PENDING: '生成结局中',
    RESTART_PENDING: '本局已结束',
  })[subState] || '未知状态';
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

export function sanitizePlayerText(session = {}, value = '') {
  if (typeof value !== 'string' || !value) return value;
  const replacements = new Map();
  for (const location of session.locations || []) replacements.set(location.id, location.name || '某处地点');
  for (const evidence of session.evidence || []) replacements.set(evidence.id, evidence.source || '一项线索');
  for (const [id, clue] of Object.entries(session.scenarioRules?.clueCatalog || {})) {
    if (!replacements.has(id)) replacements.set(id, clue.source || '一项线索');
  }
  for (const npc of session.npcs || []) replacements.set(npc.id, npc.visibility === 'hidden' ? '某人' : (npc.name || '某人'));
  for (const item of session.inventory || []) replacements.set(item.id, item.name || '一件物品');
  let text = value.replace(/(?:&#x20;|&#32;|&nbsp;)/gi, ' ');
  for (const [id, readable] of replacements) {
    if (!id || !readable) continue;
    const escapePattern = input => String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(`${escapePattern(readable)}\\s*[（(]\\s*${escapePattern(id)}\\s*[）)]`, 'gi'),
      readable
    );
  }
  return text
    .replace(/\b(?:loc|evidence|npc|item)_\d{3,}\b/gi, id => replacements.get(id) || (
      id.startsWith('loc_') ? '某处地点'
        : id.startsWith('evidence_') ? '一项线索'
          : id.startsWith('npc_') ? '某人' : '一件物品'
    ))
    .replace(/[ \t]+(?=\r?\n|$)/g, '');
}

export function sanitizePlayerPresentation(session = {}) {
  session.optionBuffer = sanitizePlayerText(session, session.optionBuffer || '');
  for (const entry of session.displayLog || []) entry.content = sanitizePlayerText(session, entry.content);
  for (const entry of session.chatRecord || []) entry.content = sanitizePlayerText(session, entry.content);
  return session;
}
