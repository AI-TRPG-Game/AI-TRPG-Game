/**
 * StrictSchemaRegistry —— DeepSeek strict 模式（Function Calling）的 JSON Schema 定义。
 *
 * 基于 DeepSeek 官方文档 https://api-docs.deepseek.com/zh-cn/guides/tool_calls：
 * - 严格的 JSON Schema 校验，服务端强制
 * - 每个 object 的所有属性必须 required + additionalProperties: false
 * - 支持 object/string/number/integer/boolean/array/enum/anyOf/$ref+$def
 * - 不支持 minLength/maxLength/minItems/maxItems
 *
 * 各 FlowType 的 schema 通过 buildXxxStrictSchema() 返回 JS 对象，
 * 由 InputAssembler 透传给 OpenAICompatibleProvider，最终放入 tools 参数。
 */
import { FlowType } from '../domain/enums.js';
import {
  NARRATION, LOCATIONS, NPCS, ITEMS, OPTIONS, HP, SAN, DICE,
  SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION,
  ENTITY_ID, ENTITY_NAME, ENTITY_DESC, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE,
  ITEM_STATUS,
  DICE_SKILL_NAME, DICE_SKILL_POINT, DICE_NOTATION, DICE_SUCCESS_RATE,
} from '../domain/NarrativeSchema.js';
import {
  CARD_KEY, NAME, AGE, GENDER, OCCUPATION, PERSONALITY, PORTRAIT,
  ATTRIBUTES_KEY, CREDIT_RATING, OCCUPATIONAL_SKILLS, PERSONAL_SKILLS, INVENTORY,
  SKILL_NAME, SKILL_VALUE,
  ATTR_STRENGTH, ATTR_DEXTERITY, ATTR_CONSTITUTION, ATTR_SIZE,
  ATTR_APPEARANCE, ATTR_INTELLIGENCE, ATTR_WILLPOWER, ATTR_EDUCATION,
} from './CharacterCardSchema.js';

// ── 可空字段通用 helper：允许 string 或 null ──
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableInteger = (min, max) => ({
  anyOf: [
    { type: 'integer', minimum: min, maximum: max },
    { type: 'null' },
  ],
});

// ── 实体 id 字段：带 pattern 约束的 string，或 null（新建） ──
function entityIdField(prefix) {
  return {
    anyOf: [
      { type: 'string', pattern: `^${prefix}_\\d{3}$` },
      { type: 'null' },
    ],
  };
}

// ── 共享：location 子 schema ──
const locationItemSchema = {
  type: 'object',
  properties: {
    [ENTITY_ID]: entityIdField('loc'),
    [ENTITY_NAME]: { type: 'string' },
    [ENTITY_DESC]: { type: 'string' },
  },
  required: [ENTITY_ID, ENTITY_NAME, ENTITY_DESC],
  additionalProperties: false,
};

// ── 共享：npc 子 schema（含 importance enum） ──
const npcItemSchema = {
  type: 'object',
  properties: {
    [ENTITY_ID]: entityIdField('npc'),
    [ENTITY_NAME]: { type: 'string' },
    [ENTITY_BASE_DESC]: { type: 'string', description: '稳定人设，仅 id=null 时填写；id 非 null 时留空字符串' },
    [ENTITY_CURRENT_STATE]: { type: 'string', description: '动态状态，可留空字符串' },
    importance: {
      type: 'string',
      enum: ['key', 'supporting', 'background'],
      description: '重要性：key=主角/关键NPC/推动剧情者；supporting=有名字有台词的配角；background=路人/酒客等背景角色（不要加入 npcs 数组，直接在 narration 中描写）',
    },
  },
  required: [ENTITY_ID, ENTITY_NAME, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE, 'importance'],
  additionalProperties: false,
};

// ── 共享：item 子 schema ──
const itemItemSchema = {
  type: 'object',
  properties: {
    [ENTITY_ID]: entityIdField('inv'),
    [ENTITY_NAME]: { type: 'string' },
    [ITEM_STATUS]: { type: 'string', enum: ['已获得', '已失去'] },
    [ENTITY_DESC]: { type: 'string' },
  },
  required: [ENTITY_ID, ENTITY_NAME, ITEM_STATUS, ENTITY_DESC],
  additionalProperties: false,
};

// ── 共享：dice 子 schema ──
const diceSchema = {
  type: 'object',
  properties: {
    [DICE_SKILL_NAME]: { type: 'string' },
    [DICE_SKILL_POINT]: { type: 'integer', minimum: 0, maximum: 100 },
    [DICE_NOTATION]: { type: 'string', pattern: '^\\d+d\\d+$' },
    [DICE_SUCCESS_RATE]: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: [DICE_SKILL_NAME, DICE_SKILL_POINT, DICE_NOTATION, DICE_SUCCESS_RATE],
  additionalProperties: false,
};

// ── 共享：options 数组（无法用 maxItems 约束长度，靠 prompt + 后端校验） ──
const optionsSchema = {
  type: 'array',
  items: { type: 'string' },
};

// ── 共享：可空的 options 数组（NARRATION_I/II 专用） ──
// 设计：当 LLM 触发判定（dice 非空）时，options 应为 null（用户先决定是否掷骰，不需要选项）；
//       当 dice 为 null（正常推进）时，options 应为恰好 4 个字符串
const nullableOptionsSchema = {
  anyOf: [
    { type: 'array', items: { type: 'string' } },
    { type: 'null' },
  ],
};

// ════════════════════════════════════════
// 各 FlowType 的 strict schema
// ════════════════════════════════════════

/** WORLD_GEN */
export function buildWorldGenStrictSchema() {
  return {
    type: 'object',
    properties: {
      [WORLD_IMPRESSION]: { type: 'string', description: '世界观印象文本，800-1000字' },
      [KEY_DESCRIPTION]: { type: 'string', description: '世界观关键词/摘要，200字以内' },
    },
    required: [WORLD_IMPRESSION, KEY_DESCRIPTION],
    additionalProperties: false,
  };
}

/** CHARACTER_GEN / KEY_CHARACTER_GEN */
export function buildCharacterGenStrictSchema() {
  return {
    type: 'object',
    properties: {
      [CARD_KEY]: {
        type: 'object',
        properties: {
          [NAME]: { type: 'string' },
          [AGE]: { type: 'integer', minimum: 1, maximum: 200 },
          [GENDER]: { type: 'string' },
          [OCCUPATION]: { type: 'string' },
          [PERSONALITY]: { type: 'string' },
          [PORTRAIT]: { type: 'string' },
          [ATTRIBUTES_KEY]: {
            type: 'object',
            properties: {
              [ATTR_STRENGTH]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_DEXTERITY]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_CONSTITUTION]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_SIZE]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_APPEARANCE]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_INTELLIGENCE]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_WILLPOWER]: { type: 'integer', minimum: 1, maximum: 99 },
              [ATTR_EDUCATION]: { type: 'integer', minimum: 1, maximum: 99 },
            },
            required: [ATTR_STRENGTH, ATTR_DEXTERITY, ATTR_CONSTITUTION, ATTR_SIZE, ATTR_APPEARANCE, ATTR_INTELLIGENCE, ATTR_WILLPOWER, ATTR_EDUCATION],
            additionalProperties: false,
          },
          [HP]: { type: 'integer', minimum: 0, maximum: 99 },
          [SAN]: { type: 'integer', minimum: 0, maximum: 99 },
          [CREDIT_RATING]: { type: 'integer', minimum: 0, maximum: 99 },
          [OCCUPATIONAL_SKILLS]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [SKILL_NAME]: { type: 'string' },
                [SKILL_VALUE]: { type: 'integer', minimum: 0, maximum: 80 },
              },
              required: [SKILL_NAME, SKILL_VALUE],
              additionalProperties: false,
            },
          },
          [PERSONAL_SKILLS]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [SKILL_NAME]: { type: 'string' },
                [SKILL_VALUE]: { type: 'integer', minimum: 0, maximum: 50 },
              },
              required: [SKILL_NAME, SKILL_VALUE],
              additionalProperties: false,
            },
          },
          [INVENTORY]: { type: 'array', items: { type: 'string' } },
        },
        required: [NAME, AGE, GENDER, OCCUPATION, PERSONALITY, PORTRAIT, ATTRIBUTES_KEY, HP, SAN, CREDIT_RATING, OCCUPATIONAL_SKILLS, PERSONAL_SKILLS, INVENTORY],
        additionalProperties: false,
      },
    },
    required: [CARD_KEY],
    additionalProperties: false,
  };
}

/**
 * 叙事超集 schema —— STORY_OPENING / NARRATION_I / NARRATION_II 共用
 *
 * 统一动机：原 STORY_OPENING 缺少 hp/san/dice 字段，与 NARRATION 格式不一致；
 *          统一后历史 assistant 消息可跨 flowType 复用 tool_calls 结构（方案 B+），
 *          且 STORY_OPENING 的 hp/san/dice 填 null 不影响语义（开幕无判定、无 HP/SAN 变化）。
 *
 * 格式A（无判定，正常推进）：dice 字段为 null，options 为 4 个字符串数组
 * 格式B（有判定，触发掷骰）：dice 字段填对象，options 为 null（用户先决定是否掷骰，不需要选项）
 * STORY_OPENING 场景：dice 为 null，hp/san 为 null，options 为 4 个字符串数组
 */
export function buildNarrationStrictSchema() {
  return {
    type: 'object',
    properties: {
      [NARRATION]: { type: 'string', description: '叙事文本；需要判定的地方用【】标注' },
      [LOCATIONS]: { type: 'array', items: locationItemSchema },
      [NPCS]: { type: 'array', items: npcItemSchema },
      [ITEMS]: { type: 'array', items: itemItemSchema },
      [HP]: nullableInteger(-99, 99),
      [SAN]: nullableInteger(-99, 99),
      [DICE]: {
        anyOf: [diceSchema, { type: 'null' }],
      },
      [OPTIONS]: nullableOptionsSchema,
    },
    required: [NARRATION, LOCATIONS, NPCS, ITEMS, HP, SAN, DICE, OPTIONS],
    additionalProperties: false,
  };
}

/** HISTORY_SUMMARY */
export function buildSummaryStrictSchema() {
  return {
    type: 'object',
    properties: {
      [SUMMARY]: { type: 'string', description: '剧情总结文本，800-1000字' },
    },
    required: [SUMMARY],
    additionalProperties: false,
  };
}

// ════════════════════════════════════════
// FlowType → schema 映射 + function name
// ════════════════════════════════════════

// FlowType → function name 映射（方案 B+：统一到 4 个函数名）
// 设计动机：跨 flowType 的历史 tool_calls 消息引用的函数名必须在当前请求的 tools 列表中存在。
//          原 7 个函数名会导致 STORY_OPENING 历史消息引用 output_story_opening，
//          而 NARRATION_I 请求的 tools 列表只有 output_narration_i，DeepSeek API 可能丢弃该消息。
//          统一到 4 个函数名后，STORY_OPENING / NARRATION_I / NARRATION_II 共用 output_narration，
//          历史消息的函数名始终在当前 tools 列表中找到，避免 API 兼容性问题。
// 导出供 InputAssembler 构造历史 assistant tool_calls 消息时复用
export const FLOW_FUNCTION_NAMES = {
  [FlowType.WORLD_GEN]: 'output_world',
  [FlowType.CHARACTER_GEN]: 'output_character',
  [FlowType.KEY_CHARACTER_GEN]: 'output_character',
  [FlowType.STORY_OPENING]: 'output_narration',
  [FlowType.NARRATION_I]: 'output_narration',
  [FlowType.NARRATION_II]: 'output_narration',
  [FlowType.HISTORY_SUMMARY]: 'output_summary',
};

const FLOW_FUNCTION_DESCRIPTIONS = {
  [FlowType.WORLD_GEN]: '输出世界观设定',
  [FlowType.CHARACTER_GEN]: '输出玩家角色档案',
  [FlowType.KEY_CHARACTER_GEN]: '输出关键角色档案',
  [FlowType.STORY_OPENING]: '输出跑团故事开幕（hp/san/dice 填 null）',
  [FlowType.NARRATION_I]: '输出叙事I结果（根据玩家行为推进剧情，含实体更新/HP/SAN/选项，或触发骰子判定）',
  [FlowType.NARRATION_II]: '输出叙事II结果（根据投掷结果推进剧情）',
  [FlowType.HISTORY_SUMMARY]: '输出剧情总结',
};

const FLOW_SCHEMA_BUILDERS = {
  [FlowType.WORLD_GEN]: buildWorldGenStrictSchema,
  [FlowType.CHARACTER_GEN]: buildCharacterGenStrictSchema,
  [FlowType.KEY_CHARACTER_GEN]: buildCharacterGenStrictSchema,
  [FlowType.STORY_OPENING]: buildNarrationStrictSchema,
  [FlowType.NARRATION_I]: buildNarrationStrictSchema,
  [FlowType.NARRATION_II]: buildNarrationStrictSchema,
  [FlowType.HISTORY_SUMMARY]: buildSummaryStrictSchema,
};

/**
 * 构造 strict 模式的 tools 参数。
 *
 * @param {FlowType} flowType
 * @returns {{ tools: Array, toolChoice: 'required' | null }}
 *
 * 关于 toolChoice：
 * - 官方文档：思考模式下不支持 tool_choice（API 会返回 400）
 * - 非思考模式下可使用 'required' 强制 LLM 调用至少一个 tool，避免 strict 失效（LLM 走 content 而非 tool_calls）
 * - 具体 tool 函数名已在 tools 中定义，LLM 自主选择；'required' 不指定具体函数
 *
 * 因此这里返回 toolChoice='required'，由 OpenAICompatibleProvider 根据思考模式开关决定是否透传
 */
export function buildStrictTools(flowType) {
  const builder = FLOW_SCHEMA_BUILDERS[flowType];
  if (!builder) {
    throw new Error(`No strict schema for flowType: ${flowType}`);
  }
  const name = FLOW_FUNCTION_NAMES[flowType];
  const description = FLOW_FUNCTION_DESCRIPTIONS[flowType] || '输出结果';
  const parameters = builder();

  return {
    tools: [{
      type: 'function',
      function: {
        name,
        strict: true,
        description,
        parameters,
      },
    }],
    toolChoice: 'required',
  };
}
