import { createApp } from '../src/api/GameController.js';
import { getLLMProfiles } from '../src/config/LLMConfig.js';
import { LLMProviderRegistry } from '../src/llm/LLMProviderRegistry.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const registry = new LLMProviderRegistry(getLLMProfiles({
  LLM_PROVIDER: 'soclaas',
  SOCLAAS_API_KEY: 'qwen-secret',
  SOCLAAS_MODEL: 'qwen3.8:27b',
  DEEPSEEK_API_KEY: 'deepseek-secret',
  DEEPSEEK_MODEL: 'deepseek-v4-pro',
}));
const app = createApp({ llmProviderRegistry: registry });
const server = app.listen(0);

try {
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const profileResponse = await fetch(`${baseUrl}/llm/profiles`);
  const profilePayload = await profileResponse.json();
  assert(profileResponse.ok && profilePayload.profiles.length === 2, 'profile endpoint should list both configured models');
  assert(!JSON.stringify(profilePayload).includes('qwen-secret'), 'profile endpoint must not expose credentials');
  assert(!JSON.stringify(profilePayload).includes('soclaas-api.comp.nus.edu.sg'), 'profile endpoint must not expose provider endpoints');

  const tutorialResponse = await fetch(`${baseUrl}/sessions/tutorials/birch-station`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ llmProfileId: 'deepseek:deepseek-v4-pro' }),
  });
  const tutorialPayload = await tutorialResponse.json();
  assert(tutorialResponse.ok, 'tutorial creation with a selected model should succeed');
  assert(tutorialPayload.session.llmProfileId === 'deepseek:deepseek-v4-pro', 'tutorial should persist the selected model profile');

  const fallbackResponse = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'fallback', llmProfileId: 'unknown:model' }),
  });
  const fallbackPayload = await fallbackResponse.json();
  assert(fallbackPayload.session.llmProfileId === profilePayload.defaultProfileId, 'unknown profiles should safely fall back to the configured default');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`${passed} passed`);

