/**
 * NarrativeSchema —— 叙事阶段 JSON 键名常量 & prompt 文本片段。
 *
 * v2.0 strict 模式改造后：
 * - JSON Schema 已通过 StrictSchemaRegistry.js + tools 参数服务端强制
 * - 本文件仅保留：键名常量、实体引用规则文本、dice 检测函数
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

// ── Prompt 文本片段 ──

/** 实体引用规则说明文本（STORY_OPENING 与 NARRATION 共用，差异通过 isOpening 区分） */
export function buildEntityReferenceRules(isOpening) {
  if (isOpening) {
    return `实体引用规则（重要）：
  1) 开幕阶段实体通常都是首次出场，${ENTITY_ID} 统一填 null，由系统自动分配
  2) 主角(npc_000)和已邀请角色(npc_001~003)已固定存在（见上方"关键角色"清单），不要加入 npcs 数组
  3) 不要用昵称、敬称、缩写、全称变体命名已存在的实体`;
  }
  return `实体引用规则（重要）：
  1) 请参考"已有实体清单"中列出的 id。对已存在的实体，必须填入对应的 ${ENTITY_ID}，并仅更新 ${ENTITY_CURRENT_STATE}（${ENTITY_BASE_DESC} 留空即可）；不要修改 ${ENTITY_NAME} 字段
  2) 仅当实体确实是首次出场时，才将 ${ENTITY_ID} 设为 null，由系统自动分配新 id
  3) 不要用昵称、敬称、缩写、全称变体重新命名已存在的实体
  4) 主角(npc_000)和已邀请角色(npc_001~003)已固定存在，不要作为新 NPC 加入 npcs 数组`;
}

// ── 检测函数 ──

/** 检测 parsed 是否包含 dice 判定 */
export function hasDiceField(parsed) {
  return !!(parsed && parsed[DICE] && typeof parsed[DICE] === 'object');
}
