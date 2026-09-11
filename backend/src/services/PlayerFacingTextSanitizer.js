import {
  NARRATION, LOCATIONS, NPCS, ITEMS, OPTIONS,
  ENDING_TITLE, ENDING_TEXT, IMMEDIATE_RESOLUTION, PLAYER_OUTCOME,
  CHARACTER_OUTCOMES, TRUTH_OUTCOME,
} from '../domain/NarrativeSchema.js';

const INTERNAL_ID = /\b(?:loc|evidence|npc|item)_\d{3,}\b/gi;
const SPACE_ENTITIES = /(?:&#x20;|&#32;|&nbsp;)/gi;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHiddenNpc(session, id) {
  return session.npcs?.find(npc => npc.id === id)?.visibility === 'hidden';
}

function replacementFor(session, id) {
  if (/^loc_/i.test(id)) {
    const location = session.locations?.find(entry => entry.id === id)
      || session.scenarioRules?.locationCatalog?.[id];
    return location?.name || '某处地点';
  }
  if (/^evidence_/i.test(id)) {
    const clue = session.evidence?.find(entry => entry.id === id)
      || session.scenarioRules?.clueCatalog?.[id];
    return clue?.source || '一项线索';
  }
  if (/^npc_/i.test(id)) {
    const npc = session.npcs?.find(entry => entry.id === id);
    return npc && !isHiddenNpc(session, id) ? (npc.name || '某人') : '某人';
  }
  if (/^item_/i.test(id)) {
    return session.inventory?.find(entry => entry.id === id)?.name || '一件物品';
  }
  return '相关信息';
}

function sanitizeText(session, value) {
  if (typeof value !== 'string' || !value) return value;
  let text = value.replace(SPACE_ENTITIES, ' ');

  // Prefer removing a redundant parenthesized identifier when the readable
  // name immediately precedes it: “头等包厢外（loc_001）” -> “头等包厢外”.
  for (const id of new Set(text.match(INTERNAL_ID) || [])) {
    const replacement = replacementFor(session, id);
    const redundant = new RegExp(`${escapeRegExp(replacement)}\\s*[（(]\\s*${escapeRegExp(id)}\\s*[）)]`, 'gi');
    text = text.replace(redundant, replacement);
  }

  text = text.replace(INTERNAL_ID, id => replacementFor(session, id));
  return text.replace(/[ \t]+(?=\r?\n|$)/g, '').replace(/[ \t]{2,}/g, ' ');
}

function sanitizeArrayStrings(session, value) {
  return Array.isArray(value) ? value.map(entry => sanitizeText(session, entry)) : value;
}

function sanitizeParsed(session, parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const safe = structuredClone(parsed);
  safe[NARRATION] = sanitizeText(session, safe[NARRATION]);
  safe[OPTIONS] = sanitizeArrayStrings(session, safe[OPTIONS]);

  for (const location of safe[LOCATIONS] || []) {
    location.name = sanitizeText(session, location.name);
    location.description = sanitizeText(session, location.description);
  }
  for (const npc of safe[NPCS] || []) {
    npc.name = sanitizeText(session, npc.name);
    npc.baseDescription = sanitizeText(session, npc.baseDescription);
    npc.description = sanitizeText(session, npc.description);
    npc.currentState = sanitizeText(session, npc.currentState);
  }
  for (const item of safe[ITEMS] || []) {
    item.name = sanitizeText(session, item.name);
    item.status = sanitizeText(session, item.status);
    item.description = sanitizeText(session, item.description);
  }

  for (const field of [ENDING_TITLE, ENDING_TEXT, IMMEDIATE_RESOLUTION, PLAYER_OUTCOME, TRUTH_OUTCOME]) {
    safe[field] = sanitizeText(session, safe[field]);
  }
  if (Array.isArray(safe[CHARACTER_OUTCOMES])) {
    for (const outcome of safe[CHARACTER_OUTCOMES]) {
      outcome.name = sanitizeText(session, outcome.name);
      outcome.outcome = sanitizeText(session, outcome.outcome);
    }
  }
  if (safe.debrief && typeof safe.debrief === 'object') {
    safe.debrief.hidden_plot = sanitizeText(session, safe.debrief.hidden_plot);
    safe.debrief.important_events = sanitizeArrayStrings(session, safe.debrief.important_events);
    safe.debrief.evidence_used = sanitizeArrayStrings(session, safe.debrief.evidence_used);
    safe.debrief.missed_leads = sanitizeArrayStrings(session, safe.debrief.missed_leads);
    safe.debrief.next_try = sanitizeText(session, safe.debrief.next_try);
  }
  return safe;
}

function sanitizeSessionPresentation(session) {
  session.optionBuffer = sanitizeText(session, session.optionBuffer || '');
  for (const entry of session.displayLog || []) entry.content = sanitizeText(session, entry.content);
  for (const entry of session.chatRecord || []) {
    entry.content = sanitizeText(session, entry.content);
    if (entry.parsed) entry.parsed = sanitizeParsed(session, entry.parsed);
  }
  if (session.storyOpeningCache?.parsed) {
    session.storyOpeningCache.parsed = sanitizeParsed(session, session.storyOpeningCache.parsed);
  }
}

export const playerFacingTextSanitizer = {
  sanitizeText,
  sanitizeParsed,
  sanitizeSessionPresentation,
};
