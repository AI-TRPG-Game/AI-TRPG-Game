import { FlowType, ChatRole, ChatEntryType } from '../domain/enums.js';
import { promptTemplateRegistry, FLOW_TEMPERATURE, FLOW_MAX_TOKENS, FLOW_THINKING, FLOW_STOP } from './PromptTemplateRegistry.js';
import { necessarySettingsBuilder } from './NecessarySettingsBuilder.js';

/**
 * 将 chatRecord 条目映射为 API messages（assistant / user 交替）。
 * - kp → assistant
 * - player → user
 * - system → user（投掷结果等系统消息，对 LLM 而言是"需要回应的输入"）
 * - summary → assistant
 */
function chatRecordToMessages(chatRecord) {
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
    messages.push({ role, content: entry.content });
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
        this._buildNarrationIMessages(messages, session, userText);
        break;
      case FlowType.NARRATION_II:
        this._buildNarrationIIMessages(messages, session);
        break;
      case FlowType.HISTORY_SUMMARY:
        this._buildHistorySummaryMessages(messages, session);
        break;
      default:
        throw new Error(`Unsupported flow type: ${flowType}`);
    }

    return {
      messages,
      flowType,
      temperature: FLOW_TEMPERATURE[flowType] ?? 0.7,
      maxTokens: FLOW_MAX_TOKENS[flowType] ?? 4096,
      thinking: FLOW_THINKING[flowType] ?? false,
      stop: FLOW_STOP[flowType] ?? null,
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
  _buildNarrationIMessages(messages, session, userText) {
    // 完整设定持续输入
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });

    // 历史对话（含 userText，handleMessage 已将其写入 chatRecord）
    const historyMsgs = chatRecordToMessages(session.chatRecord);
    for (const m of historyMsgs) {
      messages.push(m);
    }

    // option_buffer 作为 assistant 消息（上轮 KP 给出的选项）
    if (session.optionBuffer) {
      messages.push({ role: 'assistant', content: session.optionBuffer });
    }
  }

  // ── 叙述II ──
  _buildNarrationIIMessages(messages, session) {
    // 完整设定持续输入
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });

    // 历史对话（含 dice 消息和系统投掷结果）
    const historyMsgs = chatRecordToMessages(session.chatRecord);
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
  _buildHistorySummaryMessages(messages, session) {
    // 必要设定
    const settings = necessarySettingsBuilder.build(session);
    messages.push({ role: 'user', content: settings });

    // 历史对话（除最新两条外）
    const summaryRecords = session.chatRecord.slice(0, -2);
    if (summaryRecords.length > 0) {
      const historyMsgs = chatRecordToMessages(summaryRecords);
      for (const m of historyMsgs) {
        messages.push(m);
      }
    }
  }
}

export const inputAssembler = new InputAssembler();
