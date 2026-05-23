import { FlowType } from './flows.js';

/**
 * Assemble input for different flows.
 * This is intentionally lightweight and prompt-only for MVP.
 */
export function buildFlowPrompt({
  flowType,
  mode,
  worldState,
  userText,
  systemPrompt,
  checkResult,
}) {
  const base = (systemPrompt || '').trim();

  const worldBlock = JSON.stringify(
    {
      world_background: worldState?.world_background || worldState?.world || '',
      quest_core: worldState?.quest_core || '',
      quest_current: worldState?.quest_current || worldState?.quest || '',
      pc: worldState?.pc || worldState?.character || null,
      inventory: worldState?.inventory || [],
      npcs: worldState?.npcs || [],
      lastRoll: worldState?.lastRoll || null,
      checkResult: checkResult || null,
    },
    null,
    2
  );

  const optionFormat = `
【输出格式强制要求】
- 你的回复必须以四个选项结尾，并严格使用以下格式（每行一个选项）：
A. <选项内容>
B. <选项内容>
C. <选项内容>
D. 自由活动：<选项内容>
- D 选项必须以“自由活动：”开头。
- 选项内容要具体、可执行。
`;

  // Flow-specific instruction
  let instruction = '';
  switch (flowType) {
    case FlowType.WORLD_GEN:
      instruction = `你在帮助用户生成“世界观与背景”。请提供一个清晰的世界观与背景（可分点），最后仍然给出A/B/C/D选项（A/B/C用于调整设定方向，D为自由活动）。`;
      break;
    case FlowType.PC_GEN:
      instruction = `你在帮助用户生成“主角人设”。请给出一份主角设定（尽量包含：姓名/年龄/性别/性格/外貌/背景/动机），最后给出A/B/C/D选项（用于微调人物设定）。`;
      break;
    case FlowType.OPENING:
      instruction = `你在生成“故事开幕”。请用1-6段自然语言开幕叙事，引入主角与背景，并给出一个明确的核心任务/线索；最后给出A/B/C/D选项。`;
      break;
    case FlowType.CHECK_REQUEST:
      instruction = `你在做“鉴定判断”（不推进剧情）。请判断用户行动是否需要检定：
- 若不需要：直接说“无需检定”，并用1-2句解释原因；最后仍给A/B/C/D（用于替代行动）。
- 若需要：说明需要检定的类型与原因，并建议使用 D20；不要给出骰子点数（系统会掷骰）。最后仍给A/B/C/D。`;
      break;
    case FlowType.NORMAL_TURN:
    default:
      instruction = `现在是正常叙事推进。根据用户行动推进剧情；如果提供了检定结果，请据此给出成功/失败后果。最后给出A/B/C/D选项。`;
      break;
  }

  const modeRule = mode === 'meta'
    ? '当前为Meta模式（桌外）：不要强行推进剧情，可以解释、建议、或帮助修改设定。'
    : '当前为Normal模式（桌内）：推进剧情。';

  return [
    base,
    modeRule,
    `【当前世界状态】\n${worldBlock}`,
    instruction,
    optionFormat,
  ]
    .filter(Boolean)
    .join('\n\n');
}
