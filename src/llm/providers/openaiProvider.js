// NOTE: Browser-side OpenAI calls are for BYOK local testing only.
// API keys cannot be fully protected in a pure front-end app.
// For real deployment, move OpenAI calls to a backend proxy.

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
