// NOTE: Browser-side OpenAI calls are for BYOK local testing only.
// API keys cannot be fully protected in a pure front-end app.
// For real deployment, move OpenAI calls to a backend proxy.

/**
 * Minimal OpenAI chat.completions call.
 * @param {{apiKey: string, model: string, messages: Array<{role: 'system'|'user'|'assistant', content: string}>}} params
 */
export async function generate({ apiKey, model, messages }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`OpenAI error: ${r.status} ${text}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Simple raw text generation for the "simple chat" step.
 * - Sends only (optional) system prompt + the latest user message.
 * - No memory management.
 */
export async function generateSimpleChat({ apiKey, model, systemPrompt, userText }) {
  const messages = [];
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userText });

  return generate({ apiKey, model, messages });
}
