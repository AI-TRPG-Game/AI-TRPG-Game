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

  /**
   * 通用骰子公式投掷（支持 NdM+K 格式）。
   * @param {string} formula - 如 '1d6', '2d6+1', '1d4+2', '1d100'
   * @returns {number} 投掷结果总和（含加成）
   */
  rollFormula(formula) {
    if (!formula || typeof formula !== 'string') {
      throw new Error(`无效的骰子公式: ${formula}`);
    }
    const match = formula.trim().match(/^(\d+)d(\d+)(?:\+(\d+))?$/i);
    if (!match) {
      throw new Error(`无法解析骰子公式: ${formula}，仅支持 NdM+K 格式`);
    }
    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const bonus = match[3] ? parseInt(match[3], 10) : 0;
    if (count < 1 || count > 100) throw new Error(`骰子数量超限: ${count}`);
    if (sides < 2 || sides > 1000) throw new Error(`骰子面数超限: ${sides}`);

    let total = bonus;
    for (let i = 0; i < count; i++) {
      total += this.rollDie(sides);
    }
    return total;
  }

  /**
   * 1d100 投掷 + 惩罚/奖励骰（CoC 7e 规则）。
   * 1d100 = 十位骰(d10×10) + 个位骰(d10)。
   * 奖励骰：多投十位骰，取较小十位（让结果更易成功）。
   * 惩罚骰：多投十位骰，取较大十位（让结果更难成功）。
   * 官方建议最多 2 个，本方法钳制到 0-2。
   *
   * @param {number} bonusDice - 奖励骰数量（0-2，超出钳制）
   * @param {number} penaltyDice - 惩罚骰数量（0-2，超出钳制）
   * @returns {{value: number, tens: number[], ones: number, usedTensIndex: number}}
   *   - value: 最终 1d100 结果
   *   - tens: 所有十位骰结果（含原始那个，用于诊断展示）
   *   - ones: 个位骰结果
   *   - usedTensIndex: 最终使用的十位骰在 tens 数组中的索引
   */
  rollWithBonusPenalty(bonusDice = 0, penaltyDice = 0) {
    const bonus = Math.min(Math.max(bonusDice, 0), 2);
    const penalty = Math.min(Math.max(penaltyDice, 0), 2);
    const extraTens = Math.max(bonus, penalty); // 额外十位骰数量

    // 投十位骰（0-9，代表 00,10,20...90）+ 个位骰（1-10，10 代表 0）
    const tens = [];
    for (let i = 0; i <= extraTens; i++) {
      tens.push(this.rollDie(10) - 1); // 0-9
    }
    const ones = this.rollDie(10) % 10; // 0-9（10%10=0）

    // 选择使用的十位骰
    let usedTensIndex = 0;
    if (bonus > 0) {
      // 奖励骰：取最小十位
      let minVal = tens[0];
      for (let i = 1; i < tens.length; i++) {
        if (tens[i] < minVal) { minVal = tens[i]; usedTensIndex = i; }
      }
    } else if (penalty > 0) {
      // 惩罚骰：取最大十位
      let maxVal = tens[0];
      for (let i = 1; i < tens.length; i++) {
        if (tens[i] > maxVal) { maxVal = tens[i]; usedTensIndex = i; }
      }
    }

    const rawValue = tens[usedTensIndex] * 10 + ones;
    // CoC 7e 规则：十位骰=0(即 00) + 个位骰=0(即 0) 时，结果应为 100（大失败），而非 0
    // 触发概率 1%，若不修正会将"大失败"误判为"大成功"（evaluateSuccess 中 roll===1 返回大成功）
    const value = rawValue === 0 ? 100 : rawValue;
    return { value, tens, ones, usedTensIndex };
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
