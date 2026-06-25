/**
   * TextRefiner —— 将 LLM 输出的 parsed JSON 重构为人类可读格式。
 *
 * 返回 { plainText, html } 双版本：
 * - plainText: 用于模拟流式输出（逐字显示到前端）
 * - html:      用于 llm_complete 最终渲染（含金色分割线等 HTML）
 */

import { FlowType } from '../domain/enums.js';
import {
  CARD_KEY, NAME, AGE, GENDER, OCCUPATION, PERSONALITY, PORTRAIT,
  ATTRIBUTES_KEY, HP, SAN, CREDIT_RATING,
  OCCUPATIONAL_SKILLS, PERSONAL_SKILLS, INVENTORY,
  SKILL_NAME, SKILL_VALUE, ATTR_LIST,
} from '../domain/CharacterCardSchema.js';
import {
  NARRATION, LOCATIONS, NPCS, ITEMS, OPTIONS, DICE,
  ENTITY_NAME, ENTITY_DESC, ITEM_STATUS,
  DICE_SKILL_NAME, DICE_SKILL_POINT, DICE_NOTATION, DICE_SUCCESS_RATE,
  SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION,
} from '../domain/NarrativeSchema.js';

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
      case FlowType.KEY_CHARACTER_GEN:
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
    const desc = parsed[WORLD_IMPRESSION] || '';
    const key = parsed[KEY_DESCRIPTION] || '';
    if (key) {
      return {
        plainText: desc + '\n\n【关键描述】\n' + key,
        html: escapeHtml(desc) + '<br><br><strong>【关键描述】</strong><br>' + escapeHtml(key),
      };
    }
    return {
      plainText: desc,
      html: escapeHtml(desc),
    };
  }

  // ── 玩家设定 ──
  _refineCharacter(parsed) {
    const card = parsed[CARD_KEY];
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

    // 基本信息
    addField('姓名', card[NAME]);
    addField('年龄', card[AGE]);
    addField('性别', card[GENDER]);
    addField('职业', card[OCCUPATION]);
    addField('性格', card[PERSONALITY]);
    addField('人物肖像与重要经历', card[PORTRAIT]);

    // ── 属性（含 HP / SAN / 信用评级） ──
    if (card[ATTRIBUTES_KEY]) {
      const a = card[ATTRIBUTES_KEY];
      const attrParts = [];
      const attrHtml = [];
      for (const [label, key] of ATTR_LIST) {
        if (a[key] !== undefined && a[key] !== null) {
          attrParts.push(`${label}：${a[key]}`);
          attrHtml.push(`${escapeHtml(label)}：${a[key]}`);
        }
      }
      if (card[HP] !== undefined && card[HP] !== null) {
        attrParts.push(`HP：${card[HP]}`);
        attrHtml.push(`HP：${card[HP]}`);
      }
      if (card[SAN] !== undefined && card[SAN] !== null) {
        attrParts.push(`SAN：${card[SAN]}`);
        attrHtml.push(`SAN：${card[SAN]}`);
      }
      if (card[CREDIT_RATING] !== undefined && card[CREDIT_RATING] !== null) {
        attrParts.push(`信用评级：${card[CREDIT_RATING]}`);
        attrHtml.push(`信用评级：${card[CREDIT_RATING]}`);
      }
      if (attrParts.length > 0) {
        lines.push('', '【属性】', attrParts.join('  '));
        htmlParts.push(
          `<br><strong>【属性】</strong><br>${attrHtml.join('  ')}`
        );
      }
    }

    // ── 本职技能 ──
    if (Array.isArray(card[OCCUPATIONAL_SKILLS]) && card[OCCUPATIONAL_SKILLS].length > 0) {
      const skillLine = card[OCCUPATIONAL_SKILLS].map(s => `${s[SKILL_NAME]}：${s[SKILL_VALUE]}`).join('  ');
      const skillHtmlLine = card[OCCUPATIONAL_SKILLS].map(s => `${escapeHtml(s[SKILL_NAME])}：${escapeHtml(String(s[SKILL_VALUE]))}`).join('  ');
      lines.push('', '【本职技能】', skillLine);
      htmlParts.push(
        `<br><strong>【本职技能】</strong><br>${skillHtmlLine}`
      );
    }

    // ── 非本职技能 ──
    if (Array.isArray(card[PERSONAL_SKILLS]) && card[PERSONAL_SKILLS].length > 0) {
      const skillLine = card[PERSONAL_SKILLS].map(s => `${s[SKILL_NAME]}：${s[SKILL_VALUE]}`).join('  ');
      const skillHtmlLine = card[PERSONAL_SKILLS].map(s => `${escapeHtml(s[SKILL_NAME])}：${escapeHtml(String(s[SKILL_VALUE]))}`).join('  ');
      lines.push('', '【非本职技能】', skillLine);
      htmlParts.push(
        `<br><strong>【非本职技能】</strong><br>${skillHtmlLine}`
      );
    }

    // ── 随身物品 ──
    if (Array.isArray(card[INVENTORY]) && card[INVENTORY].length > 0) {
      const inv = `随身物品：${card[INVENTORY].join('、')}`;
      const invHtml = `随身物品：${escapeHtml(card[INVENTORY].join('、'))}`;
      lines.push('', '【随身物品】', inv);
      htmlParts.push(`<br><strong>【随身物品】</strong><br>${invHtml}`);
    }

    // 组装：plainText = 纯文本（用于打字机流式），html = 包裹在 kp-block 中
    return {
      plainText: lines.join('\n'),
      html: `<div class="kp-block">${htmlParts.join('<br>')}</div>`,
    };
  }

  // ── 历史总结 ──
  _refineSummary(parsed) {
    const text = parsed[SUMMARY] || '';
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
    if (parsed[NARRATION]) {
      plainParts.push(parsed[NARRATION]);
      htmlParts.push(`<div class="kp-block">${escapeHtml(parsed[NARRATION])}</div>`);
    }

    // 2. dice 提示
    if (parsed[DICE]) {
      const d = parsed[DICE];
      const diceText = `【判定：${d[DICE_SKILL_NAME] || ''}（${d[DICE_SKILL_POINT] ?? ''}），${d[DICE_NOTATION] || ''}，成功率${d[DICE_SUCCESS_RATE] ?? ''}%】`;
      plainParts.push(diceText);
      htmlParts.push(`<div class="kp-block">${escapeHtml(diceText)}</div>`);
    }

    // 3. 收集 meta 信息（每条前加类型标签）
    const metaLines = [];
    const metaHtml = [];

    const locs = parsed[LOCATIONS];
    if (Array.isArray(locs) && locs.length > 0) {
      for (const l of locs) {
        const text = `【地点】${l[ENTITY_NAME]}：${l[ENTITY_DESC]}`;
        metaLines.push(text);
        metaHtml.push(escapeHtml(text));
      }
    }

    const npcList = parsed[NPCS];
    if (Array.isArray(npcList) && npcList.length > 0) {
      for (const n of npcList) {
        const text = `【NPC】${n[ENTITY_NAME]}：${n[ENTITY_DESC]}`;
        metaLines.push(text);
        metaHtml.push(escapeHtml(text));
      }
    }

    const itemList = parsed[ITEMS];
    if (Array.isArray(itemList) && itemList.length > 0) {
      for (const i of itemList) {
        const text = `【物品】${i[ENTITY_NAME]}：${i[ITEM_STATUS] || '已获得'}，${i[ENTITY_DESC]}`;
        metaLines.push(text);
        metaHtml.push(escapeHtml(text));
      }
    }

    if (parsed[HP] !== null && parsed[HP] !== undefined) {
      metaLines.push(`HP：${parsed[HP]}`);
      metaHtml.push(`HP：${parsed[HP]}`);
    }
    if (parsed[SAN] !== null && parsed[SAN] !== undefined) {
      metaLines.push(`SAN：${parsed[SAN]}`);
      metaHtml.push(`SAN：${parsed[SAN]}`);
    }

    if (metaHtml.length > 0) {
      plainParts.push(metaLines.join('\n'));
      htmlParts.push(`<div class="kp-block">${metaHtml.join('<br>')}</div>`);
    }

    // 4. options（带标题）
    const opts = parsed[OPTIONS];
    if (Array.isArray(opts) && opts.length > 0) {
      const header = '【请选择你接下来的行动】';
      const optionText = header + '\n' + opts.join('\n');
      plainParts.push(optionText);
      htmlParts.push(`<div class="kp-block">${escapeHtml(header)}<br>${escapeHtml(opts.join('\n')).replace(/\n/g, '<br>')}</div>`);
    }

    // 组装
    const plainText = plainParts.join(DIVIDER_PLAIN);
    const html = htmlParts.join(DIVIDER_HTML);

    return { plainText, html };
  }
}

export const textRefiner = new TextRefiner();
