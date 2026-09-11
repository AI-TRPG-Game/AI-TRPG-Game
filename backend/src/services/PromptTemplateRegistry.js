import { FlowType } from '../domain/enums.js';
import { buildEntityReferenceRules } from '../domain/NarrativeSchema.js';

// ── 公共前缀（所有 flowType 共享，最大化 DeepSeek prefix cache 命中） ──
// 设计原则：
// 1. system message 必须完全静态（不追加任何 session 动态内容），否则破坏 cache
// 2. 动态内容（世界观、角色状态等）放在 user message 中
// 3. strict 模式下 schema 已强制字段结构，prompt 只描述语义，不重复 schema description
// 4. 不教 LLM 如何转义（strict 模式服务端自动转义，prompt 提转义反而导致字面输出）
const SYSTEM_PREFIX = `你是CoC7th规则下的KP兼文学剧本创作者。除JSON字段名、结构化实体ID和规则枚举值外，所有面向玩家的文字必须使用简体中文。实体ID只能填写在id、current_location_id、evidence_changes、active_event_ack等结构化字段中；严禁把loc_001、evidence_001、npc_001、item_001之类的内部ID写入narration、options、实体描述或其他玩家可见文字。必须通过调用指定函数以JSON返回结果，不在函数调用之外输出任何文本。`;

// ── CoC7th 数值计算规则（CHARACTER_GEN / KEY_CHARACTER_GEN 共用） ──
// 仅保留 schema 无法表达的公式和计算规则，范围约束由 schema minimum/maximum 强制
const CHARACTER_RULES = `CoC7th数值规则：
1. 8大属性总和580，单项15-90；HP=(体质+体型)/10，SAN=意志
2. 技能点计算规则：基础值+职业技能点+兴趣技能点
3. 职业技能点=教育×4（或按职业调整），兴趣技能点=智力×2
4. 职业技能点只能分配给本职技能+信用评级（单项≤80），兴趣技能点可分配所有技能（单项≤50，信用评级除外）
5. 基础值4档：0(克苏鲁神话/信用评级)、1(罕见)、10(偶尔使用)、25(生活技能)
6. 核查：基础点数不计入职业/兴趣技能点总和限制`;

// ── options 字段通用说明（STORY_OPENING / NARRATION_I / NARRATION_II 共用） ──
const OPTIONS_RULE = `options：4个自然、沉浸式的中文行动选项（前3个以"A.""B.""C."开头，最后1个固定"D. 自由行动"）；只能使用地点、人物、物品和线索的可读名称或具体动作，绝不能显示任何内部ID`;

const WORLD_INSTRUCTION = `${SYSTEM_PREFIX}
任务：根据用户输入生成世界观印象。为营造代入感，可尝试环境切入/普通人视角/传说歌谣/对话切入/电影蒙太奇等手法。
- world_impression：800-1000字
- key_description：200字以内摘要`;

const CHARACTER_INSTRUCTION = `${SYSTEM_PREFIX}
任务：根据用户的描述，创建玩家角色档案，按CoC7th规则计算数值。

${CHARACTER_RULES}

字段：角色档案含姓名/年龄/性别/职业/性格/肖像/8大属性/hp/san/信用评级/本职技能/非本职技能/随身物品。
- 性格描述：50字以内
- 人物肖像与重要经历：100字以内`;

const KEY_CHARACTER_INSTRUCTION = `${SYSTEM_PREFIX}
任务：创建关键角色档案（冒险伙伴/关键NPC等），按CoC7th规则计算数值。该角色不是玩家。

${CHARACTER_RULES}

字段：角色档案含姓名/年龄/性别/职业/性格/肖像/8大属性/hp/san/信用评级/本职技能/非本职技能/随身物品。
- 性格描述：50字以内
- 人物肖像与重要经历：100字以内`;

const STORY_OPENING_INSTRUCTION = `${SYSTEM_PREFIX}
任务：撰写符合设定、有代入感的跑团故事开幕。

字段：
- narration：开幕叙述
- locations/npcs/items：首次出场实体（id填null，系统自动分配）
- npc.importance：key=关键NPC，supporting=配角；路人直接在narration中描写，不加入npcs
- npc.baseDescription：稳定人设，75字以内（仅首次填写，后续不覆盖）
- npc.currentState：动态状态，35字以内（可留空字符串）
- npc.hp/san/maxHp/maxSan：仅首次出场时填写数值，已存在的 npc 填 null（由系统管理）
- current_location_id：普通剧本固定填空字符串
- actions：固定填null
- ${OPTIONS_RULE}

${buildEntityReferenceRules(true)}`;

const NARRATION_I_INSTRUCTION = `${SYSTEM_PREFIX}
任务：根据玩家行为推进剧情。

若设定上下文含“GM-ONLY ACTIVE SCENE DIRECTIVE”，必须先把该事件自然写进本轮场景，再处理或打断玩家原行动。事件尚未由系统宣告，不能假设玩家已经知道；只写主角可感知的内容，不输出事件ID、分支名或调度信息。

字段：
- narration：按设定上下文中的“本轮叙事档位”控制篇幅。普通完成回合写450-750字、4-6个有信息量的段落；重大事件、新地点、重要线索或危机写700-1100字、6-9段；触发actions的检定前铺垫写200-400字并在不确定结果前停住。完成回合必须包含玩家行动结果、环境变化、相关NPC反应和至少一个可执行后果或新信息；不要为了凑字重复背景，也不要把options或系统判定说明塞进narration。
- locations/npcs/items：新增或更新的实体（无则空数组）
- npc.importance：key/supporting（路人直接在narration中描写）
- npc.baseDescription：稳定人设，75字以内（仅首次填写，后续不覆盖）
- npc.currentState：动态状态，35字以内（可留空字符串）
- npc.hp/san/maxHp/maxSan：仅首次出场npc填写数值，已存在的 npc 填 null（由系统管理）
- NPC的精确HP、SAN、属性和规则状态是主持人信息，不得在narration、currentState或options中直接告诉玩家；只描述可观察的伤势与情绪。
- current_location_id：本轮结束时玩家所在地点。新手试炼只能填写设定上下文中已发现的地点 id；未移动时保持当前地点 id。普通剧本填空字符串。
- active_event_ack：若设定上下文含GM活动场景，必须填写其event_id与outcome，incorporated=true，并用perceived_consequence简述玩家在叙事中实际感知到的变化；没有活动场景时填null。该字段只供系统校验，不得写入面向玩家的文字。
- actions与options互斥：
  - actions非空=触发判定（options填null），narration在判定点自然切断
  - actions为null=正常推进，${OPTIONS_RULE}

actions字段语义（字段结构由schema强制）：
- skill_check.trigger/direct.trigger：'player'=玩家主动行为触发判定；'others'=NPC主动或环境被动触发
- sancheck.trigger：固定'others'

on_success/on_fail/on_critical_success/on_critical_failure 只填 HP/SAN 联级变化，叙事性后果在后续 narration 中体现

每次都必须输出 time_cost_minutes、time_cost_rationale、evidence_changes、suspicion_delta、combat_update、ending_recommendation。普通剧本固定填：0、空字符串、[]、0、null、{should_end:false,reason:""}。若设定上下文含“剧本时钟”，则 time_cost_minutes 必须为1-120，耗时按行动复杂度、移动、对话和风险决定，不可固定；填写相应证据/怀疑度/危机更新。失败只能增加代价，不能永久封锁主线。未触发的计划事件不可剧透；自然收束时填写 ending_recommendation。

${buildEntityReferenceRules(false)}

For an authored scenario: each meaningful narrated turn costs at least 10 minutes. Use 10-15 for a conversation or quick examination, 15-25 for movement/searching, 25-40 for careful investigation, and 10-20 for a crisis. A sancheck must include san_severity and san_event_id. For an authored scenario, only use a currently allowed SAN event ID from the scenario context: the server overrides the submitted severity and target, and rejects invented/repeated/early/wrong-location events. Never invent evidence IDs: only update clues supplied in the scenario context. Set secured=false when the player has found a clue but has not yet protected it. Set secured=true only after an explicit preservation action such as photographing, recording, copying, rubbing, sampling, bagging, sealing, or carrying it away; merely observing, mentioning, comparing, or understanding a clue does not preserve it. Suspicion should rise for public accusations, forced searches, threats, careless handling, or letting a suspect see protected evidence; it can fall after quiet cooperation or evidence protection. Recommend an ending only when the player's stated action resolves the case using secured evidence.`;

const NARRATION_II_INSTRUCTION = `${SYSTEM_PREFIX}
For an authored scenario, use a minimum 10-minute meaningful turn and include san_severity plus a currently allowed san_event_id on every sancheck. Only catalogued evidence IDs may be updated.
任务：根据系统判定结果推进剧情。系统已完成掷骰和HP/SAN计算，直接承接推进，不重复输出判定格式。

若设定上下文含“GM-ONLY ACTIVE SCENE DIRECTIVE”，检定后的叙事必须继续遵守该场景事实，只写主角可感知的内容，不输出事件ID、分支名或调度信息。

字段：
- narration：承接判定结果并按设定上下文中的“本轮叙事档位”写作。普通完成回合450-750字、4-6段；重大事件、新地点、重要线索或危机700-1100字、6-9段；递归触发actions时只写200-400字并停在新判定点。必须体现检定结果、环境变化、人物反应和可执行后果；不要重复系统掷骰文字。
- locations/npcs/items：新增或更新的实体（无则空数组）
- npc.baseDescription：稳定人设，75字以内（仅首次填写，后续不覆盖）
- npc.currentState：动态状态，35字以内（可留空字符串）
- npc.hp/san/maxHp/maxSan：仅首次出场时填写数值，已存在的 npc 填 null（由系统管理）
- NPC的精确HP、SAN、属性和规则状态是主持人信息，不得在narration、currentState或options中直接告诉玩家；只描述可观察的伤势与情绪。
- current_location_id：本轮结束时玩家所在地点；新手试炼只能填写已发现地点 id，未移动时保持当前地点 id。
- active_event_ack：若设定上下文含GM活动场景，必须确认同一event_id与outcome且incorporated=true，并说明检定后叙事中的可感知后果；没有活动场景时填null。不得向玩家显示该字段。
- actions与options互斥：
  - actions非空=递归检定（options填null）
  - actions为null=正常推进，${OPTIONS_RULE}

每次都必须输出 time_cost_minutes、time_cost_rationale、evidence_changes、suspicion_delta、combat_update、ending_recommendation。普通剧本固定填：0、空字符串、[]、0、null、{should_end:false,reason:""}；若上下文含剧本时钟则按其规则裁定行动时间与状态。剧本证据只能使用上下文中的精确 ID；发现但未保全填 secured=false，只有玩家明确拍照、录音、抄录、拓印、取样、装袋、封存或带走后才填secured=true，单纯观察、提及或理解不算保全。`;

const SUMMARY_INSTRUCTION = `${SYSTEM_PREFIX}
任务：总结迄今剧情，保证后续可正常推进，暗示故事可能的伏笔。
- summary：800-1000字`;

const ENDING_GEN_INSTRUCTION = `${SYSTEM_PREFIX}
任务：根据完整状态生成已经完成、没有悬而未决行动的RPG结局与独立主持人复盘。
- ending_type：truth_exposed/forbidden_cargo/truth_sunk/suppressed/withdrawal/death/madness/custom；HP/SAN归零时优先death或madness。
- ending_title：明确的中文结局名称。
- immediate_resolution：明确解决最后一场危险、追逐或对抗，不能停在攻击即将发生或仍需玩家选择的位置。
- player_outcome：说明主角是否生还、如何离开、付出何种代价以及之后的处境。
- character_outcomes：为上下文指定的每名相关角色填写npc_id、姓名和明确去向。
- truth_outcome：说明真相与证据最终如何处置。
- ending_text：300-600字的文学性收束，必须与上述结构一致。禁止使用“故事才刚刚开始”“未完待续”或暗示本局仍未结束的措辞。
- debrief：含剧透，说明隐藏真相、重要事件、实际使用的证据、错过线索与下次可尝试的行动。`;

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
  [FlowType.ENDING_GEN]: 0.8,
};

export const FLOW_MAX_TOKENS = {
  [FlowType.WORLD_GEN]: 4096,
  [FlowType.CHARACTER_GEN]: 8192,         // 思考模式 + 数值计算，需要更大额度（4096 易被思考截断）
  [FlowType.KEY_CHARACTER_GEN]: 8192,     // 同上
  [FlowType.STORY_OPENING]: 8192,         // 思考 + 叙事 + 实体更新（Plan B+ 与 NARRATION_I 同 schema，4096 会被截断）
  [FlowType.NARRATION_I]: 8192,           // 思考 + 叙事 + 实体更新，4096 易截断
  [FlowType.NARRATION_II]: 8192,           // 同上
  [FlowType.HISTORY_SUMMARY]: 4096,       // 思考 + 摘要
  [FlowType.ENDING_GEN]: 4096,            // 思考 + 结局文本（100-300 字，4096 足够）
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
  [FlowType.ENDING_GEN]: true,
};

// ── reasoning_effort 建议值 ──
// 仅作为流程层提示；最终是否发送及发送何值由模型配置的 capabilities 与
// flowPolicies 决定。DeepSeek 不接收此字段，未知兼容模型也会自动省略。
export const FLOW_REASONING_EFFORT = {
  [FlowType.WORLD_GEN]: 'high',
  [FlowType.CHARACTER_GEN]: 'high',        // CoC 数值计算虽严谨，但 'max' 易导致思考截断，用 'high' 已足够
  [FlowType.KEY_CHARACTER_GEN]: 'high',    // 同上
  [FlowType.STORY_OPENING]: 'high',
  [FlowType.NARRATION_I]: 'high',
  [FlowType.NARRATION_II]: 'high',
  [FlowType.HISTORY_SUMMARY]: 'high',
  [FlowType.ENDING_GEN]: 'high',
};

// ── 模型路由 ──
// null 表示使用 .env 中 LLM_MODEL 默认值。不要在这里硬编码某个厂商的
// 模型名：SoCLaaS 与其他 OpenAI-compatible 服务各自维护可用模型目录。
export const FLOW_MODEL = {
  [FlowType.WORLD_GEN]: null,             // 世界观创作 → pro（默认）
  [FlowType.CHARACTER_GEN]: null,          // 数值计算 → pro
  [FlowType.KEY_CHARACTER_GEN]: null,      // 数值计算 → pro
  [FlowType.STORY_OPENING]: null,         // 开场叙事 → pro
  [FlowType.NARRATION_I]: null,           // 核心叙事 → pro
  [FlowType.NARRATION_II]: null,          // 核心叙事 → pro
  [FlowType.HISTORY_SUMMARY]: null,             // 摘要任务 → 使用默认模型
  [FlowType.ENDING_GEN]: null,            // 结局生成 → pro（默认）
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
  [FlowType.ENDING_GEN]: null,
};

// ── 输出格式 field 名（用于 JSON parse 后验证关键字段） ──
// strict 模式下字段已被服务端强制，但仍保留用于业务逻辑判断
import { NARRATION, SUMMARY, WORLD_IMPRESSION, ENDING_TEXT } from '../domain/NarrativeSchema.js';
import { CARD_KEY } from '../domain/CharacterCardSchema.js';

export const FLOW_REQUIRED_FIELD = {
  [FlowType.WORLD_GEN]: WORLD_IMPRESSION,
  [FlowType.CHARACTER_GEN]: CARD_KEY,
  [FlowType.KEY_CHARACTER_GEN]: CARD_KEY,
  [FlowType.STORY_OPENING]: NARRATION,
  [FlowType.NARRATION_I]: NARRATION,
  [FlowType.NARRATION_II]: NARRATION,
  [FlowType.HISTORY_SUMMARY]: SUMMARY,
  [FlowType.ENDING_GEN]: ENDING_TEXT,
};

const templates = {
  [FlowType.WORLD_GEN]: { systemInstruction: WORLD_INSTRUCTION },
  [FlowType.CHARACTER_GEN]: { systemInstruction: CHARACTER_INSTRUCTION },
  [FlowType.KEY_CHARACTER_GEN]: { systemInstruction: KEY_CHARACTER_INSTRUCTION },
  [FlowType.STORY_OPENING]: { systemInstruction: STORY_OPENING_INSTRUCTION },
  [FlowType.NARRATION_I]: { systemInstruction: NARRATION_I_INSTRUCTION },
  [FlowType.NARRATION_II]: { systemInstruction: NARRATION_II_INSTRUCTION },
  [FlowType.HISTORY_SUMMARY]: { systemInstruction: SUMMARY_INSTRUCTION },
  [FlowType.ENDING_GEN]: { systemInstruction: ENDING_GEN_INSTRUCTION },
};

export class PromptTemplateRegistry {
  getTemplate(flowType) {
    const template = templates[flowType];
    if (!template) throw new Error(`Unknown flow type: ${flowType}`);
    return { ...template };
  }
}

export const promptTemplateRegistry = new PromptTemplateRegistry();
