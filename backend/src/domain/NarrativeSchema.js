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
export const ENTITY_NAME = 'name';
export const ENTITY_DESC = 'description';

// ── 物品子字段 ──
export const ITEM_STATUS = 'status';
// ITEM_NAME = ENTITY_NAME, ITEM_DESC = ENTITY_DESC（复用）

// ── Dice 子字段 ──
export const DICE_SKILL_NAME = 'skill_name';
export const DICE_SKILL_POINT = 'skill_point';
export const DICE_NOTATION = 'notation';
export const DICE_SUCCESS_RATE = 'success_rate';

// ── Prompt 模板生成 ──

/** STORY_OPENING 阶段的 JSON 格式提示文本 */
export function buildStoryOpeningSchemaText() {
  return `{
  "${NARRATION}": "<string>",
  "${LOCATIONS}": [
    { "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${NPCS}": [
    { "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${ITEMS}": [
    { "${ENTITY_NAME}": "<string>", "${ITEM_STATUS}": "<string>", "${ENTITY_DESC}": "<string>" }
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
- NPC 需为新出场人物或有重要状态更新的旧人物（关键角色除外）
- ${OPTIONS} 必须恰好包含 4 个元素，以 A. B. C. D. 开头，最后一个固定为"D. 自由行动"`;
}

/** NARRATION_I / NARRATION_II 阶段的 JSON 格式提示文本 */
export function buildNarrativeSchemaText() {
  return `格式 A —— 不需要投掷判定，正常叙事：
{
  "${NARRATION}": "<string>",
  "${LOCATIONS}": [
    { "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${NPCS}": [
    { "${ENTITY_NAME}": "<string>", "${ENTITY_DESC}": "<string>" }
  ],
  "${ITEMS}": [
    { "${ENTITY_NAME}": "<string>", "${ITEM_STATUS}": "<string>", "${ENTITY_DESC}": "<string>" }
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
- ${LOCATIONS} / ${NPCS} / ${ITEMS} 若本轮无新内容，设为空数组 []，不要编造（关键角色除外）
- ${OPTIONS} 必须恰好包含 4 个元素，最后一个固定为"D. 自由行动"`;
}

// ── 检测函数 ──

/** 检测 parsed 是否包含 dice 判定 */
export function hasDiceField(parsed) {
  return !!(parsed && parsed[DICE] && typeof parsed[DICE] === 'object');
}
