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

## Mode
- **纯聊天（无记忆）**: calls the provider with only (optional) system prompt + latest user message.
- **游戏（结构化JSON）**: keeps the structured JSON loop.

## New: Simple options format (A/B/C/D)
In **纯聊天（无记忆）** mode you can enable **“固定选项(A/B/C/D)”**.

- The model is instructed to **end every reply** with 4 options:
  - `A. ...`
  - `B. ...`
  - `C. ...`
  - `D. 自由活动：...` (D must be “自由活动”)
- The UI parses these options and renders them as buttons.
- Clicking a button automatically sends that option text back to the model as the next user message.

This is a lightweight “format enforcement” step before moving to full JSON schemas.
