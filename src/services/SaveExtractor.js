import { GameConfig } from '../config/GameConfig.js';
import { jsonOutputParser } from './JsonOutputParser.js';

export class SaveExtractor {
  extractWorldFromRaw(raw) {
    const parsed = jsonOutputParser.parse(raw);
    if (!parsed || !jsonOutputParser.hasWorldDescription(parsed)) {
      throw new Error('未找到 world_description 字段，无法存档世界观');
    }
    return parsed.world_description;
  }

  extractCharacterFromRaw(raw) {
    const parsed = jsonOutputParser.parse(raw);
    if (!parsed || !jsonOutputParser.hasCharacterCard(parsed)) {
      throw new Error('未找到 character_card 字段，无法存档主角设定');
    }
    // 将 character_card 对象序列化为可读文本
    const card = parsed.character_card;
    const lines = [];
    if (card.name) lines.push(`姓名：${card.name}`);
    if (card.age !== undefined) lines.push(`年龄：${card.age}`);
    if (card.gender) lines.push(`性别：${card.gender}`);
    if (card.occupation) lines.push(`职业：${card.occupation}`);
    if (card.personality) lines.push(`性格：${card.personality}`);
    if (card.portrait) lines.push(`人物肖像与重要经历：${card.portrait}`);

    if (card.attributes) {
      const a = card.attributes;
      const attrList = [];
      if (a.strength !== undefined) attrList.push(`力量：${a.strength}`);
      if (a.dexterity !== undefined) attrList.push(`敏捷：${a.dexterity}`);
      if (a.constitution !== undefined) attrList.push(`体质：${a.constitution}`);
      if (a.size !== undefined) attrList.push(`体型：${a.size}`);
      if (a.appearance !== undefined) attrList.push(`外貌：${a.appearance}`);
      if (a.intelligence !== undefined) attrList.push(`智力：${a.intelligence}`);
      if (a.willpower !== undefined) attrList.push(`意志：${a.willpower}`);
      if (a.education !== undefined) attrList.push(`教育：${a.education}`);
      if (attrList.length > 0) lines.push(attrList.join('  '));
    }

    if (card.hp !== undefined || card.san !== undefined || card.credit_rating !== undefined) {
      const stats = [];
      if (card.hp !== undefined) stats.push(`HP：${card.hp}`);
      if (card.san !== undefined) stats.push(`SAN：${card.san}`);
      if (card.credit_rating !== undefined) stats.push(`信用评级：${card.credit_rating}`);
      lines.push(stats.join('  '));
    }

    if (Array.isArray(card.occupational_skills) && card.occupational_skills.length > 0) {
      const skills = card.occupational_skills.map(s => `${s.name}：${s.value}`).join('  ');
      lines.push(skills);
    }

    if (Array.isArray(card.personal_skills) && card.personal_skills.length > 0) {
      const skills = card.personal_skills.map(s => `${s.name}：${s.value}`).join('  ');
      lines.push(skills);
    }

    if (Array.isArray(card.inventory) && card.inventory.length > 0) {
      lines.push(`随身物品：${card.inventory.join('、')}`);
    }

    let text = lines.join('\n');
    if (!text.includes(GameConfig.PROTAGONIST_SKILL_SUPPLEMENT)) {
      text += `\n${GameConfig.PROTAGONIST_SKILL_SUPPLEMENT}`;
    }
    return text;
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
}

export const saveExtractor = new SaveExtractor();
