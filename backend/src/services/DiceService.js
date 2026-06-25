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

  formatSystemMessage(values) {
    return `【系统投掷结果】${this.formatResults(values)}`;
  }
}

export const diceService = new DiceService();
