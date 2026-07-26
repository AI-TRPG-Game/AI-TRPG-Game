/**
 * NarrativeSchema —— 叙事阶段 JSON 键名常量 & prompt 文本片段。
 *
 * v2.0 strict 模式改造后：
 * - JSON Schema 已通过 StrictSchemaRegistry.js + tools 参数服务端强制
 * - 本文件仅保留：键名常量、实体引用规则文本、actions 检测函数
 * - 移除了 buildStoryOpeningSchemaText / buildNarrativeSchemaText（schema 文本不再注入 prompt）
 *
 * 所有消费者（PromptTemplateRegistry / TextRefiner / EntityUpdater / OutputProcessor / JsonOutputParser）
 * 统一引用此模块的键名常量，不再各自硬编码字段名。
 */

// ── 顶层键名 ──
export const NARRATION = 'narration';
export const LOCATIONS = 'locations';
export const NPCS = 'npcs';
export const ITEMS = 'items';
export const OPTIONS = 'options';
export const HP = 'hp';
export const SAN = 'san';
export const DICE = 'dice';
export const SUMMARY = 'summary';
export const WORLD_IMPRESSION = 'world_impression';
export const KEY_DESCRIPTION = 'key_description';

// ── 实体子字段（locations / npcs / items 共用） ──
export const ENTITY_ID = 'id';
export const ENTITY_NAME = 'name';
export const ENTITY_DESC = 'description';

// ── NPC 专属子字段（拆分人设与动态状态） ──
export const ENTITY_BASE_DESC = 'baseDescription';
export const ENTITY_CURRENT_STATE = 'currentState';

// ── 物品子字段 ──
export const ITEM_STATUS = 'status';
// ITEM_NAME = ENTITY_NAME, ITEM_DESC = ENTITY_DESC（复用）

// ── Dice 子字段 ──
export const DICE_SKILL_NAME = 'skill_name';
export const DICE_SKILL_POINT = 'skill_point';
export const DICE_NOTATION = 'notation';
export const DICE_SUCCESS_RATE = 'success_rate';

// === actions 字段常量（替代原 DICE 三字段） ===
export const ACTIONS = 'actions';
export const ACTION_TYPE = 'type';
export const SKILL_CHECK = 'skill_check';
export const SANCHECK = 'sancheck';
export const DIRECT = 'direct';
export const ON_SUCCESS = 'on_success';
export const ON_FAIL = 'on_fail';
export const CHANGES = 'changes';
export const BONUS_DICE = 'bonus_dice';
export const PENALTY_DICE = 'penalty_dice';

// changeItem 字段常量
export const TARGET = 'target';
export const ATTR_FIELD = 'attr';        // 避免与保留字冲突
export const DELTA = 'delta';
export const EFFECT = 'effect';

// === trigger 字段常量（区分检定场景） ===
export const TRIGGER = 'trigger';
export const TRIGGER_PLAYER = 'player';
export const TRIGGER_OTHERS = 'others';

// === 大成功/大失败 changeItem 字段常量 ===
export const ON_CRITICAL_SUCCESS = 'on_critical_success';
export const ON_CRITICAL_FAILURE = 'on_critical_failure';

// === pendingDiceFlow.dialogStage 状态常量 ===
export const DIALOG_STAGE = 'dialogStage';
export const DIALOG_A_CONFIRM = 'A_CONFIRM';
export const DIALOG_B_SANCHECK_CONFIRM = 'B_SANCHECK_CONFIRM';
export const DIALOG_EXECUTING = 'EXECUTING';

// === 后端返回 branch 常量（A 确认后需 B 二次弹窗） ===
export const BRANCH_B_SANCHECK_AWAITING = 'B_SANCHECK_AWAITING';

// 结局字段常量
export const ENDING_TYPE = 'ending_type';
export const ENDING_TEXT = 'ending_text';

// ── Prompt 文本片段 ──

/** 实体引用规则说明文本（STORY_OPENING 与 NARRATION 共用，差异通过 isOpening 区分） */
export function buildEntityReferenceRules(isOpening) {
  if (isOpening) {
    return `实体规则：id填null由系统分配；主角(npc_000)和已邀请角色(npc_001~003)已固定存在，不重复加入；不要用昵称/变体重命名实体。`;
  }
  return `实体规则：已有实体填其id（仅更新currentState，不改name/baseDescription）；新实体id填null；不要用昵称/变体重命名；主角(npc_000)和已邀请角色已固定，不重复加入。`;
}

// ── 检测函数 ──

/**
 * 检测是否包含 actions 字段
 * actions 非空数组 = 有检定/变化需要处理
 */
export function hasActionsField(parsed) {
  return !!(parsed && Array.isArray(parsed[ACTIONS]) && parsed[ACTIONS].length > 0);
}
