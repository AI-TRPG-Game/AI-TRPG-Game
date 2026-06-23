import { FlowType } from '../domain/enums.js';

// ── 通用前缀 ──
const BASE_INTRO = `我在尝试一种新型的AI跑团，旨在通过结合AI创作与跑团游戏元素，
创造出文学性与娱乐性并重的RPG体验。请你根据CoC7th规则，扮演KP，辅助我完成跑团。`;

// ── 各阶段 JSON 输出格式 Schema ──
// DeepSeek 的 response_format: { type: "json_object" } 不支持传入自定义 schema，
// 因此具体格式需通过 system prompt 明确告知 LLM。

const WORLD_SCHEMA = `{
  "world_description": "世界观描述文本，300字以内"
}`;

const CHARACTER_SCHEMA = `{
  "character_card": {
    "name": "姓名",
    "age": 42,
    "gender": "性别",
    "occupation": "职业",
    "personality": "性格描述",
    "portrait": "人物肖像与重要经历",
    "attributes": {
      "strength": 50, "dexterity": 50, "constitution": 60,
      "size": 55, "appearance": 40, "intelligence": 60,
      "willpower": 65, "education": 80
    },
    "hp": 11,
    "san": 65,
    "credit_rating": 20,
    "occupational_skills": [
      { "name": "技能名", "value": 60 }
    ],
    "personal_skills": [
      { "name": "技能名", "value": 40 }
    ],
    "inventory": ["随身物品1", "随身物品2"]
  }
}

说明：
- occupational_skills 为 8 个本职技能，personal_skills 为 4 个非本职技能
- 每个技能元素包含 name（技能名）和 value（点数）`;

const STORY_OPENING_SCHEMA = `{
  "narration": "开幕叙述文本",
  "locations": [
    { "name": "地点名", "description": "描述" }
  ],
  "npcs": [
    { "name": "NPC名", "description": "描述" }
  ],
  "items": [
    { "name": "物品名", "status": "已获得 或 已失去", "description": "描述" }
  ],
  "options": [
    "A. 选项内容",
    "B. 选项内容",
    "C. 选项内容",
    "D. 自由行动"
  ]
}

说明：
- locations / npcs / items 若无相应内容，设为空数组 []
- items 中每个元素必须标明 status（已获得 / 已失去）
- NPC 需为新出场人物或有重要状态更新的旧人物
- options 必须恰好包含 4 个元素，以 A. B. C. D. 开头，最后一个固定为"D. 自由行动"`;

const NARRATIVE_SCHEMA = `格式 A —— 不需要投掷判定，正常叙事：
{
  "narration": "叙述文本",
  "locations": [
    { "name": "地点名", "description": "描述" }
  ],
  "npcs": [
    { "name": "NPC名", "description": "描述" }
  ],
  "items": [
    { "name": "物品名", "status": "已获得 或 已失去", "description": "描述" }
  ],
  "hp": null,
  "san": null,
  "options": [
    "A. 选项内容",
    "B. 选项内容",
    "C. 选项内容",
    "D. 自由行动"
  ]
}

格式 B —— 需要投掷判定（此时不需要 locations/npcs/items/hp/san/options 字段）：
{
  "narration": "叙述文本（需要判定的地方用【】标注）",
  "dice": {
    "skill_name": "技能名",
    "skill_point": 60,
    "notation": "1d100",
    "success_rate": 50
  }
}

说明：
- hp / san 若无变化设为 null，不要省略
- locations / npcs / items 若本轮无新内容，设为空数组 []，不要编造
- options 必须恰好包含 4 个元素，最后一个固定为"D. 自由行动"`;

const SUMMARY_SCHEMA = `{
  "summary": "总结文本，300字以内"
}`;

// 辅助：生成格式提示文本
function fmt(schema) {
  return `你的输出必须是一个合法的 JSON 对象。请严格按照以下 JSON 格式输出，不要输出任何 JSON 以外的内容（不要用 markdown 代码块包裹）：

${schema}`;
}

// ── 世界设定 ──
const WORLD_INSTRUCTION = `${BASE_INTRO}
现在我们先创建世界，根据用户输入的文段生成文风恰切、有代入感的世界观描述。

${fmt(WORLD_SCHEMA)}`;

// ── 人物设定 ──
const CHARACTER_RULES = `以下为数值计算规则：
1. 根据用户描述/世界观/CoC7th规则合理补全，属性与技能要符合职业等人物设定
2. 8大属性点总和为460，单项属性在15-90之间
3. HP=（体质+体型）%10，SAN=意志
4. 各类技能（包括信用评级）的点数计算规则为基础+职业+兴趣，基础值固定
5. 职业技能点只能分配给本职技能和信用评级，兴趣技能点可分配给所有技能（信用评级除外）
6. 信用评级基础值为0，代表财富与社会地位，要符合职业设定，且占用职业技能点
7. 单项本职技能点数不超过80，非本职技能不超过50
8. 所有职业的基础数值由时代背景下普通人样貌决定，与角色本身无关；基础数值有4档：0为克苏鲁神话和信用评级，1为普通人一般接触不到的技能，10为普通人偶尔用到/一般熟悉的技能，25为生活技能或生物本能
9. 职业技能点总和=教育*4 或 教育*2+力量*2 等，根据职业决定计算方式
10. 兴趣技能点总和=智力*2
11. 核查数值计算，注意不要把技能基础点数计入职业技能点与兴趣技能点总和的限制`;

const CHARACTER_INSTRUCTION = `${BASE_INTRO}
现在我们要创建主角的人物设定。

${CHARACTER_RULES}

${fmt(CHARACTER_SCHEMA)}`;

// ── 故事开幕 ──
const STORY_OPENING_INSTRUCTION = `${BASE_INTRO}
现在，请为我撰写一个符合设定、有代入感的跑团故事开幕。

${fmt(STORY_OPENING_SCHEMA)}`;

// ── 叙述I ──
const NARRATION_I_INSTRUCTION = `${BASE_INTRO}
现在，你作为KP，需要根据玩家行为推进剧情。

若剧情中需要进行技能/属性投掷判定，请选择格式 B（附带 "dice" 字段，需要填写 skill_name / skill_point / notation / success_rate）。
如果不附带 "dice" 字段，则选择格式 A（包含完整的 narration + locations/npcs/items/hp/san/options）。

${fmt(NARRATIVE_SCHEMA)}`;

// ── 叙述II ──
const NARRATION_II_INSTRUCTION = `${BASE_INTRO}
现在，你作为KP，需要根据投掷结果推进剧情。
投掷结果的回应要模仿游戏口吻，例如"【使用..技能（技能点x），判定结果y，大失败/一般失败/成功/困难成功/大成功等】"，然后承接剧情。

若剧情中仍需进行新一轮投掷判定，请选择格式 B（附带 "dice" 字段）；否则选择格式 A。

${fmt(NARRATIVE_SCHEMA)}`;

// ── 历史总结 ──
const SUMMARY_INSTRUCTION = `你是跑团KP，现在需要帮我总结迄今剧情。你给出的总结要保证自己后续
可以通过该总结正常推进跑团进程，保证故事的合理性，暗示故事可能的伏笔。

${fmt(SUMMARY_SCHEMA)}`;

// ── temperature / max_tokens 配置 ──
export const FLOW_TEMPERATURE = {
  [FlowType.WORLD_GEN]: 0.3,
  [FlowType.CHARACTER_GEN]: 0.2,
  [FlowType.STORY_OPENING]: 0.7,
  [FlowType.NARRATION_I]: 0.8,
  [FlowType.NARRATION_II]: 0.7,
  [FlowType.HISTORY_SUMMARY]: 0.3,
};

export const FLOW_MAX_TOKENS = {
  [FlowType.WORLD_GEN]: 1024,
  [FlowType.CHARACTER_GEN]: 4096,
  [FlowType.STORY_OPENING]: 2048,
  [FlowType.NARRATION_I]: 4096,
  [FlowType.NARRATION_II]: 4096,
  [FlowType.HISTORY_SUMMARY]: 800,
};

// ── thinking 模式配置（DeepSeek V3.2+ 支持） ──
// 叙事阶段启用思考模式提升逻辑严谨性
export const FLOW_THINKING = {
  [FlowType.WORLD_GEN]: false,
  [FlowType.CHARACTER_GEN]: false,
  [FlowType.STORY_OPENING]: true,
  [FlowType.NARRATION_I]: true,
  [FlowType.NARRATION_II]: true,
  [FlowType.HISTORY_SUMMARY]: false,
};

// ── stop 序列配置 ──
// JSON 模式下防止 LLM 在闭合 } 后继续生成废话
export const FLOW_STOP = {
  [FlowType.WORLD_GEN]: null,
  [FlowType.CHARACTER_GEN]: null,
  [FlowType.STORY_OPENING]: null,
  [FlowType.NARRATION_I]: null,
  [FlowType.NARRATION_II]: null,
  [FlowType.HISTORY_SUMMARY]: null,
};

// ── 输出格式 field 名（用于 JSON parse 后验证关键字段） ──
export const FLOW_REQUIRED_FIELD = {
  [FlowType.WORLD_GEN]: 'world_description',
  [FlowType.CHARACTER_GEN]: 'character_card',
  [FlowType.STORY_OPENING]: 'narration',
  [FlowType.NARRATION_I]: 'narration',
  [FlowType.NARRATION_II]: 'narration',
  [FlowType.HISTORY_SUMMARY]: 'summary',
};

const templates = {
  [FlowType.WORLD_GEN]: { systemInstruction: WORLD_INSTRUCTION },
  [FlowType.CHARACTER_GEN]: { systemInstruction: CHARACTER_INSTRUCTION },
  [FlowType.STORY_OPENING]: { systemInstruction: STORY_OPENING_INSTRUCTION },
  [FlowType.NARRATION_I]: { systemInstruction: NARRATION_I_INSTRUCTION },
  [FlowType.NARRATION_II]: { systemInstruction: NARRATION_II_INSTRUCTION },
  [FlowType.HISTORY_SUMMARY]: { systemInstruction: SUMMARY_INSTRUCTION },
};

export class PromptTemplateRegistry {
  getTemplate(flowType) {
    const template = templates[flowType];
    if (!template) throw new Error(`Unknown flow type: ${flowType}`);
    return { ...template };
  }
}

export const promptTemplateRegistry = new PromptTemplateRegistry();
