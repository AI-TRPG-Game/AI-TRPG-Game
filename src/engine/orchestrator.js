import { FlowType, Phase } from './flows.js';
import { buildFlowPrompt } from './inputAssembler.js';
import { roll } from './dice.js';
import { parseABCDOptions, parseCheckDecision } from './simpleOptions.js';
import { generateSimpleChat } from '../llm/providers/openaiProvider.js';
import { generate as generateOpenRouter } from '../llm/providers/openrouterProvider.js';

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

async function generateWithProvider({ provider, conf, apiKey, model, systemPrompt, userText }) {
  if (provider === 'openrouter') {
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: userText });
    return generateOpenRouter({ apiKey, model, messages });
  }

  return generateSimpleChat({
    baseUrl: conf.baseUrl,
    apiKey,
    model,
    systemPrompt,
    userText,
  });
}

/**
 * Orchestrator aligned with docs.
 * - InputAssemble: buildFlowPrompt
 * - Output parsing: ABCD options, check decision
 * - Rule engine: crypto dice
 * - Two-stage pipeline for playing turns:
 *    1) CHECK_REQUEST (if needed)
 *    2) NORMAL_TURN with checkResult
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
  // Mock provider for offline testing
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
  if (!conf && provider !== 'openrouter') throw new Error('Unknown provider');
  if (!apiKey) {
    const label = conf?.label || 'OpenRouter';
    throw new Error(`${label} provider selected but API key is empty.`);
  }

  const worldState = session.state;

  async function callOnce({ flowType: ft, userText: ut, checkResult }) {
    const sys = buildFlowPrompt({
      flowType: ft,
      mode,
      worldState,
      userText: ut,
      systemPrompt,
      checkResult,
      contextSummary: session.summary || '',
      recentMessages: (session.messages || []).slice(-6),
    });
    return generateWithProvider({ provider, conf, apiKey, model, systemPrompt: sys, userText: ut });
  }

  // --------- Main flow handling ---------
  let checkResult = null;

  // If we are in playing phase (or NORMAL_TURN) we run the check pipeline first.
  const shouldRunPipeline =
    mode === 'normal' &&
    (phase === Phase.playing || phase === Phase.opening || flowType === FlowType.NORMAL_TURN);

  if (shouldRunPipeline) {
    // 1) Ask for check decision
    const checkRaw = await callOnce({
      flowType: FlowType.CHECK_REQUEST,
      userText,
      checkResult: null,
    });

    const decision = parseCheckDecision(checkRaw);
    if (decision?.needsCheck) {
      // 2) System rolls dice
      const rr = roll({ sides: decision.sides || 20, reason: decision.reason || '行动检定' });
      session.state.diceLog.push(rr);
      session.state.lastRoll = rr;
      checkResult = rr;
    }
  }

  // 3) Generate final narrative for the requested flowType
  let raw = await callOnce({ flowType, userText, checkResult });
  let parsed = parseABCDOptions(raw);

  // one-retry repair if needed
  if (!parsed && retryOnFormatFailure) {
    const retryUser =
      '请把你刚才的回复【重写一次】并满足：\n' +
      '1) 正文在上，\n' +
      '2) 结尾必须严格包含四行选项：A./B./C./D.，\n' +
      '3) D 必须以“自由活动：”开头，\n' +
      '4) 不要输出多余解释、不要输出 Markdown 代码块。';

    raw = await callOnce({ flowType, userText: retryUser, checkResult });
    parsed = parseABCDOptions(raw);
  }

  const text = parsed?.narrative || raw;
  const options = parsed?.options || [];

  // Phase transitions (minimal but useful)
  let nextPhase = phase;
  if (flowType === FlowType.WORLD_GEN) nextPhase = Phase.setup_world;
  if (flowType === FlowType.PC_GEN) nextPhase = Phase.setup_pc;
  if (flowType === FlowType.OPENING) nextPhase = Phase.opening;
  if (flowType === FlowType.CHECK_REQUEST) nextPhase = Phase.checking;
  if (flowType === FlowType.NORMAL_TURN) nextPhase = Phase.playing;

  return {
    text,
    options,
    raw,
    next: { mode, phase: nextPhase },
  };
}
