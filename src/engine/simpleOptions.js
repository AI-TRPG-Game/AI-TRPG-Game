import { generateSimpleChat } from "../llm/providers/openaiProvider.js";

// Parsing helpers for the “A/B/C/D options” transitional format
// and a minimal check-decision format.

/**
 * Parse A/B/C/D options at end of assistant output.
 * Accepts lines like:
 *  A. xxx
 *  B. xxx
 *  C. xxx
 *  D. 自由活动：xxx
 */
export function parseABCDOptions(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);

  function findLine(prefix) {
    const idx = lines.findIndex((l) => l.trim().startsWith(prefix));
    return idx;
  }

  const aIdx = findLine('A.');
  const bIdx = findLine('B.');
  const cIdx = findLine('C.');
  const dIdx = findLine('D.');
  if ([aIdx, bIdx, cIdx, dIdx].some((x) => x < 0)) return null;

  if (!(aIdx < bIdx && bIdx < cIdx && cIdx < dIdx)) return null;

  const narrative = lines.slice(0, aIdx).join('\n').trim();

  const pick = (idx, key) => {
    const raw = lines[idx].trim();
    const text2 = raw.slice(2).trim();
    return { key, text: text2 };
  };

  const options = [pick(aIdx, 'A'), pick(bIdx, 'B'), pick(cIdx, 'C'), pick(dIdx, 'D')];

  // D must be free action in MVP
  if (!/^自由活动：/.test(options[3].text)) {
    return null;
  }

  return { narrative, options };
}

/**
 * Enforce A/B/C/D options for simple chat.
 */
export async function runSimpleChatWithOptions({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userText,
}) {
  const enforce =
    '请在回复末尾严格给出四行选项：\n' +
    'A. ...\n' +
    'B. ...\n' +
    'C. ...\n' +
    'D. 自由活动：...\n' +
    '不要输出多余解释、不要输出 Markdown 代码块。';

  const mergedSystem = [systemPrompt, enforce].filter(Boolean).join('\n\n');
  const raw = await generateSimpleChat({
    baseUrl,
    apiKey,
    model,
    systemPrompt: mergedSystem,
    userText,
  });

  const parsed = parseABCDOptions(raw);
  return {
    text: parsed?.narrative || raw,
    options: parsed?.options || [],
    raw,
  };
}

/**
 * Parse a minimal check decision.
 * We ask the model to output something like:
 *  needs_check: yes|no
 *  dice: d20|d100
 *  reason: ...
 */
export function parseCheckDecision(text) {
  if (!text || typeof text !== 'string') return null;

  const needs = /needs_check\s*:\s*(yes|no)/i.exec(text);
  if (!needs) return null;
  const needsCheck = needs[1].toLowerCase() === 'yes';

  const dice = /dice\s*:\s*d\s*(\d+)/i.exec(text);
  const sides = dice ? Number(dice[1]) : null;

  const reason = /reason\s*:\s*(.+)/i.exec(text)?.[1]?.trim() || null;

  return { needsCheck, sides, reason };
}

/**
 * Parse NPC proposals from a tagged text section.
 * Format (A chosen by user):
 * 
 * 重要人物：
 * - 姓名 | 与主角关系 | 详细描述
 * - （可多条）
 *
 * Returns [] if none.
 */
export function parseNpcProposals(text) {
  if (!text || typeof text !== 'string') return [];
  const m = /(^|\n)重要人物：\s*\n([\s\S]*?)(\n\s*\n|\nA\.|$)/.exec(text);
  if (!m) return [];

  const block = m[2] || '';
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];
  for (const l of lines) {
    if (!l.startsWith('-')) continue;
    const body = l.replace(/^\-\s*/, '').trim();
    const parts = body.split('|').map((x) => x.trim());
    const name = parts[0] || '';
    const relation = parts[1] || '';
    const description = parts.slice(2).join(' | ').trim();
    if (!name && !description) continue;
    out.push({ name: name || '(未命名)', relation, description });
  }
  return out;
}

/**
 * Parse item proposals from a tagged text section.
 * Format:
 *
 *  重要物品：
 * - 名称 | 描述
 * - 名称
 */
export function parseItemProposals(text) {
  if (!text || typeof text !== 'string') return [];
  const m = /(^|\n)重要物品：\s*\n([\s\S]*?)(\n\s*\n|\nA\.|$)/.exec(text);
  if (!m) return [];

  const block = m[2] || '';
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];
  for (const l of lines) {
    if (!l.startsWith('-')) continue;
    const body = l.replace(/^\-\s*/, '').trim();
    const parts = body.split('|').map((x) => x.trim());
    const name = parts[0] || '';
    const description = parts.slice(1).join(' | ').trim();
    if (!name && !description) continue;
    out.push({ name: name || '(未命名物品)', description });
  }
  return out;
}

/**
 * Parse a quest update line.
 * Format:
 *
 *  任务更新：
 *  <一行任务描述>
 */
export function parseQuestUpdate(text) {
  if (!text || typeof text !== 'string') return null;
  const m = /(^|\n)任务更新：\s*\n([^\n]+)\s*/.exec(text);
  if (!m) return null;
  const value = (m[2] || '').trim();
  return value || null;
}
