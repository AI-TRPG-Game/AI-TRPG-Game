import { FlowType } from '../domain/enums.js';
import { buildEntityReferenceRules } from '../domain/NarrativeSchema.js';

// ── 通用前缀 ──
const BASE_INTRO = `我在尝试一种新型的AI跑团，旨在通过结合AI创作与跑团游戏元素，创造出文学性与娱乐性并重的RPG体验。
你既是CoC7th规则下的KP，又是文学剧本创作者。`;

// ── 通用输出格式约束 ──
// 设计原则（重要）：
// 1. strict 模式下，DeepSeek 服务端会按 JSON 规范自动转义字符串值（"→\"、换行→\n 等），
//    prompt 完全不需要教 LLM 如何转义。一旦在 prompt 中提到 \" 或 \\n，
//    LLM 反而会在字符串值里输出字面 \" 或 \\n 字符，破坏渲染。
// 2. 不要约束"字符串值必须是纯文本/不含 markdown"——这会让 LLM 困惑。
//    LLM 写文学叙事时自然会用换行分段，这是良性的，系统已能正确解析和渲染。
// 3. 这里只保留"通过调用指定函数返回 JSON"这一条核心要求（提醒 strict 模式职责）。
const PLAIN_TEXT_RULE = `【输出方式】
- 必须通过调用指定函数以 JSON 形式返回结果
- 不要在函数调用之外输出任何文本（不要寒暄、不要解释、不要 markdown、不要代码块）
- 你的全部输出都应该作为函数调用的 arguments，content 字段应为空`;

// ── 各阶段 strict 模式下的自然语言说明（schema 已通过 tools 强制，prompt 只描述语义） ──

const WORLD_INSTRUCTION = `${BASE_INTRO}
现在我们先创建世界，请根据用户输入的文段生成世界观印象。为了营造代入感与沉浸感，你可以创造性地尝试环境切入/普通人视角/传说歌谣/对话切入/电影蒙太奇等手法的有机结合，撰写一篇连贯的文段。

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_world 函数返回 JSON 结果，字段结构如下：
- world_impression：世界观印象文本，800-1000 字
- key_description：世界观关键词/摘要，200 字以内，概括世界观核心要点`;

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
现在我们要创建玩家的人物设定。

${CHARACTER_RULES}

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_character 函数返回 JSON 结果，字段结构如下：
- 角色档案.属性：8 大属性（力量/敏捷/体质/体型/外貌/智力/意志/教育），单项 15-90
- 角色档案.hp / san / 信用评级：0-99
- 角色档案.本职技能：8 个，每项点数 0-80
- 角色档案.非本职技能：4 个，每项点数 0-50
- 角色档案.随身物品：字符串数组
- 所有数值字段必须按 CoC7th 规则计算，不要套用示例值`;

const KEY_CHARACTER_INSTRUCTION = `${BASE_INTRO}
现在我们要创建一个关键角色的人物设定。该角色不是玩家，但可能是玩家的冒险伙伴、故事关键NPC、幻想伴侣等。
请根据用户描述、世界观背景等，为该角色创建完整的人物档案。

${CHARACTER_RULES}

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_character 函数返回 JSON 结果（字段结构与玩家角色相同）。`;

const STORY_OPENING_INSTRUCTION = `${BASE_INTRO}
现在，请撰写一个符合设定、有代入感的跑团故事开幕。

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_narration 函数返回 JSON 结果，字段结构如下：
- narration：开幕叙述文本，文学性强、有沉浸感
- locations / npcs / items：开幕场景中首次出场的实体（id 全部填 null，系统会自动分配）
  - npc 必须标注 importance 字段：
    - "key"：推动剧情的关键 NPC（如玩家追踪的目标、重要反派、关键线索人物）
    - "supporting"：有名字、有台词、对剧情有一定作用的配角（如酒馆老板、仆人）
    - "background"：路人/酒客/侍女等背景角色 —— 不要加入 npcs 数组，直接在 narration 中描写即可
  - npc.baseDescription：稳定人设（≤20字），仅本次填写，后续不会被覆盖
  - npc.currentState：动态状态（可留空字符串）
- hp / san：固定填 null（开幕无 HP/SAN 变化）
- dice：固定填 null（开幕不触发掷骰判定）
- options：恰好 4 个选项，前 3 个以 "A." "B." "C." 开头，最后一个固定为 "D. 自由行动"

${buildEntityReferenceRules(true)}`;

const NARRATION_I_INSTRUCTION = `${BASE_INTRO}
现在，你作为KP，需要根据玩家行为推进剧情。

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_narration 函数返回 JSON 结果，字段结构如下：
- narration：叙事文本，文学性强、有沉浸感
- locations / npcs / items：本轮新增或状态更新的实体（无则空数组 []）
  - npc 必须标注 importance 字段：
    - "key"：主角、已邀请角色、推动剧情的关键 NPC
    - "supporting"：有名字、有台词、对剧情有一定作用的配角
    - "background"：路人/酒客/侍女等背景角色 —— 不要加入 npcs 数组，直接在 narration 中描写即可
- hp / san：本轮 HP/SAN 变化值（正负皆可），无变化为 null
- dice 与 options 二选一（互斥）：
  - 若剧情需要技能/属性投掷判定：dice 填 { skill_name, skill_point, notation, success_rate }，options 填 null
    （用户会先决定是否掷骰，不需要选项；narration 应在判定点自然切断）
  - 否则：dice 填 null，options 填恰好 4 个选项，前 3 个以 "A." "B." "C." 开头，最后一个固定为 "D. 自由行动"

${buildEntityReferenceRules(false)}`;

const NARRATION_II_INSTRUCTION = `${BASE_INTRO}
现在，你作为KP，需要根据投掷结果推进剧情。
系统消息已按【使用XX技能（技能点YY），判定结果Z，等级】格式给出判定结果（等级为大成功/极难成功/困难成功/一般成功/一般失败/大失败），请直接承接该结果推进剧情，不要重复输出判定格式。

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_narration 函数返回 JSON 结果（字段结构与 NARRATION_I 相同）：
- dice 与 options 二选一（互斥，规则同 NARRATION_I）：
  - 若剧情仍需新一轮投掷判定：dice 填对象，options 填 null
  - 否则：dice 填 null，options 填恰好 4 个选项
- npc.importance 标注规则同 NARRATION_I

${buildEntityReferenceRules(false)}`;

const SUMMARY_INSTRUCTION = `你是跑团KP，现在需要帮我总结迄今剧情。你给出的总结要保证自己后续
可以通过该总结正常推进跑团进程，保证故事的合理性，暗示故事可能的伏笔。总结请控制在 800-1000 字。

${PLAIN_TEXT_RULE}

【字段说明】
必须调用 output_summary 函数返回 JSON 结果：
- summary：剧情总结文本，800-1000 字`;

// ── temperature / max_tokens 配置 ──
// 注意：思考模式下 reasoning_content 也消耗 max_tokens，需留足思考空间
// - CHARACTER_GEN/KEY_CHARACTER_GEN：数值计算严谨，思考量大，需要更大额度
// - STORY_OPENING：纯叙事，思考量适中
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
  [FlowType.CHARACTER_GEN]: 8192,         // 思考模式 + 数值计算，需要更大额度（4096 易被思考截断）
  [FlowType.KEY_CHARACTER_GEN]: 8192,     // 同上
  [FlowType.STORY_OPENING]: 4096,         // 思考 + 叙事
  [FlowType.NARRATION_I]: 8192,           // 思考 + 叙事 + 实体更新，4096 易截断
  [FlowType.NARRATION_II]: 8192,           // 同上
  [FlowType.HISTORY_SUMMARY]: 4096,       // 思考 + 摘要
};

// ── thinking 模式配置（DeepSeek V3.2+ 支持，与 strict 模式可共存） ──
export const FLOW_THINKING = {
  [FlowType.WORLD_GEN]: true,
  [FlowType.CHARACTER_GEN]: true,
  [FlowType.KEY_CHARACTER_GEN]: true,
  [FlowType.STORY_OPENING]: true,
  [FlowType.NARRATION_I]: true,
  [FlowType.NARRATION_II]: true,
  [FlowType.HISTORY_SUMMARY]: true,
};

// ── reasoning_effort 配置（思考强度，仅思考模式下生效） ──
// 官方文档：思考模式下默认 high；复杂 Agent 类请求自动 max
// 注意：reasoning_effort='max' 会让 LLM 深度思考，消耗大量 max_tokens
//   若 max_tokens 不足，思考会被截断，导致 LLM 无法进入输出阶段（content/tool_calls 都为空）
// 因此 'max' 仅在 max_tokens 足够大（>= 8192）时使用，否则降级为 'high'
export const FLOW_REASONING_EFFORT = {
  [FlowType.WORLD_GEN]: 'high',
  [FlowType.CHARACTER_GEN]: 'high',        // CoC 数值计算虽严谨，但 'max' 易导致思考截断，用 'high' 已足够
  [FlowType.KEY_CHARACTER_GEN]: 'high',    // 同上
  [FlowType.STORY_OPENING]: 'high',
  [FlowType.NARRATION_I]: 'high',
  [FlowType.NARRATION_II]: 'high',
  [FlowType.HISTORY_SUMMARY]: 'high',
};

// ── 模型路由（D18 分层模型路由） ──
// 官方文档：deepseek-v4-pro（500 并发，3 元/百万输入）vs deepseek-v4-flash（2500 并发，1 元/百万输入）
// 策略：高质量叙事/规则判定 → pro；高频低复杂度 → flash
// 注意：null 表示使用 .env 中 LLM_MODEL 默认值
export const FLOW_MODEL = {
  [FlowType.WORLD_GEN]: null,             // 世界观创作 → pro（默认）
  [FlowType.CHARACTER_GEN]: null,          // 数值计算 → pro
  [FlowType.KEY_CHARACTER_GEN]: null,      // 数值计算 → pro
  [FlowType.STORY_OPENING]: null,         // 开场叙事 → pro
  [FlowType.NARRATION_I]: null,           // 核心叙事 → pro
  [FlowType.NARRATION_II]: null,          // 核心叙事 → pro
  [FlowType.HISTORY_SUMMARY]: 'deepseek-v4-flash',  // 摘要任务 → flash（降本 2/3）
};

// ── stop 序列配置 ──
// strict 模式下 tool_calls 自然结束，stop 通常不需要
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
// strict 模式下字段已被服务端强制，但仍保留用于业务逻辑判断
import { NARRATION, SUMMARY, WORLD_IMPRESSION } from '../domain/NarrativeSchema.js';
import { CARD_KEY } from '../domain/CharacterCardSchema.js';

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
