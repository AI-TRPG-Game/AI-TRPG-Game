# AI+TRPG — AI 驱动的跑团游戏

一个基于大语言模型（LLM）的 **单人 AI 跑团系统**。由 AI 扮演 KP（守秘人），遵循 **CoC 7th（克苏鲁的呼唤第七版）** 规则，为玩家提供高自由度、强沉浸感的互动叙事体验。

## 项目演示
<img width="2856" height="1535" alt="屏幕截图 2026-06-24 200308" src="https://github.com/user-attachments/assets/52379237-cc16-4c46-988f-227b2c07438d" />
<img width="2843" height="1514" alt="屏幕截图 2026-06-25 152826" src="https://github.com/user-attachments/assets/a1698ea8-0a4d-454f-b95c-700ad9317dbd" />


## 项目动机

线下跑团组织成本高、传统 RPG 自由度有限、直接和通用 LLM 聊天缺乏规则约束和记忆管理。AI+TRPG 试图弥合「叙事自由度」和「游戏规则感」之间的裂缝，做一个既有灵魂（AI 驱动叙事）、又有骨架（规则引擎、记忆系统、状态管理）的产品。

## 核心特性

- **三阶段游戏流程**：世界设定 → 人物设定 → 故事跑团，循序渐进
- **CoC 7th 规则引擎**：后端真随机骰子判定，AI 负责叙事但不掌控结果
- **结构化 JSON 输出**：LLM 输出被解析为结构化数据（叙述、选项、地点、NPC、物品、骰子请求等），而非自由文本
- **自动记忆管理**：对话历史超过阈值时自动触发 LLM 摘要压缩，避免上下文溢出
- **流式输出**：支持 SSE 风格的实时流式推送，带打字机效果
- **实体追踪**：独立追踪地点、NPC、物品栏，不受 LLM 遗忘影响
- **选项解析**：支持「选项 A」「选项 A 和 B」等快捷输入，自动映射为完整行动描述
- **会话持久化**：基于 SQLite 的全量存档，随时退出、随时继续

## 最近更新

当前版本已围绕《白桦站的末班车》试炼和 LLM 稳定性完成以下改进：

- **时间与地点推进**：试炼时钟从 00:10 推进至 06:00；有意义的行动至少消耗 10 分钟。地点会在玩家首次发现后显示在侧栏，计划事件会根据时间和当前位置触发。
- **SAN 与心理后果**：SAN 检定区分不安、创伤和灾变等级，并可触发早期创伤、惩罚骰或失控风险。SAN 日志会显示玩家的实际身份，而不是内部 NPC 编号。
- **证据、线索与真相**：线索分为“已发现”和“已保全”；调查行动和当前位置可以发现剧本预设证据，保全证据后才会推进真相事实。结局需要满足证据条件并由玩家明确选择，不能仅由 LLM 的一句叙述触发。
- **角色与开幕信息**：苏棠、林晚等重要角色会在开幕阶段被介绍并显示在 NPC 列表中；主角单独列在“玩家状态”区域，不再归入 NPC。
- **选项与阅读体验**：输入「选项 A/B/C」会解析为对应的完整行动并原样传给 LLM；生成叙述、骰子和重试后页面会保持原滚动位置，方便继续阅读。
- **DeepSeek thinking 与工具调用**：`deepseek-v4-flash` 未显式配置时默认关闭 thinking 以降低延迟；可用 `LLM_THINKING_TYPE=enabled` 或 `disabled` 覆盖。请求会显式声明 thinking 状态：非 thinking 请求可以使用 `tool_choice`，thinking 请求会自动移除该字段，避免 DeepSeek V4 返回 400。
- **诊断与回归测试**：后端调试记录模型、延迟、thinking 状态和工具调用结果，并新增选项解析、白桦站引导、SAN 身份显示和 LLM 请求配置测试。
- **地点感知事件导演**：白桦站事件采用 `dormant → eligible → queued → resolved/expired` 生命周期。事件越过时间点后先进入可触发状态，再根据玩家当前位置、明确移动意图和地点邻接关系选择现场介入、附近拦截、延后或幕后结算；幕后事件只留下稍后可发现的余波，不再直接向玩家播报全知信息。
- **关键事件分支**：停电、销毁调度记录、林晚供词和夺证危机已分别支持同场、邻近、远离或错过窗口的不同结果。夺证危机会移动参与者到玩家所在场景并建立非击杀式冲突目标。
- **回合一致性**：需要检定的回合会在骰子和后续叙事完成后再统一结算证据、事件、时钟与截止时间；取消检定会恢复回合前的对话、场景和剧本状态。明确结局选择会保存为结构化状态，疑问、假设和否定语句不会触发结局。

## 技术架构

```
┌─────────────────────────┐     ┌──────────────────────────────────┐
│   前端 (Vite SPA)        │     │           后端 (Node.js)           │
│                         │     │                                  │
│  index.html  (开发入口)  │◄───►│  api/GameController.js  (REST)   │
│  src/main.js (应用逻辑)  │ SSE │  api/StreamEmitter.js  (推送)     │
│                         │     │                                  │
│  dist/ (Vite 构建产物)   │     │  orchestrator/GameOrchestrator   │
│                         │     │  orchestrator/PhaseManager       │
│                         │     │                                  │
│                         │     │  services/ (输入组装 → 输出解析     │
│                         │     │    → 实体更新 → 骰子 → 摘要…)      │
│                         │     │                                  │
│                         │     │  llm/OpenAICompatibleProvider    │
│                         │     │  persistence/SessionRepository   │
└─────────────────────────┘     └──────────────────────────────────┘
                                          │
                                          ▼
                                 ┌────────────────┐
                                 │   LLM API      │
                                 │ (DeepSeek 等)   │
                                 └────────────────┘
```

### 后端目录结构

```
backend/
├── src/
│   ├── index.js                    # 入口：初始化 DB、LLM Provider、启动 Express
│   ├── api/
│   │   ├── GameController.js       # RESTful API 路由与 SSE 端点
│   │   └── StreamEmitter.js        # 内存流事件管理器
│   ├── config/
│   │   └── GameConfig.js           # 摘要阈值、阶段引导文案等配置
│   ├── domain/
│   │   ├── GameSession.js          # 核心领域模型（会话状态）
│   │   ├── ParsedLLMOutput.js      # LLM 解析结果的数据结构
│   │   └── enums.js                # Phase / SubState / FlowType 等枚举
│   ├── llm/
│   │   ├── LLMProvider.js          # LLM 调用抽象基类
│   │   └── OpenAICompatibleProvider.js  # OpenAI 兼容 API 实现
│   ├── orchestrator/
│   │   ├── GameOrchestrator.js     # 核心编排器：流程调度、LLM 调用、重试、骰子分支
│   │   └── PhaseManager.js         # 阶段状态机：权限校验与流转
│   ├── persistence/
│   │   ├── database.js             # SQLite 初始化与 migration
│   │   └── SessionRepository.js    # 会话 CRUD
│   └── services/
│       ├── InputAssembler.js       # 根据 FlowType 组装 LLM 请求 messages
│       ├── PromptTemplateRegistry.js # 各阶段的 System Prompt 模板
│       ├── JsonOutputParser.js     # LLM JSON 输出解析
│       ├── OutputProcessor.js      # 解析结果分发（叙述/骰子/设定/摘要）
│       ├── EntityUpdater.js        # 更新地点、NPC、物品、HP/SAN 等状态
│       ├── TextRefiner.js          # 将 JSON 重构为可读文本 + HTML
│       ├── DiceService.js          # 真随机骰子服务
│       ├── OptionResolver.js       # 选项快捷输入解析
│       ├── SaveExtractor.js        # 从 LLM 输出中提取世界/人物设定
│       ├── ConversationHistoryBuilder.js # 对话历史格式化
│       ├── HistorySummarizer.js    # 历史摘要自动触发
│       ├── NecessarySettingsBuilder.js   # 必要设定文本组装
│       └── JsonSchemaRegistry.js   # JSON Schema 定义（备用）
├── test/
│   └── smoke.js                    # 冒烟测试
├── .env                            # 环境变量（API Key、模型配置）
└── package.json
```

### 游戏阶段流转

```
WORLD_SETTING ──► CHARACTER_SETTING ──► STORY_PLAY
                                         │
                                         ├── STORY_OPENING (开幕叙述)
                                         ├── NARRATION_I   (正常叙述)
                                         │      │
                                         │      ├── 有骰子 → DICE_PENDING → NARRATION_II
                                         │      └── 无骰子 → 更新状态与选项
                                         └── HISTORY_SUMMARY (自动触发)
```

### LLM 输出协议

所有阶段的 LLM 输出均为 **JSON**（通过 strict function tools 约束），各阶段有不同的必填字段：

| 阶段 | 输出 JSON 必填字段 | 关键内容 |
|------|-------------------|---------|
| 世界设定 | `world_description` | 世界观描述 |
| 人物设定 | `character_card` | CoC 7th 人物卡（属性、技能、物品等） |
| 故事开幕 | `narration` + `options` | 开幕叙述、地点/NPC/物品、选项 |
| 正常叙述 | `narration` 或 `dice` | 叙述文本或骰子请求 |

LLM 未按要求输出合法 JSON 时，系统会自动重试一次，两次均失败则使用原始输出兜底。

## 快速开始

### 环境要求

- **Node.js** >= 18
- 一个 OpenAI 兼容的 LLM API（[DeepSeek](https://platform.deepseek.com/) 推荐，也可用 OpenAI / 其他兼容服务）

### 1. 克隆项目并安装依赖

```bash
git clone https://github.com/AI-TRPG-Game/AI-TRPG-Game
cd AI-TRPG-Game

# 一键安装根目录 + 后端全部依赖（postinstall 自动处理）
npm install
```

### 2. 配置环境变量

复制模板文件并填入你的 API Key：

```bash
cd backend
cp .env.example .env
# 然后编辑 .env，将 LLM_API_KEY 替换为你的真实 Key
```

`.env` 文件内容示例：

```env
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
# 若改用 deepseek-v4-flash，未显式配置时默认关闭 thinking
# LLM_THINKING_TYPE=enabled
```

> 推荐使用 **DeepSeek v3/v4** 系列模型，性价比高且支持 JSON 输出模式。使用其他模型（如 GPT-4o）时将 `LLM_BASE_URL` 和 `LLM_MODEL` 改为对应值即可。
>
> `.env` 已被 `.gitignore` 排除，不会上传到 GitHub。你的 API Key 不会泄露。

### 3. 启动项目（一条命令）

```bash
npm run dev:all
```

> 自动同时启动前端（`http://127.0.0.1:5173`）和后端（`http://localhost:3001`），启动前自动清理端口占用。
>
> 按 `Ctrl+C` 即可同时停止前后端。
>
> 如需单独启动某一端：
> - 前端：`npm run dev`
> - 后端：`cd backend && npm run dev`

### 4. 打开浏览器访问

浏览器访问 Vite 输出的地址（通常为 `http://localhost:5173`），即可进入游戏。

### 5. 开始游戏

1. 点击「开启故事设定」→ 输入你喜欢的世界风格（如「蒸汽朋克与古老魔法并存的大陆」）→ 调整满意后「存档当前世界观」
2. 点击「开启人物设定」→ 描述你的主角（如「一个退伍老兵，沉默寡言但心地善良」）→ 调整满意后「保存主角设定」
3. 点击「故事开幕」→ 沉浸在 AI 为你生成的开幕叙事中
4. 输入行动或点击选项按钮推进剧情

## API 端点摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/sessions` | 创建新会话 |
| GET | `/sessions/:id` | 获取会话状态 |
| POST | `/sessions/:id/enter-world` | 进入世界设定阶段 |
| POST | `/sessions/:id/enter-character` | 进入人物设定阶段 |
| POST | `/sessions/:id/save-world` | 存档世界观 |
| POST | `/sessions/:id/save-character` | 存档主角设定 |
| PATCH | `/sessions/:id/protagonist` | 手动修改主角设定 |
| POST | `/sessions/:id/open-story` | 故事开幕（返回 streamId） |
| POST | `/sessions/:id/message` | 发送玩家输入（返回 streamId） |
| GET | `/streams/:id` | SSE 流式获取实时输出 |

## 项目文档

- `MVP分析/` — 产品需求分析、玩法闭环设计、竞品调研
- `plan/plans/` — 后端框架设计文档（含架构图与流程说明）
- `MVP分析/世界设定阶段.md` — 世界设定阶段的详细交互流程
- `MVP分析/人物设定阶段.md` — 人物设定阶段的详细交互流程
- `MVP分析/故事开幕与正常叙述.md` — 跑团核心循环的详细流程

## 白桦站新手试炼

**《白桦站的末班车》** 是一场完整、由时间驱动的 CoC 单人新手试炼。可在会话菜单中点击 **试炼** 按钮开始，或通过 `POST /sessions/tutorials/birch-station` 创建会话。

调查从 00:10 开始，并在列车于 06:00 恢复通行时结束。每次有实际意义的行动至少推进十分钟；随着时间流逝，计划事件会改变可获得的线索、风险与可选行动。

- **SAN 压力：** 恐怖检定分为不安、重大揭示与灾变三个等级。低 SAN 会施加惩罚骰，并改变调查员的精神状态。
- **怀疑度：** 0–10 的怀疑度会让嫌疑人开始监视、阻挠，最终公开对抗调查员；较高怀疑度还会额外消耗时间。
- **证据与真相：** 只有剧本预设的证据才能证明谋杀、掩盖行动、第七名幸存者与凶手关联等事实；LLM 的叙事性断言不能提前结束案件。
- **状态驱动结局：** 死亡、疯狂、06:00 截止时间，以及玩家明确作出的最终选择，都会由已验证的游戏状态决定；LLM 只负责书写结局，而不决定结局是否可触发。

若要在截止前达成结局，请先保全足以确立至少三项真相事实的证据，再明确决定如何处置真相：公开、保全、压下，或撤离。

## License

MIT
