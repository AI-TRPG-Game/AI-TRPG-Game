import {
  getNpcCondition,
  getSanLabel,
  getScenarioPhaseLabel,
  getSuspicionDisplay,
} from '../../src/ui/ScenarioPresentation.mjs';
import { scenarioProgressService } from '../src/services/ScenarioProgressService.js';

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

const healthy = getNpcCondition({ hp: 10, maxHp: 10, san: 55, maxSan: 60 });
const injured = getNpcCondition({ hp: 4, maxHp: 10, san: 35, maxSan: 60 });
const unknown = getNpcCondition({ hp: null, maxHp: null, san: null, maxSan: null });
assert(healthy === '无明显伤势 | 稳定', '健康 NPC 应只显示质性状态');
assert(injured === '重伤 | 动摇', '受伤 NPC 应只显示质性状态');
assert(unknown === '状态不明', '任一关键数值未知时应统一显示状态不明');
assert(!/[0-9]|\b(?:HP|SAN)\b/.test(`${healthy}${injured}${unknown}`), '非玩家状态文本不应包含数字 HP/SAN');

console.log(`${passed} passed`);
