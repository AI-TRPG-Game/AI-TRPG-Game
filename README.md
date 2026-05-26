# AI-TRPG-Game (MVP)

## 简介
这是一个 **AI + TRPG（跑团）** 的前端 MVP，旨在结合LLM叙述的高自由度，和跑团的Rougelike+RPG的游戏元素，打造轻量但独特的文游体验。

## Motivation:
传统Rougelike/RPG游戏剧情有限且玩家自由度较低，开发周期长/成本高；TRPG（跑团，一种多人桌游）入门门槛高且受限于真人主持人（KP/DM）水平；而直接与LLM模拟角色扮演有较高prompt engineering门槛，和且受限于用户自身思考表达能力，并仍有长文本幻觉问题。那么我们可不可以利用LLM的文本生成潜力，通过API集成/上下文工程/历史记忆管理/前端渲染等技术，打造一个专属的“跑团agent”与游戏平台，解决上述问题？

## 基本设计流程
需求识别与分析->市场竞品分析学习->最小玩法闭环设计->通过模拟用户体验反复优化与迭代->收集天使用户反馈并迭代->设计创收方式与初步商业化

## 最小可行产品（MVP）的基本运作原理
单个用户-单个Agent-游戏系统之间的交互
- LLM 负责：读取输入 → 思考 → 输出文本 【调用Deepseek等LLM的API】
- 系统负责：游戏指引、拼装与结构化输入内容、审查输出格式、解析选项/核心地点/物品/人物等并进行前端渲染与存档、掷骰、管理历史记忆等 

## 快速开始

```bash
git clone https://github.com/AI-TRPG-Game/AI-TRPG-Game
cd AI-TRPG-Game
npm install
npm run dev
```

打开页面后：
- 选择 Provider（DeepSeek / OpenAI / OpenRouter）
- 若选择 DeepSeek/OpenAI/OpenRouter，需要输入 API Key（尚未进行API后端包装）

## 目前已完成的核心交互
### Phase（阶段）
- setup_world：世界观设定（支持反复调整，一键UI渲染与数据库存档）
- setup_pc：主角设定（支持反复调整，一键UI渲染与数据库存档）
- opening：故事开幕（点击后LLM自动生成）
- playing：正常叙事主循环（LLM输出由剧情叙述+核心设定提取+主角活动选项组成，后两者支持UI渲染；玩家可点击与修改选项进行prompt）
- checking：检定（玩家每次活动后，LLM判定是否掷骰与如何掷骰，系统调用本地伪随机程序掷骰并发送结果给LLM，LLM根据结果生成后续内容）

## 核心思考
什么样的叙事设计适合此产品模式、能给用户带来差异化体验
## 未来进度与方向
叙事逻辑优化，API集成优化，UI设计优化，RAG技术等优化历史记忆管理，LongChain重构后端优化Agent工作流，引入图片等多模态渲染，多agent/多人复杂叙事等

注：“MVP分析”文档中有更详细的分析思考
