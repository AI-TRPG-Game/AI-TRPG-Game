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
  NARRATION, LOCATIONS, NPCS, ITEMS, OPTIONS, HP, SAN,
  SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION,
  ENTITY_ID, ENTITY_NAME, ENTITY_DESC, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE,
  ITEM_STATUS,
  ACTIONS, ACTION_TYPE, SKILL_CHECK, SANCHECK, DIRECT,
  ON_SUCCESS, ON_FAIL, CHANGES, BONUS_DICE, PENALTY_DICE,
  TARGET, ATTR_FIELD, DICE_COUNT, DICE_SIDES, DICE_BONUS, EFFECT,
  TRIGGER, TRIGGER_PLAYER, TRIGGER_OTHERS,
  ON_CRITICAL_SUCCESS, ON_CRITICAL_FAILURE,
  ENDING_TYPE, ENDING_TEXT,
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

// ── 共享：npc 子 schema（含 importance enum + HP/SAN/visibility/status/attributes） ──
const npcItemSchema = {
  type: 'object',
  properties: {
    [ENTITY_ID]: entityIdField('npc'),
    [ENTITY_NAME]: { type: 'string' },
    [ENTITY_BASE_DESC]: { type: 'string', description: '稳定人设，75字以内；仅 id=null 时填写，id 非 null 时留空字符串' },
    [ENTITY_CURRENT_STATE]: { type: 'string', description: '动态状态，35字以内；可留空字符串' },
    importance: {
      type: 'string',
      enum: ['key', 'supporting'],
      description: 'key=主角/关键NPC/推动剧情者；supporting=配角。路人/背景角色不要加入 npcs 数组，直接在 narration 中描写',
    },
    // HP/SAN 相关字段
    hp: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: 99 }, { type: 'null' }],
      description: '当前 HP。仅首次出场时填写，后续轮次留 null',
    },
    maxHp: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 99 }, { type: 'null' }],
      description: '最大 HP。仅首次出场时填写',
    },
    san: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: 99 }, { type: 'null' }],
      description: '当前 SAN。仅首次出场时填写',
    },
    maxSan: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 99 }, { type: 'null' }],
      description: '最大 SAN。仅首次出场时填写',
    },
    visibility: {
      type: 'string',
      enum: ['visible', 'hidden'],
      description: "玩家是否可见 HP/SAN/属性。可随剧情更新（如神秘人现身 hidden→visible）。默认 'visible'",
    },
    // 注意：status 字段由系统设置（DamageResolver），LLM 不输出，故不放入 properties
    // （DeepSeek strict 模式要求 properties 必须全部在 required 中，若放入 status 则 LLM 被迫输出，与设计矛盾）
    // 8 大属性（仅 key 角色输出，supporting 留 null）
    attributes: {
      anyOf: [
        {
          type: 'object',
          properties: {
            力量: { type: 'integer', minimum: 1, maximum: 99 },
            敏捷: { type: 'integer', minimum: 1, maximum: 99 },
            体质: { type: 'integer', minimum: 1, maximum: 99 },
            体型: { type: 'integer', minimum: 1, maximum: 99 },
            外貌: { type: 'integer', minimum: 1, maximum: 99 },
            智力: { type: 'integer', minimum: 1, maximum: 99 },
            意志: { type: 'integer', minimum: 1, maximum: 99 },
            教育: { type: 'integer', minimum: 1, maximum: 99 },
          },
          required: ['力量', '敏捷', '体质', '体型', '外貌', '智力', '意志', '教育'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: '8 大属性对象。仅 importance=key 时填写（首次填入后锁定）；importance=supporting 时留 null',
    },
  },
  required: [ENTITY_ID, ENTITY_NAME, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE, 'importance',
             'hp', 'maxHp', 'san', 'maxSan', 'visibility', 'attributes'],
  // status 由系统设置，不在 required 中（LLM 不需要输出）
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

// === actions 字段相关 schema（替代 diceSchema） ===

// changeItem：on_success/on_fail/changes 数组的元素
const changeItemSchema = {
  type: 'object',
  properties: {
    [TARGET]: { type: 'string', description: "目标角色 ID，如 'player'（=npc_000）或 'npc_001'/'npc_102' 等" },
    [ATTR_FIELD]: { type: 'string', enum: ['hp', 'san'], description: '变化的属性' },
    [DICE_COUNT]: { type: 'integer', minimum: 0, maximum: 10, description: '骰子数量。0=固定值变化；≥1=投骰' },
    [DICE_SIDES]: { type: 'integer', minimum: 0, maximum: 100, description: '骰子面数。diceCount=0 时此字段填 0' },
    [DICE_BONUS]: { type: 'integer', minimum: 0, maximum: 99, description: '附加值。diceCount=0 时不可为0，代表固定变化值。' },
    [EFFECT]: { type: 'string', enum: ['damage', 'heal'], description: '伤害或治疗' },
  },
  required: [TARGET, ATTR_FIELD, DICE_COUNT, DICE_SIDES, DICE_BONUS, EFFECT],
  additionalProperties: false,
};

// skill_check action
const skillCheckActionSchema = {
  type: 'object',
  properties: {
    [ACTION_TYPE]: { type: 'string', enum: [SKILL_CHECK] },
    [TRIGGER]: {
      type: 'string',
      enum: [TRIGGER_PLAYER, TRIGGER_OTHERS],
      description: "触发来源：'player'=玩家主动声明使用技能；'others'=NPC 主动掷骰、玩家技能被动触发等",
    },
    skill_name: { type: 'string', description: '技能名称' },
    skill_point: { type: 'integer', minimum: 0, maximum: 100, description: '技能点数' },
    [BONUS_DICE]: { type: 'integer', minimum: 0, maximum: 2, description: '奖励骰数量（0-2）' },
    [PENALTY_DICE]: { type: 'integer', minimum: 0, maximum: 2, description: '惩罚骰数量（0-2）' },
    [ON_SUCCESS]: { type: 'array', items: changeItemSchema, description: '检定成功时生效的 HP/SAN 联级变化（可为空数组）' },
    [ON_FAIL]: { type: 'array', items: changeItemSchema, description: '检定失败时生效的 HP/SAN 联级变化（可为空数组）' },
    [ON_CRITICAL_SUCCESS]: { type: 'array', items: changeItemSchema, description: '大成功时生效的 HP/SAN 联级变化（可为空数组）' },
    [ON_CRITICAL_FAILURE]: { type: 'array', items: changeItemSchema, description: '大失败时生效的 HP/SAN 联级变化（可为空数组）' },
  },
  required: [ACTION_TYPE, TRIGGER, 'skill_name', 'skill_point', BONUS_DICE, PENALTY_DICE,
             ON_SUCCESS, ON_FAIL, ON_CRITICAL_SUCCESS, ON_CRITICAL_FAILURE],
  additionalProperties: false,
};

// sancheck action
const sancheckActionSchema = {
  type: 'object',
  properties: {
    [ACTION_TYPE]: { type: 'string', enum: [SANCHECK] },
    [TRIGGER]: {
      type: 'string',
      enum: [TRIGGER_OTHERS],
      description: "触发来源：固定为 'others'",
    },
    [TARGET]: { type: 'string', description: "检定目标，填玩家/npc的id" },
  },
  required: [ACTION_TYPE, TRIGGER, TARGET],
  additionalProperties: false,
};

// direct action
const directActionSchema = {
  type: 'object',
  properties: {
    [ACTION_TYPE]: { type: 'string', enum: [DIRECT] },
    [TRIGGER]: {
      type: 'string',
      enum: [TRIGGER_PLAYER, TRIGGER_OTHERS],
      description: "触发来源：'player'=玩家主动造成自身变化（如喝药水回血）；'others'=环境/NPC 直接造成变化（如陷阱伤害）",
    },
    [CHANGES]: { type: 'array', items: changeItemSchema, description: '直接变化列表（无检定）' },
  },
  required: [ACTION_TYPE, TRIGGER, CHANGES],
  additionalProperties: false,
};

// actions 数组（anyOf 三种类型；DeepSeek strict 不支持 oneOf）
const actionsSchema = {
  type: 'array',
  items: {
    anyOf: [skillCheckActionSchema, sancheckActionSchema, directActionSchema],
  },
};

// ── 共享：options 数组（无法用 maxItems 约束长度，靠 prompt + 后端校验） ──
const optionsSchema = {
  type: 'array',
  items: { type: 'string' },
};

// ── 共享：可空的 options 数组（NARRATION_I/II 专用） ──
// 设计：当 LLM 触发判定（actions 非空）时，options 应为 null（用户先决定是否掷骰，不需要选项）；
//       当 actions 为 null（正常推进）时，options 应为恰好 4 个字符串
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
          [PERSONALITY]: { type: 'string', description: '性格描述，50字以内' },
          [PORTRAIT]: { type: 'string', description: '人物肖像与重要经历，100字以内' },
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
 * 统一动机：原 STORY_OPENING 缺少 actions 字段，与 NARRATION 格式不一致；
 *          统一后历史 assistant 消息可跨 flowType 复用 tool_calls 结构（方案 B+），
 *          且 STORY_OPENING 的 actions 填 null 不影响语义（开幕无判定）。
 *
 * HP/SAN 变化全部走 actions 内的 changeItem（由 DamageResolver 计算），顶层无 hp/san 字段。
 *
 * 格式A（无判定，正常推进）：actions 字段为 null，options 为 4 个字符串数组
 * 格式B（有判定，触发掷骰）：actions 字段填数组，options 为 null（用户先决定是否掷骰，不需要选项）
 * STORY_OPENING 场景：actions 为 null，options 为 4 个字符串数组
 */
export function buildNarrationStrictSchema() {
  return {
    type: 'object',
    properties: {
      [NARRATION]: { type: 'string', description: '叙事文本' },
      [LOCATIONS]: { type: 'array', items: locationItemSchema },
      [NPCS]: { type: 'array', items: npcItemSchema },
      [ITEMS]: { type: 'array', items: itemItemSchema },
      [ACTIONS]: {
        anyOf: [actionsSchema, { type: 'null' }],
        description: '检定与变化数组。null=无检定（填 options）；非空数组=有检定（options 填 null）',
      },
      [OPTIONS]: nullableOptionsSchema,
    },
    required: [NARRATION, LOCATIONS, NPCS, ITEMS, ACTIONS, OPTIONS],
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

/** ENDING_GEN */
const endingGenStrictSchema = {
  type: 'object',
  properties: {
    [ENDING_TYPE]: {
      type: 'string',
      enum: ['death', 'madness'],
      description: "结局类型：'death'=HP 归零死亡结局，'madness'=SAN 归零疯狂结局",
    },
    [ENDING_TEXT]: {
      type: 'string',
      description: 'RPG 风格结局文本，如"达成 XXX 结局"。只描述结局，不提重新开始选项',
    },
  },
  required: [ENDING_TYPE, ENDING_TEXT],
  additionalProperties: false,
};

export function buildEndingGenStrictSchema() {
  return endingGenStrictSchema;
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
  [FlowType.ENDING_GEN]: 'output_ending',
};

const FLOW_FUNCTION_DESCRIPTIONS = {
  [FlowType.WORLD_GEN]: '输出世界观设定',
  [FlowType.CHARACTER_GEN]: '输出玩家角色档案',
  [FlowType.KEY_CHARACTER_GEN]: '输出关键角色档案',
  [FlowType.STORY_OPENING]: '输出跑团故事开幕（actions 填 null）',
  [FlowType.NARRATION_I]: '输出叙事I结果（根据玩家行为推进剧情，含实体更新/选项，或触发检定）',
  [FlowType.NARRATION_II]: '输出叙事II结果（根据投掷结果推进剧情）',
  [FlowType.HISTORY_SUMMARY]: '输出剧情总结',
  [FlowType.ENDING_GEN]: '生成 RPG 风格结局文本',
};

const FLOW_SCHEMA_BUILDERS = {
  [FlowType.WORLD_GEN]: buildWorldGenStrictSchema,
  [FlowType.CHARACTER_GEN]: buildCharacterGenStrictSchema,
  [FlowType.KEY_CHARACTER_GEN]: buildCharacterGenStrictSchema,
  [FlowType.STORY_OPENING]: buildNarrationStrictSchema,
  [FlowType.NARRATION_I]: buildNarrationStrictSchema,
  [FlowType.NARRATION_II]: buildNarrationStrictSchema,
  [FlowType.HISTORY_SUMMARY]: buildSummaryStrictSchema,
  [FlowType.ENDING_GEN]: buildEndingGenStrictSchema,
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
