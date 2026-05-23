import { runTurn } from "./gameEngine.js";
import { runFlowTurn } from "./orchestrator.js";
import { FlowType, Phase } from "./flows.js";

/**
 * Legacy structured game engine (JSON loop) + new flow-based orchestrator.
 */
export async function runNarrative({
  session,
  provider,
  apiKey,
  model,
  mode,
  phase,
  userText,
  systemPrompt,
  flowEnabled,
  selectedFlowType,
}) {
  if (!flowEnabled) {
    // fallback to old structured JSON engine
    const r = await runTurn({ mode, session, userText, provider, apiKey, model });
    return {
      text: r.narrative,
      options: (r.options || []).map((t, i) => ({ key: String(i + 1), text: t })),
      raw: JSON.stringify(r),
      next: { mode, phase },
    };
  }

  // Determine flow type from phase / user selection
  const flowType = selectedFlowType || inferFlowType({ phase, mode });

  return runFlowTurn({
    session,
    provider,
    apiKey,
    model,
    mode,
    phase,
    flowType,
    userText,
    systemPrompt,
    retryOnFormatFailure: true,
  });
}

export function inferFlowType({ phase, mode }) {
  if (mode === 'meta') {
    if (phase === Phase.setup_world) return FlowType.WORLD_GEN;
    if (phase === Phase.setup_pc) return FlowType.PC_GEN;
  }
  if (phase === Phase.opening) return FlowType.OPENING;
  if (phase === Phase.checking) return FlowType.CHECK_REQUEST;
  return FlowType.NORMAL_TURN;
}
