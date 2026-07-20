/**
 * NarrativeSchema —— 叙事阶段 JSON 键名常量 & prompt 模板生成器。
 *
 * 覆盖 STORY_OPENING / NARRATION_I / NARRATION_II 三个阶段共用的字段。
 * 所有消费者（PromptTemplateRegistry / TextRefiner / EntityUpdater / OutputProcessor / JsonOutputParser）
 * 统一引用此模块，不再各自硬编码字段名。
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

// ── 实体子字段（locations / npcs 共用） ──
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

// ── Prompt 模板生成 ──

/** 实体引用规则说明文本（STORY_OPENING 与 NARRATION 共用，差异通过 isOpening 区分） */
function buildEntityReferenceRules(isOpening) {
  if (isOpening) {
    return `实体引用规则（重要）：
  1) 开幕阶段实体通常都是首次出场，${ENTITY_ID} 统一填 null，由系统自动分配
  2) 主角(npc_000)和已邀请角色(npc_001~003)已固定存在（见上方"关键角色"清单），不要作为新 NPC 输出
  3) 不要用昵称、敬称、缩写、全称变体命名已存在的实体`;
  }
  return `实体引用规则（重要）：
  1) 请参考"已有实体清单"中列出的 id。对已存在的实体，**必须填入对应的 ${ENTITY_ID}**，并仅更新 ${ENTITY_CURRENT_STATE}（${ENTITY_BASE_DESC} 留空即可）；**不要修改 ${ENTITY_NAME} 字段**
  2) 仅当实体确实是首次出场时，才将 ${ENTITY_ID} 设为 null，由系统自动分配新 id
  3) 不要用昵称、敬称、缩写、全称变体重新命名已存在的实体
  4) 主角(npc_000)和已邀请角色(npc_001~003)已固定存在，不要作为新 NPC 重复输出`;
}

/** STORY_OPENING 阶段的 JSON 格式提示文本 */
export function buildStoryOpeningSchemaText() {
  return `{
  "${NARRATION}": "<string>",
  "${LOCATIONS}": [
    { "${ENTITY_ID}": null, "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${NPCS}": [
    { "${ENTITY_ID}": null, "${ENTITY_NAME}": "<string>", "${ENTITY_BASE_DESC}": "<string>", "${ENTITY_CURRENT_STATE}": "<string>" }
  ],
  "${ITEMS}": [
    { "${ENTITY_ID}": null, "${ENTITY_NAME}": "<string>", "${ITEM_STATUS}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${OPTIONS}": [
    "A. <string>",
    "B. <string>",
    "C. <string>",
    "D. 自由行动"
  ]
}

说明：
- 所有 <string> 字段请根据世界观和玩家设定合理创作，不要套用示例值
- ${LOCATIONS} / ${NPCS} / ${ITEMS} 若无相应内容，设为空数组 []
- ${ITEMS} 中每个元素必须标明 ${ITEM_STATUS}（已获得 / 已失去）
- ${buildEntityReferenceRules(true)}
- ${OPTIONS} 必须恰好包含 4 个元素，以 A. B. C. D. 开头，最后一个固定为"D. 自由行动"`;
}

/** NARRATION_I / NARRATION_II 阶段的 JSON 格式提示文本 */
export function buildNarrativeSchemaText() {
  return `格式 A —— 不需要投掷判定，正常叙事：
{
  "${NARRATION}": "<string>",
  "${LOCATIONS}": [
    { "${ENTITY_ID}": "<string|null>", "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${NPCS}": [
    { "${ENTITY_ID}": "<string|null>", "${ENTITY_NAME}": "<string>", "${ENTITY_BASE_DESC}": "<string>", "${ENTITY_CURRENT_STATE}": "<string>" }
  ],
  "${ITEMS}": [
    { "${ENTITY_ID}": "<string|null>", "${ENTITY_NAME}": "<string>", "${ITEM_STATUS}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${HP}": null,
  "${SAN}": null,
  "${OPTIONS}": [
    "A. <string>",
    "B. <string>",
    "C. <string>",
    "D. 自由行动"
  ]
}

格式 B —— 需要投掷判定（此时不需要 ${LOCATIONS}/${NPCS}/${ITEMS}/${HP}/${SAN}/${OPTIONS} 字段）：
{
  "${NARRATION}": "<string>（需要判定的地方用【】标注）",
  "${DICE}": {
    "${DICE_SKILL_NAME}": "<string>",
    "${DICE_SKILL_POINT}": <number>,
    "${DICE_NOTATION}": "<string>",
    "${DICE_SUCCESS_RATE}": <number>
  }
}

说明：
- 所有 <string> 和 <number> 字段请根据实际情况合理填写，不要套用示例值
- ${HP} / ${SAN} 若无变化设为 null，不要省略
- ${buildEntityReferenceRules(false)}
- ${LOCATIONS} / ${NPCS} / ${ITEMS} 若本轮无任何新增或状态更新，设为空数组 []
- ${OPTIONS} 必须恰好包含 4 个元素，最后一个固定为"D. 自由行动"`;
}

// ── 检测函数 ──

/** 检测 parsed 是否包含 dice 判定 */
export function hasDiceField(parsed) {
  return !!(parsed && parsed[DICE] && typeof parsed[DICE] === 'object');
}
