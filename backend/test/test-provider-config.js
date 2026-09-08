import { OpenAICompatibleProvider } from '../src/llm/OpenAICompatibleProvider.js';
import { getLLMConfig } from '../src/config/LLMConfig.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const previous = process.env.LLM_THINKING_TYPE;
const previousFetch = globalThis.fetch;
try {
  delete process.env.LLM_THINKING_TYPE;
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-flash' }).thinkingType === 'disabled', 'Flash should default to disabled thinking for lower latency');
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-pro' }).thinkingType === 'enabled', 'Pro should keep thinking enabled by default');
  process.env.LLM_THINKING_TYPE = 'enabled';
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-flash' }).thinkingType === 'enabled', 'explicit thinking configuration should override Flash default');

  // DeepSeek V4 defaults to thinking when the field is omitted. Verify that
  // the non-thinking path explicitly disables it before sending tool_choice.
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [{
                id: 'call_test',
                function: { arguments: '{}', name: 'test_output' },
              }],
            },
          }],
        };
      },
    };
  };

  process.env.LLM_THINKING_TYPE = 'disabled';
  const flashProvider = new OpenAICompatibleProvider({ apiKey: 'test-key', model: 'deepseek-v4-flash' });
  await flashProvider.generate({
    messages: [{ role: 'user', content: 'test' }],
    maxTokens: 32,
    thinking: true,
    tools: [{ type: 'function', function: { name: 'test_output', parameters: {} } }],
    toolChoice: 'required',
  });
  assert(requestBody.thinking?.type === 'disabled', 'non-thinking requests must explicitly disable DeepSeek V4 thinking');
  assert(requestBody.tool_choice === 'required', 'non-thinking requests should retain required tool_choice');

  process.env.LLM_THINKING_TYPE = 'enabled';
  const proProvider = new OpenAICompatibleProvider({ apiKey: 'test-key', model: 'deepseek-v4-pro' });
  await proProvider.generate({
    messages: [{ role: 'user', content: 'test' }],
    maxTokens: 32,
    thinking: true,
    tools: [{ type: 'function', function: { name: 'test_output', parameters: {} } }],
    toolChoice: 'required',
  });
  assert(requestBody.thinking?.type === 'enabled', 'thinking requests must enable DeepSeek thinking');
  assert(!Object.prototype.hasOwnProperty.call(requestBody, 'tool_choice'), 'thinking requests must omit tool_choice');

  const soclaasConfig = getLLMConfig({
    LLM_PROVIDER: 'soclaas',
    SOCLAAS_API_KEY: 'soclaas-key',
    SOCLAAS_BASE_URL: 'https://soclaas-api.comp.nus.edu.sg/v1',
    SOCLAAS_MODEL: 'qwen3.8:27b',
  });
  assert(soclaasConfig.provider === 'soclaas', 'SoCLaaS provider should be selectable from environment config');
  assert(soclaasConfig.apiKey === 'soclaas-key', 'SoCLaaS should use SOCLAAS_API_KEY');
  assert(soclaasConfig.baseUrl.endsWith('/v1'), 'SoCLaaS should use its /v1 base URL');
  assert(soclaasConfig.model === 'qwen3.8:27b', 'SoCLaaS should use SOCLAAS_MODEL');
  assert(
    getLLMConfig({ SOCLAAS_API_KEY: 'quick-start-key', SOCLAAS_BASE_URL: 'https://soclaas-api.comp.nus.edu.sg/v1' }).provider === 'soclaas',
    'SOCLAAS_* quick-start variables should auto-select SoCLaaS when LLM_PROVIDER is omitted'
  );
  const copiedDeepSeekConfig = getLLMConfig({
    LLM_PROVIDER: 'soclaas',
    LLM_BASE_URL: 'https://api.deepseek.com',
    LLM_MODEL: 'deepseek-v4-pro',
    SOCLAAS_API_KEY: 'soclaas-key',
  });
  assert(copiedDeepSeekConfig.baseUrl === 'https://soclaas-api.comp.nus.edu.sg/v1', 'SoCLaaS should not inherit a copied DeepSeek base URL');
  assert(copiedDeepSeekConfig.model === 'qwen3.8:27b', 'SoCLaaS should not inherit a copied DeepSeek model');

  // SoCLaaS uses the supplied /v1 base URL directly and its documented
  // reasoning_effort field; it must not receive DeepSeek's thinking object.
  let soclaasUrl;
  globalThis.fetch = async (url, init) => {
    soclaasUrl = url;
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [{
                id: 'call_soclaas',
                function: { arguments: '{}', name: 'test_output' },
              }],
            },
          }],
        };
      },
    };
  };

  const soclaasProvider = new OpenAICompatibleProvider({
    provider: 'soclaas',
    apiKey: 'test-soclaas-key',
    baseUrl: 'https://soclaas-api.comp.nus.edu.sg/v1/',
    model: 'qwen3.8:27b',
    reasoningEffort: 'none',
    timeoutMs: 1000,
    maxRetries: 0,
  });
  await soclaasProvider.generate({
    messages: [{ role: 'user', content: 'test' }],
    maxTokens: 32,
    thinking: true,
    tools: [{ type: 'function', function: { name: 'test_output', parameters: {} } }],
    toolChoice: 'required',
  });
  assert(soclaasUrl === 'https://soclaas-api.comp.nus.edu.sg/v1/chat/completions', 'SoCLaaS should use the /v1 chat completions endpoint');
  assert(requestBody.reasoning_effort === 'none', 'SoCLaaS should send the configured reasoning_effort');
  assert(!Object.prototype.hasOwnProperty.call(requestBody, 'thinking'), 'SoCLaaS should not receive DeepSeek thinking options');
  assert(requestBody.tool_choice === 'required', 'SoCLaaS should require the structured-output tool');
} finally {
  globalThis.fetch = previousFetch;
  if (previous === undefined) delete process.env.LLM_THINKING_TYPE;
  else process.env.LLM_THINKING_TYPE = previous;
}

console.log(`${passed} passed`);
