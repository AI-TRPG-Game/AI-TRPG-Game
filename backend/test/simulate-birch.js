import assert from 'node:assert/strict';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';
import { scenarioProgressService } from '../src/services/ScenarioProgressService.js';

// No external API calls. Persist/reconstruct between every action as HTTP does.
for (const style of ['exploratory', 'evidence-focused', 'high-suspicion', 'failed-check', 'never-clears-combat']) {
  let session;
  let targetLocation;
  let calls = 0;
  const trace = [];
  const provider = { model: 'simulation', async generate(input) {
    calls++;
    if (input.flowType === 'HISTORY_SUMMARY') return { content: JSON.stringify({ summary: '已完成多次调查。保留当前证据与危机状态。' }) };
    if (input.flowType === 'ENDING_GEN') return { content: JSON.stringify({
      ending_title: '离站之后', immediate_resolution: session.finaleState.resolutionOutcome?.text || '危机已经结束。',
      player_outcome: '你沿公路离开车站。', truth_outcome: '只保留本局已经取得的材料，未证实的部分仍是缺口。',
      character_outcomes: session.npcs.filter(n => n.id !== 'npc_000').map(n => ({ npc_id: n.id, name: n.name, outcome: '本次冲突结束，离开现场。' })),
      ending_text: '本次调查结束，雨中的站房渐渐远去。', debrief: {},
    }) };
    const scene = session.activeScene;
    const clear = style !== 'never-clears-combat' && style !== 'failed-check' && session.combat?.active;
    return { content: JSON.stringify({
      narration: (style === 'failed-check' ? '尝试没有奏效，对方仍封住退路。' : '你观察眼前的变化，并记录可以核对的信息。').repeat(65),
      locations: [], npcs: [], items: [], actions: style === 'failed-check' && session.finaleState?.stage === 'resolve_scene' && input.flowType === 'NARRATION_I'
        ? [{ type: 'skill_check', trigger: 'player', target: 'player', skill_name: '闪避', skill_point: 0, bonus_dice: 0, penalty_dice: 0, on_success: [], on_fail: [] }] : null,
      options: ['A. 继续调查', 'B. 询问证人', 'C. 整理记录', 'D. 自由行动'],
      time_cost_minutes: 60, time_cost_rationale: '模型故意给出过高耗时', evidence_changes: [], suspicion_delta: 0,
      combat_update: clear ? { ...session.combat, active: false } : null,
      ending_recommendation: { should_end: false, reason: '' }, current_location_id: targetLocation || session.playerLocationId,
      active_event_ack: scene ? { event_id: scene.eventId, outcome: scene.outcome, incorporated: true, perceived_consequence: '周围局势已经变化。' } : null,
    }) };
  }};
  let repo = new RequestSessionRepository();
  let engine = new GameOrchestrator({ repository: repo, llmProvider: provider });
  session = repo.findById(engine.createBirchStationTutorial().session.id);
  session.scenarioRules.pacingVersion = 2; // Retained legacy timing regression; v3 is test-investigation-director.js.
  if (style === 'high-suspicion') session.suspicion = 8;
  let actions = 0;
  let deadlineAction;
  while (actions < 55 && session.finaleState?.stage !== 'complete') {
    repo = new RequestSessionRepository(structuredClone(session.toJSON()));
    engine = new GameOrchestrator({ repository: repo, llmProvider: provider });
    session = repo.findById(session.id);
    targetLocation = null;
    let text = '检查当前现场并核对已知线索';
    if (style === 'evidence-focused') {
      // Follow reachable, revealed clues; this fixture does not grant hidden locations.
      const clue = Object.entries(session.scenarioRules.clueCatalog).find(([id, c]) =>
        !session.evidence.some(e => e.id === id && e.secured) && (c.locationIds || [c.locationId]).includes(session.playerLocationId));
      if (clue) text = `检查${clue[1].source}并${clue[1].preservationHint}`;
      else {
        const known = new Set(session.locations.map(l => l.id));
        const queue = [[session.playerLocationId]];
        const seen = new Set();
        while (queue.length) {
          const route = queue.shift();
          const current = route.at(-1);
          if (seen.has(current)) continue;
          seen.add(current);
          if (route.length > 1 && Object.entries(session.scenarioRules.clueCatalog).some(([id,c]) => c.locationId === current && !session.evidence.some(e => e.id === id && e.secured))) {
            targetLocation = route[1];
            text = `进入${session.locations.find(l => l.id === targetLocation).name}`;
            break;
          }
          for (const id of session.scenarioRules.locationGraph[current] || []) if (known.has(id)) queue.push([...route, id]);
        }
      }
    }
    if (session.finaleState?.stage === 'resolve_scene') {
      const before = session.finaleState.completedActions;
      await engine.handleMessage(session.id, '我该怎么办');
      assert.equal(session.finaleState.completedActions, before, 'guidance must not spend actions');
      text = '选项C';
    }
    if (session.finaleState?.stage === 'decision') text = '选项D';
    let result = await engine.handleMessage(session.id, text);
    if (result.result.branch === 'DICE_AWAITING') result = await engine.confirmDice(session.id);
    actions++;
    if (session.scenarioClock.mode === 'finale' && deadlineAction == null) deadlineAction = actions;
    trace.push({ action: actions, text, location: session.playerLocationId, time: session.scenarioClock.currentTime, stage: session.finaleState?.stage || 'normal', event: result.result.eventResolution?.id, announced: result.result.boundaryScene?.eventId });
  }
  assert.equal(session.finaleState.stage, 'complete', style);
  assert.ok(session.finaleState.completedActions <= 3);
  assert.ok(actions >= 24 && actions <= 30, `${style}: ${actions} actions outside target`);
  const count = calls;
  await assert.rejects(engine.handleMessage(session.id, '选项A'));
  assert.equal(calls, count, 'completed ending must not invoke narration again');
  const truth = scenarioProgressService.evaluateTruth(session);
  if (style === 'evidence-focused' && truth.factCount !== 4) console.error(JSON.stringify({ trace, truth }));
  if (style === 'evidence-focused') assert.equal(truth.factCount, 4, 'a guided route can assemble the complete case');
  console.log(JSON.stringify({ style, actions, deadlineAction, crisisActions: session.finaleState.completedActions, requests: calls, secured: truth.securedEvidence, facts: truth.factCount, stage: session.finaleState.stage, trace }));
}
