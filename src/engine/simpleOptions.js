import { generateSimpleChat } from "../llm/providers/openaiProvider.js";

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

/**
 * Build a format-enforcing system prompt to make the model output A/B/C/D options.
 * @param {{baseSystemPrompt: string}} params
 */
export function buildOptionsSystemPrompt({ baseSystemPrompt }) {
  const base = (baseSystemPrompt || '').trim();
  const rules = `
你是一个文字冒险/跑团主持人(KP)。
请用中文回复。

【输出格式强制要求】
- 你的回复必须以四个选项结尾，并严格使用以下格式（每行一个选项）：
A. <选项内容>
B. <选项内容>
C. <选项内容>
D. 自由活动：<选项内容>

- D 选项必须以“自由活动：”开头。
- 选项内容要具体、可执行。
- 除了选项之外，你可以先输出1-6段剧情/旁白。
`;

  return [base, rules].filter(Boolean).join('\n\n');
}

/**
 * Parse the last A/B/C/D options from model output.
 * Returns null if not found.
 *
 * @param {string} text
 * @returns {{ narrative: string, options: Array<{key: 'A'|'B'|'C'|'D', text: string}> } | null}
 */
export function parseABCDOptions(text) {
  if (!text) return null;

  // Accept variations like "A." "A、" "A)" "A：" and whitespace.
  const line = (label) => `(?:^|\n)\s*${label}\s*[\.、\)\:]\s*(.+?)\s*(?=\n|$)`;
  const re = new RegExp(
    `${line('A')}${line('B')}${line('C')}${line('D')}`,
    's'
  );

  const m = text.match(re);
  if (!m) return null;

  const a = (m[1] || '').trim();
  const b = (m[2] || '').trim();
  const c = (m[3] || '').trim();
  const d = (m[4] || '').trim();

  // D must start with 自由活动
  if (!/^自由活动\s*：/.test(d)) return null;

  // narrative = everything before the first option label occurrence
  const idxA = text.search(/\n\s*A\s*[\.、\)\:]/);
  const narrative = (idxA >= 0 ? text.slice(0, idxA) : '').trim();

  return {
    narrative: narrative || text.trim(),
    options: [
      { key: 'A', text: a },
      { key: 'B', text: b },
      { key: 'C', text: c },
      { key: 'D', text: d },
    ],
  };
}

/**
 * Step-2 (lightweight): ask model to return A/B/C/D options and render as buttons.
 * No memory management: we still send only system + latest user.
 */
export async function runSimpleChatWithOptions({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userText,
}) {
  const enforcedSystemPrompt = buildOptionsSystemPrompt({ baseSystemPrompt: systemPrompt });

  const raw = await generateSimpleChat({
    baseUrl,
    apiKey,
    model,
    systemPrompt: enforcedSystemPrompt,
    userText,
  });

  const parsed = parseABCDOptions(raw);
  if (!parsed) {
    // If format fails, return raw text and no options.
    return { text: raw, options: [] };
  }

  return {
    text: parsed.narrative,
    options: parsed.options,
    raw,
  };
}
