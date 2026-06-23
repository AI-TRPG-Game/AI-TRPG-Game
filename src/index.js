import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './persistence/database.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { OpenAICompatibleProvider } from './llm/OpenAICompatibleProvider.js';
import { GameOrchestrator } from './orchestrator/GameOrchestrator.js';
import { streamEmitter } from './api/StreamEmitter.js';
import { createApp } from './api/GameController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(__dirname, '../data/trpg.db');

const db = getDatabase(DATABASE_PATH);
const repository = new SessionRepository(db);

const llmProvider = new OpenAICompatibleProvider({
  apiKey: process.env.LLM_API_KEY,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
});

const orchestrator = new GameOrchestrator({
  repository,
  llmProvider,
  streamEmitter,
});

const app = createApp(orchestrator, streamEmitter);

app.listen(PORT, () => {
  console.log(`AI-TRPG backend running on http://localhost:${PORT}`);
});
