/**
 * JSON 输出解析器 —— 替代旧的 TagParser（XML regex 解析）。
 * 解析 LLM 返回的 JSON 字符串，提取各字段。
 */
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
    return !!(parsed && parsed.dice && typeof parsed.dice === 'object');
  }

  /** 检测是否包含 narration 字段 */
  hasNarration(parsed) {
    return !!(parsed && typeof parsed.narration === 'string' && parsed.narration.trim());
  }

  /** 检测是否包含 summary 字段 */
  hasSummary(parsed) {
    return !!(parsed && typeof parsed.summary === 'string' && parsed.summary.trim());
  }

  /** 检测是否包含 world_description 字段 */
  hasWorldDescription(parsed) {
    return !!(parsed && typeof parsed.world_description === 'string' && parsed.world_description.trim());
  }

  /** 检测是否包含 character_card 字段 */
  hasCharacterCard(parsed) {
    return !!(parsed && parsed.character_card && typeof parsed.character_card === 'object');
  }
}

export const jsonOutputParser = new JsonOutputParser();
