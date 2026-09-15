export const CRISIS_OPTIONS = [
  'A. 寻找掩护，带着已保全的证据脱离围堵',
  'B. 与对方谈判，争取停止追击',
  'C. 护住证据，抵挡对方并争取退路',
  'D. 自由行动',
];

export function isGuidance(text) {
  return /^(?:我该怎么办|怎么办|帮助|提示|我还没想好|help)[？?。！!\s]*$/i.test(String(text).trim());
}

export function crisisGuidance(session) {
  const left = Math.max(0, 3 - (session.finaleState?.completedActions || 0));
  const names = (session.finaleState?.crisisSnapshot?.participants || [])
    .map(id => session.npcs.find(n => n.id === id && n.visibility !== 'hidden')?.name).filter(Boolean);
  return `【终局危机 · 剩余${left}次行动】${session.combat?.objective || '脱离眼前危险'}。${names.length ? `现场人物：${names.join('、')}。` : ''}列车已经离站，撤离将走站外公路。\n${CRISIS_OPTIONS.join('\n')}`;
}

// Called only after a completed narrative/check, never during retries or dice setup.
export function completeFinaleAction(session, action) {
  const state = session.finaleState;
  if (state?.stage !== 'resolve_scene') return null;
  state.completedActions = Math.min(3, (state.completedActions || 0) + 1);
  state.crisisSnapshot ||= session.combat ? structuredClone(session.combat) : null;
  if (/逃|脱离|撤离|谈判|说服/.test(action) && state.lastCheck?.success) {
    session.combat = null;
    state.resolutionOutcome = { kind: 'successful_exit', text: '你的行动通过了检定，成功结束了眼前的围堵。你保留已保全的记录，接下来可沿站外公路撤离。' };
  }
  if (!session.combat?.active) {
    state.resolutionOutcome ||= { kind: 'resolved', text: '眼前冲突已经结束，接下来决定真相与证据的去向。' };
  } else if (state.completedActions >= 3) {
    return forceFinaleClosure(session, action);
  }
  return state.resolutionOutcome?.text || null;
}

export function forceFinaleClosure(session, action = '') {
  const state = session.finaleState;
  // Transfer only an explicitly named, held item; never invent contested evidence.
  const surrender = /交出|交给|放下|投降/.test(action);
  const handed = surrender ? session.inventory.filter(item => item.name && action.includes(item.name) && item.status !== '已失去') : [];
  for (const item of handed) item.status = '已失去';
  const text = handed.length
    ? `你交出了${handed.map(item => item.name).join('、')}。对方收下物品，围堵随之结束。列车已经离站，你只能沿站外公路撤离；已有调查记录的证明程度没有因此增加。`
    : '你没能压倒对手，只得借站务楼的隔门阻断追击，退向站外公路。对方仍控制着现场，继续追查的机会已经失去；你保留已记录的调查成果，没有得到新的证据。眼前的围堵到此结束。';
  state.resolutionOutcome = { kind: handed.length ? 'surrender' : 'forced_retreat', text, transferredItems: handed.map(item => item.id) };
  session.combat = null;
  session.activeScene = null;
  session.scenarioFlags.finale_crisis_resolved = true;
  return text;
}

export function playerActionMinutes(session, text = '') {
  const firstAction = String(text).split(/然后|接着|随后|再去|；/)[0];
  if (/长时间|彻底搜查|逐页|全面检查|仔细整理/.test(firstAction)) return 20;
  if (session.combat?.active || /^(?:前往|去往|赶往|进入|回到|返回|移动|走向|登上)/.test(firstAction.replace(/^对应行动：/, ''))) return 10;
  return 15;
}

export function consolidationOptions(session) {
  const pending = session.evidence.find(e => e.discovered !== false && !e.secured);
  const hint = pending && session.scenarioRules.clueCatalog?.[pending.id]?.preservationHint;
  return [`A. ${hint || '整理已经保全的材料，标明仍无法证明的部分'}`, 'B. 核对调查笔记，决定哪些已知材料可以公开', 'C. 收好现有记录，确认撤离路线', 'D. 自由行动'];
}

// Applied only to new output, never to historical descriptions of earlier boarding.
export function enforceDeparture(session, parsed) {
  if (!session.scenarioFlags?.train_departed) return parsed;
  const blocked = /登上.{0,10}(?:列车|雾港号)|登车|(?:赶紧|赶快|赶在.{0,8}|准备|决定|尝试|可以|还能|立即)上车|赶上.{0,8}(?:列车|雾港号)|离站前|发车前/;
  const rewrite = text => typeof text !== 'string' ? text : text.split(/(?<=[。！？\n])/).map(sentence =>
    blocked.test(sentence) ? '列车已经离站，撤离只能沿站外公路进行。' : sentence).join('');
  const safe = structuredClone(parsed);
  for (const field of ['narration', 'immediate_resolution', 'player_outcome', 'ending_text']) safe[field] = rewrite(safe[field]);
  if (Array.isArray(safe.options)) safe.options = safe.options.map((option, i) => blocked.test(option) ? `${'ABCD'[i]}. 沿站外公路撤离，带好现有记录` : option);
  if (Array.isArray(safe.character_outcomes)) for (const outcome of safe.character_outcomes) outcome.outcome = rewrite(outcome.outcome);
  return safe;
}
