// Optional real-API playthrough. Not part of the offline test suite.
// node test/live-birch.js <profile-id> [--full]
import dotenv from 'dotenv';
import { getLLMProfiles } from '../src/config/LLMConfig.js';
import { LLMProviderRegistry } from '../src/llm/LLMProviderRegistry.js';
import { GameOrchestrator } from '../src/orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../src/persistence/RequestSessionRepository.js';
dotenv.config();
const registry = new LLMProviderRegistry(getLLMProfiles());
const entry = registry.resolve(process.argv[2]);
let repo = new RequestSessionRepository();
let engine = new GameOrchestrator({ repository: repo, llmProvider: entry.provider });
let session = engine.createBirchStationTutorial().session;
if (!process.argv.includes('--full')) {
  session.scenarioClock.currentTime = '06:00';
  session.scenarioClock.mode = 'finale';
  session.combat = { active: true, objective: '保护记录并脱离围堵', participants: ['npc_000','npc_001','npc_003'], round: 1 };
}
for (let action = 1; action <= 40; action++) {
  repo = new RequestSessionRepository(session);
  engine = new GameOrchestrator({ repository: repo, llmProvider: entry.provider });
  const s = repo.findById(session.id);
  const text = s.finaleState?.stage === 'decision' ? '最终决定：撤离白桦站'
    : s.finaleState?.stage === 'resolve_scene' ? '护住已有记录，尝试利用隔门脱离围堵，向站外公路撤退'
      : s.optionBuffer?.includes('A.') ? '选项A' : '检查当前现场，保全已经发现的线索';
  let response = await engine.handleMessage(s.id, text);
  let dice = 0;
  while (response.session.subState === 'DICE_PENDING' && dice++ < 5) response = await engine.confirmDice(s.id);
  session = response.session;
  console.log(JSON.stringify({ model: entry.provider.model, action, time: session.scenarioClock.currentTime,
    stage: session.finaleState?.stage, crisisActions: session.finaleState?.completedActions,
    ending: response.result?.endingTriggered || false,
    excerpt: (response.result?.endingText || response.result?.parsed?.narration || '').slice(-180) }));
  if (session.finaleState?.stage === 'complete') break;
  if (dice >= 5) throw Error('Excessive nested dice flow');
}
if (session.finaleState?.stage !== 'complete') throw Error('Live run did not reach a conclusion');
