import { FlowType } from '../domain/enums.js';
import { CARD_KEY, buildCharacterSchemaText } from '../domain/CharacterCardSchema.js';
import {
  buildStoryOpeningSchemaText, buildNarrativeSchemaText, NARRATION, SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION,
} from '../domain/NarrativeSchema.js';

// ── 通用前缀 ──
const BASE_INTRO = `我在尝试一种新型的AI跑团，旨在通过结合AI创作与跑团游戏元素，创造出文学性与娱乐性并重的RPG体验。
你既是CoC7th规则下的KP，又是文学剧本创作者。`;

// ── 各阶段 JSON 输出格式 Schema ──
// DeepSeek 的 response_format: { type: "json_object" } 不支持传入自定义 schema，
// 因此具体格式需通过 system prompt 明确告知 LLM。

const WORLD_SCHEMA = `{
  "${WORLD_IMPRESSION}": "世界观印象文本，800-1000 字",
  "${KEY_DESCRIPTION}": "世界观关键词/摘要，200字以内，概括世界观核心要点"
}`;

const CHARACTER_SCHEMA = buildCharacterSchemaText();

const STORY_OPENING_SCHEMA = buildStoryOpeningSchemaText();

const NARRATIVE_SCHEMA = buildNarrativeSchemaText();

const SUMMARY_SCHEMA = `{
  "${SUMMARY}": "剧情总结文本，800-1000 字"
}`;

// 辅助：生成格式提示文本
function fmt(schema) {
  return `你的输出必须是一个合法的 JSON 对象。请严格按照以下 JSON 格式输出，不要输出任何 JSON 以外的内容（不要用 markdown 代码块包裹）：

${schema}`;
}

// ── 世界设定 ──
const WORLD_INSTRUCTION = `${BASE_INTRO}
现在我们先创建世界，请根据用户输入的文段生成世界观印象。为了营造代入感与沉浸感，你可以创造性地尝试环境切入/普通人视角/传说歌谣/对话切入/电影蒙太奇等手法的有机结合，撰写一篇连贯的文段。

${fmt(WORLD_SCHEMA)}`;

// ── 人物设定 ──
const CHARACTER_RULES = `以下为数值计算规则：
1. 根据用户描述/世界观/CoC7th规则合理补全，属性与技能要符合职业等人物设定
2. 8大属性点总和为600，单项属性在15-90之间
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
现在我们要创建玩家的人物设定。

${CHARACTER_RULES}

${fmt(CHARACTER_SCHEMA)}`;

// ── 关键角色设定 ──
const KEY_CHARACTER_INSTRUCTION = `${BASE_INTRO}
现在我们要创建一个关键角色的人物设定。该角色不是玩家，但可能是玩家的冒险伙伴、故事关键NPC、幻想伴侣等。
请根据用户描述、世界观背景等，为该角色创建完整的人物档案。

${CHARACTER_RULES}

${fmt(CHARACTER_SCHEMA)}`;

// ── 故事开幕 ──
const STORY_OPENING_INSTRUCTION = `${BASE_INTRO}
现在，请撰写一个符合设定、有代入感的跑团故事开幕。

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
投掷结果的回应要模仿游戏口吻，例如"【使用..技能（技能点x），判定结果y，大失败/一般失败/成功/困难成功/极难成功/大成功等】"，然后承接剧情。

若剧情中仍需进行新一轮投掷判定，请选择格式 B（附带 "dice" 字段）；否则选择格式 A。

${fmt(NARRATIVE_SCHEMA)}`;

// ── 历史总结 ──
const SUMMARY_INSTRUCTION = `你是跑团KP，现在需要帮我总结迄今剧情。你给出的总结要保证自己后续
可以通过该总结正常推进跑团进程，保证故事的合理性，暗示故事可能的伏笔。总结请控制在 800-1000 字。

${fmt(SUMMARY_SCHEMA)}`;

// ── temperature / max_tokens 配置 ──
export const FLOW_TEMPERATURE = {
  [FlowType.WORLD_GEN]: 0.7,
  [FlowType.CHARACTER_GEN]: 0.2,
  [FlowType.KEY_CHARACTER_GEN]: 0.2,
  [FlowType.STORY_OPENING]: 0.7,
  [FlowType.NARRATION_I]: 0.8,
  [FlowType.NARRATION_II]: 0.7,
  [FlowType.HISTORY_SUMMARY]: 0.3,
};

export const FLOW_MAX_TOKENS = {
  [FlowType.WORLD_GEN]: 4096,
  [FlowType.CHARACTER_GEN]: 4096,
  [FlowType.KEY_CHARACTER_GEN]: 4096,
  [FlowType.STORY_OPENING]: 2048,
  [FlowType.NARRATION_I]: 4096,
  [FlowType.NARRATION_II]: 4096,
  [FlowType.HISTORY_SUMMARY]: 3000,
};

// ── thinking 模式配置（DeepSeek V3.2+ 支持） ──
// 全阶段开启，提升逻辑严谨性与文学质量
export const FLOW_THINKING = {
  [FlowType.WORLD_GEN]: true,
  [FlowType.CHARACTER_GEN]: true,
  [FlowType.KEY_CHARACTER_GEN]: true,
  [FlowType.STORY_OPENING]: true,
  [FlowType.NARRATION_I]: true,
  [FlowType.NARRATION_II]: true,
  [FlowType.HISTORY_SUMMARY]: true,
};

// ── stop 序列配置 ──
// JSON 模式下防止 LLM 在闭合 } 后继续生成废话
export const FLOW_STOP = {
  [FlowType.WORLD_GEN]: null,
  [FlowType.CHARACTER_GEN]: null,
  [FlowType.KEY_CHARACTER_GEN]: null,
  [FlowType.STORY_OPENING]: null,
  [FlowType.NARRATION_I]: null,
  [FlowType.NARRATION_II]: null,
  [FlowType.HISTORY_SUMMARY]: null,
};

// ── 输出格式 field 名（用于 JSON parse 后验证关键字段） ──
export const FLOW_REQUIRED_FIELD = {
  [FlowType.WORLD_GEN]: WORLD_IMPRESSION,
  [FlowType.CHARACTER_GEN]: CARD_KEY,
  [FlowType.KEY_CHARACTER_GEN]: CARD_KEY,
  [FlowType.STORY_OPENING]: NARRATION,
  [FlowType.NARRATION_I]: NARRATION,
  [FlowType.NARRATION_II]: NARRATION,
  [FlowType.HISTORY_SUMMARY]: SUMMARY,
};

const templates = {
  [FlowType.WORLD_GEN]: { systemInstruction: WORLD_INSTRUCTION },
  [FlowType.CHARACTER_GEN]: { systemInstruction: CHARACTER_INSTRUCTION },
  [FlowType.KEY_CHARACTER_GEN]: { systemInstruction: KEY_CHARACTER_INSTRUCTION },
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
