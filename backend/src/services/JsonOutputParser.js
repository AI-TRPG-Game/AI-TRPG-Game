/**
 * JSON 输出解析器 —— 替代旧的 TagParser（XML regex 解析）。
 * 解析 LLM 返回的 JSON 字符串，提取各字段。
 */
import { hasCardKey } from '../domain/CharacterCardSchema.js';
import { hasDiceField, NARRATION, SUMMARY, WORLD_IMPRESSION } from '../domain/NarrativeSchema.js';
export class JsonOutputParser {
  clean(raw) {
    if (!raw) return '';
    let text = String(raw).trim();
    text = text
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim();
  }

  /**
   * @param {string} raw - LLM 返回的原始文本
   * @returns {Object|null} 解析后的 JSON 对象，或 null
   */
  parse(raw) {
    if (!raw) return null;
    const text = this.clean(raw);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** 检测是否包含 dice 字段 */
  hasDice(parsed) {
    return hasDiceField(parsed);
  }

  /** 检测是否包含 narration 字段 */
  hasNarration(parsed) {
    return !!(parsed && typeof parsed[NARRATION] === 'string' && parsed[NARRATION].trim());
  }

  /** 检测是否包含 summary 字段 */
  hasSummary(parsed) {
    return !!(parsed && typeof parsed[SUMMARY] === 'string' && parsed[SUMMARY].trim());
  }

  /** 检测是否包含 world_impression 字段 */
  hasWorldDescription(parsed) {
    return !!(parsed && typeof parsed[WORLD_IMPRESSION] === 'string' && parsed[WORLD_IMPRESSION].trim());
  }

  /** 检测是否包含 角色档案 字段 */
  hasCharacterCard(parsed) {
    return hasCardKey(parsed);
  }
}

export const jsonOutputParser = new JsonOutputParser();
