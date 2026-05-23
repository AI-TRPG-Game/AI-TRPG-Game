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

  // Ensure order (end-ish); allow some extra trailing whitespace but not extra content after D.
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
 * Parse a minimal check decision.
 * We ask the model to output something like:
 *  needs_check: yes|no
 *  dice: d20|d100
 *  reason: ...
 *
 * This parser is intentionally permissive.
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
