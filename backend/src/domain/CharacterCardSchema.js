/**
 * CharacterCardSchema —— 角色档案 JSON 键名常量 & 工具函数。
 *
 * 所有消费者（PromptTemplateRegistry / SaveExtractor / TextRefiner / JsonOutputParser）
 * 统一引用此模块，不再各自硬编码字段名。修改字段名只需改这一处。
 */

// ── 顶层键名 ──
export const CARD_KEY = '角色档案';
export const NAME = '姓名';
export const AGE = '年龄';
export const GENDER = '性别';
export const OCCUPATION = '职业';
export const PERSONALITY = '性格描述';
export const PORTRAIT = '人物肖像与重要经历';
export const ATTRIBUTES_KEY = '属性';
export const HP = 'hp';
export const SAN = 'san';
export const CREDIT_RATING = '信用评级';
export const OCCUPATIONAL_SKILLS = '本职技能';
export const PERSONAL_SKILLS = '非本职技能';
export const INVENTORY = '随身物品';
export const SKILL_NAME = '技能名';
export const SKILL_VALUE = '点数';

// ── 属性子字段 ──
export const ATTR_STRENGTH = '力量';
export const ATTR_DEXTERITY = '敏捷';
export const ATTR_CONSTITUTION = '体质';
export const ATTR_SIZE = '体型';
export const ATTR_APPEARANCE = '外貌';
export const ATTR_INTELLIGENCE = '智力';
export const ATTR_WILLPOWER = '意志';
export const ATTR_EDUCATION = '教育';

/** 属性遍历：[[显示名, 键名], ...] */
export const ATTR_LIST = [
  [ATTR_STRENGTH, ATTR_STRENGTH],
  [ATTR_DEXTERITY, ATTR_DEXTERITY],
  [ATTR_CONSTITUTION, ATTR_CONSTITUTION],
  [ATTR_SIZE, ATTR_SIZE],
  [ATTR_APPEARANCE, ATTR_APPEARANCE],
  [ATTR_INTELLIGENCE, ATTR_INTELLIGENCE],
  [ATTR_WILLPOWER, ATTR_WILLPOWER],
  [ATTR_EDUCATION, ATTR_EDUCATION],
];

// ── Prompt 模板生成 ──

/** 生成 CHARACTER_SCHEMA 提示文本（用于 system prompt） */
export function buildCharacterSchemaText() {
  return `{
  "${CARD_KEY}": {
    "${NAME}": "<string>",
    "${AGE}": <number>,
    "${GENDER}": "<string>",
    "${OCCUPATION}": "<string>",
    "${PERSONALITY}": "<string>",
    "${PORTRAIT}": "<string>",
    "${ATTRIBUTES_KEY}": {
      "${ATTR_STRENGTH}": <number>, "${ATTR_DEXTERITY}": <number>, "${ATTR_CONSTITUTION}": <number>,
      "${ATTR_SIZE}": <number>, "${ATTR_APPEARANCE}": <number>, "${ATTR_INTELLIGENCE}": <number>,
      "${ATTR_WILLPOWER}": <number>, "${ATTR_EDUCATION}": <number>
    },
    "${HP}": <number>,
    "${SAN}": <number>,
    "${CREDIT_RATING}": <number>,
    "${OCCUPATIONAL_SKILLS}": [
      { "${SKILL_NAME}": "<string>", "${SKILL_VALUE}": <number> }
    ],
    "${PERSONAL_SKILLS}": [
      { "${SKILL_NAME}": "<string>", "${SKILL_VALUE}": <number> }
    ],
    "${INVENTORY}": ["<string>"]
  }
}

说明：
- 所有 <number> 字段请根据 CoC7th 数值计算规则自行计算，不要套用示例值
- 所有 <string> 字段请根据用户描述和世界观合理创作
- ${OCCUPATIONAL_SKILLS} 为 8 个本职技能，${PERSONAL_SKILLS} 为 4 个非本职技能
- 每个技能元素包含"${SKILL_NAME}"和"${SKILL_VALUE}"两个字段`;
}

// ── 序列化接口 ──

/**
 * 从解析后的角色档案 JSON 对象中安全读取字段值。
 * @param {object} card - parsed[CARD_KEY]
 * @param {string} key  - 字段键名
 * @param {*}      defaultValue
 */
export function getCardField(card, key, defaultValue = undefined) {
  return card?.[key] !== undefined ? card[key] : defaultValue;
}

/** 判断角色档案是否有指定顶层键 */
export function hasCardKey(parsed) {
  return !!(parsed && parsed[CARD_KEY] && typeof parsed[CARD_KEY] === 'object');
}
