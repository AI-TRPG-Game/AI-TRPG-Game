import { diceService } from './DiceService.js';
import {
  ACTIONS, ACTION_TYPE, SKILL_CHECK, SANCHECK, SAN_SEVERITY, DIRECT,
  ON_SUCCESS, ON_FAIL, CHANGES, BONUS_DICE, PENALTY_DICE,
  TARGET, ATTR_FIELD, DICE_COUNT, DICE_SIDES, DICE_BONUS, EFFECT,
  TRIGGER, TRIGGER_PLAYER, TRIGGER_OTHERS,
  ON_CRITICAL_SUCCESS, ON_CRITICAL_FAILURE,
} from '../domain/NarrativeSchema.js';

/**
 * 伤害计算核心模块。
 * 处理 actions 数组（skill_check/sancheck/direct），掷骰，更新 HP/SAN，生成状态词和系统消息。
 *
 * 设计动机：
 * - 系统全权计算伤害（LLM 只输出 actions 结构，不输出数值）
 * - 基于 CoC 7e 规则简化版（惩罚/奖励骰、SAN check 1d3/1d6、状态词映射）
 * - 消除多检定歧义（每个 action 自包含检定+后果）
 */
export class DamageResolver {
  /**
   * 处理 actions 数组，计算伤害并更新 session.npcs 中的 HP/SAN。
   * @param {Object} session - GameSession 实例
   * @param {Object} parsed - LLM 输出的 parsed JSON（含 actions 数组）
   * @returns {{
   *   systemMessages: string[],
   *   playerDied: boolean,
   *   departedNpcs: string[],
   * }}
   */
  resolve(session, parsed) {
    const actions = parsed[ACTIONS];
    if (!Array.isArray(actions) || actions.length === 0) {
      return { systemMessages: [], playerDied: false, departedNpcs: [] };
    }

    const systemMessages = [];
    const departedNpcs = [];
    let playerDied = false;

    for (const action of actions) {
      const msgs = this._processAction(session, action, departedNpcs);
      systemMessages.push(...msgs);
    }

    // 所有 actions 处理完毕后，检查玩家是否清零
    const player = this._findNpc(session, 'player');
    if (player && (player.hp <= 0 || player.san <= 0)) {
      playerDied = true;
    }

    return { systemMessages, playerDied, departedNpcs };
  }

  /**
   * 处理单个 action。按 trigger + type 分发到 4 种结果消息生成器。
   * - player skill_check → _processPlayerSkillCheck（A 结果）
   * - others skill_check → _processOthersSkillCheck（C1 结果）
   * - sancheck → _processSancheck（B 结果，trigger 恒为 others）
   * - direct → _processDirect（C2 结果，含 player 与 others）
   */
  _processAction(session, action, departedNpcs) {
    const type = action[ACTION_TYPE] || action.type;
    const trigger = action[TRIGGER] || TRIGGER_OTHERS;

    if (type === SKILL_CHECK) {
      if (trigger === TRIGGER_PLAYER) {
        return this._processPlayerSkillCheck(session, action, departedNpcs);
      }
      return this._processOthersSkillCheck(session, action, departedNpcs);
    } else if (type === SANCHECK) {
      return this._processSancheck(session, action, departedNpcs);
    } else if (type === DIRECT) {
      return this._processDirect(session, action, departedNpcs);
    }
    return [];
  }

  /**
   * 处理 player skill_check（A 结果格式）。
   * 消息格式："XX技能投掷结果[原始骰值]，奖励骰x，惩罚骰x，最终结果[最终值]，[等级]"
   *          + 若对应 on_xxx 有 changeItem → 追加 HP/SAN 变化消息
   * 大成功 → on_critical_success；大失败 → on_critical_failure；
   * 其余成功 → on_success；失败 → on_fail
   */
  _sanPenaltyDice(session) {
    if (!session.scenarioId) return 0;
    const player = this._findNpc(session, 'player');
    if (!player || player.san == null) return 0;
    if (player.san <= 20) return 2;
    if (player.san <= 40) return 1;
    return 0;
  }

  _processPlayerSkillCheck(session, action, departedNpcs) {
    const skillName = action.skill_name;
    const skillPoint = action.skill_point;
    const bonusDice = action[BONUS_DICE] || 0;
    const penaltyDice = Math.min(2, (action[PENALTY_DICE] || 0) + this._sanPenaltyDice(session));
    const onSuccess = action[ON_SUCCESS] || [];
    const onFail = action[ON_FAIL] || [];
    const onCriticalSuccess = action[ON_CRITICAL_SUCCESS] || [];
    const onCriticalFailure = action[ON_CRITICAL_FAILURE] || [];

    const roll = diceService.rollWithBonusPenalty(bonusDice, penaltyDice);
    const level = diceService.evaluateSuccess(skillPoint, roll.value);

    // 生成 A 结果主消息
    const bonusDesc = bonusDice > 0 ? `，奖励骰${bonusDice}` : '';
    const penaltyDesc = penaltyDice > 0 ? `，惩罚骰${penaltyDice}` : '';
    const mainMsg = `【${skillName}技能投掷结果${roll.value}${bonusDesc}${penaltyDesc}，最终结果${roll.value}，${level}】`;
    const messages = [mainMsg];

    // 根据等级选择 changeItem
    let changes = [];
    if (level === '大成功') {
      changes = onCriticalSuccess.length > 0 ? onCriticalSuccess : onSuccess;
    } else if (level === '大失败') {
      changes = onCriticalFailure.length > 0 ? onCriticalFailure : onFail;
    } else if (this._isSuccess(level)) {
      changes = onSuccess;
    } else {
      changes = onFail;
    }

    for (const change of changes) {
      const changeMsg = this._applyChange(session, change, departedNpcs);
      if (changeMsg) messages.push(changeMsg);
    }

    return messages;
  }

  /**
   * 处理 others skill_check（C1 结果格式）。
   * 消息格式同 A，但语义上是 NPC/环境触发的检定。
   * 注意：others skill_check 的掷骰者是 NPC，但 on_success/on_fail 的 target 可能是玩家
   *       （如 NPC 攻击玩家，NPC 掷斗殴，失败时玩家不受伤害，成功时玩家受伤）
   *       因此 changeItem.target 决定伤害归属，与掷骰者无关
   */
  _processOthersSkillCheck(session, action, departedNpcs) {
    const skillName = action.skill_name;
    const skillPoint = action.skill_point;
    const bonusDice = action[BONUS_DICE] || 0;
    const penaltyDice = action[PENALTY_DICE] || 0;
    const onSuccess = action[ON_SUCCESS] || [];
    const onFail = action[ON_FAIL] || [];
    const onCriticalSuccess = action[ON_CRITICAL_SUCCESS] || [];
    const onCriticalFailure = action[ON_CRITICAL_FAILURE] || [];

    const roll = diceService.rollWithBonusPenalty(bonusDice, penaltyDice);
    const level = diceService.evaluateSuccess(skillPoint, roll.value);

    // C1 格式：与 A 格式相同（消息不显示主语，只显示技能与结果）
    const bonusDesc = bonusDice > 0 ? `，奖励骰${bonusDice}` : '';
    const penaltyDesc = penaltyDice > 0 ? `，惩罚骰${penaltyDice}` : '';
    const mainMsg = `【${skillName}技能投掷结果${roll.value}${bonusDesc}${penaltyDesc}，最终结果${roll.value}，${level}】`;
    const messages = [mainMsg];

    let changes = [];
    if (level === '大成功') {
      changes = onCriticalSuccess.length > 0 ? onCriticalSuccess : onSuccess;
    } else if (level === '大失败') {
      changes = onCriticalFailure.length > 0 ? onCriticalFailure : onFail;
    } else if (this._isSuccess(level)) {
      changes = onSuccess;
    } else {
      changes = onFail;
    }

    for (const change of changes) {
      const changeMsg = this._applyChange(session, change, departedNpcs);
      if (changeMsg) messages.push(changeMsg);
    }

    return messages;
  }
  /**
   * 处理 sancheck（B 结果格式）。
   * 消息格式：玩家："你直视了不可直视之物，san -n"
   *          NPC："target 直视了不可直视之物，san -n"
   */
  _processSancheck(session, action, departedNpcs) {
    const targetId = action[TARGET];
    const target = this._findNpc(session, targetId);
    if (!target) {
      return [`【SAN 检定失败：未找到目标 ${targetId}】`];
    }

    const sanValue = target.san ?? 0;
    const roll = diceService.rollWithBonusPenalty(0, 0);
    const isSuccess = roll.value <= sanValue;

    const severity = action[SAN_SEVERITY] || 'major';
    const formulas = {
      unease: { success: '1d2', failure: '1d4' },
      major: { success: '1d4', failure: '1d8' },
      catastrophe: { success: '1d6', failure: '2d6' },
    };
    const damageFormula = (formulas[severity] || formulas.major)[isSuccess ? 'success' : 'failure'];
    const damage = diceService.rollFormula(damageFormula);

    const oldSan = target.san;
    const maxSan = target.maxSan ?? 99;
    target.san = Math.max(0, Math.min(maxSan, target.san - damage));
    const actualDamage = oldSan - target.san;

    // B 结果格式：固定文案"直视了不可直视之物"
    const targetName = this._getTargetName(target);
    const isPlayer = target.id === 'npc_000';
    const subject = isPlayer ? '你' : targetName;
    const msg = `【${subject} 直视了不可直视之物，san -${actualDamage}】`;

    this._checkDeparted(target, departedNpcs);

    return [`${msg} [SAN severity: ${severity}]`];
  }

  /**
   * 处理 direct（C2 结果格式，含 player 与 others trigger）。
   * 消息格式："HP 变化投掷结果为x，HP -n，target 当前 HP: x"
   *          或 "SAN 变化投掷结果为x，SAN -n，target 当前 SAN: x"
   * direct 无检定过程，掷的是伤害骰（delta），非判定骰
   */
  _processDirect(session, action, departedNpcs) {
    const changes = action[CHANGES] || [];
    const messages = [];

    for (const change of changes) {
      const msg = this._applyChangeDirect(session, change, departedNpcs);
      if (msg) messages.push(msg);
    }

    return messages;
  }

  /**
   * 应用单个变化项（投骰/固定值 + 更新 HP/SAN + 生成状态词消息）。
   * 用于 skill_check 的 on_success/on_fail/on_critical_success/on_critical_failure。
   */
  _applyChange(session, change, departedNpcs) {
    const targetId = change[TARGET];
    const attr = change[ATTR_FIELD];
    const diceCount = change[DICE_COUNT] ?? 0;
    const diceSides = change[DICE_SIDES] ?? 0;
    const diceBonus = change[DICE_BONUS] ?? 0;
    const effect = change[EFFECT];

    const target = this._findNpc(session, targetId);
    if (!target) {
      return `【变化失败：未找到目标 ${targetId}】`;
    }

    // 跨字段约束（schema 无法表达，代码层校验）
    if (diceCount === 0 && diceBonus === 0) {
      return `【变化失败：diceCount 和 diceBonus 不可同时为 0】`;
    }

    const { total: rollResult, formulaText } = diceService.rollParts(diceCount, diceSides, diceBonus);
    const oldValue = target[attr] ?? 0;
    const maxKey = attr === 'hp' ? 'maxHp' : 'maxSan';
    const maxValue = target[maxKey] ?? 99;

    let newValue;
    if (effect === 'damage') {
      newValue = Math.max(0, Math.min(maxValue, oldValue - rollResult));
    } else {
      newValue = Math.max(0, Math.min(maxValue, oldValue + rollResult));
    }

    const actualChange = Math.abs(newValue - oldValue);
    target[attr] = newValue;

    // 生成状态词
    const statusWord = this.getStatusWord(attr, actualChange, newValue, effect);

    // 生成系统消息
    const targetName = this._getTargetName(target);
    const actionDesc = effect === 'damage' ? '受到' : '恢复';
    const changeDesc = effect === 'damage' ? '伤害' : '恢复';

    // 检查清零
    this._checkDeparted(target, departedNpcs);

    return `【${targetName} ${actionDesc}${formulaText}点${attr.toUpperCase()}${changeDesc} → ${statusWord}】`;
  }

  /**
   * 应用 direct 变化项（C2 结果格式）。
   * 与 _applyChange 的区别：消息格式为"HP 变化投掷结果为x，HP -n，target 当前 HP: x"
   * （_applyChange 用于 skill_check 的 on_success/on_fail，格式为"target 受到1dX=N点HP伤害 → 状态词"）
   */
  _applyChangeDirect(session, change, departedNpcs) {
    const targetId = change[TARGET];
    const attr = change[ATTR_FIELD];
    const diceCount = change[DICE_COUNT] ?? 0;
    const diceSides = change[DICE_SIDES] ?? 0;
    const diceBonus = change[DICE_BONUS] ?? 0;
    const effect = change[EFFECT];

    const target = this._findNpc(session, targetId);
    if (!target) {
      return `【变化失败：未找到目标 ${targetId}】`;
    }

    // 跨字段约束（schema 无法表达，代码层校验）
    if (diceCount === 0 && diceBonus === 0) {
      return `【变化失败：diceCount 和 diceBonus 不可同时为 0】`;
    }

    const { total: rollResult, formulaText } = diceService.rollParts(diceCount, diceSides, diceBonus);
    const oldValue = target[attr] ?? 0;
    const maxKey = attr === 'hp' ? 'maxHp' : 'maxSan';
    const maxValue = target[maxKey] ?? 99;

    let newValue;
    if (effect === 'damage') {
      newValue = Math.max(0, Math.min(maxValue, oldValue - rollResult));
    } else {
      newValue = Math.max(0, Math.min(maxValue, oldValue + rollResult));
    }

    target[attr] = newValue;

    // C2 格式
    const targetName = this._getTargetName(target);
    const changeSymbol = effect === 'damage' ? '-' : '+';
    const attrUpper = attr.toUpperCase();

    this._checkDeparted(target, departedNpcs);

    return `【${attrUpper} 变化${formulaText}，${attrUpper} ${changeSymbol}${rollResult}，${targetName} 当前 ${attrUpper}: ${newValue}】`;
  }

  /**
   * 检查 NPC 是否清零，若清零标记 departed。
   */
  _checkDeparted(npc, departedNpcs) {
    if ((npc.hp !== null && npc.hp <= 0) || (npc.san !== null && npc.san <= 0)) {
      if (npc.status !== 'departed') {
        npc.status = 'departed';
        if (!departedNpcs.includes(npc.id)) {
          departedNpcs.push(npc.id);
        }
      }
    }
  }

  /**
   * 判定成功等级是否为"成功"。
   */
  _isSuccess(level) {
    return level === '大成功' || level === '极难成功' ||
           level === '困难成功' || level === '一般成功';
  }

  /**
   * 在 session.npcs 中查找目标 NPC。
   * @param {string} targetId - 'player' 或 'npc_XXX'
   */
  _findNpc(session, targetId) {
    if (targetId === 'player') {
      return session.npcs.find(n => n.id === 'npc_000');
    }
    return session.npcs.find(n => n.id === targetId);
  }

  /**
   * 获取目标的显示名称。
   */
  _getTargetName(npc) {
    if (npc.id === 'npc_000') return '玩家';
    if (npc.importance === 'key') return `关键角色(${npc.name})`;
    return npc.name || npc.id;
  }

  /**
   * 根据 CoC 7e 规则生成状态词。
   * @param {string} attr - 'hp' | 'san'
   * @param {number} damageAmount - 单次伤害量
   * @param {number} currentAfter - 变化后的当前值
   * @param {string} effect - 'damage' | 'heal'
   * @returns {string} 状态词
   */
  getStatusWord(attr, damageAmount, currentAfter = null, effect = 'damage') {
    // 治疗不触发状态词
    if (effect === 'heal') {
      return `恢复${damageAmount}点`;
    }

    // 清零检测
    if (currentAfter !== null && currentAfter <= 0) {
      if (attr === 'hp') return '濒死';
      if (attr === 'san') return '永久疯狂';
    }

    // HP 伤害状态词
    if (attr === 'hp') {
      if (damageAmount >= 10) return '致命重创';
      if (damageAmount >= 4) return '受重伤';
      return '轻微受伤';
    }

    // SAN 伤害状态词（CoC 7e：单次损失 ≥5 暂时疯狂）
    if (attr === 'san') {
      if (damageAmount >= 5) return '暂时疯狂';
      return '头晕目眩';
    }

    return '';
  }
}

export const damageResolver = new DamageResolver();
