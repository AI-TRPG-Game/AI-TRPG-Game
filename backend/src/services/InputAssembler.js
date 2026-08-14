import { FlowType, ChatRole, ChatEntryType } from '../domain/enums.js';
import { promptTemplateRegistry, FLOW_TEMPERATURE, FLOW_MAX_TOKENS, FLOW_THINKING, FLOW_REASONING_EFFORT, FLOW_MODEL, FLOW_STOP } from './PromptTemplateRegistry.js';
import { necessarySettingsBuilder } from './NecessarySettingsBuilder.js';
import { buildStrictTools, FLOW_FUNCTION_NAMES } from '../domain/StrictSchemaRegistry.js';
import { endingService } from './EndingService.js';

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
 *   {role: assistant, content: '', reasoning_content: ..., tool_calls: [{id, type: 'function', function: {name, arguments: JSON}}]}
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
 * reasoning_content 匹配策略：直接从 chatRecord 条目的 reasoningContent 字段读取（1:1 精确匹配）。
 * 不再使用独立队列 FIFO 匹配，避免 ACTIONS 分支等场景导致队列错位。
 */
function chatRecordToMessages(chatRecord) {
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
        // DeepSeek 官方文档：工具调用轮次 content 为空字符串 ''（非 null）
        // 官方示例 response.choices[0].message.content 在 tool_calls 轮次返回 ''
        // 使用 null 可能导致 API 400（content 字段类型不匹配）
        content: '',
        tool_calls: [{
          id: toolCallId,
          type: 'function',
          function: { name: functionName, arguments: argumentsJson },
        }],
      };

      // 注入 reasoning_content（直接从条目读取，1:1 精确匹配）
      // 官方要求：工具调用轮次的 reasoning_content 必须回传，否则 API 400
      if (entry.reasoningContent) {
        assistantMsg.reasoning_content = entry.reasoningContent;
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
    // 注意：无 tool_calls 的 assistant 消息回传 reasoning_content 会被 API 忽略（官方文档），
    //       故不注入，避免浪费 token
    const msg = { role, content: entry.content };

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
      case FlowType.ENDING_GEN:
        this._buildEndingGenMessages(messages, session);
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
    // 世界观描述作为 user message 注入（不修改 system message，保持 cache 命中）
    const history = session.setupHistory.character || [];

    if (history.length === 0) {
      // 初次轮次：将世界观作为上下文前缀，与用户输入合并为一条 user message
      const worldContext = session.worldSettings
        ? `世界观描述：\n${session.worldSettings}\n\n${userText}`
        : userText;
      messages.push({ role: 'user', content: worldContext });
    } else {
      // 调整轮次：世界观作为独立 user message，后接历史对话
      // 注意：历史最后一条已是本轮用户输入（由 handleMessage 提前写入），无需再 push
      if (session.worldSettings) {
        messages.push({ role: 'user', content: `世界观描述：\n${session.worldSettings}` });
      }
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const role = entry.role === ChatRole.PLAYER ? 'user' : 'assistant';
        messages.push({ role, content: entry.content });
      }
    }
  }

  // ── 关键角色设定 ──
  _buildKeyCharacterGenMessages(messages, session, userText) {
    // 世界观+玩家设定+已有角色作为 user message 注入（不修改 system message，保持 cache 命中）
    const contextParts = [];
    if (session.worldSettings) contextParts.push(`世界观描述：\n${session.worldSettings}`);
    if (session.player) contextParts.push(`玩家设定：\n${session.player}`);

    // 已邀请的关键角色档案注入，要求 LLM 不重复
    const existingKeyChars = [];
    for (let i = 0; i < session.keyCharacterIndex; i++) {
      if (session.keyCharacters[i]) {
        existingKeyChars.push(`关键角色${i + 1}：\n${session.keyCharacters[i]}`);
      }
    }
    if (existingKeyChars.length > 0) {
      contextParts.push(`已创建的关键角色：\n${existingKeyChars.join('\n---\n')}\n注意：新角色不能与以上已有角色完全重复。`);
    }

    const history = session.getCurrentKeyCharSetupHistory();

    if (history.length === 0) {
      const context = contextParts.length > 0
        ? contextParts.join('\n\n') + '\n\n' + userText
        : userText;
      messages.push({ role: 'user', content: context });
    } else {
      if (contextParts.length > 0) {
        messages.push({ role: 'user', content: contextParts.join('\n\n') });
      }
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

    // 注入角色 HP/SAN/属性 状态（追加到第一个 user message，不修改 system message）
    // 设计：system message 必须完全静态以命中 DeepSeek prefix cache
    const statusBlock = this._buildCharacterStatusBlock(session);
    if (statusBlock) {
      messages[1].content += '\n\n' + statusBlock;
    }

    // 历史对话（含 userText，handleMessage 已将其写入 chatRecord）
    // 注意：applyNarrative 已把 narration + options 合并为一条 assistant 消息，
    //       无需再单独注入 optionBuffer
    // 关键修复：思考模式 + 工具调用场景下，kp assistant 消息必须回传 reasoning_content
    const historyMsgs = chatRecordToMessages(session.chatRecord);
    for (const m of historyMsgs) {
      messages.push(m);
    }
  }

  // ── 叙述II ──
  _buildNarrationIIMessages(messages, session) {
    // 完整设定持续输入
    messages.push({
      role: 'user',
      content: this._buildFullSettingsContext(session),
    });

    // 注入角色 HP/SAN/属性 状态（追加到第一个 user message，不修改 system message）
    const statusBlock = this._buildCharacterStatusBlock(session);
    if (statusBlock) {
      messages[1].content += '\n\n' + statusBlock;
    }

    // 历史对话（含 dice 消息和系统投掷结果）
    // system instruction 已说明"根据系统判定结果推进剧情"，不再追加额外提示
    const historyMsgs = chatRecordToMessages(session.chatRecord);
    for (const m of historyMsgs) {
      messages.push(m);
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

  // ── 结局生成 ──
  _buildEndingGenMessages(messages, session) {
    // 注入世界观和玩家设定
    const context = this._buildFullSettingsContext(session);
    messages.push({ role: 'user', content: context });

    // 注入故事开幕缓存（让 LLM 知道故事的起点）
    if (session.storyOpeningCache?.parsed?.narration) {
      messages.push({
        role: 'user',
        content: `故事开幕：\n${session.storyOpeningCache.parsed.narration}`,
      });
    }

    // 历史对话
    const historyMessages = chatRecordToMessages(session.chatRecord);
    for (const m of historyMessages) {
      messages.push(m);
    }

    // 结局指示
    const player = session.npcs.find(n => n.id === 'npc_000');
    const endingType = session.endingState?.endingType || (player ? endingService.getEndingType(player) : 'withdrawal');
    const forcedReason = session.endingState?.reason;
    messages.push({
      role: 'user',
      content: forcedReason
        ? `结局触发原因：${forcedReason}。请根据完整状态生成合适结局，不要仅按HP/SAN判断。`
        : `玩家${endingType === 'death' ? 'HP 归零' : 'SAN 归零'}，请生成 ${endingType} 类型的结局文本。`,
    });
  }

  /**
   * 构建角色 HP/SAN/属性 状态块，注入到 prompt 中。
   * 格式：
   * 【当前角色状态】
   * 玩家（npc_000）：HP 8/11，SAN 65/70
   * 关键角色（npc_001 · 阿史德）：HP 10/10，SAN 55/60，属性：力量50/敏捷60/...
   * 普通NPC（npc_002 · 酒肆老板）：HP 6/8，SAN 50/50
   * 隐藏NPC（npc_003 · 神秘人）：HP ??/??，SAN ??/??，属性 ??（已隐藏）
   * 已退场：npc_004 · 亡灵（已退场）
   */
  _buildCharacterStatusBlock(session) {
    if (!session.npcs || session.npcs.length === 0) return '';

    const lines = ['【当前角色状态】'];
    for (const npc of session.npcs) {
      const name = npc.name || npc.id;
      let label;
      if (npc.id === 'npc_000') {
        label = `玩家（${npc.id}）`;
      } else if (npc.importance === 'key') {
        label = `关键角色（${npc.id} · ${name}）`;
      } else {
        label = `${name}（${npc.id}）`;
      }

      // departed 的 NPC
      if (npc.status === 'departed') {
        lines.push(`${label}：已退场`);
        continue;
      }

      // hidden 的 NPC：HP/SAN/属性全部显示 ??
      if (npc.visibility === 'hidden') {
        lines.push(`${label}：HP ??/??，SAN ??/??，属性 ??（已隐藏）`);
        continue;
      }

      // 正常显示：HP/SAN + 属性（仅 key 角色有 attributes）
      const hpStr = npc.hp != null ? `${npc.hp}/${npc.maxHp ?? '?'}` : '?';
      const sanStr = npc.san != null ? `${npc.san}/${npc.maxSan ?? '?'}` : '?';
      let line = `${label}：HP ${hpStr}，SAN ${sanStr}`;
      if (npc.attributes) {
        const attrStr = Object.entries(npc.attributes)
          .map(([k, v]) => `${k}${v}`)
          .join('/');
        line += `，属性：${attrStr}`;
      }
      lines.push(line);
    }

    return lines.join('\n');
  }
}

export const inputAssembler = new InputAssembler();
