# AI-TRPG-Game (MVP)

这是一个 **AI + TRPG** 的前端 MVP：
- LLM 负责：读取输入 → 思考 → 输出文本（含结构化段落/选项/重要人物提议）
- 系统负责：拼装上下文、约束输出格式、解析选项、掷骰、保存“世界状态”（WorldState）

## 快速开始

```bash
npm install
npm run dev
```

打开页面后：
- 选择 Provider（Mock / DeepSeek / OpenAI / OpenRouter）
- 若选择 DeepSeek/OpenAI/OpenRouter，需要输入 API Key（仅本地 BYOK 测试，不安全）

## 核心交互（对齐设计文档）

### 1) Meta / Normal
- **Meta**：用于世界观/人物设定等“桌外”编辑与存档
- **Normal**：用于故事推进

### 2) Phase（阶段）
- setup_world：世界观设定
- setup_pc：主角设定（支持一键存档到 UI/WorldState）
- opening：故事开幕
- playing：正常叙事主循环
- checking：检定（系统掷骰）

### 3) 四选项 A/B/C/D（过渡结构化）
在 playing 阶段，系统会提示模型在输出末尾提供四行选项：
- A/B/C：剧情行动
- D：自由活动（必须以 `自由活动：` 开头）

重要：**点击选项不会自动发送**，只会把选项写入输入框；玩家可追加文字，最终点击“发送”才提交回合。

### 4) 检定两段式管线（Checking → Normal）
当玩家在 playing 阶段点击发送：
1. 系统先请求模型输出是否需要检定（needs_check / dice / reason）
2. 若需要：系统本地掷骰并把结果作为事实加入下一次叙事输入
3. 再请求模型生成最终叙事 + A/B/C/D 选项

补充：点击“接收任务”会直接自动提交一次回合。

### 5) 主角设定：schema + 一键存档
在 setup_pc 阶段，系统要求模型严格输出以下字段（逐项一行）：
- 姓名/年龄/性别/种族/性格/外貌/家世与教育背景/其余

当解析成功后，界面会出现“主角设定草稿（可一键存档）”模块，点击按钮即可覆盖写入 `pc`。

### 6) 人物存档（重要人物：提议→确认）
模型在 normal 输出里可以额外给出一个“重要人物：”段落（放在选项之前）：

```
重要人物：
- 姓名 | 与主角关系 | 详细描述
- ...
```

系统会把它解析为“待存档人物”列表，并在聊天框下方显示 **角色存档** 按钮。
- **只有点击“角色存档”才会写入 WorldState 的 `npcs[]`**
- 若姓名重复：会追加编号（如 `张三#2`）

### 7) 物品与任务（提议→确认）
模型在 normal 输出里可以额外给出：

```
重要物品：
- 名称 | 描述
- ...

任务更新：
新的任务描述
```

系统会把它们解析为“待存档物品”和“任务更新建议”，只有在 UI 中确认后才会写入 `inventory[]` 或 `quest_current`。

## WorldState（特殊数据库）
右侧面板是“权威设定源”，用于让 AI 长期保持一致：
- world_background
- pc
- npcs
- quest_core / quest_current
- inventory
- rulesets
- diceLog / lastRoll

建议只在 **Meta** 模式下直接编辑右侧 JSON，并点击保存（保存后会自动提交一次回合）。

## 说明
- 该 MVP 仍是纯前端，API Key 无法安全保存；部署版本应迁移到后端代理。
