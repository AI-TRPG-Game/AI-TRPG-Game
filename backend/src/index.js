import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { getLLMProfiles } = await import('./config/LLMConfig.js');
const { LLMProviderRegistry } = await import('./llm/LLMProviderRegistry.js');
const { createApp } = await import('./api/GameController.js');

const PORT = process.env.PORT || 3001;
const llmProviderRegistry = new LLMProviderRegistry(getLLMProfiles());
const defaultEntry = llmProviderRegistry.resolve();

const app = createApp({ llmProviderRegistry });

app.listen(PORT, () => {
  console.log(
    `AI-TRPG stateless backend running on http://localhost:${PORT} ` +
    `(default LLM provider=${defaultEntry.provider.provider}, model=${defaultEntry.provider.model}, ` +
    `profiles=${llmProviderRegistry.listPublicProfiles().length})`
  );
});
