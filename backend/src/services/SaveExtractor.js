import { GameConfig } from '../config/GameConfig.js';
import { jsonOutputParser } from './JsonOutputParser.js';
import {
  CARD_KEY, NAME, AGE, GENDER, OCCUPATION, PERSONALITY, PORTRAIT,
  ATTRIBUTES_KEY, HP, SAN, CREDIT_RATING,
  OCCUPATIONAL_SKILLS, PERSONAL_SKILLS, INVENTORY,
  SKILL_NAME, SKILL_VALUE, ATTR_LIST,
} from '../domain/CharacterCardSchema.js';
import { WORLD_IMPRESSION, KEY_DESCRIPTION } from '../domain/NarrativeSchema.js';

export class SaveExtractor {
  extractWorldFromRaw(raw) {
    const parsed = jsonOutputParser.parse(raw);
    if (!parsed || !jsonOutputParser.hasWorldDescription(parsed)) {
      throw new Error(`未找到 ${WORLD_IMPRESSION} 字段，无法存档世界观`);
    }
    // 存档 key_description（200字摘要），后续阶段只会发送这个
    return parsed[KEY_DESCRIPTION] || parsed[WORLD_IMPRESSION];
  }

  extractCharacterFromRaw(raw) {
    const parsed = jsonOutputParser.parse(raw);
    if (!parsed || !jsonOutputParser.hasCharacterCard(parsed)) {
      throw new Error(`未找到 ${CARD_KEY} 字段，无法存档玩家设定`);
    }
    return this._serializeCharacterCard(parsed[CARD_KEY], true);
  }

  getLatestKpOutput(session, bucket) {
    const history =
      bucket === 'world'
        ? session.setupHistory.world
        : session.setupHistory.character;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'kp') {
        return history[i].content;
      }
    }
    return null;
  }

  getLatestKeyCharKpOutput(session) {
    const history = session.getCurrentKeyCharSetupHistory();
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'kp') {
        return history[i].content;
      }
    }
    return null;
  }

  extractKeyCharacterFromRaw(raw) {
    const parsed = jsonOutputParser.parse(raw);
    if (!parsed || !jsonOutputParser.hasCharacterCard(parsed)) {
      throw new Error(`未找到 ${CARD_KEY} 字段，无法存档关键角色`);
    }
    return this._serializeCharacterCard(parsed[CARD_KEY], false);
  }

  _serializeCharacterCard(card, addSupplement = true) {
    const lines = [];
    if (card[NAME]) lines.push(`姓名：${card[NAME]}`);
    if (card[AGE] !== undefined) lines.push(`年龄：${card[AGE]}`);
    if (card[GENDER]) lines.push(`性别：${card[GENDER]}`);
    if (card[OCCUPATION]) lines.push(`职业：${card[OCCUPATION]}`);
    if (card[PERSONALITY]) lines.push(`性格：${card[PERSONALITY]}`);
    if (card[PORTRAIT]) lines.push(`人物肖像与重要经历：${card[PORTRAIT]}`);

    if (card[ATTRIBUTES_KEY]) {
      const a = card[ATTRIBUTES_KEY];
      const attrList = [];
      for (const [label, key] of ATTR_LIST) {
        if (a[key] !== undefined) attrList.push(`${label}：${a[key]}`);
      }
      if (attrList.length > 0) lines.push(attrList.join('  '));
    }

    if (card[HP] !== undefined || card[SAN] !== undefined || card[CREDIT_RATING] !== undefined) {
      const stats = [];
      if (card[HP] !== undefined) stats.push(`HP：${card[HP]}`);
      if (card[SAN] !== undefined) stats.push(`SAN：${card[SAN]}`);
      if (card[CREDIT_RATING] !== undefined) stats.push(`信用评级：${card[CREDIT_RATING]}`);
      lines.push(stats.join('  '));
    }

    if (Array.isArray(card[OCCUPATIONAL_SKILLS]) && card[OCCUPATIONAL_SKILLS].length > 0) {
      const skills = card[OCCUPATIONAL_SKILLS].map(s => `${s[SKILL_NAME]}：${s[SKILL_VALUE]}`).join('  ');
      lines.push(skills);
    }

    if (Array.isArray(card[PERSONAL_SKILLS]) && card[PERSONAL_SKILLS].length > 0) {
      const skills = card[PERSONAL_SKILLS].map(s => `${s[SKILL_NAME]}：${s[SKILL_VALUE]}`).join('  ');
      lines.push(skills);
    }

    if (Array.isArray(card[INVENTORY]) && card[INVENTORY].length > 0) {
      lines.push(`随身物品：${card[INVENTORY].join('、')}`);
    }

    let text = lines.join('\n');
    if (addSupplement && !text.includes(GameConfig.PLAYER_SKILL_SUPPLEMENT)) {
      text += `\n${GameConfig.PLAYER_SKILL_SUPPLEMENT}`;
    }
    return text;
  }
}

export const saveExtractor = new SaveExtractor();
