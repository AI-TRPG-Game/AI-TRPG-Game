// NOTE: Browser-side API calls are for BYOK local testing only.
// API keys cannot be fully protected in a pure front-end app.
// For real deployment, move provider calls to a backend proxy.

/**
 * Minimal OpenAI-compatible chat.completions call.
 * Works for:
 * - OpenAI (baseUrl https://api.openai.com/v1)
 * - DeepSeek (baseUrl https://api.deepseek.com/v1)
 *
 * @param {{
 *  baseUrl: string,
 *  apiKey: string,
 *  model: string,
 *  messages: Array<{role: 'system'|'user'|'assistant', content: string}>,
 *  temperature?: number
 * }} params
 */
export async function generate({ baseUrl, apiKey, model, messages, temperature = 0.8 }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Provider error: ${r.status} ${text}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Simple raw text generation for the "simple chat" step.
 * - Sends only (optional) system prompt + the latest user message.
 * - No memory management.
 */
export async function generateSimpleChat({ baseUrl, apiKey, model, systemPrompt, userText }) {
  const messages = [];
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userText });

  return generate({ baseUrl, apiKey, model, messages });
}
