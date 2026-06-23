/**
 * TextRefiner —— 将 LLM 输出的 parsed JSON 重构为人类可读格式。
 *
 * 返回 { plainText, html } 双版本：
 * - plainText: 用于模拟流式输出（逐字显示到前端）
 * - html:      用于 llm_complete 最终渲染（含金色分割线等 HTML）
 */

import { FlowType } from '../domain/enums.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DIVIDER_PLAIN = '\n───\n';
const DIVIDER_HTML = '<div class="kp-divider"></div>';

export class TextRefiner {
  /**
   * @param {string} flowType
   * @param {object} parsed - JSON.parse 后的对象
   * @returns {{ plainText: string, html: string }}
   */
  refine(flowType, parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return this._rawFallback(String(parsed || ''));
    }

    switch (flowType) {
      case FlowType.WORLD_GEN:
        return this._refineWorld(parsed);
      case FlowType.CHARACTER_GEN:
        return this._refineCharacter(parsed);
      case FlowType.STORY_OPENING:
      case FlowType.NARRATION_I:
      case FlowType.NARRATION_II:
        return this._refineNarrative(parsed);
      case FlowType.HISTORY_SUMMARY:
        return this._refineSummary(parsed);
      default:
        return this._rawFallback(JSON.stringify(parsed, null, 2));
    }
  }

  // ── 兜底：非 JSON 或无法识别类型 ──
  _rawFallback(text) {
    const s = text == null ? '' : String(text);
    return { plainText: s, html: escapeHtml(s) };
  }

  // ── 世界观 ──
  _refineWorld(parsed) {
    const desc = parsed.world_description || '';
    return {
      plainText: desc,
      html: escapeHtml(desc),
    };
  }

  // ── 人物设定 ──
  _refineCharacter(parsed) {
    const card = parsed.character_card;
    if (!card) {
      return this._rawFallback(JSON.stringify(parsed, null, 2));
    }

    const lines = [];
    const htmlParts = [];

    const addField = (label, value) => {
      if (value !== undefined && value !== null && value !== '') {
        lines.push(`${label}：${value}`);
        htmlParts.push(`${escapeHtml(label)}：${escapeHtml(String(value))}`);
      }
    };

    addField('姓名', card.name);
    addField('年龄', card.age);
    addField('性别', card.gender);
    addField('职业', card.occupation);
    addField('性格', card.personality);
    addField('人物肖像与重要经历', card.portrait);

    if (card.attributes) {
      const a = card.attributes;
      const attrNames = [
        ['力量', 'strength'], ['敏捷', 'dexterity'], ['体质', 'constitution'],
        ['体型', 'size'], ['外貌', 'appearance'], ['智力', 'intelligence'],
        ['意志', 'willpower'], ['教育', 'education'],
      ];
      const attrParts = [];
      const attrHtml = [];
      for (const [label, key] of attrNames) {
        if (a[key] !== undefined && a[key] !== null) {
          attrParts.push(`${label}：${a[key]}`);
          attrHtml.push(`${escapeHtml(label)}：${a[key]}`);
        }
      }
      if (attrParts.length > 0) {
        lines.push(attrParts.join('  '));
        htmlParts.push(attrHtml.join('  '));
      }
    }

    const stats = [];
    const statsHtml = [];
    if (card.hp !== undefined && card.hp !== null) {
      stats.push(`HP：${card.hp}`);
      statsHtml.push(`HP：${card.hp}`);
    }
    if (card.san !== undefined && card.san !== null) {
      stats.push(`SAN：${card.san}`);
      statsHtml.push(`SAN：${card.san}`);
    }
    if (card.credit_rating !== undefined && card.credit_rating !== null) {
      stats.push(`信用评级：${card.credit_rating}`);
      statsHtml.push(`信用评级：${card.credit_rating}`);
    }
    if (stats.length > 0) {
      lines.push(stats.join('  '));
      htmlParts.push(statsHtml.join('  '));
    }

    if (Array.isArray(card.occupational_skills) && card.occupational_skills.length > 0) {
      const skills = card.occupational_skills.map(s => `${s.name}：${s.value}`).join('  ');
      lines.push(skills);
      htmlParts.push(escapeHtml(skills));
    }

    if (Array.isArray(card.personal_skills) && card.personal_skills.length > 0) {
      const skills = card.personal_skills.map(s => `${s.name}：${s.value}`).join('  ');
      lines.push(skills);
      htmlParts.push(escapeHtml(skills));
    }

    if (Array.isArray(card.inventory) && card.inventory.length > 0) {
      const inv = `随身物品：${card.inventory.join('、')}`;
      lines.push(inv);
      htmlParts.push(escapeHtml(inv));
    }

    return {
      plainText: lines.join('\n'),
      html: htmlParts.join('<br>'),
    };
  }

  // ── 历史总结 ──
  _refineSummary(parsed) {
    const text = parsed.summary || '';
    return {
      plainText: text,
      html: escapeHtml(text),
    };
  }

  // ── 叙事阶段（STORY_OPENING / NARRATION_I / NARRATION_II） ──
  _refineNarrative(parsed) {
    const plainParts = [];
    const htmlParts = [];

    // 1. narration
    if (parsed.narration) {
      plainParts.push(parsed.narration);
      htmlParts.push(`<div class="kp-block">${escapeHtml(parsed.narration)}</div>`);
    }

    // 2. dice 提示
    if (parsed.dice) {
      const diceText = `【判定：${parsed.dice.skill_name || ''}（${parsed.dice.skill_point ?? ''}），${parsed.dice.notation || ''}，成功率${parsed.dice.success_rate ?? ''}%】`;
      plainParts.push(diceText);
      htmlParts.push(`<div class="kp-block">${escapeHtml(diceText)}</div>`);
    }

    // 3. 收集 meta 信息（每条前加类型标签）
    const metaLines = [];
    const metaHtml = [];

    if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
      for (const l of parsed.locations) {
        metaLines.push(`【地点】${l.name}：${l.description}`);
        metaHtml.push(escapeHtml(`【地点】${l.name}：${l.description}`));
      }
    }

    if (Array.isArray(parsed.npcs) && parsed.npcs.length > 0) {
      for (const n of parsed.npcs) {
        metaLines.push(`【NPC】${n.name}：${n.description}`);
        metaHtml.push(escapeHtml(`【NPC】${n.name}：${n.description}`));
      }
    }

    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      for (const i of parsed.items) {
        metaLines.push(`【物品】${i.name}：${i.status || '已获得'}，${i.description}`);
        metaHtml.push(escapeHtml(`【物品】${i.name}：${i.status || '已获得'}，${i.description}`));
      }
    }

    if (parsed.hp !== null && parsed.hp !== undefined) {
      metaLines.push(`HP：${parsed.hp}`);
      metaHtml.push(`HP：${parsed.hp}`);
    }
    if (parsed.san !== null && parsed.san !== undefined) {
      metaLines.push(`SAN：${parsed.san}`);
      metaHtml.push(`SAN：${parsed.san}`);
    }

    if (metaHtml.length > 0) {
      plainParts.push(metaLines.join('\n'));
      htmlParts.push(`<div class="kp-block">${metaHtml.join('<br>')}</div>`);
    }

    // 4. options（带标题）
    if (Array.isArray(parsed.options) && parsed.options.length > 0) {
      const header = '【请选择你接下来的行动】';
      const optionText = header + '\n' + parsed.options.join('\n');
      plainParts.push(optionText);
      htmlParts.push(`<div class="kp-block">${escapeHtml(header)}<br>${escapeHtml(parsed.options.join('\n')).replace(/\n/g, '<br>')}</div>`);
    }

    // 组装
    const plainText = plainParts.join(DIVIDER_PLAIN);
    const html = htmlParts.join(DIVIDER_HTML);

    return { plainText, html };
  }
}

export const textRefiner = new TextRefiner();
