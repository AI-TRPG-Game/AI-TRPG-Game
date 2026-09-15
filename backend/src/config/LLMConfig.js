/**
 * Resolve the LLM configuration without exposing secrets in logs or source.
 *
 * DeepSeek remains the default for backwards compatibility. SoCLaaS has its
 * own variable names because its API key and model catalogue are independent
 * from the existing DeepSeek configuration.
 */
export function getLLMConfig(env = process.env) {
  const explicitProvider = String(env.LLM_PROVIDER || '').trim().toLowerCase();
  // Keep the documented SOCLAAS_* quick-start variables usable on their own,
  // while allowing LLM_PROVIDER to disambiguate when both providers are set.
  const provider = explicitProvider || (
    env.SOCLAAS_API_KEY || env.SOCLAAS_BASE_URL || env.SOCLAAS_MODEL
      ? 'soclaas'
      : 'deepseek'
  );

  if (provider === 'soclaas') {
    return {
      provider,
      apiKey: env.SOCLAAS_API_KEY || env.LLM_API_KEY,
      // Do not inherit a copied DeepSeek LLM_BASE_URL/LLM_MODEL when the
      // provider is switched to SoCLaaS. Use the SoCLaaS defaults unless its
      // provider-specific variables are explicitly supplied.
      baseUrl: env.SOCLAAS_BASE_URL || 'https://soclaas-api.comp.nus.edu.sg/v1',
      model: env.SOCLAAS_MODEL || 'qwen3.8:27b',
      // SoCLaaS documents reasoning_effort and does not require DeepSeek's
      // provider-specific { thinking: { type } } option. Keep the default
      // conservative; users can opt into another supported value in .env.
      reasoningEffort: env.SOCLAAS_REASONING_EFFORT || 'none',
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxRetries: env.LLM_MAX_RETRIES,
    };
  }

  return {
    provider,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
  };
}

const ROUTINE_FLOWS = new Set(['STORY_OPENING', 'NARRATION_I', 'NARRATION_II']);

function splitModels(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
  if (fallback && !values.includes(fallback)) values.unshift(fallback);
  return [...new Set(values)];
}

function buildCapabilities(provider, model) {
  if (provider === 'deepseek') {
    return { reasoningEffort: false, deepseekThinking: true, reasoningHistory: true, toolChoice: true };
  }
  if (provider === 'soclaas') {
    // Only opt models into optional parameters when their contract is known.
    // Unknown models stay on the portable OpenAI-compatible subset.
    const supportsReasoningEffort = /^qwen3\.8(?::|[-_])/i.test(String(model));
    return {
      reasoningEffort: supportsReasoningEffort,
      deepseekThinking: false,
      reasoningHistory: false,
      toolChoice: true,
    };
  }
  return { reasoningEffort: false, deepseekThinking: false, reasoningHistory: false, toolChoice: true };
}

function buildFlowPolicies(provider, capabilities = {}) {
  const policies = {};
  for (const flow of ['WORLD_GEN', 'CHARACTER_GEN', 'KEY_CHARACTER_GEN', 'STORY_OPENING', 'NARRATION_I', 'NARRATION_II', 'HISTORY_SUMMARY', 'ENDING_GEN']) {
    const routine = ROUTINE_FLOWS.has(flow);
    const summary = flow === 'HISTORY_SUMMARY';
    const ending = flow === 'ENDING_GEN';
    const character = flow === 'CHARACTER_GEN' || flow === 'KEY_CHARACTER_GEN';
    policies[flow] = {
      maxTokens: summary ? 2048 : (routine ? 4096 : (character ? 8192 : 4096)),
      timeoutMs: ending || character ? 150_000 : (summary ? 90_000 : 120_000),
      timeoutRetries: 0,
      reasoningEffort: provider === 'soclaas' && capabilities.reasoningEffort
        ? (ending || character ? 'medium' : 'none')
        : null,
      thinking: provider === 'deepseek' ? Boolean(ending || character) : false,
    };
  }
  return policies;
}

function profileId(provider, model) {
  return `${provider}:${model}`;
}

function hasConfiguredKey(value) {
  const key = String(value || '').trim();
  return Boolean(key) && !/^(your[-_]|replace|change-?me)/i.test(key);
}

/**
 * Build all selectable model profiles. Credentials remain private in these
 * server-side records; listPublicProfiles() exposes only safe metadata.
 *
 * Multiple models can be configured once with comma-separated
 * SOCLAAS_MODELS / DEEPSEEK_MODELS. Legacy single-model variables continue to
 * work, so existing installations do not need to rewrite their .env file.
 */
export function getLLMProfiles(env = process.env) {
  const explicitProvider = String(env.LLM_PROVIDER || '').trim().toLowerCase();
  const profiles = [];

  const soclaasKey = env.SOCLAAS_API_KEY || (explicitProvider === 'soclaas' ? env.LLM_API_KEY : '');
  const soclaasRequested = Boolean(
    explicitProvider === 'soclaas' || env.SOCLAAS_API_KEY || env.SOCLAAS_BASE_URL ||
    env.SOCLAAS_MODEL || env.SOCLAAS_MODELS
  );
  if (soclaasRequested) {
    const primaryModel = env.SOCLAAS_MODEL || 'qwen3.8:27b';
    for (const model of splitModels(env.SOCLAAS_MODELS, primaryModel)) {
      const capabilities = buildCapabilities('soclaas', model);
      profiles.push({
        id: profileId('soclaas', model),
        label: `${model}（SoCLaaS）`,
        description: capabilities.reasoningEffort
          ? '日常叙事优先低延迟，复杂人物与结局自动增加推理预算。'
          : '兼容模式：省略未经确认支持的推理参数。',
        provider: 'soclaas',
        apiKey: soclaasKey || '',
        baseUrl: env.SOCLAAS_BASE_URL || 'https://soclaas-api.comp.nus.edu.sg/v1',
        model,
        configured: hasConfiguredKey(soclaasKey),
        capabilities,
        flowPolicies: buildFlowPolicies('soclaas', capabilities),
      });
    }
  }

  const legacyLooksDeepSeek = /deepseek/i.test(String(env.LLM_MODEL || ''))
    || /deepseek/i.test(String(env.LLM_BASE_URL || ''));
  const deepSeekKey = env.DEEPSEEK_API_KEY
    || ((explicitProvider !== 'soclaas' || legacyLooksDeepSeek) ? env.LLM_API_KEY : '');
  // Always advertise one direct DeepSeek profile. Without a key it is exposed
  // as disabled metadata, which makes the setup path discoverable without
  // allowing a request that is guaranteed to fail.
  const deepSeekRequested = true;
  if (deepSeekRequested) {
    const primaryModel = env.DEEPSEEK_MODEL || env.LLM_MODEL || 'deepseek-v4-pro';
    for (const model of splitModels(env.DEEPSEEK_MODELS, primaryModel)) {
      const capabilities = buildCapabilities('deepseek', model);
      const configured = hasConfiguredKey(deepSeekKey);
      profiles.push({
        id: profileId('deepseek', model),
        label: `${model}（DeepSeek）`,
        description: configured
          ? '普通叙事关闭思考；人物生成与结局自动启用思考模式。'
          : '需要在backend/.env中配置DEEPSEEK_API_KEY，重启后即可选择。',
        provider: 'deepseek',
        apiKey: deepSeekKey || '',
        baseUrl: env.DEEPSEEK_BASE_URL || env.LLM_BASE_URL || 'https://api.deepseek.com',
        model,
        configured,
        capabilities,
        flowPolicies: buildFlowPolicies('deepseek', capabilities),
      });
    }
  }

  // Preserve support for other OpenAI-compatible endpoints. Optional
  // reasoning controls are omitted unless a named provider profile declares
  // support for them.
  if (explicitProvider && !['deepseek', 'soclaas'].includes(explicitProvider)) {
    const model = env.LLM_MODEL || 'default';
    profiles.push({
      id: profileId(explicitProvider, model),
      label: `${model}（${explicitProvider}）`,
      description: '兼容模式：仅发送标准工具调用参数。',
      provider: explicitProvider,
      apiKey: env.LLM_API_KEY || '',
      baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model,
      configured: hasConfiguredKey(env.LLM_API_KEY),
      capabilities: buildCapabilities('generic', model),
      flowPolicies: buildFlowPolicies('generic'),
    });
  }

  // Keep the backend bootable without credentials so the setup UI can still
  // explain what is missing.
  if (profiles.length === 0) {
    const legacy = getLLMConfig(env);
    profiles.push({
      id: profileId(legacy.provider, legacy.model || 'default'),
      label: `${legacy.model || '未配置模型'}（${legacy.provider}）`,
      description: '尚未配置API密钥。',
      ...legacy,
      configured: hasConfiguredKey(legacy.apiKey),
      capabilities: buildCapabilities(legacy.provider, legacy.model),
      flowPolicies: buildFlowPolicies(
        legacy.provider,
        buildCapabilities(legacy.provider, legacy.model)
      ),
    });
  }

  const requestedDefault = String(env.LLM_DEFAULT_PROFILE || '').trim();
  const providerDefault = explicitProvider
    ? profiles.find(profile => profile.provider === explicitProvider)
    : null;
  const defaultProfile = profiles.find(profile => profile.id === requestedDefault)
    || providerDefault
    || profiles.find(profile => profile.configured)
    || profiles[0];

  return { profiles, defaultProfileId: defaultProfile.id };
}
