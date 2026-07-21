import { FlowType } from '../domain/enums.js';
import { jsonOutputParser } from './JsonOutputParser.js';
import { entityUpdater } from './EntityUpdater.js';
import { DICE, DICE_NOTATION, DICE_SKILL_NAME, SUMMARY } from '../domain/NarrativeSchema.js';

export class OutputProcessor {
  /**
   * @param {object} session
   * @param {object|string} parsedOrRaw - JSON.parse 后对象 或 原始文本（兜底）
   * @param {string} rawText - 原始 LLM 输出（用于 error 分支）
   */
  process(flowType, session, parsedOrRaw, rawText) {
    const parsed = typeof parsedOrRaw === 'object' ? parsedOrRaw : null;

    if (flowType === FlowType.HISTORY_SUMMARY) {
      if (!parsed || !jsonOutputParser.hasSummary(parsed)) {
        return { branch: 'ERROR', error: '未找到 summary 字段' };
      }
      entityUpdater.applySummary(session, parsed[SUMMARY]);
      return { branch: 'SUMMARY', summary: parsed[SUMMARY] };
    }

    // Dice 分支
    if (parsed && jsonOutputParser.hasDice(parsed)) {
      return {
        branch: 'DICE',
        diceNotation: parsed[DICE][DICE_NOTATION],
        diceSkillName: parsed[DICE][DICE_SKILL_NAME],
        raw: rawText,
      };
    }

    // World / Character / KeyCharacter 设定阶段
    if (
      flowType === FlowType.WORLD_GEN ||
      flowType === FlowType.CHARACTER_GEN ||
      flowType === FlowType.KEY_CHARACTER_GEN
    ) {
      entityUpdater.applySetupHistory(
        session,
        session.phase,
        'kp',
        rawText
      );
      return {
        branch: 'SETUP',
        raw: rawText,
        parsed,
      };
    }

    // Narrative 阶段（STORY_OPENING / NARRATION_I / NARRATION_II）
    const statePatch = entityUpdater.applyNarrative(session, parsed, rawText, flowType);
    return {
      branch: 'NARRATIVE',
      raw: rawText,
      statePatch,
      parsed,
    };
  }
}

export const outputProcessor = new OutputProcessor();
