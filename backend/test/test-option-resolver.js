import { optionResolver } from '../src/services/OptionResolver.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const buffer = 'A. 检查包厢门锁\nB. 询问许薇\nC. 搜查顾言的行李\nD. 自由行动';
assert(optionResolver.resolve('选项C', buffer) === '搜查顾言的行李', 'option C should resolve to its exact text');
assert(optionResolver.resolve('选项A和C', buffer) === '检查包厢门锁；搜查顾言的行李', 'combined options should preserve selected order');
assert(optionResolver.resolve('选项C，然后询问许薇', buffer) === '搜查顾言的行李。然后询问许薇', 'free-text additions should follow the resolved option');
assert(optionResolver.resolve('调查行李车', buffer) === '调查行李车', 'free-text actions should not be rewritten');
assert(optionResolver.resolve('选项Z', buffer) === '选项Z', 'unknown options should remain visible for safe handling');

console.log(`${passed} passed`);
