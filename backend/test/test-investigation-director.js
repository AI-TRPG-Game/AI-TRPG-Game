import assert from 'node:assert/strict';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';
import { prepareAction, resolveAction, state, observeNpcs, repeatedNarration, unsupportedEffects } from '../src/services/InvestigationDirector.js';
import { scenarioProgressService } from '../src/services/ScenarioProgressService.js';
import { damageResolver } from '../src/services/DamageResolver.js';
import { diceService } from '../src/services/DiceService.js';
import { getNpcCondition } from '../../src/ui/ScenarioPresentation.mjs';
import { scheduleService } from '../src/services/ScheduleService.js';

function fixture() {
  const repository = new RequestSessionRepository();
  const engine = new GameOrchestrator({ repository, llmProvider: {} });
  return repository.findById(engine.createBirchStationTutorial().session.id);
}
const s = fixture();
// Exact reported response: the announcement is already a danger, even before
// commitActiveScene applies the event's final consequences.
const announced = fixture();
const seizure = announced.scheduledEvents.find(e => e.id === 'seizure_0440');
seizure.status = 'eligible';
scheduleService.stageBoundaryEvent(announced, [seizure.id]);
const announceRepo = new RequestSessionRepository(announced.toJSON());
const announceEngine = new GameOrchestrator({repository:announceRepo,llmProvider:{generate(){throw Error('must roll before model');}}});
const negotiation = await announceEngine.handleMessage(announced.id,'利用两人的分歧进行谈判，争取带着现有证据脱身');
assert.equal(negotiation.result.branch,'DICE_AWAITING');
assert.equal(negotiation.session.scenarioFlags.investigation.transaction.checks[0].skill_name,'说服');
const reverted = announceEngine.cancelDice(announced.id).session;
assert.ok(!reverted.combat?.active);
assert.equal(reverted.activeScene.eventId,seizure.id);
assert.equal(reverted.scenarioFlags.investigation.actions,0);

const portable = fixture();
portable.playerLocationId = 'loc_005';
const lin = portable.npcs.find(n=>n.id==='npc_005');
lin.locationId = 'loc_005';
prepareAction(portable,'说服林晚相信我的保护承诺');
state(portable).transaction.checkResults = [{skill:'说服',success:true}];
resolveAction(portable);
assert.equal(portable.scenarioFlags.witness_cooperating,true);
prepareAction(portable,'录音保存林晚证词');
assert.ok(state(portable).transaction.checks.some(c=>c.san_event_id?.includes('confession')));
damageResolver.resolve(portable,{actions:state(portable).transaction.checks});
resolveAction(portable);
assert.equal(portable.evidence.find(e=>e.id==='evidence_008').artifacts[0].component,'testimony');
lin.status='departed';
prepareAction(portable,'复制林晚证词并保存检修图');
assert.equal(portable.evidence.find(e=>e.id==='evidence_008').secured,false,'cannot copy a map never received');
assert.ok(state(portable).receipts.some(r=>r.includes('未持有检修图')));
lin.status='active';
prepareAction(portable,'保存并带走林晚的检修图');
assert.equal(portable.evidence.find(e=>e.id==='evidence_008').secured,true);
const absent = fixture(); absent.playerLocationId='loc_008'; absent.npcs.find(n=>n.id==='npc_005').locationId='loc_005';
prepareAction(absent,'说服林晚并录音保存证词');
assert.equal(state(absent).transaction.checks.length,0);
assert.ok(!absent.scenarioFlags.witness_cooperating);
assert.ok(state(absent).receipts.some(r=>r.includes('无法与林晚直接交流')));

const blackout = fixture();
blackout.activeScene={eventId:'blackout_0110',branchKey:'present'};
prepareAction(blackout,'辨认黑暗中的呼吸声');
assert.ok(state(blackout).transaction.checks.some(c=>c.san_event_id==='san_blackout_0110'));
const mereContact = fixture(); mereContact.playerLocationId='loc_008';
prepareAction(mereContact,'询问林晚的证词');
assert.equal(state(mereContact).transaction.checks.length,0,'no revelation before cooperation');
const expiry = fixture(); const painting = expiry.scheduledEvents.find(e=>e.id==='painting_0140');
painting.eligibleAtAction=7; state(expiry).actions=7; expiry.scenarioClock.currentTime='06:00';
assert.notEqual(scheduleService._decidePlacement(expiry,painting,'loc_001').branchKey,'expired');
state(expiry).actions=11; expiry.scenarioClock.currentTime='00:10';
assert.equal(scheduleService._decidePlacement(expiry,painting,'loc_001').branchKey,'expired');
const consolidation = fixture();
state(consolidation).act='consolidation'; state(consolidation).actions=20; state(consolidation).climaxResolvedAt=18;
const presentationEngine = new GameOrchestrator({repository:new RequestSessionRepository(),llmProvider:{}});
const normalResult = {parsed:{narration:'危险已经解除。',options:[]}};
presentationEngine._discardOrdinaryOptionsForFinale(consolidation,normalResult,'NARRATION_I');
assert.ok(!normalResult.parsed.options.some(o=>o.includes('最终决定')));
assert.ok(normalResult.parsed.narration.includes('自愿提前收束'));
assert.equal(consolidation.finaleState,null);
state(consolidation).actions=24;
const finalResult = {parsed:{narration:'整理完毕。',options:[]}};
presentationEngine._discardOrdinaryOptionsForFinale(consolidation,finalResult,'NARRATION_I');
assert.ok(finalResult.parsed.options.every(o=>o.includes('最终决定')));
prepareAction(s, 'Take photos of the door lock scratches');
assert.equal(s.evidence.find(e => e.id === 'evidence_001').secured, true);
prepareAction(s, '记录地毯湿泥');
assert.equal(unsupportedEffects(s, '你从包中取出证物袋，用镊子刮下地毯边缘的湿泥。封袋时，你把袋子放进胸前口袋。'), true);
assert.equal(s.evidence.find(e => e.id === 'evidence_002').secured, false);
prepareAction(s, 'Put the mud into a sample bag');
assert.equal(s.evidence.find(e => e.id === 'evidence_002').secured, true);
assert.equal(s.evidence.find(e => e.id === 'evidence_002').artifacts[0].method, 'sample');
prepareAction(s, 'Record the usable portion of 顾言’s recording and its relevant words');
assert.equal(s.evidence.find(e => e.id === 'evidence_004').secured, true);
assert.equal(s.evidence.some(e => e.id === 'evidence_005'), false);
prepareAction(s, '拍摄针孔');
assert.equal(s.evidence.find(e => e.id === 'evidence_003').secured, false);
s.locations.push({ id: 'loc_007', name: '医疗档案室' });
prepareAction(s, '进入医疗档案室并抄录药物记录');
damageResolver.resolve(s, { actions: state(s).transaction.checks });
resolveAction(s);
assert.equal(s.evidence.find(e => e.id === 'evidence_003').secured, true);
prepareAction(s, '拍照保存这些材料'); // Last target was compound needle/medical evidence.
assert.ok(state(s).transaction.clarification, 'multiple recent targets need clarification');

const observed = fixture(); observed.playerLocationId = 'loc_008';
observed.npcs.find(n => n.id === 'npc_005').currentState = '站在门边，神情紧张';
observeNpcs(observed);
assert.equal(getNpcCondition(observed.npcs.find(n => n.id === 'npc_005')), '未见明显行动障碍 | 神情紧张');
assert.equal(observed.npcs.find(n => n.id === 'npc_005').san, null);

const danger = fixture();
danger.combat = { active: true, objective: '围堵', participants: ['npc_000','npc_001'] };
const original = diceService.rollWithBonusPenalty;
diceService.rollWithBonusPenalty = () => ({ value: 99 });
try {
  prepareAction(danger, '抵挡攻击');
  const result = damageResolver.resolve(danger, { actions: state(danger).transaction.checks });
  assert.equal(result.playerDied, false);
  assert.ok(danger.npcs[0].hp < 11);
  assert.equal(state(danger).injuries.length, 1);
  resolveAction(danger);
  danger.combat = null;
  const before = danger.npcs[0].hp;
  prepareAction(danger, '包扎伤口');
  assert.ok(danger.npcs[0].hp > before);
  assert.equal(state(danger).dressings, 1);
  prepareAction(danger, '包扎伤口');
  assert.equal(state(danger).dressings, 1, 'same injury cannot heal twice');
} finally { diceService.rollWithBonusPenalty = original; }
assert.equal(repeatedNarration(('这是一段用于测试重复的长叙述。'.repeat(6)) + '\n\n' + ('这是一段用于测试重复的长叙述。'.repeat(6))), true);

const interrupted = fixture();
const interruptedRepo = new RequestSessionRepository(interrupted.toJSON());
const interruptedEngine = new GameOrchestrator({ repository: interruptedRepo, llmProvider: { generate() { throw Error('not needed before deterministic dice'); } } });
const pending = await interruptedEngine.handleMessage(interrupted.id, '寻找隐藏的细节');
assert.equal(pending.result.branch, 'DICE_AWAITING');
const canceled = interruptedEngine.cancelDice(interrupted.id);
assert.equal(canceled.session.scenarioFlags.investigation.actions, 0);
assert.equal(canceled.session.evidence.length, 2);

const endingSession = fixture();
endingSession.scenarioClock = { currentTime:'06:00', deadline:'06:00', mode:'finale', turn:26 };
endingSession.finaleState = { stage:'decision' };
const endRepo = new RequestSessionRepository(endingSession.toJSON());
const endEngine = new GameOrchestrator({ repository:endRepo, llmProvider:{generate(){throw Error('finish_reason=length: reasoning exhausted output');}} });
const ended = await endEngine.handleMessage(endingSession.id, '最终决定：撤离白桦站');
assert.equal(ended.session.finaleState.stage,'complete');
assert.equal(ended.session.optionBuffer,'');
assert.ok(ended.result.debugLogs.some(log=>log.type==='ending_transport_fallback'));
await assert.rejects(endEngine.handleMessage(endingSession.id,'选项A'));

// An early commitment survives combat and save/reload; no second final choice.
let committed = fixture();
state(committed).actions = 24;
committed.combat = { active:true, objective:'保护现有证据并撤离', participants:['npc_000','npc_001'] };
const failingProvider = { generate(){ throw Error('offline fallback'); } };
let commitRepo = new RequestSessionRepository(committed.toJSON());
let commitEngine = new GameOrchestrator({repository:commitRepo,llmProvider:failingProvider});
const commitment = await commitEngine.handleMessage(committed.id,'最终决定：保全并带走证据');
assert.equal(commitment.session.scenarioFlags.pendingCommitment,true);
assert.equal(commitment.session.finaleState.stage,'resolve_scene');
committed = commitRepo.findById(committed.id);
diceService.rollWithBonusPenalty = () => ({value:99});
try {
  for (let i=0;i<3 && committed.finaleState.stage!=='complete';i++) {
    commitRepo = new RequestSessionRepository(committed.toJSON());
    commitEngine = new GameOrchestrator({repository:commitRepo,llmProvider:failingProvider});
    committed = commitRepo.findById(committed.id);
    await commitEngine.handleMessage(committed.id,'尝试寻找退路');
    for (let j=0;j<4 && committed.pendingDiceFlow;j++) await commitEngine.confirmDice(committed.id);
  }
  assert.equal(committed.finaleState.stage,'complete');
  assert.equal(committed.scenarioFlags.pendingCommitment,false);
  assert.ok(committed.finalChoice);
} finally { diceService.rollWithBonusPenalty = original; }

const frightened = fixture(); frightened.playerLocationId = 'loc_005';
diceService.rollWithBonusPenalty = () => ({value:99});
try {
  prepareAction(frightened,'拍摄画作和乘客名册');
  const checks = state(frightened).transaction.checks;
  assert.ok(checks.some(c=>c.type==='sancheck'));
  damageResolver.resolve(frightened,{actions:checks}); resolveAction(frightened);
  assert.ok(frightened.npcs[0].san < 60);
  assert.ok(frightened.sanity.activeTrauma);
  prepareAction(frightened,'再次拍摄画作和乘客名册');
  assert.equal(state(frightened).transaction.checks.length,0,'same horror must not trigger again');
  const san = frightened.npcs[0].san;
  prepareAction(frightened,'稳定情绪');
  assert.equal(frightened.sanity.activeTrauma,null);
  assert.equal(frightened.npcs[0].san,san);
} finally { diceService.rollWithBonusPenalty = original; }

// Actual orchestrator + save/reload: a noncompliant narrator never clears combat.
for (const style of ['cautious','failed-check','noncompliant','evidence-focused']) {
  let current;
  let calls = 0;
  const provider = { model:'offline', async generate(input) {
    calls++;
    if (input.flowType === 'HISTORY_SUMMARY') return { content: JSON.stringify({ summary:'调查仍在推进，保留引擎状态。' }) };
    if (input.flowType === 'ENDING_GEN') return { content: JSON.stringify({ ending_title:'雨夜之后', immediate_resolution:'围堵已结束，沿公路撤出车站。', player_outcome:'带着本局实际获得的记录离开。', truth_outcome:'未能证明的部分仍然是缺口。', character_outcomes: current.npcs.filter(n=>n.id!=='npc_000').map(n=>({ npc_id:n.id,name:n.name,outcome:'本次冲突已经结束。' })), ending_text:'本次调查结束。', debrief:{} }) };
    const event = current.activeScene;
    return { content: JSON.stringify({ narration:'你确认眼前的情况，没有得到额外的机械收益。'.repeat(40), locations:[], npcs:[], items:[], actions:null, options:['A. 核对调查笔记','B. 查看已有记录','C. 撤出危险','D. 自由行动'], time_cost_minutes:90, time_cost_rationale:'模型随意时间', evidence_changes:[], suspicion_delta:0, combat_update:null, current_location_id:current.playerLocationId, active_event_ack:event ? {event_id:event.eventId,outcome:event.outcome,incorporated:true,perceived_consequence:'周围出现变化。'} : null }) };
  }};
  let repo = new RequestSessionRepository();
  let engine = new GameOrchestrator({repository:repo,llmProvider:provider});
  current = repo.findById(engine.createBirchStationTutorial().session.id);
  let actions = 0;
  if (style === 'failed-check') diceService.rollWithBonusPenalty = () => ({ value:99 });
  else diceService.rollWithBonusPenalty = () => ({ value:1 });
  const route = ['给门锁刮痕拍照', '把地毯湿泥装袋取样', '拍摄针孔', '抄录顾言的录音', '进入站务楼候车厅', '拍摄苏棠的画作和乘客名册', '进入乘务员休息室', '说服林晚相信我的保护承诺', '录音保存林晚证词并保存检修图', '进入站务楼候车厅', '进入站务办公室', '拍摄调度记录', '进入医疗档案室', '抄录药物记录与医疗转运档案'];
  let routeIndex = 0;
  try {
    for (let step=0; step<40 && current.finaleState?.stage !== 'complete'; step++) {
      repo = new RequestSessionRepository(current.toJSON());
      engine = new GameOrchestrator({repository:repo,llmProvider:provider});
      current = repo.findById(current.id);
      const text = current.finaleState?.stage === 'decision' ? '最终决定：撤离白桦站' : current.combat?.active ? '尝试寻找退路' : style === 'evidence-focused' && routeIndex < route.length ? route[routeIndex++] : actions === 0 ? '给门锁刮痕拍照' : '核对已知调查记录';
      let response = await engine.handleMessage(current.id,text);
      for (let i=0; i<4 && current.pendingDiceFlow; i++) response = await engine.confirmDice(current.id);
      actions++;
      assert.ok(!current.combat?.active || (state(current).exchanges || 0) < 3);
    }
    assert.equal(current.finaleState?.stage,'complete', style);
    assert.ok(state(current).actions + 1 <= 30, `${style} used ${actions}`);
    const facts = scenarioProgressService.evaluateTruth(current).factCount;
    if (style === 'evidence-focused') assert.equal(facts,4, JSON.stringify(current.evidence));
    console.log(JSON.stringify({style,submissions:actions,meaningfulActions:state(current).actions+1,calls,hp:current.npcs[0].hp,san:current.npcs[0].san,facts,stage:current.finaleState.stage}));
  } finally { diceService.rollWithBonusPenalty = original; }
}
console.log('Investigation, resource, NPC observation and full hybrid-run tests passed');
