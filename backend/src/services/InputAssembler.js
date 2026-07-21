import { FlowType, ChatRole, ChatEntryType } from '../domain/enums.js';
import { promptTemplateRegistry, FLOW_TEMPERATURE, FLOW_MAX_TOKENS, FLOW_THINKING, FLOW_REASONING_EFFORT, FLOW_MODEL, FLOW_STOP } from './PromptTemplateRegistry.js';
import { necessarySettingsBuilder } from './NecessarySettingsBuilder.js';
import { buildStrictTools, FLOW_FUNCTION_NAMES } from '../domain/StrictSchemaRegistry.js';

// 注意：思考模式下不支持 tool_choice（DeepSeek API 会返回 400）
// buildStrictTools 返回的 toolChoice 字段已废弃，不再透传给 Provider

/**
 * 将 chatRecord 条目映射为 API messages（assistant / user 交替）。
 * - kp → assistant（若有 parsed + flowType，构造 tool_calls + tool 消息对，模拟真实 LLM 输出格式）
 * - player → user
 * - system → user（投掷结果等系统消息，对 LLM 而言是"需要回应的输入"）
 * - summary → assistant
 *
 * 方案 B+ 改造：KP 消息若携带 parsed + flowType，则构造为：
 *   {role: assistant, content: null, reasoning_content: ..., tool_calls: [{id, type: 'function', function: {name, arguments: JSON}}]}
 *   {role: tool, tool_call_id: id, content: ''}
 * 这样 LLM 看到的历史 assistant 消息格式 = strict 模式要求它输出的格式，
 * 强化格式一致性引导，减少"LLM 不调 function 直接输出文本"的概率。
 *
 * 跨 flowType 兼容性：方案 B+ 已把函数名统一到 4 个
 *   （output_world / output_character / output_narration / output_summary），
 *   STORY_OPENING / NARRATION_I / NARRATION_II 共用 output_narration，
 *   历史消息的函数名始终在当前请求的 tools 列表中找到，避免 API 兼容性问题。
 *
 * 无 parsed 的 KP 条目（旧数据 / pendingBracket 片段）退化为 content=文本。
 *
 * 重要：DeepSeek 官方要求"思考模式 + 工具调用场景下，后续轮次必须回传 reasoning_content"
 * reasoning_content 注入到 assistant 消息（tool_calls 同一条），不注入 tool 消息。
 *
 * reasoning_content 匹配策略：按 kp 出现顺序与 reasoningContents 队列顺序一一对应（FIFO）
 */
function chatRecordToMessages(chatRecord, reasoningContents = []) {
  const reasoningQueue = [...reasoningContents]; // 按 push 顺序 FIFO
  let reasoningIdx = 0;
  let toolCallCounter = 0;

  const messages = [];
  for (const entry of chatRecord) {
    if (entry.type === ChatEntryType.RAW) continue; // raw 兜底不参与正常传播
    let role;
    if (entry.role === ChatRole.PLAYER) {
      role = 'user';
    } else if (entry.role === ChatRole.SYSTEM) {
      role = 'user'; // 投掷结果视为 user 输入
    } else {
      role = 'assistant'; // kp / summary
    }

    // 方案 B+：KP 消息携带 parsed + flowType 时，构造 tool_calls + tool 消息对
    if (
      entry.role === ChatRole.KP &&
      entry.parsed &&
      typeof entry.parsed === 'object' &&
      entry.flowType &&
      FLOW_FUNCTION_NAMES[entry.flowType]
    ) {
      const toolCallId = `call_${Date.now()}_${++toolCallCounter}`;
      const functionName = FLOW_FUNCTION_NAMES[entry.flowType];
      const argumentsJson = JSON.stringify(entry.parsed);

      const assistantMsg = {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: toolCallId,
          type: 'function',
          function: { name: functionName, arguments: argumentsJson },
        }],
      };

      // 注入 reasoning_content（FIFO 匹配，与改造前一致）
      if (reasoningIdx < reasoningQueue.length) {
        assistantMsg.reasoning_content = reasoningQueue[reasoningIdx].reasoningContent;
        reasoningIdx++;
      }

      messages.push(assistantMsg);
      // tool_calls 后必须跟 tool 消息（OpenAI/DeepSeek 规范）
      // content 放空字符串最省 token，LLM 会理解为"工具执行完成"
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: '',
      });
      continue;
    }

    // 兜底：无 parsed 的 KP / SUMMARY / 旧数据 → content=文本
    const msg = { role, content: entry.content };

    // kp 角色的 assistant 消息：按 FIFO 顺序匹配 reasoning_content
    if (entry.role === ChatRole.KP && reasoningIdx < reasoningQueue.length) {
      msg.reasoning_content = reasoningQueue[reasoningIdx].reasoningContent;
      reasoningIdx++;
    }

    messages.push(msg);
  }
  return messages;
}

export class InputAssembler {
  /**
   * 组装 API 请求所需参数。
   * @returns {{ messages, flowType, temperature, maxTokens }}
   */
  assemble(flowType, session, options = {}) {
    const { userText = '' } = options;
    const template = promptTemplateRegistry.getTemplate(flowType);

    const messages = [{ role: 'system', content: template.systemInstruction }];

    // 思考模式 + 工具调用场景下，回传 reasoning_content（官方要求）
    const reasoningContents = session.recentReasoningContents || [];

    switch (flowType) {
      case FlowType.WORLD_GEN:
        this._buildWorldGenMessages(messages, session, userText);
        break;
      case FlowType.CHARACTER_GEN:
        this._buildCharacterGenMessages(messages, session, userText);
        break;
      case FlowType.KEY_CHARACTER_GEN:
        this._buildKeyCharacterGenMessages(messages, session, userText);
        break;
      case FlowType.STORY_OPENING:
        this._buildStoryOpeningMessages(messages, session);
        break;
      case FlowType.NARRATION_I:
        this._buildNarrationIMessages(messages, session, userText, reasoningContents);
        break;
      case FlowType.NARRATION_II:
        this._buildNarrationIIMessages(messages, session, reasoningContents);
        break;
      case FlowType.HISTORY_SUMMARY:
        this._buildHistorySummaryMessages(messages, session, reasoningContents);
        break;
      default:
        throw new Error(`Unsupported flow type: ${flowType}`);
    }

    // strict 模式：注入 tools + toolChoice
    // 官方文档：思考模式下不支持 tool_choice（API 400）
    // 因此 toolChoice 在思考模式下由 Provider 过滤掉
    const { tools, toolChoice } = buildStrictTools(flowType);

    return {
      messages,
      flowType,
      temperature: FLOW_TEMPERATURE[flowType] ?? 0.7,
      maxTokens: FLOW_MAX_TOKENS[flowType] ?? 4096,
      thinking: FLOW_THINKING[flowType] ?? false,
      reasoningEffort: FLOW_REASONING_EFFORT[flowType] || null,  // 思考强度
      modelOverride: FLOW_MODEL[flowType] || null,                // 分层模型路由（null 表示用默认）
      stop: FLOW_STOP[flowType] ?? null,
      tools,
      toolChoice,
    };
  }

  // ── 世界设定 ──
  _buildWorldGenMessages(messages, session, userText) {
    const history = session.setupHistory.world || [];
    for (const entry of history) {
      const role = entry.role === ChatRole.PLAYER ? 'user' : 'assistant';
      messages.push({ role, content: entry.content });
    }
    if (history.length === 0) {
      messages.push({ role: 'user', content: userText });
    }
  }

  // ── 人物设定 ──
  _buildCharacterGenMessages(messages, session, userText) {
    // 世界观描述追加到 system 消息末尾（BASE_INTRO 保持在最前面）
    if (session.worldSettings) {
      messages[0].content += `\n\n世界观描述如下：\n${session.worldSettings}`;
    }

    const history = session.setupHistory.character || [];

    if (history.length === 0) {
      // 初次轮次：system + user prompt（纯用户输入，不加额外前缀）
      messages.push({ role: 'user', content: userText });
    } else {
      // 调整轮次：system + 首次用户 prompt + 历史对话
      // 注意：历史最后一条已是本轮用户输入（由 handleMessage 提前写入），无需再 push
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const role = entry.role === ChatRole.PLAYER ? 'user' : 'assistant';
        messages.push({ role, content: entry.content });
      }
    }
  }

  // ── 关键角色设定 ──
  _buildKeyCharacterGenMessages(messages, session, userText) {
    // 世界观和玩家设定追加到 system 消息末尾（BASE_INTRO 保持在最前面）
    messages[0].content += `\n\n世界观描述如下：\n${session.worldSettings}\n\n玩家设定如下：\n${session.player}`;

    // 将已邀请的关键角色档案注入 prompt，并要求 LLM 不重复
    const existingKeyChars = [];
    for (let i = 0; i < session.keyCharacterIndex; i++) {
      if (session.keyCharacters[i]) {
        existingKeyChars.push(`关键角色${i + 1}：\n${session.keyCharacters[i]}`);
      }
    }
    if (existingKeyChars.length > 0) {
      messages[0].content += `\n\n已创建的关键角色如下：\n${existingKeyChars.join('\n---\n')}\n\n注意：新角色不能与以上已有角色完全重复。`;
    }

    const history = session.getCurrentKeyCharSetupHistory();

    if (history.length === 0) {
      messages.push({ role: 'user', content: userText });
    } else {
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const role = entry.role === ChatRole.PLAYER ? 'user' : 'assistant';
        messages.push({ role, content: entry.content });
      }
    }
  }

  /** 构建完整设定上下文（世界观+玩家+关键角色+地点+NPC+物品），持续发给LLM */
  _buildFullSettingsContext(session) {
    return necessarySettingsBuilder.build(session);
  }

  // ── 故事开幕 ──
  _buildStoryOpeningMessages(messages, session) {
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });
  }

  // ── 叙述I ──
  _buildNarrationIMessages(messages, session, userText, reasoningContents = []) {
    // 完整设定持续输入
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });

    // 历史对话（含 userText，handleMessage 已将其写入 chatRecord）
    // 注意：applyNarrative 已把 narration + options 合并为一条 assistant 消息，
    //       无需再单独注入 optionBuffer
    // 关键修复：思考模式 + 工具调用场景下，kp assistant 消息必须回传 reasoning_content
    const historyMsgs = chatRecordToMessages(session.chatRecord, reasoningContents);
    for (const m of historyMsgs) {
      messages.push(m);
    }
  }

  // ── 叙述II ──
  _buildNarrationIIMessages(messages, session, reasoningContents = []) {
    // 完整设定持续输入
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });

    // 历史对话（含 dice 消息和系统投掷结果）
    const historyMsgs = chatRecordToMessages(session.chatRecord, reasoningContents);
    for (const m of historyMsgs) {
      messages.push(m);
    }

    // 追加提示 —— 合并到最后一个 user 消息末尾，避免连续两个 user
    const appendText = '\n请根据投掷结果推进剧情，回应要模仿游戏口吻。';
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content += appendText;
    } else {
      messages.push({ role: 'user', content: appendText.trim() });
    }
  }

  // ── 历史总结 ──
  _buildHistorySummaryMessages(messages, session, reasoningContents = []) {
    // 必要设定
    const settings = necessarySettingsBuilder.build(session);
    messages.push({ role: 'user', content: settings });

    // 历史对话（除最新两条外）
    const summaryRecords = session.chatRecord.slice(0, -2);
    if (summaryRecords.length > 0) {
      const historyMsgs = chatRecordToMessages(summaryRecords, reasoningContents);
      for (const m of historyMsgs) {
        messages.push(m);
      }
    }
  }
}

export const inputAssembler = new InputAssembler();
