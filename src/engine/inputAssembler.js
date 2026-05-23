import { FlowType, Phase } from './flows.js';

const DEFAULT_RULESETS = {
  pc_card_format:
    '姓名/年龄/性别/种族/性格/外貌/家世与教育背景/其余（必须逐项给出，每项一行，使用“字段名：内容”格式）',
  npc_card_format:
    '姓名（无则以简短描述代替） | 与主角关系 | 详细描述（同一行用“|”分隔）',
  opening_format:
    '输出：开幕自然叙述（氛围+地点+现状）\n再用自然语言回顾主角设定并衔接背景\n最后给出核心任务/钩子。',
  normal_output_format:
    '输出：\n1) 正常叙述推进\n2) 如果出现重要NPC，请加一个“重要人物：”段落（放在选项之前），格式为：\n   重要人物：\n   - 姓名 | 与主角关系 | 详细描述\n   - ...\n3) 结尾必须给四个选项：A/B/C/D。D 必须以“自由活动：”开头。',
  check_format:
    '只输出三行：\nneeds_check: yes|no\ndice: d20|d100\nreason: <一句话原因>\n不要输出其它文字。',
};

function json(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export function buildFlowPrompt({
  flowType,
  mode,
  worldState,
  userText,
  systemPrompt,
  checkResult,
}) {
  const rulesets = worldState?.rulesets || DEFAULT_RULESETS;

  const base = [
    '你是TRPG主持人(KP/DM)。',
    '重要：骰子由系统掷出，你不能编造点数；你只能根据结果叙事。',
    '重要：输出必须是中文。',
    systemPrompt && systemPrompt.trim() ? `（额外系统设定）\n${systemPrompt.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const stateBlock = [
    '【特殊数据库 WorldState（权威设定）】',
    json({
      world_background: worldState?.world_background,
      pc: worldState?.pc,
      npcs_tail: (worldState?.npcs || []).slice(-6),
      quest_core: worldState?.quest_core,
      quest_current: worldState?.quest_current,
      dice_log_tail: (worldState?.diceLog || []).slice(-3),
      lastRoll: worldState?.lastRoll || null,
    }),
  ].join('\n');

  if (flowType === FlowType.WORLD_GEN) {
    return [
      base,
      '你现在处于【Meta/世界观设定】阶段。',
      '目标：根据用户关键词生成“世界观与背景”的可编辑文本。',
      '不要推进剧情，不要掷骰，不要输出A/B/C/D。',
      stateBlock,
      '请输出：\n- 世界观与背景（分段）\n- 3条可选的进一步追问/补充方向（用项目符号）',
    ].join('\n\n');
  }

  if (flowType === FlowType.PC_GEN) {
    return [
      base,
      '你现在处于【Meta/主角设定】阶段。',
      '目标：根据世界观与用户输入生成主角卡。',
      `主角卡必须严格按以下 schema 输出：${rulesets.pc_card_format}`,
      '输出时不要夹杂额外段落、不要使用项目符号、不要输出A/B/C/D。',
      stateBlock,
      '请只输出主角卡内容（严格逐项）。',
    ].join('\n\n');
  }

  if (flowType === FlowType.OPENING) {
    return [
      base,
      '你现在处于【Normal/故事开幕】阶段。',
      `开幕输出格式要求：${rulesets.opening_format}`,
      '开幕后不需要A/B/C/D选项；系统会提供“接收任务”按钮进入主循环。',
      stateBlock,
    ].join('\n\n');
  }

  if (flowType === FlowType.CHECK_REQUEST) {
    return [
      base,
      '你现在处于【Checking】阶段：你只负责判断“用户行为是否需要检定，以及用什么骰子”。',
      '非常重要：你必须严格遵守输出格式，否则系统无法解析。',
      `输出格式：\n${rulesets.check_format}`,
      stateBlock,
      '现在用户的行为是：',
      userText,
    ].join('\n\n');
  }

  const checkBlock = checkResult
    ? `【系统检定结果（事实）】\n${json(checkResult)}`
    : '';

  return [
    base,
    `你现在处于【Normal/${mode === 'meta' ? 'Meta' : 'Playing'}】阶段。`,
    '请推进剧情，并在结尾提供A/B/C/D四个选项（D为自由活动）。',
    rulesets.normal_output_format,
    `重要人物卡格式：${rulesets.npc_card_format}`,
    stateBlock,
    checkBlock,
    '用户本回合提交的行动/输入：',
    userText,
    '',
    '输出要求：',
    '1) 先叙事正文',
    '2) 若出现重要NPC，请在选项之前加“重要人物：”段落（按指定格式，每行一条，以"- "开头）',
    '3) 结尾必须严格四行选项：',
    'A. ...',
    'B. ...',
    'C. ...',
    'D. 自由活动：...',
  ]
    .filter(Boolean)
    .join('\n\n');
}
