import { scenarioProgressService as progress } from './ScenarioProgressService.js';
import { componentAccess, contactWitness, knownRoute, locationPatterns, requestedComponents } from '../../../src/shared/InvestigationRules.mjs';

export const GUIDE = '每次只处理一个有意义的目标，移动与到达后的调查分开输入；比例尺、标注等辅助步骤可合并。模糊或多步骤输入会免费请求澄清；失败的实际检定仍消耗行动。证据栏“详细信息”免费显示各组件、已知条件和下一步，未知来源不会提前揭露。调查会发现线索；拍照、取样、录音等保全行动才形成可复核的证据。可用中英文输入，也可点击证据栏的保全按钮：按钮仍是正常行动，不会绕过危险。检定前会说明风险。NPC显示的是你观察到的情况，不是其秘密或数值。安全处可用“包扎伤口”消耗敷料恢复生命，或“稳定情绪”缓解暂时压力；两者都消耗一次行动。最终决定只需提交一次，即使眼前危险尚未结束。';
const aliases = {
  evidence_001: /door|lock|scratch|门锁|门框|锁芯|刮痕/i,
  evidence_002: /mud|地毯|湿泥|泥粒/i,
  evidence_003: /needle|injection|medication|针孔|药物|注射/i,
  evidence_004: /recording|audio|顾言.{0,8}录音|录音带/i,
  evidence_005: /dispatch|logbook|调度|残页/i,
  evidence_006: /painting|register|portrait|画作|名册|苏棠|画布/i,
  evidence_007: /medical.{0,12}(?:archive|transfer)|医疗档案|转运档案|病历|封蜡/i,
  evidence_008: /testimony|lin wan|林晚|证词|检修图/i,
};
export function normalizeAction(text = '') {
  return String(text).split('对应行动：').pop().trim()
    .replace(/photograph|take (?:a )?photos?|take (?:a )?pictures?/gi, '拍照')
    .replace(/bag|sampl(?:e|ing)|collect/gi, '装袋取样')
    .replace(/transcrib(?:e|ing)|copy/gi, '抄录')
    .replace(/\brecord\b/gi, '记录')
    .replace(/(?:go|move|return|head|enter)(?: back)?(?: to| into)?\s+/gi, '进入');
}
export function state(session) {
  return session.scenarioFlags.investigation ||= { actions: 0, act: 'opening', attempted: [], injuries: [], dressings: 2, grounding: 0, milestones: [], rewards: [], receipts: [] };
}
export function isHybrid(session) { return session.scenarioRules?.pacingVersion === 3; }
const NEGOTIATION = /谈判|说服|分歧|争取信任|negotia|persuad|convince/i;
export function witnessContact(session) {
  return contactWitness(session);
}
// Establish the announced danger before classifying a response, but do not resolve
// its event. The ordinary turn snapshot rolls this back when dice are canceled.
export function enterAnnouncedDanger(session) {
  if (session.combat?.active || session.scenarioFlags.finale_crisis_resolved) return;
  const scene = session.activeScene;
  const event = session.scheduledEvents?.find(e => e.id === scene?.eventId);
  const branch = event?.branches?.[scene?.branchKey];
  if (!branch?.combatUpdate?.active) return;
  session.combat = structuredClone(branch.combatUpdate);
  state(session).exchanges = 0;
  for (const id of session.combat.participants || []) {
    const npc = session.npcs.find(n => n.id === id);
    if (npc) { npc.locationId = session.playerLocationId; npc.visibility = 'visible'; }
  }
}
export function targetClues(session, text) {
  return Object.entries(aliases).filter(([id, pattern]) => session.scenarioRules?.clueCatalog?.[id] && pattern.test(text)).map(([id]) => id);
}
export function preservationMethod(text) {
  if (/不(?:要|会|想)?(?:拍|录|取|保存)|不要保全|do not|don't|won't|如果|if\b/i.test(text)) return null;
  if (/拍照|拍摄|摄影|photo|picture/i.test(text)) return 'photo';
  if (/装袋|取样|采样|bag|sample/i.test(text)) return 'sample';
  if (/录音取证|录制|复制录音|录音保存|record.{0,18}(?:audio|testimony)|录音或形成签字|录音并/i.test(text)) return 'audio';
  if (/带走|封存|take away|seal|签字|抄录|拓印|复制|复印|copy|transcribe/i.test(text)) return 'copy';
  return null;
}
const methods = { evidence_001: ['photo','copy'], evidence_002: ['sample','photo'], evidence_003: ['photo','copy'], evidence_004: ['audio','copy'], evidence_005: ['photo','copy'], evidence_006: ['photo','copy'], evidence_007: ['photo','copy'], evidence_008: ['audio','copy'] };
export function evidenceIntent(session, input) {
  const text = normalizeAction(input);
  let ids = targetClues(session, input + ' ' + text);
  if (!ids.length && /这些|这个|上述|those|that|these/i.test(input) && /拍|记录|保全|photo|record|preserv/i.test(input)) {
    ids = (session.scenarioFlags.lastEvidenceTargets || []).filter(id => session.evidence.some(e => e.id === id));
    if (ids.length !== 1) return { clarification: '你要处理哪项线索？请写出名称，或点击证据栏对应的保全按钮。', ids: [] };
  }
  return { ids, text, method: preservationMethod(input) || preservationMethod(text) || (/^(?:record|录制)\b.{0,80}(?:录音|recording|testimony)/i.test(input) ? 'audio' : null) };
}
function check(session, skill, danger = false) {
  const match = new RegExp(`${skill}[：:\\s]+(\\d+)`).exec(session.player || '');
  const value = Number(match?.[1] || 0);
  return { type: 'skill_check', trigger: 'player', target: 'player', skill_name: skill, skill_point: value,
    bonus_dice: 0, penalty_dice: 0, on_success: [], on_fail: danger ? [{ target: 'player', attr: 'hp', effect: 'damage', diceCount: 1, diceSides: 3, diceBonus: 0 }] : [], on_critical_success: [], on_critical_failure: [] };
}
export function prepareAction(session, input) {
  enterAnnouncedDanger(session);
  const s = state(session);
  const intent = evidenceIntent(session, input);
  const tx = { id: `${session.id}:${session.scenarioClock.turn + 1}`, ...intent, input, checks: [], receipts: [], resolved: false, wasCombat: !!session.combat?.active, hpBefore: session.npcs.find(n => n.id === 'npc_000')?.hp };
  s.transaction = tx;
  if (intent.clarification) return tx;
  tx.witnessTarget = /林晚|lin wan/i.test(input);
  const locations = locationPatterns;
  if (/进入|前往|返回|回到|走进|赶到|先去|^去|go to|return to|enter|move to|head (?:to|for)/i.test(input)) {
    const destination = Object.entries(locations).find(([id, pattern]) => pattern.test(input) && session.locations.some(l => l.id === id));
    if (destination && !tx.wasCombat) {
      const previous = session.playerLocationId;
      const companion = tx.witnessTarget && witnessContact(session) && session.scenarioFlags.witness_cooperating
        && /一起|带着|陪同|with|together/i.test(input) ? session.npcs.find(n => n.id === 'npc_005') : null;
      s.visited ||= [previous];
      const route = knownRoute(session,destination[0]);
      const safeReturn = route?.every(id=>s.visited.includes(id) && !['loc_004','loc_009','loc_010'].includes(id));
      progress.updatePlayerLocation(session, destination[0]);
      if (companion) { companion.locationId = destination[0]; tx.receipts.push('【同行】林晚与你一同移动。'); }
      const player = session.npcs.find(n => n.id === 'npc_000'); if (player) player.locationId = destination[0];
      for (const id of route || [destination[0]]) if (!s.visited.includes(id)) s.visited.push(id);
      tx.travelOnly = (!intent.ids.length || companion && intent.ids.every(id=>id==='evidence_008')) && !intent.method && !/调查|检查|询问|inspect|investigate|ask/i.test(input) && safeReturn;
      tx.receipts.push(`【移动】到达${session.locations.find(l => l.id === destination[0]).name}。${tx.travelOnly ? '熟悉安全区域内的移动不单独增加压力。' : ''}`);
    }
  }
  if (/包扎|治疗伤口|bandage|dress wound/i.test(input)) tx.recovery = 'health';
  if (/稳定情绪|平复心情|grounding|calm down/i.test(input)) tx.recovery = 'sanity';
  if (tx.wasCombat && !tx.recovery) {
    if (/投降|交出|surrender/i.test(input) && !/不|拒绝|don't|not /i.test(input)) tx.concede = true;
    else tx.checks.push(check(session, NEGOTIATION.test(input) ? '说服' : '闪避', !NEGOTIATION.test(input)));
  } else if (!tx.recovery && !s.attempted.includes(intent.text)) {
    const skill = NEGOTIATION.test(input) ? '说服'
      : /心理|试探|判断.{0,8}谎|assess|lying/i.test(input) ? '心理学'
        : /偷听|聆听|eavesdrop|listen through/i.test(input) ? '聆听'
          : /解读|破译|对照.{0,8}日期|interpret|decipher/i.test(input) ? '图书馆使用'
            : /暗格|隐藏|藏匿|hidden|concealed/i.test(input) ? '侦查' : null;
    if (skill && !(skill === '说服' && tx.witnessTarget && (!witnessContact(session) || session.scenarioFlags.witness_cooperating))) tx.checks.push(check(session, skill));
  }
  // Actual encounter, never a remote event cue alone.
  if (isHybrid(session)) {
    for (const event of progress.getAvailableSanEvents(session)) {
      if (tx.checks.some(c => c.type === 'sancheck')) break;
      const relevant = event.id.includes('portrait') ? intent.ids.includes('evidence_006')
        : event.id.includes('records') ? intent.ids.includes('evidence_007')
          : event.id.includes('confession') ? intent.ids.includes('evidence_008') && witnessContact(session) && session.scenarioFlags.witness_cooperating && /证词|第七|见闻|testimony/i.test(input)
            : event.id.includes('depths') ? /检查|观察|inspect|look/i.test(input)
              : event.id.includes('signal') ? /信号灯|signal/i.test(input) && (session.scenarioFlags.passenger_restriction_announced || session.activeScene?.eventId === 'broadcast_0040')
                : event.id.includes('blackout') ? session.activeScene?.eventId === 'blackout_0110' && session.activeScene.branchKey === 'present' : false;
      if (relevant) tx.checks.push({ type: 'sancheck', trigger: 'others', target: 'player', san_event_id: event.id, san_severity: event.severity });
    }
  }
  if (!tx.wasCombat && ['loc_004','loc_009','loc_010'].includes(session.playerLocationId) && /强行|跳下|攀爬|涉水|jump|climb|force|wade/i.test(input)) {
    const danger = check(session, '闪避', true);
    danger.on_fail[0].diceSides = 6;
    danger.on_fail[0].diceCount = /跳下|jump down/i.test(input) ? 2 : 1;
    tx.checks.unshift(danger);
  }
  if (!tx.checks.length) resolveAction(session);
  tx.receipts.unshift(`【行动消耗】${tx.travelOnly ? '熟悉安全路线移动：0' : '处理当前目标：1'}次有效行动。`);
  return tx;
}
export function resolveAction(session) {
  const s = state(session), tx = s.transaction;
  if (!tx || tx.resolved) return;
  tx.resolved = true;
  const p = session.npcs.find(n => n.id === 'npc_000');
  const failed = tx.checkResults?.some(r => !r.success);
  if (tx.witnessTarget && witnessContact(session) && tx.checkResults?.some(r => r.skill === '说服' && r.success)) {
    session.scenarioFlags.witness_cooperating = true;
    tx.receipts.push('【合作已确认】林晚同意提供证词，并允许保存她持有的检修图。');
    if (!s.rewards.includes('witness')) { s.rewards.push('witness'); p.san = Math.min(session.sanity.startSan, p.san + 2); }
    if (tx.method) { tx.deferWitness = true; tx.receipts.push('【下一步】合作已取得；请下一行动听取并保存证词，以便先结算揭露内容的SAN检定。'); }
  }
  if (tx.checks.some(c => c.type === 'skill_check')) s.attempted.push(tx.text);
  if (tx.recovery) {
    if (session.combat?.active) tx.receipts.push('【尚未完成】危险尚未解除，无法安全治疗或休整。');
    else if (tx.recovery === 'health') {
      const injury = s.injuries.find(i => !i.treated);
      if (s.dressings > 0 && injury && p.hp < p.maxHp) {
        const amount = Math.min(2, injury.damage, p.maxHp - p.hp);
        p.hp += amount; injury.treated = true; s.dressings--;
        tx.receipts.push(`【包扎完成】HP +${amount}，剩余敷料${s.dressings}份。`);
      } else tx.receipts.push('【尚未完成】没有可治疗的新伤，或敷料已用完。');
    } else if (s.grounding < 2) {
      s.grounding++; session.sanity.activeTrauma = null;
      tx.receipts.push('【情绪稳定】暂时压力已缓解，SAN数值不变。');
    } else tx.receipts.push('【尚未完成】本局两次安全休整已用完。');
  }
  for (const id of tx.ids || []) {
    const clue = session.scenarioRules.clueCatalog[id];
    const existing = session.evidence.find(e => e.id === id);
    if (existing?.secured) { tx.receipts.push(`【已经保全】${clue.source}`); continue; }
    if (id === 'evidence_008' && tx.deferWitness) continue;
    const carried = existing?.artifacts?.filter(a => a.custody === 'player').map(a => a.component) || [];
    const accessible = id === 'evidence_008' ? witnessContact(session) || carried.length > 0 : carried.length > 0 || (clue.locationIds || [clue.locationId]).includes(session.playerLocationId)
      || (id === 'evidence_004' && session.inventory.some(i => i.id === 'item_001' && i.status !== '已失去'));
    if (!accessible) { tx.receipts.push(id === 'evidence_008' ? '【尚未完成】目前无法与林晚直接交流，也未持有可复制的证词或检修图。请先找到她并建立联系。' : `【尚未完成】${clue.source}不在可接触范围，请先前往相应地点。`); continue; }
    const equipped = session.inventory.some(i => i.id === 'item_field_kit' && i.status !== '已失去');
    const liveWitness = witnessContact(session) && session.scenarioFlags.witness_cooperating;
    const blocked = (id === 'evidence_008' && !liveWitness && !carried.length) || (tx.checks.some(c => c.on_fail?.length) && failed) || (!!tx.method && !equipped);
    const secured = !!tx.method && methods[id].includes(tx.method) && !blocked;
    const [record] = progress.applyEvidenceChanges(session, [{ id, secured: false }]);
    const evidence = record || session.evidence.find(e => e.id === id);
    // Compound needle/medical evidence requires both accessible components.
    const components = requestedComponents(session,id,tx.input);
    evidence.artifacts ||= [];
    if (secured) for (const component of components) {
      const access = componentAccess(session,id,component);
      if (!access.ok) { tx.receipts.push(`【尚未完成】${access.reason}`); continue; }
      if (id === 'evidence_008' && !liveWitness && !carried.includes(component)) { tx.receipts.push(`【尚未完成】未持有${component === 'map' ? '检修图' : '证词记录'}，不能凭空复制。`); continue; }
      evidence.artifacts.push({ method: tx.method, component, actionId: tx.id, locationId: session.playerLocationId, custody: 'player' });
    }
    const required = id === 'evidence_003' ? ['needle','medical'] : id === 'evidence_006' ? ['painting','register'] : id === 'evidence_008' ? ['testimony','map'] : ['record'];
    evidence.secured = required.every(c => evidence.artifacts.some(a => a.component === c));
    tx.receipts.push(evidence.secured ? `【证据已保全】${clue.source}：已形成可复核的${tx.method === 'sample' ? '样本' : '记录'}。`
      : `【已发现，尚未完成保全】${clue.source}：${blocked ? !equipped ? '缺少随身取证工具。' : '须先解除阻碍或取得证人同意。' : secured ? '已保存部分材料，仍需补足组合线索。' + clue.preservationHint : clue.preservationHint}`);
  }
  if (tx.ids?.length) session.scenarioFlags.lastEvidenceTargets = tx.ids;
  if (tx.wasCombat) {
    s.exchanges = (s.exchanges || 0) + 1;
    if (tx.concede || (!failed && tx.checkResults?.length) || s.exchanges >= 3) {
      if (tx.concede) {
        const named = session.inventory.filter(i => i.status !== '已失去' && tx.input.includes(i.name));
        named.forEach(i => { i.status = '已失去'; });
        tx.receipts.push(named.length ? `【退出冲突】交出${named.map(i => i.name).join('、')}，对方停止围堵。` : '【退出冲突】你放弃继续接近现场的机会，沿退路撤离；已有副本仍保留。');
      } else tx.receipts.push(failed ? '【冲突结束】未能压倒对方，你利用隔门撤出；失去现场控制权，没有获得新证据。' : '【冲突结束】检定成功，你保护现有记录并脱离围堵。');
      session.finaleState ||= {};
      session.finaleState.crisisSnapshot ||= structuredClone(session.combat);
      session.finaleState.resolutionOutcome = { kind: failed ? 'forced_retreat' : 'resolved', text: tx.receipts.at(-1) };
      session.combat = null; session.scenarioFlags.finale_crisis_resolved = true;
      s.climaxResolvedAt = s.actions + 1;
      if (!s.rewards.includes('conflict')) { s.rewards.push('conflict'); p.san = Math.min(session.sanity.startSan, p.san + 2); }
    }
  }
  s.receipts = tx.receipts;
}
export function advanceHybrid(session) {
  const s = state(session); if (!s.transaction?.travelOnly) s.actions++;
  const found = session.evidence.filter(e => e.discovered !== false);
  if (s.act === 'opening' && (s.actions >= 6 || s.actions >= 4 && found.length >= 2)) s.act = 'investigation';
  const branches = ['evidence_005','evidence_006','evidence_008'].filter(id => found.some(e => e.id === id)).length;
  if (s.act === 'investigation' && (s.actions >= 16 || s.actions >= 12 && branches >= 2)) s.act = 'confrontation';
  if (session.scenarioFlags.finale_crisis_resolved) s.act = 'consolidation';
  if (s.actions >= 26) s.act = 'finale';
  const due = { broadcast_0040: 2, blackout_0110: 4, painting_0140: 7, power_0210: 8, records_0240: 10, confession_0310: 13, entrance_0340: 15, seizure_0440: s.act === 'confrontation' || s.act === 'consolidation' ? 0 : 16, departure_0510: 22, last_boarding_0550: 24 };
  const eligible = [];
  for (const e of session.scheduledEvents) if (!e.fired && e.status === 'dormant' && s.actions >= (due[e.id] ?? Infinity)) { e.status = 'eligible'; e.eligibleAtAction = s.actions; eligible.push(e); }
  const previous = session.scenarioClock.currentTime;
  const minutes = Math.min(360, 10 + Math.floor(s.actions * 350 / 26));
  session.scenarioClock.currentTime = `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
  session.scenarioClock.turn++;
  session.scenarioClock.phase = ({ opening:'hook', investigation:'investigation', confrontation:'crisis', consolidation:'aftermath', finale:'finale' })[s.act];
  return { advanced: true, cost: 0, previous, currentTime: session.scenarioClock.currentTime, deadlineReached: s.actions >= 26, newlyEligibleEvents: eligible, firedEvents: [], revealedLocations: [] };
}
export function observeNpcs(session) {
  for (const npc of session.npcs) {
    if (npc.observation) npc.observation.stale = npc.locationId !== session.playerLocationId || npc.status === 'departed';
    if (npc.id === 'npc_000' || npc.visibility === 'hidden' || npc.locationId !== session.playerLocationId || npc.status === 'departed') continue;
    const text = npc.currentState || '';
    npc.observation ||= {};
    const physical = /流血|渗血|伤口/.test(text) ? '可见伤势' : /倒地|昏迷/.test(text) ? '倒地，行动受限' : /站|坐|走|整理|守|画/.test(text) ? '未见明显行动障碍' : null;
    const emotional = /惊恐|惊吓|惊呼|发抖|颤抖/.test(text) ? '受到惊吓' : /紧张|攥|戒备|警惕/.test(text) ? '神情紧张' : /平静|稍稳|放松/.test(text) ? '表现平静' : null;
    if (physical) npc.observation.physical = physical;
    if (emotional) npc.observation.emotional = emotional;
    npc.observation.at = session.scenarioClock.turn;
    npc.observation.source = '亲眼观察';
  }
}
export function repeatedNarration(text, previous = []) {
  const norm = s => s.replace(/[\s\p{P}]/gu, '');
  const blocks = text.split(/\n+/).map(norm).filter(s => s.length >= 40);
  if (new Set(blocks).size !== blocks.length) return true;
  const old = previous.map(norm).join('');
  return blocks.length > 0 && blocks.filter(b => old.includes(b)).join('').length > norm(text).length * 0.45;
}

export function unsupportedEffects(session, text) {
  const tx = state(session).transaction;
  if (!tx) return false;
  const normalized = text.replace(/\s+/g, '');
  if (session.combat?.active && /退让|撤退|退去|停止围堵|放你离开|成功脱身|逃脱成功/.test(normalized)) return true;
  if (!session.scenarioFlags.witness_cooperating && /林晚.{0,30}(?:同意|答应|交出|交给)/.test(normalized)) return true;
  if (tx.ids?.includes('evidence_008') && tx.receipts.some(r => /尚未完成|下一步/.test(r)) && /(?:录音|证词).{0,15}(?:保存完|录制完|已经保存)|你.{0,25}(?:录下|录好)/.test(normalized)) return true;
  const has = id => session.evidence.find(e => e.id === id)?.artifacts?.length || session.evidence.find(e => e.id === id)?.secured;
  if (!has('evidence_002') && /泥样|(?:你|封袋时).{0,100}(?:刮下|封袋|泥粒.{0,15}(?:袋|口袋))/.test(normalized)) return true;
  if (!has('evidence_001') && /(?:你的|手里的|门锁的)拓片|(?:你).{0,30}拓印/.test(normalized)) return true;
  if (!has('evidence_003') && /针孔照片|你.{0,40}拍下.{0,15}针孔/.test(normalized)) return true;
  if (!tx.method && /你.{0,35}(?:装袋|封存|取样|录制|拍摄|抄录)|封袋时/.test(normalized)) return true;
  const damage = tx.hpBefore - session.npcs.find(n => n.id === 'npc_000')?.hp;
  if (!(damage > 0) && /你.{0,50}(?:被.{0,10}砸中|伤口|流血|剧痛|鲜血)|肩头.{0,10}砸中/.test(normalized)) return true;
  return false;
}

export function engineNarrative(session, pending = false) {
  const tx = state(session).transaction;
  const scene = session.activeScene;
  const checks = pending ? tx.checks : [];
  const text = pending ? checks.map(c => c.type === 'sancheck'
    ? `【SAN检定】${c.san_severity === 'catastrophe' ? '灾变：成功损失1，失败1d6' : c.san_severity === 'major' ? '重大异常：成功0，失败1d4+1' : '不安：成功0，失败1d3'}。确认前结果尚未发生。`
    : `【${c.skill_name} ${c.skill_point}】成功取得行动优势；失败${c.on_fail?.length ? `受到${c.on_fail[0].diceCount}d${c.on_fail[0].diceSides}点HP伤害` : '未取得优势，已有线索保留'}。请确认后掷骰。`).join('\n')
    : [...(tx?.receipts || []), ...(tx?.checkResults || []).map(r => `${r.skill}：${r.success ? '成功' : '失败'}；投掷${r.roll}。`), '本次行动已结算，以下选项继续当前调查。'].join('\n');
  return { narration: `${scene?.playerCue || ''}\n${text}`, actions: checks.length ? checks : null, options: checks.length ? null : ['A. 核对现有线索','B. 处理尚未保全的材料','C. 确认可用退路','D. 自由行动'], npcs:[], items:[], locations:[], time_cost_minutes:0, time_cost_rationale:'引擎行动结算', evidence_changes:[], suspicion_delta:0, combat_update:null, current_location_id:session.playerLocationId, active_event_ack:scene ? { event_id:scene.eventId,outcome:scene.outcome,incorporated:true,perceived_consequence:scene.playerCue } : null };
}
