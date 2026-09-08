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
