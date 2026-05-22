export function buildMessages({ mode, state, userText, lastRoll }) {
  const baseRules = `
你是TRPG主持人(KP/DM)。系统负责骰子与随机，你只负责叙事与提出是否需要检定。
你必须【只输出严格JSON】且不带任何多余文字。
JSON字段：
- narrative: string
- options: string[]
- needs_roll: boolean
- roll: null 或 { sides:number, reason:string }
- state_updates: null 或 { add_item?: string, set_quest?: string, hp_change?: number, san_change?: number }
`;

  const stateBlock = JSON.stringify({
    world: state.world,
    quest: state.quest,
    character: state.character,
    inventory: state.inventory,
    lastRoll,
  });

  const modeRules =
    mode === "meta"
      ? `现在是 meta 模式：不推进剧情。回答桌外问题，或提出如何修改设定。needs_roll 必须为 false。`
      : `现在是 normal 模式：推进剧情。结尾给3个 options。需要检定时 needs_roll=true 并说明 roll。不要自己编骰子点数。`;

  return [
    { role: "system", content: baseRules + "\n" + modeRules },
    { role: "system", content: `当前状态：${stateBlock}` },
    { role: "user", content: userText },
  ];
}
