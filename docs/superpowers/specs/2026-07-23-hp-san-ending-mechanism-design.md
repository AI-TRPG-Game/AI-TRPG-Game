# HP/SAN 伤害机制与结局触发设计

**日期**: 2026-07-23
**状态**: 设计已确认，待实现
**关联专题**: 专题2-核心机制缺陷与修复（缺陷二：HP/SAN 虚设 + 缺陷一：结局触发）

***

## 1. 背景与问题

### 1.1 现有缺陷

**缺陷二：HP/SAN 只是虚设，无机制触发结果**

- `session.player` 是字符串，HP/SAN 用正则 `replace(/HP[::]\s*\d+/, ...)` 替换，脆弱且无类型安全
- 无 `maxHp`/`maxSan` 概念，LLM 可把 HP 从 5 改到 150（超过最大值）
- HP/SAN 变化完全由 LLM 决定，不与骰子检定关联，不遵循 CoC 7e 伤害公式
- NPC 完全没有 hp/san 字段
- 骰子结果与 HP/SAN 完全解耦（骰子只生成"判定等级文本"，HP/SAN 变化由 LLM 在 NARRATION\_II 凭感觉编）

**缺陷一：结局触发机制缺失**

- `Phase` 只有 4 个阶段（WORLD\_SETTING/CHARACTER\_SETTING/KEY\_CHARACTER\_SETTING/STORY\_PLAY），没有 ENDING
- `SubState` 只有 4 个子状态（AWAITING\_INPUT/LLM\_STREAMING/DICE\_PENDING/SUMMARIZING），没有 GAME\_OVER
- 没有任何代码检测 `hp<=0` / `san<=0`

### 1.2 设计目标

- 结构化存储 HP/SAN（带 maxHp/maxSan 钳制）
- 系统全权计算伤害（基于 CoC 7e 规则），LLM 只参考状态词写剧情
- 所有角色（玩家+NPC）统一到 npcs 数组，HP/SAN 逻辑统一
- HP/SAN 清零触发结局流程，支持"重新开始故事"（保留对话记忆，回退实体状态）
- 不集成完整跑团伤害机制（简化版，覆盖核心场景）

### 1.3 CoC 7e 规则参考

- **HP**：HP = (CON+SIZ)/10，武器伤害骰（1d3 空手 / 1d4+db 武器 / 1d8 刀等），结果即伤害。HP ≤ 0 → 死亡撕卡
- **SAN check**：投 1d100 vs 当前 SAN 值。成功扣 1d3 SAN，失败扣 1d6 SAN（特殊场景 1d10/2d20）
- **临时疯狂**：单次损失 ≥5 SAN → 立即发作
- **永久疯狂**：SAN = 0 → 撕卡
- **惩罚/奖励骰**：1d100 = 十位骰（d10×10）+ 个位骰（d10）。奖励骰多投一个十位骰取**较小**十位，惩罚骰多投一个十位骰取**较大**十位。官方建议最多 2 个，本设计采用 0-2
- **对抗检定**：双方都投检定，比较成功等级（如角力、说服）。本设计**放弃对抗检定**，用惩罚/奖励骰 + delta 公式两层调节替代：
  - **检定层**：强弱通过惩罚/奖励骰体现（强者攻击给玩家惩罚骰，弱者给奖励骰）
  - **伤害层**：通过 `hp_san_changes[].delta` 公式大小体现（老人空手 1d3，壮汉 1d6+1，异形 2d6）

### 1.4 骰子公式格式

`hp_san_changes[].delta` 和现有 DiceService 的 notation 字段统一使用 **NdM+K** 格式字符串：

- `1d3`、`1d4`、`1d6`、`1d8`、`1d10`、`1d100`（标准骰）
- `2d6+1`、`1d4+2`（带加成）
- `1d3`（SAN check 成功伤害）、`1d6`（SAN check 失败伤害）

现有 DiceService 只支持 1d100，需扩展为支持通用 `NdM+K` 公式解析与投掷。

***

## 2. 数据结构变更

### 2.1 统一到 npcs 数组

现有 `session.player`（字符串）和 `session.npcs[]`（数组，不含玩家）是分离的，HP/SAN 逻辑分散。统一到 npcs 数组：

```
npcs[] 包含所有角色：
  npc_000 = 玩家（importance='player'）
  npc_001~00X = 关键角色（importance='key'，X = 实际邀请数量）
  npc_00(X+1)+ = 普通 NPC（importance='supporting'/'background'）
```

**格式区分**：

- 玩家和关键角色保留 `session.player`（字符串）和 `session.keyCharacters[]`（字符串数组）作为角色卡文本源（显示和 prompt 用）
- npc\_000\~00X 条目的 baseDescription 不存文本，标记 importance 即可，渲染时从 player/keyCharacters 取
- 普通 NPC 用 baseDescription + currentState

**编号方案与决策时机**：

- 故事开幕时（`openStory` 被调用，准备处理 LLM 故事开幕输出时），根据 `keyCharacters.length` 确定普通 NPC 起始编号
- `idAllocator.nextNewNpcId` 改为：起始编号 = `keyCharacters.length + 1`（000 是玩家，001\~00X 是关键角色）
- 结局重置时：删除 `id > npc_00X` 的所有 NPC（X = keyCharacters.length），保留 npc\_000\~00X

### 2.2 NPC 条目扩展

现有 NPC 只有 `id/name/baseDescription/currentState/importance/firstSeenAt/lastUpdatedAt`。新增：

```javascript
npc = {
  id, name, baseDescription, currentState, importance, firstSeenAt, lastUpdatedAt,
  // 新增
  hp,           // 当前 HP（number，首次出场由 LLM 输出）
  maxHp,        // 最大 HP（number，首次出场由 LLM 输出）
  san,          // 当前 SAN（number）
  maxSan,       // 最大 SAN（number）
  visibility,   // 'visible'（玩家可见）| 'hidden'（前端显示"已隐藏"）
  status,       // 'active' | 'departed'（清零后标记退场，不从列表移除）
  attributes,   // 8大属性对象（仅 key 角色输出，supporting 不输出）
}
```

- **首次出场**：LLM 在 npcItemSchema 中输出完整 hp/san/maxHp/maxSan/visibility；key 角色额外输出 attributes
- **后续轮次**：LLM 不再输出这些字段（靠 actions 触发变化）
- **visibility 可更新**：LLM 可根据剧情切换（如神秘人现身 hidden→visible，角色潜行隐匿 visible→hidden）
- **attributes 锁定**：key 角色首次创建时填入，后续不可覆盖（与 baseDescription 同样的保护逻辑）
- **hidden 角色的属性处理**：创建时 LLM 输出完整属性+hp/san，系统存储真实值；前端和 prompt 注入时隐藏数值（显示 "??"）；visibility 变为 visible 后开始显示真实值（数值本身不变）
- **status='departed'**：NPC hp/san≤0 时由系统标记，LLM 在叙事中体现退场

### 2.3 NPC 更新权限矩阵

| importance | baseDescription         | currentState | hp/san | visibility | importance | attributes       |
| ---------- | ----------------------- | ------------ | ------ | ---------- | ---------- | ---------------- |
| player     | 不可改（从 session.player 取） | 可更新          | 系统计算   | 锁定（visible） | 锁定（player） | 锁定（从角色卡取） |
| key        | 不可改（从 keyCharacters 取）  | 可更新          | 系统计算   | 可更新        | 锁定（key）   | 首次填入后锁定 |
| supporting | 首次设定后不可改                | 可更新          | 系统计算   | 可更新        | 可升级（→key） | 不输出（null） |

**设计说明**：
- `background` 不作为 importance 枚举值——路人/背景角色不进入 npcs 数组，直接在 narration 中描写
- 玩家/已邀请关键角色的 importance 和 visibility 由系统锁定，LLM 即使输出也会被 mergeEntity 忽略
- 其他 NPC 的 importance 和 visibility 不需要在 prompt 特别约束，LLM 可根据剧情自由更新
- supporting 角色不输出 attributes，仅 key 角色输出（key 可能参与检定，需要精确属性值；supporting 不检定，伤害通过 delta 公式体现）

### 2.4 actions 字段 schema（统一替代三字段）

将原 `dice` 字段（及之前设计的 attr\_skill\_dice/sancheck\_dice/hp\_san\_changes 三字段）统一合并为一个 `actions` 数组。每个 action 自包含"检定+后果"，消除多检定场景下的歧义。

```javascript
// 变化项（change）统一结构：on_success/on_fail/changes 数组的元素
changeItem = {
  target: 'player' | 'npc_XXX',    // 目标（谁的血条变化）
  attr: 'hp' | 'san',               // 变化属性
  delta: '1d4',                     // 骰子公式（NdM+K 格式）
  effect: 'damage' | 'heal',        // 伤害/治疗
}

// actions 数组，每个元素是三种类型之一
actions: [
  // 类型1：skill_check（技能/属性检定，1d100 vs skill_point + 惩罚/奖励骰）
  {
    type: 'skill_check',
    skill_name: '斗殴',
    skill_point: 55,                // 0-100
    bonus_dice: 0,                  // 0-2，默认 0（多投十位骰取较小）
    penalty_dice: 0,                // 0-2，默认 0（多投十位骰取较大）
    on_success: [changeItem],       // 检定成功时生效的变化，空数组=无变化
    on_fail: [changeItem],          // 检定失败时生效的变化，空数组=无变化
  },

  // 类型2：sancheck（SAN 检定，系统查 target 当前 SAN 作为阈值，自动投 1d3/1d6）
  {
    type: 'sancheck',
    target: 'player'                // 系统自动查 target 的 san 作为检定阈值
    // 成功→系统自动投 1d3 san damage；失败→自动投 1d6 san damage
  },

  // 类型3：direct（直接变化，无检定，休息恢复/区域影响/NPC加血等）
  {
    type: 'direct',
    changes: [changeItem]
  }
] | null   // null 或不存在=本轮无任何检定/变化
```

**相比三字段设计的精简点**：

- 三字段（attr\_skill\_dice + sancheck\_dice + hp\_san\_changes）→ 一个 `actions` 字段
- `trigger` 字段不再需要（on\_success/on\_fail 已表达触发条件）
- `san_value` 不再需要（系统查 target 当前 SAN）
- `notation` 不再需要（固定 1d100）
- `success_rate` 不再需要（= skill\_point）

**消除歧义的核心**：每个检定的后果自包含在 action 内，不跨字段关联。同一轮可包含多个检定（多个 skill\_check、多个 sancheck、或混合），每个检定的后果独立无歧义。

### 2.5 顶层 hp/san 字段语义变更

`buildNarrationStrictSchema` 中的 `hp`/`san` 顶层字段（`nullableInteger(-99, 99)`）**语义变更**：

- **旧语义**：LLM 输出 HP/SAN 绝对值，系统用正则替换字符串
- **新语义**：LLM 固定填 `null`（系统全权计算伤害，LLM 不再输出数值）
- schema 中字段保留（方案 B+ 统一 schema 兼容性），但 prompt 明确指示"hp/san 固定填 null，由系统计算"
- 系统通过 prompt 注入当前所有角色（npc\_000\~00X + 普通 NPC）的 hp/san，让 LLM 知道当前数值（见 3.4）

### 2.6 新增 session 缓存字段

```javascript
// 故事开幕缓存（用于结局重置时重新发送）
session.storyOpeningCache = null | {
  raw: '...',          // LLM 原始输出（含 parsed JSON）
  parsed: {...},       // 解析后的对象（含 narration/locations/...）
  timestamp: '...',
};

// 玩家/关键角色初始状态缓存（用于结局重置时恢复）
session.characterInitialStats = null | [
  { npcId: 'npc_000', hp: 11, maxHp: 11, san: 70, maxSan: 70, currentState: '' },
  { npcId: 'npc_001', hp: 10, maxHp: 10, san: 55, maxSan: 55, currentState: '...' },
  // ... 直到 npc_00X（X = keyCharacters.length）
];
```

**缓存时机**：故事开幕完成时（`openStory` 完成后）
**恢复时机**：用户点"是"重启时

***

## 3. HP/SAN 变化数据流

### 3.1 NARRATION\_I 输出的场景（基于 actions 字段）

**场景 A：纯技能检定**（如攀爬、聆听）

```javascript
actions: [
  { type: 'skill_check', skill_name: '攀爬', skill_point: 60,
    on_success: [], on_fail: [] }
]
```

- on\_success/on\_fail 都为空 = 无 HP/SAN 变化，只输出判定结果

**场景 B：SAN 检定**（目击恐怖事物）

```javascript
actions: [
  { type: 'sancheck', target: 'player' }
]
```

- 系统查 player 当前 SAN 作为阈值，投 1d100
- 成功投 1d3 SAN 伤害，失败投 1d6 SAN 伤害（系统自动计算，LLM 不输出伤害）

**场景 C：直接伤害/治疗**（物理攻击、休息恢复、区域影响）

```javascript
actions: [
  { type: 'direct', changes: [
      { target: 'player', attr: 'san', delta: '1d3', effect: 'heal' }
  ]}
]
```

- 无检定，系统投 delta，按 effect 扣减或增加

**场景 D：检定+伤害**（玩家攻击 NPC / NPC 攻击玩家 / 治愈术等）

```javascript
// D1: 玩家攻击 NPC（成功才造成伤害）
actions: [
  { type: 'skill_check', skill_name: '斗殴', skill_point: 55,
    on_success: [{ target: 'npc_002', attr: 'hp', delta: '1d8', effect: 'damage' }],
    on_fail: [] }
]

// D2: NPC 攻击玩家（玩家闪避，失败才受伤）
actions: [
  { type: 'skill_check', skill_name: '闪避', skill_point: 45, penalty_dice: 2,
    on_success: [],
    on_fail: [{ target: 'player', attr: 'hp', delta: '1d6', effect: 'damage' }] }
]

// D3: 治愈术（成功加血 + 大失败额外伤害）
actions: [
  { type: 'skill_check', skill_name: '急救', skill_point: 40,
    on_success: [{ target: 'player', attr: 'hp', delta: '1d3', effect: 'heal' }],
    on_fail: [{ target: 'player', attr: 'hp', delta: '1d4', effect: 'damage' }] }
]
```

**场景 E：多检定组合**（原三字段设计无法表达，actions 无歧义覆盖）

```javascript
// E1: 玩家攻击NPC + 同时闪避另一NPC攻击
actions: [
  { type: 'skill_check', skill_name: '斗殴', skill_point: 55,
    on_success: [{ target: 'npc_002', attr: 'hp', delta: '1d8', effect: 'damage' }],
    on_fail: [] },
  { type: 'skill_check', skill_name: '闪避', skill_point: 45,
    on_success: [],
    on_fail: [{ target: 'player', attr: 'hp', delta: '1d6', effect: 'damage' }] }
]

// E2: 群体 sancheck
actions: [
  { type: 'sancheck', target: 'player' },
  { type: 'sancheck', target: 'npc_001' }
]

// E3: sancheck + 无伤害技能检定
actions: [
  { type: 'sancheck', target: 'player' },
  { type: 'skill_check', skill_name: '神秘学', skill_point: 30,
    on_success: [], on_fail: [] }
]
```

### 3.2 DamageResolver 处理流程

用户确认掷骰后（confirmDice），DamageResolver 按顺序处理 `actions` 数组：

```
对 actions 数组中的每个 action 按顺序处理：

1. type='skill_check'：
   a. 投 1d100 + 惩罚/奖励骰（十位骰取较大/较小）
   b. 判定成功等级（大成功/极难成功/困难成功/一般成功/一般失败/大失败）
   c. 根据成功/失败，应用对应的 on_success / on_fail 变化项
      （成功→应用 on_success，失败→应用 on_fail）

2. type='sancheck'：
   a. 系统查 target 当前 san 作为阈值
   b. 投 1d100 vs san，判定成功/失败
   c. 成功→系统自动投 1d3 san damage；失败→自动投 1d6 san damage
   d. 应用伤害到 target 的 san

3. type='direct'：
   a. 对 changes 数组中每个变化项投 delta
   b. 按 effect 应用伤害/治疗

4. 每个变化项应用：
   - 找到 target 对应的 npc 条目
   - effect='damage' → hp/san = max(0, min(maxHp, current - damage))
   - effect='heal' → hp/san = max(0, min(maxHp, current + heal))
   - 生成状态词（见 3.3）

5. 所有 actions 处理完毕后，检查清零：
   - 玩家（npc_000）hp≤0 或 san≤0 → 触发结局流程（第 4 节）
   - NPC hp≤0 或 san≤0 → 标记 status='departed'，生成状态词

6. 生成系统判定消息（推送到前端 + LLM）：
   【使用斗殴技能（技能点55），判定结果23，困难成功】
   【npc_002 受到1d8=6点HP伤害 → 受重伤】
   【使用闪避技能（技能点45，2惩罚骰），判定结果78，一般失败】
   【SAN检定（当前SAN 70），判定结果45，成功，损失1d3=2点SAN → 头晕目眩】

7. 调用 NARRATION_II，让 LLM 根据系统判定+状态词写剧情
```

### 3.3 状态词映射（基于 CoC 7e）

新增 `DamageResolver.getStatusWord(attr, damageAmount)`:

**HP 伤害**（基于单次伤害量）：

- 1-3 → "轻微受伤"
- 4-9 → "受重伤"
- ≥10 → "致命重创"
- HP ≤ 0 → "濒死"（玩家触发结局，NPC 标记 departed）

**SAN 伤害**（基于 CoC 7e 单次损失）：

- 1-4 → "头晕目眩"
- ≥5 → "暂时疯狂"（CoC 7e：单次损失 ≥5 立即发作）
- SAN ≤ 0 → "永久疯狂"（玩家触发结局，NPC 标记 departed）

**治疗**：状态词为"恢复若干点"（如"HP恢复3点"），不触发疯狂判定。

状态词一次性提示，不持久化。`status='departed'` 持久化到 npc 条目。

### 3.4 prompt 注入当前角色状态

`InputAssembler` 在组装 NARRATION\_I/II 的 prompt 时，注入所有角色的当前 HP/SAN（及 key 角色的属性）：

```
【当前角色状态】
玩家（npc_000）：HP 8/11，SAN 65/70
关键角色1（npc_001 · 阿史德·跋禄迦）：HP 10/10，SAN 55/60，属性：力量50/敏捷60/体质55/体型60/外貌50/智力60/意志55/教育65
普通NPC（npc_002 · 葡萄盏酒肆老板）：HP 6/8，SAN 50/50
隐藏NPC（npc_003 · 神秘人）：HP ??/??，SAN ??/??，属性 ??（已隐藏）
```

- visibility='hidden' 的 NPC，数值显示 "??"，LLM 知道存在但不知道具体值
- departed 的 NPC 标注"已退场"，prompt 约束 LLM 不可让其行动

### 3.5 NARRATION\_II 阶段

系统判定+状态词通过 system 消息推送给 LLM 后，NARRATION\_II 的 prompt 包含：

- 系统判定结果（"【受到1d4=3点HP伤害 → 轻微受伤】"）
- 当前角色状态（HP/SAN 数值）

LLM 据此输出 NARRATION\_II：

```
narration: "触手抽中你的肩膀，一阵剧痛传来...(描写伤害和状态词的叙事体现)"
hp: null, san: null  // LLM 固定填 null，系统已计算完毕
actions: null  // 本轮无新判定
```

NARRATION\_II 中若 actions 非空，走递归 dice 分支（现有机制）。

***

## 4. 结局触发与重新开始机制

### 4.1 结局触发条件

`DamageResolver` 在每次伤害计算后检测：**仅玩家（npc\_000）** 的 hp≤0 或 san≤0 触发结局流程。NPC 清零只标记 `status='departed'` + 生成状态词。

触发时机：在 `confirmDice` 流程中，DamageResolver 计算伤害后、调用 NARRATION\_II **之前**检测。若触发结局，**跳过 NARRATION\_II**，进入结局流程。

### 4.2 结局流程数据流

```
1. DamageResolver 检测到玩家 hp≤0 或 san≤0
2. 系统推送 system 消息到前端 + chatRecord：
   "【玩家HP归零，触发死亡结局】" 或 "【玩家SAN归零，触发疯狂结局】"
3. 系统设置 session.subState = SubState.ENDING_PENDING（新增子状态）
4. 系统调用 ENDING_GEN flow（新增 FlowType）：
   - prompt 包含：storyOpeningCache + 当前剧情上下文 + 结局类型（death/madness）
   - LLM 生成 RPG 风格结局文本（"达成 XXX 结局"），不提重新开始选项
   - LLM 输出格式：{ ending_type: 'death'|'madness', ending_text: '...' }
5. 系统将结局文本推送到前端 + chatRecord
6. 系统设置 session.subState = SubState.RESTART_PENDING（新增子状态）
7. 前端显示"是否重新开始故事？"选项：
   - 按钮1："是" → 触发重启
   - 按钮2："暂时搁置" → 仅按钮变色，无其他操作
   - 禁止玩家操作对话框（直到点"是"并完成重启）
```

### 4.3 新增 FlowType.ENDING\_GEN

```javascript
// enums.js 新增
FlowType.ENDING_GEN = 'ENDING_GEN';

// StrictSchemaRegistry.js 新增（第 5 个函数名）
endingGenStrictSchema = {
  type: 'object',
  properties: {
    ending_type: { type: 'string', enum: ['death', 'madness'] },
    ending_text: { type: 'string', description: 'RPG风格结局文本' },
  },
  required: ['ending_type', 'ending_text'],
  additionalProperties: false,
};

// FLOW_FUNCTION_NAMES 新增（现在共 5 个函数）
[FlowType.ENDING_GEN]: 'output_ending',

// PromptTemplateRegistry 新增 system instruction
// 约束：只生成结局文本，不提重新开始选项（选项由系统处理）
```

### 4.4 重启流程（用户点"是"）

```
1. 前端调用 /restart-story API
2. 系统执行重启（不删除对话记录）：
   a. 恢复玩家/关键角色初始状态：
      - 从 characterInitialStats 恢复 npc_000~00X 的 hp/san/maxHp/maxSan
      - 恢复 npc_000~00X 的 currentState 为初始值（故事开幕时的状态）
   b. 删除普通 NPC：移除 npcs[] 中 id > npc_00X 的所有条目（X = keyCharacters.length）
   c. 清除 locations[] 和 inventory[]
   d. 重置 session.phase = STORY_PLAY，session.subState = AWAITING_INPUT
3. 重新发送故事开幕：
   a. 将"请重新开启一轮故事，世界观与主要人设不变"写入本轮 user 消息
   b. 将 storyOpeningCache 的内容作为本轮 assistant 消息注入 chatRecord
      （含 parsed + flowType=STORY_OPENING，保持方案 B+ 的 tool_calls 结构）
   c. 前端渲染故事开幕文本（从 storyOpeningCache）
4. 等待用户在故事开幕做出选择：
   - 用户输入正常计入 user 消息
   - 后续走正常 NARRATION_I 流程
```

### 4.5 重启时的对话记录顺序

chatRecord 保持完整（不删除任何对话记录）。LLM 看到的历史是：

```
[之前所有对话，含第一轮故事的剧情、伤害、结局]
[system] 【玩家HP归零，触发死亡结局】
[assistant] 结局文本（tool_calls: output_ending）
[user] 请重新开启一轮故事，世界观与主要人设不变
[assistant] 故事开幕文本（tool_calls: output_narration，从 storyOpeningCache 恢复）
[user] （等待用户输入新的选择）
```

这样 LLM 有第一轮故事的记忆，能给用户呼应感。

### 4.6 "暂时搁置"与按钮状态管理

- 点"暂时搁置"：按钮变色（如灰色→淡黄色），`session.subState` 保持 `RESTART_PENDING`，无其他操作
- 允许点"暂时搁置"后再次点"是"
- 点"是"后：两个按钮禁用（不可再点），开始重启流程
- 重启完成（故事开幕重新发送后）：恢复对话框操作权限

前端状态管理：

- `subState === 'ENDING_PENDING'` 时：LLM 正在生成结局，禁用对话框
- `subState === 'RESTART_PENDING'` 时：禁用对话框 + 显示重启按钮
- `subState === 'AWAITING_INPUT'`（重启后）时：恢复对话框 + 隐藏重启按钮

***

## 5. 新增组件与模块清单

### 5.1 新增模块

**`DamageResolver.js`**（核心新模块）

- 职责：处理 attr\_skill\_dice / sancheck\_dice / hp\_san\_changes，计算伤害，更新 HP/SAN，生成状态词和系统消息
- 依赖：DiceService（掷骰）、GameSession（npcs 数组）、NarrativeSchema（字段常量）
- 接口：
  ```javascript
  class DamageResolver {
    resolve(session, parsed, onSystemMessage) → {
      systemMessages: string[],      // 推送给前端+LLM 的判定消息
      playerDied: boolean,           // 是否触发结局
      departedNpcs: string[],        // 本轮退场的 NPC id 列表
    }
    getStatusWord(attr, damageAmount, currentAfter) → string
  }
  ```

**`EndingService.js`**（结局与重启）

- 职责：检测结局触发、调用 ENDING\_GEN、执行重启流程
- 依赖：GameOrchestrator（调 LLM）、GameSession（状态管理）、storyOpeningCache/characterInitialStats
- 接口：
  ```javascript
  class EndingService {
    checkAndTriggerEnding(session, damageResult, onDebug, onSystemMessage) → boolean
    restartStory(session) → void  // 恢复初始状态+删除普通NPC+重发故事开幕
  }
  ```

### 5.2 现有模块修改

| 模块                          | 修改内容                                                                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameSession.js`            | 新增 `storyOpeningCache`、`characterInitialStats`；npcs 数组元素新增 hp/san/maxHp/maxSan/visibility/status/attributes 字段；删除 playerStats（改用 npc\_000 的 hp/san）                                                                                                                                          |
| `DiceService.js`            | 扩展为支持通用 `NdM+K` 公式解析与投掷（现有仅支持 1d100）；新增 `rollFormula(formula)` 方法；新增惩罚/奖励骰计算（1d100 拆为十位骰+个位骰，惩罚骰多投十位骰取较大，奖励骰取较小，最多 2 个）                                                                                                                                                                      |
| `NarrativeSchema.js`        | `DICE` 改名 `ACTIONS`；新增 `ACTIONS`、`SKILL_CHECK`、`SANCHECK`、`DIRECT`、`ON_SUCCESS`、`ON_FAIL`、`CHANGES`、`BONUS_DICE`、`PENALTY_DICE`、`TARGET`、`ATTR_FIELD`、`DELTA`、`EFFECT`、`ENDING_TYPE`、`ENDING_TEXT` 常量；`HP`/`SAN` 顶层字段语义变更（LLM 固定填 null）                                                      |
| `StrictSchemaRegistry.js`   | `diceSchema` 替换为 `actionsSchema`（含 skill\_check/sancheck/direct 三种类型的 oneOf）；新增 `changeItemSchema`（target/attr/delta/effect）；新增 `endingGenStrictSchema`、`buildEndingGenStrictSchema`；`npcItemSchema` 新增 hp/san/maxHp/maxSan/visibility/status/attributes，importance enum 移除 background（仅 key/supporting）；`FLOW_FUNCTION_NAMES` 新增 output\_ending（第5个函数） |
| `EntityUpdater.js`          | 删除 `updatePlayerStats`（正则替换）；`mergeEntity` 增加 hp/san/visibility/status/attributes 处理逻辑（visibility 可更新、importance 可升级、attributes 首次填入后锁定）；玩家/关键角色合并到 npcs 数组的逻辑                                                                                                                                  |
| `OutputProcessor.js`        | Dice 分支检测改为检测 `actions` 字段非空；调用 DamageResolver                                                                                                                                                                                                                                               |
| `GameOrchestrator.js`       | `_executeDice` 重构：注入 DamageResolver + EndingService；`saveCharacter` 时初始化 npc\_000 的 hp/san/maxHp/maxSan；`openStory` 完成后缓存 storyOpeningCache + characterInitialStats；新增 `restartStory` 方法                                                                                                     |
| `PromptTemplateRegistry.js` | NARRATION\_I/II prompt 注入当前 HP/SAN 状态；importance 可变说明；新增 ENDING\_GEN system instruction                                                                                                                                                                                                      |
| `InputAssembler.js`         | `_buildNarrationI/II Messages` 注入角色状态块；ENDING\_GEN 的 message 组装                                                                                                                                                                                                                              |
| `GameController.js`         | 新增 `/restart-story` 路由                                                                                                                                                                                                                                                                       |
| `GameUIController.js`       | 新增 HP/SAN 状态栏渲染；结局/重启按钮 UI；RESTART\_PENDING 状态管理                                                                                                                                                                                                                                             |
| `enums.js`                  | 新增 `FlowType.ENDING_GEN`、`SubState.ENDING_PENDING`、`SubState.RESTART_PENDING`                                                                                                                                                                                                                |

### 5.3 数据迁移

现有 session 数据需要迁移：

- `session.player` 中的 HP/SAN 解析到 npc\_000 条目（如果 npc\_000 不存在则创建）
- `session.keyCharacters[]` 中的角色映射到 npc\_001\~00X（如果不存在则创建）
- 现有 `session.npcs[]` 中的 NPC 保持不变，新增 hp/san/maxHp/maxSan/visibility/status/attributes 字段默认值（可设为 null 表示未追踪）
- 旧 `npc.importance='background'` 的数据需清理（background 已从 enum 移除，降级为 supporting）
- 新增 `storyOpeningCache`、`characterInitialStats` 缓存字段默认 null

迁移在 `GameSession` 构造函数中做向后兼容处理（`_migrateLegacyData` 方法，检测旧格式并自动转换，幂等执行）。

### 5.4 测试覆盖

**DamageResolver 单元测试**：

- 五种场景（A/B/C/D/E）的正确处理
- 惩罚/奖励骰计算
- 状态词映射边界值
- HP/SAN 钳制
- 清零检测（玩家 vs NPC）
- 多检定组合（场景E）的顺序处理与独立性

**EndingService 单元测试**：

- 结局触发条件
- 重启流程（状态恢复、NPC 删除、故事开幕重发）
- characterInitialStats 缓存与恢复

**集成测试**：

- 完整伤害流程（NARRATION\_I → confirmDice → DamageResolver → NARRATION\_II）
- 结局流程（伤害清零 → ENDING\_GEN → 重启 → 故事开幕重发）
- 数据迁移（旧 session 格式 → 新格式）

***

## 6. 设计决策记录

### 6.1 关键决策

1. **系统全权计算伤害**：LLM 只输出 actions 字段，系统计算数值并更新 HP/SAN，LLM 通过 prompt 知道当前数值但固定填 null
2. **统一 actions 字段**：三字段（attr\_skill\_dice/sancheck\_dice/hp\_san\_changes）合并为一个 actions 数组，每个 action 自包含"检定+后果"，消除多检定歧义
3. **统一到 npcs 数组**：玩家=npc\_000，关键角色=npc\_001\~00X，普通 NPC=npc\_00(X+1)+，HP/SAN 逻辑统一一套
4. **惩罚/奖励骰替代 NPC 技能值**：NPC 不检定，强弱通过惩罚/奖励骰体现（范围 0-2，机制为多投十位骰取较大/较小）
5. **on\_success/on\_fail 替代 trigger**：变化项的触发条件由 action 内的 on\_success/on\_fail 表达，不再需要 trigger 字段
6. **visibility 可更新**：LLM 可根据剧情切换可见性（如神秘人现身、角色潜行隐匿）；仅玩家/已邀请关键角色由系统锁定
7. **importance 可升级**：supporting→key 可升级，但 player/key 一旦设定不可降级或变更；不设 background 枚举值，路人直接在 narration 中描写
8. **key 角色输出 attributes**：为更真实，key 角色首次创建时输出 8 大属性（锁定不可改）；supporting 不输出属性（不参与检定，伤害通过 delta 公式体现）
9. **hidden 角色属性策略**：创建时 LLM 输出完整属性+hp/san，系统存储真实值；前端和 prompt 注入时隐藏数值（显示 "??"）；visibility 变 visible 后显示真实值（数值本身不变，避免 LLM 在揭示时刻重新计算属性导致不一致）
10. **结局仅限玩家**：NPC 清零只标记 departed，不触发结局
11. **重新开始保留对话记忆**：chatRecord 不删除，LLM 有第一轮故事的记忆
12. **currentState 恢复初始值**：重启时玩家/关键角色状态回到故事开幕时的状态

### 6.2 放弃的特性

- **对抗检定**：用惩罚/奖励骰替代，不支持双方都投骰子的对抗
- **不定性疯狂**：不追踪一天内累计 SAN 损失，只看单次损失 ≥5 触发暂时疯狂
- **临时疯狂状态机**：不持久化疯狂状态，状态词一次性提示
- **NPC 检定**：NPC 不检定，只玩家/关键角色检定
- **完整 CoC 7e 战斗规则**：不集成武器伤害公式、护甲、体格等
- **supporting 角色属性**：supporting 不输出 8 大属性，仅 key 角色输出（简化 token 消耗，supporting 不参与检定）

### 6.3 待实现时确认的细节

- HP/SAN 状态栏的前端 UI 布局（侧边栏 vs 顶部栏）
- 结局文本的 RPG 风格具体格式（"达成 XXX 结局"的 XXX 由 LLM 生成）
- 惩罚/奖励骰的具体 UI 展示（是否在系统消息中显示投骰过程）

### 6.4 后续阶段待实现特性

- **技能/属性成长机制**（CoC 7e 成长规则）：
  - 每次技能检定成功后标记"成长标记"
  - 模组结束/章节结束时进行成长检定：投 1d100 > 当前技能值 → +1d10
  - 设计意图：技能越低越容易成长，模拟学习曲线
  - 融入前置条件：需先结构化存储玩家技能（当前存在 session.player 字符串中）
  - 简化方案：在 npc_000 新增 `skillChecks` 标记字段，DamageResolver 在 skill_check 成功时标记，章节结束时系统自动成长检定

