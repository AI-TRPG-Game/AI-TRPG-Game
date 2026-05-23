import { FlowType, Phase } from './flows.js';
import { buildFlowPrompt } from './inputAssembler.js';
import { roll } from './dice.js';
import { parseABCDOptions } from './simpleOptions.js';
import { generateSimpleChat } from '../llm/providers/openaiProvider.js';

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

function getProviderConf(provider) {
  if (provider === 'openai' || provider === 'deepseek') return PROVIDER_CONFIG[provider];
  return null;
}

/**
 * Lightweight orchestrator aligned with docs.
 * - Maintains {mode, phase}
 * - Supports different flow types
 * - Enforces A/B/C/D format (via prompt) and parses options to buttons
 * - Optional 1-retry on format failure
 */
export async function runFlowTurn({
  session,
  provider,
  apiKey,
  model,
  mode,
  phase,
  flowType,
  userText,
  systemPrompt,
  retryOnFormatFailure = true,
}) {
  // mock provider
  if (provider === 'mock') {
    const raw = `（Mock）${flowType} 收到：${userText}\n\nA. 继续\nB. 修改设定\nC. 查看状态\nD. 自由活动：输入你的自由行动`;
    const parsed = parseABCDOptions(raw);
    return {
      text: parsed?.narrative || raw,
      options: parsed?.options || [],
      raw,
      next: { mode, phase },
    };
  }

  const conf = getProviderConf(provider);
  if (!conf) throw new Error('Unknown provider');
  if (!apiKey) throw new Error(`${conf.label} provider selected but API key is empty.`);

  const worldState = session.state;

  // For checking pipeline: in this MVP we simplify by always doing NORMAL_TURN directly.
  // But we keep placeholders for CHECK_REQUEST and dice.
  let checkResult = null;

  const system = buildFlowPrompt({
    flowType,
    mode,
    worldState,
    userText,
    systemPrompt,
    checkResult,
  });

  async function callOnce(userText2) {
    return generateSimpleChat({
      baseUrl: conf.baseUrl,
      apiKey,
      model,
      systemPrompt: system,
      userText: userText2,
    });
  }

  let raw = await callOnce(userText);
  let parsed = parseABCDOptions(raw);

  // one-retry repair if needed
  if (!parsed && retryOnFormatFailure) {
    const retryUser = `请把你刚才的回复【重写一次】，必须严格以A/B/C/D四行选项结尾，并且D必须以“自由活动：”开头。只输出最终正文+选项，不要解释规则。`;
    raw = await callOnce(retryUser);
    parsed = parseABCDOptions(raw);
  }

  // If still fails, degrade
  const text = parsed?.narrative || raw;
  const options = parsed?.options || [];

  // very small: if flowType is CHECK_REQUEST and model suggests check, we could roll.
  // (Not implemented: would require reliable parse. Placeholder for next step.)
  if (flowType === FlowType.CHECK_REQUEST) {
    // Example: always roll a d20 for now if user text includes "检定" keywords.
    if (/检定|掷骰|判定|潜行|攻击|开锁|侦查/.test(userText)) {
      const rr = roll({ sides: 20, reason: '行动检定' });
      session.state.diceLog.push(rr);
      session.state.lastRoll = rr;
      checkResult = rr;
    }
  }

  // Phase transitions (minimal)
  let nextPhase = phase;
  if (flowType === FlowType.WORLD_GEN) nextPhase = Phase.setup_world;
  if (flowType === FlowType.PC_GEN) nextPhase = Phase.setup_pc;
  if (flowType === FlowType.OPENING) nextPhase = Phase.opening;
  if (flowType === FlowType.NORMAL_TURN) nextPhase = Phase.playing;

  return {
    text,
    options,
    raw,
    next: { mode, phase: nextPhase },
  };
}
