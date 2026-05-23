```
# AI-TRPG-Game (MVP)

这是一个 **AI + TRPG** 的前端 MVP：
- LLM 负责：读取输入 → 思考 → 输出文本（含结构化段落/选项）
- 系统负责：拼装上下文、约束输出格式、解析选项、掷骰、保存“世界状态”（WorldState）

## 快速开始

```bash
npm install
npm run dev
```

打开页面后：
- 选择 Provider（Mock / DeepSeek / OpenAI）
- 若选择 DeepSeek/OpenAI，需要输入 API Key（仅本地 BYOK 测试，不安全）

## 核心交互（对齐设计文档）

### 1) Meta / Normal
- **Meta**：用于世界观/人物设定等“桌外”编辑与存档
- **Normal**：用于故事推进

### 2) Phase（阶段）
- setup_world：世界观设定
- setup_pc：主角设定
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

## WorldState（特殊数据库）
右侧面板是“权威设定源”，用于让 AI 长期保持一致：
- world_background
- pc
- npcs
- quest_core / quest_current
- inventory
- rulesets
- diceLog / lastRoll

建议只在 **Meta** 模式下直接编辑右侧 JSON，并点击保存。

## 说明
- 该 MVP 仍是纯前端，API Key 无法安全保存；部署版本应迁移到后端代理。
```
