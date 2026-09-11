import {
  getNpcCondition,
  getGamePhaseLabel,
  getGameSubStateLabel,
  getSanLabel,
  getScenarioPhaseLabel,
  getSuspicionDisplay,
  sanitizePlayerPresentation,
} from '../../src/ui/ScenarioPresentation.mjs';
import { scenarioProgressService } from '../src/services/ScenarioProgressService.js';
import { playerFacingTextSanitizer } from '../src/services/PlayerFacingTextSanitizer.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const uiSuspicion = getSuspicionDisplay(3);
const engineSuspicion = scenarioProgressService.getSuspicionState(3);
assert(uiSuspicion.label === '被监视' && engineSuspicion.label === '被监视', '怀疑度标签应统一使用中文');
assert(!/[A-Za-z]|&#/.test(`${uiSuspicion.label}${uiSuspicion.effect}${engineSuspicion.label}${engineSuspicion.effect}`), '怀疑度玩家文案不应含英文状态或 HTML 实体');
assert(getScenarioPhaseLabel('investigation') === '调查' && getScenarioPhaseLabel('unexpected') === '未知阶段', '阶段名不应泄露内部英文 ID');
assert(getSanLabel(35) === '动摇', 'SAN 质性标签应为中文');
assert(getGamePhaseLabel('STORY_PLAY') === '故事进行中' && getGameSubStateLabel('AWAITING_INPUT') === '等待行动', '顶栏阶段和状态不应显示内部英文枚举');

const healthy = getNpcCondition({ hp: 10, maxHp: 10, san: 55, maxSan: 60 });
const injured = getNpcCondition({ hp: 4, maxHp: 10, san: 35, maxSan: 60 });
const unknown = getNpcCondition({ hp: null, maxHp: null, san: null, maxSan: null });
assert(healthy === '无明显伤势 | 稳定', '健康 NPC 应只显示质性状态');
assert(injured === '重伤 | 动摇', '受伤 NPC 应只显示质性状态');
assert(unknown === '状态不明', '任一关键数值未知时应统一显示状态不明');
assert(!/[0-9]|\b(?:HP|SAN)\b/.test(`${healthy}${injured}${unknown}`), '非玩家状态文本不应包含数字 HP/SAN');

const presentationSession = {
  locations: [{ id: 'loc_001', name: '头等包厢外' }],
  npcs: [
    { id: 'npc_001', name: '沈岐医生', visibility: 'visible' },
    { id: 'npc_003', name: '程岳', visibility: 'hidden' },
  ],
  inventory: [{ id: 'item_001', name: '顾言的录音' }],
  evidence: [{ id: 'evidence_001', source: '包厢门锁' }],
  scenarioRules: { clueCatalog: { evidence_001: { source: '包厢门锁' } } },
};
const unsafe = {
  narration: '你在头等包厢外（loc_001）看见npc_001，隐藏者npc_003没有现身。 &#x20;',
  locations: [], npcs: [], items: [], actions: null,
  options: ['A. 检查门锁（evidence_001）', 'B. 播放item_001', 'C. 留在loc_001', 'D. 自由行动'],
  current_location_id: 'loc_001',
  evidence_changes: [{ id: 'evidence_001', secured: false }],
  active_event_ack: null,
};
const safe = playerFacingTextSanitizer.sanitizeParsed(presentationSession, unsafe);
assert(!/(?:loc|evidence|npc|item)_\d{3}|&#x20;/.test(`${safe.narration}${safe.options.join('')}`), 'normal narration and choices should contain no internal IDs or literal spacing entities');
assert(safe.options[0].includes('包厢门锁') && safe.narration.includes('沈岐医生') && safe.narration.includes('某人'), 'known visible IDs should become readable names while hidden IDs remain anonymous');
assert(safe.current_location_id === 'loc_001' && safe.evidence_changes[0].id === 'evidence_001', 'sanitizing presentation must preserve structured engine IDs');

const restored = {
  ...presentationSession,
  optionBuffer: 'A. 前往头等包厢外（loc_001）检查evidence_001',
  displayLog: [{ role: 'kp', content: '<div>前往loc_001并检查evidence_001 &#x20;</div>' }],
  chatRecord: [{ role: 'kp', content: '询问npc_001' }],
};
sanitizePlayerPresentation(restored);
assert(!/(?:loc|evidence|npc|item)_\d{3}|&#x20;/.test(`${restored.optionBuffer}${restored.displayLog[0].content}${restored.chatRecord[0].content}`), 'restored browser presentation should be sanitized before it is rendered');
assert(!restored.optionBuffer.includes('头等包厢外（头等包厢外）'), 'restored redundant parenthesized IDs should be removed rather than duplicated');

console.log(`${passed} passed`);
