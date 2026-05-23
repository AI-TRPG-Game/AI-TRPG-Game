import { roll } from "./dice.js";
import { tryParseJson } from "../llm/validator.js";
import { buildMessages } from "../llm/promptBuilder.js";
import * as Mock from "../llm/providers/mockProvider.js";
import * as OpenAICompat from "../llm/providers/openaiProvider.js";
import { runSimpleChatWithOptions } from "./simpleOptions.js";

const PROVIDER_CONFIG = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

export async function runTurn({
  mode,
  session,
  userText,
  provider, // "mock" | "openai" | "deepseek"
  apiKey,
  model,
}) {
  const state = session.state;
  let lastRoll = state.lastRoll ?? null;

  // 1) Ask provider for structured JSON
  let raw;
  if (provider === "openai" || provider === 'deepseek') {
    if (!apiKey) {
      throw new Error(`${PROVIDER_CONFIG[provider].label} provider selected but API key is empty.`);
    }
    const messages = buildMessages({ mode, state, userText, lastRoll });
    raw = await OpenAICompat.generate({
      baseUrl: PROVIDER_CONFIG[provider].baseUrl,
      apiKey,
      model,
      messages,
    });
  } else {
    raw = await Mock.generate({ mode, state, userText });
  }

  let obj = tryParseJson(raw);

  // 2) External dice
  if (mode === "normal" && obj.needs_roll && obj.roll?.sides) {
    const rr = roll(obj.roll);
    session.state.diceLog.push(rr);
    session.state.lastRoll = rr;

    // Minimal way: append system result to narrative
    obj.narrative += `\n\n【系统掷骰】${rr.reason}：D${rr.sides} = ${rr.value}`;
    obj.needs_roll = false;
    obj.roll = null;
  }

  // 3) Apply minimal state updates
  if (obj.state_updates?.add_item) {
    session.state.inventory.push(obj.state_updates.add_item);
  }
  if (typeof obj.state_updates?.hp_change === "number") {
    session.state.character.hp += obj.state_updates.hp_change;
  }
  if (typeof obj.state_updates?.san_change === "number") {
    session.state.character.san += obj.state_updates.san_change;
  }
  if (obj.state_updates?.set_quest) {
    session.state.quest = obj.state_updates.set_quest;
  }

  return obj;
}

/**
 * Step-1: simplest plain text chat.
 * Step-2 (optional): enforce A/B/C/D options at end.
 */
export async function runSimpleChat({
  provider,
  apiKey,
  model,
  systemPrompt,
  userText,
  enforceOptions = false,
}) {
  if (provider === 'openai' || provider === 'deepseek') {
    const conf = PROVIDER_CONFIG[provider];
    if (!apiKey) {
      throw new Error(`${conf.label} provider selected but API key is empty.`);
    }

    if (enforceOptions) {
      const r = await runSimpleChatWithOptions({
        baseUrl: conf.baseUrl,
        apiKey,
        model,
        systemPrompt,
        userText,
      });
      return r;
    }

    const text = await OpenAICompat.generateSimpleChat({
      baseUrl: conf.baseUrl,
      apiKey,
      model,
      systemPrompt,
      userText,
    });
    return { text, options: [] };
  }

  // mock
  if (enforceOptions) {
    const text = `（Mock）你刚才说：${userText}\n\nA. 继续探索前方\nB. 仔细观察周围\nC. 打开背包检查物品\nD. 自由活动：说出你的自由行动`;
    return {
      text: `（Mock）你刚才说：${userText}`,
      options: [
        { key: 'A', text: '继续探索前方' },
        { key: 'B', text: '仔细观察周围' },
        { key: 'C', text: '打开背包检查物品' },
        { key: 'D', text: '自由活动：说出你的自由行动' },
      ],
      raw: text,
    };
  }

  const text = `（Mock）你刚才说：${userText}\n\n提示：切换到 DeepSeek 并输入 Key 可体验真实大模型回复。`;
  return { text, options: [] };
}
