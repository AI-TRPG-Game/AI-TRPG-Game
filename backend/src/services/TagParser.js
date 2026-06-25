import { ParsedLLMOutput } from '../domain/ParsedLLMOutput.js';

const TAG_NAMES = [
  'world_description',
  'character_card',
  'narration',
  'location',
  'npc',
  'item',
  'option',
  'dice',
  'HP',
  'SAN',
  'summary',
];

function extractTag(text, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function extractSingleTag(text, tagName) {
  const matches = extractTag(text, tagName);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

export class TagParser {
  parse(raw) {
    const text = raw ?? '';
    const locations = extractTag(text, 'location');
    const npcs = extractTag(text, 'npc');
    const items = extractTag(text, 'item');
    const optionMatches = extractTag(text, 'option');

    return new ParsedLLMOutput({
      raw: text,
      worldDescription: extractSingleTag(text, 'world_description'),
      characterCard: extractSingleTag(text, 'character_card'),
      narration: extractSingleTag(text, 'narration'),
      locations,
      npcs,
      items,
      option: optionMatches.length > 0 ? optionMatches.join('\n') : null,
      dice: extractSingleTag(text, 'dice'),
      hp: extractSingleTag(text, 'HP'),
      san: extractSingleTag(text, 'SAN'),
      summary: extractSingleTag(text, 'summary'),
    });
  }

  static getSupportedTags() {
    return [...TAG_NAMES];
  }
}

export const tagParser = new TagParser();
