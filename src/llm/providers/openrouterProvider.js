// NOTE: Browser-side OpenRouter calls are for BYOK local testing only.
// API keys cannot be fully protected in a pure front-end app.
// For real deployment, move LLM calls to a backend proxy.

export async function generate({ apiKey, model, messages }) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin,
      "X-Title": document.title || "AI-TRPG-MVP",
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 2048,
      messages,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`OpenRouter error: ${r.status} ${text}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}
