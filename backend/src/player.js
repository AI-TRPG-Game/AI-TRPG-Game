import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlayerApp } from './playerServer.js';
import { getLLMProfiles } from './config/LLMConfig.js';
import { LLMProviderRegistry } from './llm/LLMProviderRegistry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, 'backend/.env') });
const token = process.env.TRPG_LAUNCH_TOKEN;
if (!token) throw new Error('请使用启动游戏启动播放器。');
const app = createPlayerApp({
  token, origin: 'http://127.0.0.1:5173', dist: path.join(root, 'dist'),
  llmProviderRegistry: new LLMProviderRegistry(getLLMProfiles()),
  shutdown: () => { server.close(() => process.exit(0)); server.closeIdleConnections(); },
});
const server = app.listen(5173, '127.0.0.1');
server.on('error', error => { console.error(error); process.exit(1); });
