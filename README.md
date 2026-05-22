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

### OpenAI (BYOK, for local testing only)
- Paste your OpenAI API key into the UI. It is stored in `localStorage`.
- **Security warning:** browser-side keys cannot be fully protected.
  - Do **NOT** use a high-privilege key.
  - Do **NOT** deploy this build publicly with a real key.

## Mode
- **Normal**: story/game mode.
- **Meta**: out-of-character mode for Q&A / editing settings.

## Next step (requested)
We are adding a **simple chat mode** that calls the LLM API with minimal prompt rules and **no memory management** (send only the latest user message + a small optional system prompt).

For real deployment, move LLM calls to a backend proxy (Option B) and store API keys in server environment variables.
