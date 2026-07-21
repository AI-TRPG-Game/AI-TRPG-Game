/**
 * TextRefiner —— 将 LLM 输出的 parsed JSON 重构为人类可读格式。
 *
 * 返回 { plainText, html } 双版本：
 * - plainText: 纯文本版本（v2.0 strict 模式下不再用于打字机，保留供日志/调试）
 * - html:      HTML 版本（前端一次性渲染，含金色分割线等样式）
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
  ENTITY_NAME, ENTITY_DESC, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE, ITEM_STATUS,
  DICE_SKILL_NAME, DICE_SKILL_POINT, DICE_NOTATION, DICE_SUCCESS_RATE,
  SUMMARY, WORLD_IMPRESSION, KEY_DESCRIPTION,
} from '../domain/NarrativeSchema.js';

// HTML 转义：转义会破坏 HTML 结构的字符（& < >），并把换行符转为 <br>
// - 不转义 " —— 浏览器 innerHTML 会把 &quot; 解码回 "，转义无实际效果
// - \n → <br>：LLM 输出的字符串值常含换行分段，HTML 中需转为 <br> 才能正确显示
//   （HTML 默认会把 \n 当作空白合并，导致所有内容挤一行）
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// 轻量 markdown 渲染：仅处理 LLM 在叙事文本中常见的两种行内标记
// - **加粗** → <strong>加粗</strong>
// - *斜体*   → <em>斜体</em>
// 设计要点：
//   1. 必须在 escapeHtml 之后调用，此时 < > & 已转义，不会干扰 markdown 解析
//   2. ** 优先于 *（先处理加粗，避免 * 把 ** 拆掉）
//   3. 斜体要求 * 两侧不能同时为空白——避免 "2 * 3 * 4" 这种数学表达式被误判
//      （数学表达式中 * 前后都是空格；markdown 斜体至少有一侧紧贴文字）
//   4. 不处理 # 标题、- 列表、` 代码块 等——这些在叙事文本中很少见
function renderInlineMarkdown(html) {
  // 先处理 **加粗**
  let result = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 再处理 *斜体*：用函数判断两侧字符，两侧同时为空白（或边界）则跳过（数学表达式）
  result = result.replace(/\*([^*]+)\*/g, (match, content, offset, full) => {
    const before = offset > 0 ? full[offset - 1] : '';
    const after = full[offset + match.length] ?? '';
    const isWhitespaceOrEdge = (ch) => ch === '' || /\s/.test(ch);
    // 两侧都是空白（或边界）→ 数学运算符，跳过
    if (isWhitespaceOrEdge(before) && isWhitespaceOrEdge(after)) return match;
    return `<em>${content}</em>`;
  });
  return result;
}

// 渲染 LLM 直接产出的长文本：先剥离可能存在的 HTML 标签，再 escape，再渲染行内 markdown
// 仅用于 narration / world_impression / key_description / summary / portrait / 实体描述等
// 标签、数值、选项字母前缀等用 escapeHtml 即可（不需要 markdown）
//
// stripHtmlTags 的存在是为了兜底 LLM 偶发输出 HTML 标签的情况
// （如 <span style="...">侦查</span>），保留标签内部的文字
function stripHtmlTags(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

function renderText(s) {
  return renderInlineMarkdown(escapeHtml(stripHtmlTags(s)));
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
    // 用 kp-block 包裹，保证 html 以 '<' 开头，便于前端 _restoreUI 精确识别
    return { plainText: s, html: `<div class="kp-block">${renderText(s)}</div>` };
  }

  // ── 世界观 ──
  _refineWorld(parsed) {
    const desc = parsed[WORLD_IMPRESSION] || '';
    const key = parsed[KEY_DESCRIPTION] || '';
    if (key) {
      return {
        plainText: desc + '\n\n【关键描述】\n' + key,
        html: `<div class="kp-block">${renderText(desc)}<br><br><strong>【关键描述】</strong><br>${renderText(key)}</div>`,
      };
    }
    return {
      plainText: desc,
      html: `<div class="kp-block">${renderText(desc)}</div>`,
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

    const addField = (label, value, isLongText = false) => {
      if (value !== undefined && value !== null && value !== '') {
        lines.push(`${label}：${value}`);
        // isLongText=true 的字段（如 portrait）是 LLM 自由长文本，需渲染 markdown
        // 其他字段（姓名/年龄/性别/职业/性格）通常是短文本，escape 即可
        const rendered = isLongText ? renderText(String(value)) : escapeHtml(String(value));
        htmlParts.push(`${escapeHtml(label)}：${rendered}`);
      }
    };

    // 基本信息（portrait 为长文本，可能含 *斜体*/**加粗**）
    addField('姓名', card[NAME]);
    addField('年龄', card[AGE]);
    addField('性别', card[GENDER]);
    addField('职业', card[OCCUPATION]);
    addField('性格', card[PERSONALITY]);
    addField('人物肖像与重要经历', card[PORTRAIT], true);

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
      html: `<div class="kp-block">${renderText(text)}</div>`,
    };
  }

  // ── 叙事阶段（STORY_OPENING / NARRATION_I / NARRATION_II） ──
  _refineNarrative(parsed) {
    const plainParts = [];
    const htmlParts = [];

    // 1. narration
    if (parsed[NARRATION]) {
      plainParts.push(parsed[NARRATION]);
      htmlParts.push(`<div class="kp-block">${renderText(parsed[NARRATION])}</div>`);
    }

    // 2. dice 提示（紧跟 narration 之后，机械化格式）
    // 渲染为：【判定：侦查（55），1d100，成功率55%】
    if (parsed[DICE]) {
      const d = parsed[DICE];
      const diceText = `【判定：${d[DICE_SKILL_NAME] || ''}（${d[DICE_SKILL_POINT] ?? ''}），${d[DICE_NOTATION] || ''}，成功率${d[DICE_SUCCESS_RATE] ?? ''}%】`;
      plainParts.push(diceText);
      // diceText 是模板拼接的字符串，没有 markdown 需求，escapeHtml 即可
      htmlParts.push(`<div class="kp-block"><strong>${escapeHtml(diceText)}</strong></div>`);
    }

    // 3. 收集 meta 信息（每条前加类型标签）
    // 实体描述（description/baseDescription/currentState）是 LLM 自由长文本，需渲染 markdown
    // 实体 name 通常很短，escape 即可；标签（【地点】等）是模板字符串，escape 即可
    const metaLines = [];
    const metaHtml = [];

    const locs = parsed[LOCATIONS];
    if (Array.isArray(locs) && locs.length > 0) {
      for (const l of locs) {
        if (!l[ENTITY_NAME] || !l[ENTITY_DESC]) continue;  // 防护：跳过只有名字没描述的条目
        const text = `【地点】${l[ENTITY_NAME]}：${l[ENTITY_DESC]}`;
        metaLines.push(text);
        metaHtml.push(`${escapeHtml('【地点】')}${escapeHtml(l[ENTITY_NAME])}：${renderText(l[ENTITY_DESC] || '')}`);
      }
    }

    const npcList = parsed[NPCS];
    if (Array.isArray(npcList) && npcList.length > 0) {
      for (const n of npcList) {
        if (!n[ENTITY_NAME] || !n[ENTITY_CURRENT_STATE]) continue;  // 防护：跳过只有名字没 currentState 的条目
        // NPC 新结构：baseDescription（稳定人设）+ currentState（动态状态）
        // 兜底 description 字段以兼容旧 LLM 输出
        const base = n[ENTITY_BASE_DESC] ?? n[ENTITY_DESC] ?? '';
        const state = n[ENTITY_CURRENT_STATE] ?? '';
        const descText = state ? `${base}（${state}）` : base;
        const text = `【NPC】${n[ENTITY_NAME]}：${descText}`;
        metaLines.push(text);
        const baseHtml = renderText(base);
        const stateHtml = state ? `（${renderText(state)}）` : '';
        metaHtml.push(`${escapeHtml('【NPC】')}${escapeHtml(n[ENTITY_NAME])}：${baseHtml}${stateHtml}`);
      }
    }

    const itemList = parsed[ITEMS];
    if (Array.isArray(itemList) && itemList.length > 0) {
      for (const i of itemList) {
        if (!i[ENTITY_NAME] || !i[ENTITY_DESC]) continue;  // 防护：跳过只有名字没描述的条目
        const text = `【物品】${i[ENTITY_NAME]}：${i[ITEM_STATUS] || '已获得'}，${i[ENTITY_DESC]}`;
        metaLines.push(text);
        metaHtml.push(`${escapeHtml('【物品】')}${escapeHtml(i[ENTITY_NAME])}：${escapeHtml(i[ITEM_STATUS] || '已获得')}，${renderText(i[ENTITY_DESC] || '')}`);
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
      // 选项文本是 LLM 自由文本，可能含 *斜体*/**加粗**，渲染 markdown
      // escapeHtml 已将 \n 转为 <br>，无需再额外 replace
      htmlParts.push(`<div class="kp-block">${escapeHtml(header)}<br>${renderText(opts.join('\n'))}</div>`);
    }

    // 组装
    const plainText = plainParts.join(DIVIDER_PLAIN);
    const html = htmlParts.join(DIVIDER_HTML);

    return { plainText, html };
  }
}

export const textRefiner = new TextRefiner();
