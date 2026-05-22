import { roll } from "./dice.js";
import { tryParseJson } from "../llm/validator.js";
import { buildMessages } from "../llm/promptBuilder.js";
import * as Mock from "../llm/providers/mockProvider.js";
import * as OpenAI from "../llm/providers/openaiProvider.js";

export async function runTurn({
  mode,
  session,
  userText,
  provider, // "mock" | "openai"
  apiKey,
  model,
}) {
  const state = session.state;
  let lastRoll = state.lastRoll ?? null;

  // 1) Ask provider for structured JSON
  let raw;
  if (provider === "openai") {
    if (!apiKey) {
      throw new Error("OpenAI provider selected but API key is empty.");
    }
    const messages = buildMessages({ mode, state, userText, lastRoll });
    raw = await OpenAI.generate({ apiKey, model, messages });
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
 * - UI looks like chat, but we do NOT do memory management.
 * - If provider=openai, call OpenAI with (optional) systemPrompt + userText only.
 * - If provider=mock, echo a deterministic response.
 */
export async function runSimpleChat({ provider, apiKey, model, systemPrompt, userText }) {
  if (provider === 'openai') {
    if (!apiKey) {
      throw new Error('OpenAI provider selected but API key is empty.');
    }
    const text = await OpenAI.generateSimpleChat({ apiKey, model, systemPrompt, userText });
    return { text };
  }

  // mock
  const text = `（Mock）你刚才说：${userText}\n\n提示：切换到 OpenAI 并输入 Key 可体验真实大模型回复。`;
  return { text };
}
