import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { getLLMConfig } = await import('./config/LLMConfig.js');
const { OpenAICompatibleProvider } = await import('./llm/OpenAICompatibleProvider.js');
const { createApp } = await import('./api/GameController.js');

const PORT = process.env.PORT || 3001;
const llmConfig = getLLMConfig();

const llmProvider = new OpenAICompatibleProvider(llmConfig);

const app = createApp({ llmProvider });

app.listen(PORT, () => {
  console.log(
    `AI-TRPG stateless backend running on http://localhost:${PORT} ` +
    `(LLM provider=${llmProvider.provider}, model=${llmProvider.model})`
  );
});
