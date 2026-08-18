import { OpenAICompatibleProvider } from '../src/llm/OpenAICompatibleProvider.js';

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
} finally {
  globalThis.fetch = previousFetch;
  if (previous === undefined) delete process.env.LLM_THINKING_TYPE;
  else process.env.LLM_THINKING_TYPE = previous;
}

console.log(`${passed} passed`);
