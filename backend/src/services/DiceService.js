import crypto from 'crypto';

export class DiceService {
  parseNotation(diceTagContent) {
    if (!diceTagContent) return [];
    const requests = [];
    const parts = diceTagContent.split(',').map((p) => p.trim());

    for (const part of parts) {
      const match = part.match(/(\d+)d(\d+)/i);
      if (match) {
        requests.push({
          count: parseInt(match[1], 10),
          sides: parseInt(match[2], 10),
          notation: part,
        });
      }
    }
    return requests;
  }

  rollDie(sides) {
    return crypto.randomInt(1, sides + 1);
  }

  rollAll(requests) {
    const results = [];
    for (const req of requests) {
      for (let i = 0; i < req.count; i++) {
        results.push(this.rollDie(req.sides));
      }
    }
    return results;
  }

  formatResults(values) {
    return values.join(', ');
  }

  /**
   * 按 COC 7e 规则判定成功等级。
   *
   * 规则（标准 COC 7e）：
   *   - 1d100 投掷，结果范围 1-100
   *   - 1 总是大成功；100 总是大失败
   *   - 当 skillPoint < 50 时，96-100 为大失败
   *   - 当 roll ≤ 5 且 roll ≤ skillPoint 时为大成功（极端值优先于极难成功）
   *   - roll ≤ skillPoint/5 → 极难成功
   *   - roll ≤ skillPoint/2 → 困难成功
   *   - roll ≤ skillPoint   → 一般成功
   *   - 其余                → 一般失败
   *
   * @param {number} skillPoint 技能点数（0-100）
   * @param {number} rollValue  1d100 投掷结果（1-100）
   * @returns {string} 成功等级中文名
   */
  evaluateSuccess(skillPoint, rollValue) {
    const sp = Number(skillPoint);
    const roll = Number(rollValue);

    // 极端值优先
    if (roll === 1) return '大成功';
    if (roll === 100) return '大失败';
    if (roll >= 96 && sp < 50) return '大失败';

    // 大成功：1-5 且 ≤ skillPoint
    if (roll <= 5 && roll <= sp) return '大成功';

    // 极难成功：≤ skillPoint/5
    if (roll <= Math.floor(sp / 5)) return '极难成功';

    // 困难成功：≤ skillPoint/2
    if (roll <= Math.floor(sp / 2)) return '困难成功';

    // 一般成功：≤ skillPoint
    if (roll <= sp) return '一般成功';

    return '一般失败';
  }

  /**
   * 组装系统投掷结果消息。
   *
   * v2 改造：由系统按 COC 7e 规则判定成功等级，组装为
   *   【使用${skillName}技能（技能点${skillPoint}），判定结果${value}，${level}】
   *
   * 替代原"【系统投掷结果】9"格式，LLM 无需再自行生成判定等级。
   *
   * @param {{ skillName: string, skillPoint: number, notation: string, successRate: number, values: number[] }} dice
   * @returns {string}
   */
  formatSystemMessage({ skillName, skillPoint, notation, successRate, values }) {
    const value = Array.isArray(values) ? values[0] : values;
    const level = this.evaluateSuccess(skillPoint, value);
    return `【使用${skillName || ''}技能（技能点${skillPoint ?? ''}），判定结果${value}，${level}】`;
  }
}

export const diceService = new DiceService();
