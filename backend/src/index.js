import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { OpenAICompatibleProvider } = await import('./llm/OpenAICompatibleProvider.js');
const { createApp } = await import('./api/GameController.js');

const PORT = process.env.PORT || 3001;

const llmProvider = new OpenAICompatibleProvider({
  apiKey: process.env.LLM_API_KEY,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
});

const app = createApp({ llmProvider });

app.listen(PORT, () => {
  console.log(`AI-TRPG stateless backend running on http://localhost:${PORT}`);
});
