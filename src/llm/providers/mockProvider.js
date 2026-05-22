export async function generate({ mode, state, userText }) {
  // Deterministic JSON output to let you test the whole loop without any API key.
  if (mode === "meta") {
    return JSON.stringify({
      narrative: `【Meta】我理解你的问题：${userText}\n你可以在右侧面板直接修改世界观/任务/角色卡/背包。`,
      options: [],
      needs_roll: false,
      roll: null,
      state_updates: null,
    });
  }

  const wantsRoll = /踢门|潜行|攻击|开锁|侦查/.test(userText);

  return JSON.stringify({
    narrative: `你在昏暗的走廊里前进。你说：“${userText}”。\n空气里有潮湿的霉味，远处传来木板吱呀声。`,
    options: ["仔细侦查周围", "继续前进", "呼喊同伴（其实你是单人）"],
    needs_roll: wantsRoll,
    roll: wantsRoll ? { sides: 20, reason: "行动检定" } : null,
    state_updates: userText.includes("拿") ? { add_item: "可疑的钥匙" } : null,
  });
}
