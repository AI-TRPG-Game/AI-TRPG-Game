import { DiceService } from '../src/services/DiceService.js';

const dice = new DiceService();
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// === rollFormula 测试 ===

// 基本 1d6
const r1 = dice.rollFormula('1d6');
assert(r1 >= 1 && r1 <= 6, `1d6 应在 1-6 范围内，实际=${r1}`);

// 1d100
const r2 = dice.rollFormula('1d100');
assert(r2 >= 1 && r2 <= 100, `1d100 应在 1-100 范围内，实际=${r2}`);

// 2d6+1（最小3，最大13）
const r3 = dice.rollFormula('2d6+1');
assert(r3 >= 3 && r3 <= 13, `2d6+1 应在 3-13 范围内，实际=${r3}`);

// 1d4+2（最小3，最大6）
const r4 = dice.rollFormula('1d4+2');
assert(r4 >= 3 && r4 <= 6, `1d4+2 应在 3-6 范围内，实际=${r4}`);

// 1d3
const r5 = dice.rollFormula('1d3');
assert(r5 >= 1 && r5 <= 3, `1d3 应在 1-3 范围内，实际=${r5}`);

// 无效公式应抛错
try {
  dice.rollFormula('invalid');
  assert(false, '无效公式应抛错');
} catch {
  assert(true, '无效公式正确抛错');
}

// === rollWithBonusPenalty 测试 ===

// 无奖励/惩罚骰 = 普通 1d100
const r6 = dice.rollWithBonusPenalty(0, 0);
assert(r6.value >= 1 && r6.value <= 100, `普通 1d100 应在 1-100 范围内，实际=${r6.value}`);
assert(r6.tens.length === 1, `普通投掷应有 1 个十位骰，实际=${r6.tens.length}`);

// 1 个奖励骰：取较小十位
const r7 = dice.rollWithBonusPenalty(1, 0);
assert(r7.value >= 1 && r7.value <= 100, `奖励骰 1d100 应在 1-100 范围内，实际=${r7.value}`);
assert(r7.tens.length === 2, `1 奖励骰应有 2 个十位骰，实际=${r7.tens.length}`);
assert(r7.usedTensIndex === r7.tens.indexOf(Math.min(...r7.tens)), '奖励骰应取较小十位');

// 1 个惩罚骰：取较大十位
const r8 = dice.rollWithBonusPenalty(0, 1);
assert(r8.value >= 1 && r8.value <= 100, `惩罚骰 1d100 应在 1-100 范围内，实际=${r8.value}`);
assert(r8.tens.length === 2, `1 惩罚骰应有 2 个十位骰，实际=${r8.tens.length}`);
assert(r8.usedTensIndex === r8.tens.indexOf(Math.max(...r8.tens)), '惩罚骰应取较大十位');

// 2 个奖励骰
const r9 = dice.rollWithBonusPenalty(2, 0);
assert(r9.tens.length === 3, `2 奖励骰应有 3 个十位骰，实际=${r9.tens.length}`);

// 超过 2 个应钳制为 2
const r10 = dice.rollWithBonusPenalty(5, 0);
assert(r10.tens.length === 3, `5 奖励骰应钳制为 2（共 3 个十位骰），实际=${r10.tens.length}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
