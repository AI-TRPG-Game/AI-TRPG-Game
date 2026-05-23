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

## Security warning (important)
Browser-side keys cannot be fully protected.
- Do **NOT** deploy this build publicly with a real key.
- For real deployment, move provider calls to a backend proxy (Option B) and store API keys in server environment variables.

## Modes

### 纯聊天（无记忆）
Calls the provider with only (optional) system prompt + latest user message.

### 游戏（结构化JSON）
Keeps the older structured JSON loop (legacy).

## New: Narrative flows (engineering scaffold)
This branch adds a **flow-based** orchestrator scaffold aligned with the product docs:

Flow types:
- `WORLD_GEN` (Meta)
- `PC_GEN` (Meta)
- `OPENING` (Normal)
- `CHECK_REQUEST` (Normal)
- `NORMAL_TURN` (Normal)

We currently implement a lightweight output format:
- Narrative text followed by A/B/C/D options where D must be `自由活动：...`
- The UI renders options as buttons. Clicking sends the option text as next input.

This is a stepping stone before moving to full JSON schema outputs.
