import { OpenAICompatibleProvider } from '../src/llm/OpenAICompatibleProvider.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const previous = process.env.LLM_THINKING_TYPE;
try {
  delete process.env.LLM_THINKING_TYPE;
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-flash' }).thinkingType === 'disabled', 'Flash should default to disabled thinking for lower latency');
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-pro' }).thinkingType === 'enabled', 'Pro should keep thinking enabled by default');
  process.env.LLM_THINKING_TYPE = 'enabled';
  assert(new OpenAICompatibleProvider({ model: 'deepseek-v4-flash' }).thinkingType === 'enabled', 'explicit thinking configuration should override Flash default');
} finally {
  if (previous === undefined) delete process.env.LLM_THINKING_TYPE;
  else process.env.LLM_THINKING_TYPE = previous;
}

console.log(`${passed} passed`);
