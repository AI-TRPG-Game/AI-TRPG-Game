import {
  buildStrictTools,
} from '../src/domain/StrictSchemaRegistry.js';
import { FlowType } from '../src/domain/enums.js';

let problems = 0;

function checkSchema(schema, path = 'root') {
  if (!schema || typeof schema !== 'object') return;

  // 检查 object 类型：properties 的 key 必须全部在 required 中
  if (schema.type === 'object' && schema.properties) {
    const props = Object.keys(schema.properties);
    const required = schema.required || [];

    // 检查1：properties 必须全部在 required 中（DeepSeek strict 核心约束）
    const missing = props.filter(p => !required.includes(p));
    if (missing.length > 0) {
      console.error(`[FAIL] ${path}: properties 不在 required 中: ${missing.join(', ')}`);
      problems++;
    }

    // 检查2：required 中的字段必须存在于 properties（反向校验，防止拼写错误）
    const extra = required.filter(r => !props.includes(r));
    if (extra.length > 0) {
      console.error(`[FAIL] ${path}: required 中存在 properties 没有的字段: ${extra.join(', ')}`);
      problems++;
    }

    // 检查3：object 必须设置 additionalProperties: false（DeepSeek strict 要求）
    if (schema.additionalProperties !== false) {
      console.error(`[FAIL] ${path}: object 缺少 additionalProperties: false`);
      problems++;
    }

    // 递归检查每个 property
    for (const key of props) {
      checkSchema(schema.properties[key], `${path}.properties.${key}`);
    }
  }

  // 检查 array 类型：递归检查 items
  if (schema.type === 'array' && schema.items) {
    checkSchema(schema.items, `${path}.items`);
  }

  // 检查 anyOf：递归检查每个子 schema
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((sub, i) => checkSchema(sub, `${path}.anyOf[${i}]`));
  }
}

const flowTypes = [
  FlowType.WORLD_GEN,
  FlowType.CHARACTER_GEN,
  FlowType.KEY_CHARACTER_GEN,
  FlowType.STORY_OPENING,
  FlowType.NARRATION_I,
  FlowType.NARRATION_II,
  FlowType.HISTORY_SUMMARY,
  FlowType.ENDING_GEN,
];

for (const ft of flowTypes) {
  console.log(`\n=== 检查 ${ft} ===`);
  const tools = buildStrictTools(ft);
  const params = tools.tools[0].function.parameters;
  checkSchema(params, ft);
}

console.log(`\n=== 总结 ===`);
if (problems === 0) {
  console.log('PASS: 所有 schema 的 properties 都在 required 中');
} else {
  console.error(`FAIL: 发现 ${problems} 个问题`);
  process.exit(1);
}
