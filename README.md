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
- Returns deterministic JSON so you can test the whole loop:
  - meta/normal modes
  - options buttons
  - external dice roll
  - inventory updates
  - localStorage save/load

### OpenAI (BYOK, for local testing only)
- Paste your OpenAI API key into the UI. It is stored in `localStorage`.
- **Security warning:** browser-side keys cannot be fully protected.
  - Do **NOT** use a high-privilege key.
  - Do **NOT** deploy this build publicly with a real key.

### OpenRouter (BYOK, for local testing only)
- Choose OpenRouter in the provider dropdown and paste your OpenRouter API key.
- Use an OpenRouter model name (for example `openai/gpt-4.1-mini`).
- The key is stored in `localStorage` and has the same browser-side security risks as above.

## Why no backend?
This repo starts with the simplest option (A).

For real deployment, move LLM calls to a backend proxy (Option B) and store API keys in server environment variables.
