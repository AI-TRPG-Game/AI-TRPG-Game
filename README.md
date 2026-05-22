# AI+TRPG MVP (Pure Front-end)

This repository contains a minimal **pure front-end** MVP for an AI+TRPG single-player experience.

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Providers

### Mock (default)
- No API key needed.
- Returns deterministic JSON so you can test the whole loop.

### DeepSeek (BYOK, for local testing only)
- DeepSeek provides an OpenAI-compatible API (`/chat/completions`).
- Paste your DeepSeek API key into the UI. It is stored in `localStorage`.
- Default model in UI: `deepseek-v4-flash` (you can change it).

### OpenAI (BYOK, for local testing only)
- Paste your OpenAI API key into the UI. It is stored in `localStorage`.

## Security warning (important)
Browser-side keys cannot be fully protected.
- Do **NOT** deploy this build publicly with a real key.
- For real deployment, move provider calls to a backend proxy (Option B) and store API keys in server environment variables.

## Mode
- **纯聊天（无记忆）**: calls the provider with only (optional) system prompt + latest user message.
- **游戏（结构化JSON）**: keeps the structured JSON loop.
