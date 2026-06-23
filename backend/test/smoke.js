import { tagParser } from '../src/services/TagParser.js';
import { diceService } from '../src/services/DiceService.js';
import { optionResolver } from '../src/services/OptionResolver.js';
import { inputAssembler } from '../src/services/InputAssembler.js';
import { FlowType, SubState } from '../src/domain/enums.js';
import { GameSession } from '../src/domain/GameSession.js';
import { getDatabase } from '../src/persistence/database.js';
import { SessionRepository } from '../src/persistence/SessionRepository.js';

const raw = `<narration>夜幕降临</narration>
<location>码头区：咸腥的海风</location>
<npc>老乞丐：无害</npc>
<item>生锈匕首：已获得，一把旧匕首</item>
<dice>1d100, 2d4</dice>
<option>
A. 探索
B. 观察
C. 离开
D. 自由行动
</option>`;

const parsed = tagParser.parse(raw);
console.assert(parsed.narration === '夜幕降临', 'narration parse');
console.assert(parsed.locations.length === 1, 'location parse');
console.assert(parsed.hasDice(), 'dice parse');
console.assert(parsed.option.includes('A. 探索'), 'option parse');

const diceReqs = diceService.parseNotation(parsed.dice);
console.assert(diceReqs.length === 2, 'dice notation');
console.assert(diceReqs[0].count === 1 && diceReqs[0].sides === 100, 'd100');

const buffer = 'A. 探索前方\nB. 观察周围\nC. 离开\nD. 自由行动';
const resolved = optionResolver.resolve('选项A和B', buffer);
console.assert(resolved.includes('探索前方'), 'option resolve');

const db = getDatabase(':memory:');
const repo = new SessionRepository(db);
const session = repo.create('test');
const assembled = inputAssembler.assemble(FlowType.WORLD_GEN, session, {
  userText: '蒸汽朋克世界',
});
console.assert(
  assembled.messages[0].content.includes('CoC7th'),
  'system instruction'
);
console.assert(
  assembled.messages.some(m => m.role === 'user' && m.content.includes('蒸汽朋克世界')),
  'user content'
);

const streamingSession = new GameSession({
  id: 'streaming',
  subState: SubState.LLM_STREAMING,
  pendingDiceFlow: { diceNotation: '1d100' },
});
console.assert(
  streamingSession.toJSON().subState === SubState.LLM_STREAMING,
  'runtime snapshot keeps transient state'
);
console.assert(
  streamingSession.toClientJSON().subState === SubState.AWAITING_INPUT,
  'client snapshot recovers streaming state'
);
console.assert(
  streamingSession.toClientJSON().pendingDiceFlow === null,
  'client snapshot clears stale dice flow'
);
streamingSession.recoverTransientState();
console.assert(
  streamingSession.subState === SubState.AWAITING_INPUT,
  'incoming snapshot recovers transient state'
);

const diceSession = new GameSession({
  id: 'dice',
  subState: SubState.DICE_PENDING,
  pendingDiceFlow: { diceNotation: '1d100' },
});
console.assert(
  diceSession.toClientJSON().subState === SubState.DICE_PENDING,
  'client snapshot preserves dice pending state'
);

console.log('All tests passed');
