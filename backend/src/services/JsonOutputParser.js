/**
 * JSON 输出解析器 —— 替代旧的 TagParser（XML regex 解析）。
 * 解析 LLM 返回的 JSON 字符串，提取各字段。
 *
 * 解析策略（按优先级递进）：
 * 1. 直接 JSON.parse(clean(raw))
 * 2. 提取代码块（任意位置）后 JSON.parse
 * 3. 用括号配对算法从混合文本中提取第一个完整的 {...} 后 JSON.parse
 * 4. 修复字符串值内未转义的双引号后重新走 1+3
 *
 * 设计动机：DeepSeek 思考模式 + strict 模式下，LLM 偶尔：
 *   - 不调用 function，把内容放在 content 字段
 *   - content 可能是混合文本（前缀寒暄 + JSON + 后缀说明）
 *   - 字符串值内输出未转义双引号（strict schema 校验不到的细节错误）
 */
import { hasCardKey } from '../domain/CharacterCardSchema.js';
import { hasDiceField, NARRATION, SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION } from '../domain/NarrativeSchema.js';

const THINK_OPEN_TAG = '<' + 'think>';
const THINK_CLOSE_TAG = '<' + '/think>';
const THINK_RE = new RegExp('^\\s*[\\s\\S]*?' + THINK_CLOSE_TAG + '\\s*', 'i');

export class JsonOutputParser {
  clean(raw) {
    if (!raw) return '';
    let text = String(raw).trim();
    text = text
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    return text.replace(THINK_RE, '').trim();
  }

  /**
   * @param {string} raw - LLM 返回的原始文本
   * @returns {Object|null} 解析后的 JSON 对象，或 null
   */
  parse(raw) {
    if (!raw) return null;
    const text = this.clean(raw);

    // 阶段 A：原始文本直接尝试解析（含代码块提取、括号配对）
    const directResult = this._tryParseText(text);
    if (directResult !== null) return directResult;

    // 阶段 B：修复未转义引号后再尝试解析
    //   场景：strict 模式下 LLM 偶尔在字符串值内输出未转义双引号
    const repaired = this._repairUnescapedQuotes(text);
    if (repaired && repaired !== text) {
      const repairedResult = this._tryParseText(repaired);
      if (repairedResult !== null) return repairedResult;
    }

    return null;
  }

  /**
   * 在文本上尝试 3 种解析策略：直接 parse / 代码块提取 / 括号配对提取
   * @param {string} text 已 clean 过的文本
   * @returns {Object|null}
   */
  _tryParseText(text) {
    if (!text) return null;

    // 1. 直接 JSON.parse
    try {
      return JSON.parse(text);
    } catch {
      // 落到下一步
    }

    // 2. 提取代码块（任意位置）
    const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]);
      } catch {
        // 落到下一步
      }
    }

    // 3. 用括号配对算法提取第一个完整的 {...} JSON 对象
    //    场景：content 字段含混合文本，JSON 嵌在中间
    const jsonObj = this._extractFirstJsonObject(text);
    if (jsonObj) {
      try {
        return JSON.parse(jsonObj);
      } catch {
        // 真的不是合法 JSON
      }
    }

    return null;
  }

  /**
   * 修复 JSON 字符串值内未转义的双引号。
   *
   * 算法：状态机 + 前瞻
   *   - 跟踪是否在字符串内
   *   - 在字符串内遇到双引号时，向后看跳过空白：
   *     - 若是逗号 大括号 方括号 冒号 或字符串结尾，则是字符串结束，保留
   *     - 否则是非法内嵌，转义为反斜线+双引号
   *   - 已转义的引号原样保留，不重复转义
   *
   * 安全性：合法 JSON（中文引号、已转义引号）不会被修改，因为它们能被 JSON.parse 直接通过，
   *         根本不会走到本方法。
   *
   * @param {string} text
   * @returns {string|null} 修复后的字符串，或 null（无修复空间）
   */
  _repairUnescapedQuotes(text) {
    if (!text) return null;

    // 找到第一个 { 起始位置（跳过前缀寒暄）
    const start = text.indexOf('{');
    if (start < 0) return null;

    let result = text.slice(0, start); // 保留前缀
    let inString = false;
    let i = start;

    while (i < text.length) {
      const c = text[i];

      if (!inString) {
        if (c === '"') {
          inString = true;
          result += c;
          i++;
        } else if (c === '\\' && i + 1 < text.length) {
          // 非字符串状态下的转义符（不应该出现，但安全起见保留）
          result += c + text[i + 1];
          i += 2;
        } else {
          result += c;
          i++;
        }
        continue;
      }

      // 字符串状态
      if (c === '\\' && i + 1 < text.length) {
        // 合法转义，原样保留
        result += c + text[i + 1];
        i += 2;
        continue;
      }

      if (c === '"') {
        // 判断是字符串结束还是非法内嵌
        // 向后看跳过空白，若遇逗号 大括号 方括号 冒号 或字符串结尾，则是结束
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;

        if (
          j >= text.length ||
          text[j] === ',' ||
          text[j] === '}' ||
          text[j] === ']' ||
          text[j] === ':'
        ) {
          // 字符串结束
          inString = false;
          result += c;
          i++;
        } else {
          // 非法内嵌的双引号，转义
          result += '\\"';
          i++;
        }
        continue;
      }

      result += c;
      i++;
    }

    return result;
  }

  /**
   * 括号配对算法：从文本中提取第一个完整的 {...} 对象。
   * 正确处理字符串内的 {}、转义符、嵌套对象。
   * @param {string} text
   * @returns {string|null} 第一个完整 JSON 对象的字符串形式，或 null
   */
  _extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
        if (depth < 0) return null; // 括号失衡
      }
    }
    return null; // 括号未闭合
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

  /**
   * 检测是否包含可存档的世界观字段
   * 优先校验 key_description（存档目标字段），兜底 world_impression
   * 设计动机：SaveExtractor 存档时返回 key_description || world_impression，
   *          所以两者任一存在即可存档；但 key_description 是首选
   */
  hasWorldDescription(parsed) {
    const hasKey = !!(parsed && typeof parsed[KEY_DESCRIPTION] === 'string' && parsed[KEY_DESCRIPTION].trim());
    const hasImpression = !!(parsed && typeof parsed[WORLD_IMPRESSION] === 'string' && parsed[WORLD_IMPRESSION].trim());
    return hasKey || hasImpression;
  }

  /** 检测是否包含 角色档案 字段 */
  hasCharacterCard(parsed) {
    return hasCardKey(parsed);
  }
}

export const jsonOutputParser = new JsonOutputParser();
