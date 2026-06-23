import 'dotenv/config';
import { OpenAICompatibleProvider } from './llm/OpenAICompatibleProvider.js';
import { streamEmitter } from './api/StreamEmitter.js';
import { createApp } from './api/GameController.js';

const PORT = process.env.PORT || 3001;

const llmProvider = new OpenAICompatibleProvider({
  apiKey: process.env.LLM_API_KEY,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
});

const app = createApp({ llmProvider, streamEmitter });

app.listen(PORT, () => {
  console.log(`AI-TRPG stateless backend running on http://localhost:${PORT}`);
});
