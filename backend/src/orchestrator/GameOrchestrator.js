import { GameConfig } from '../config/GameConfig.js';
import {
  Phase,
  SubState,
  FlowType,
  ChatRole,
  ChatEntryType,
  GameAction,
} from '../domain/enums.js';
import { phaseManager } from './PhaseManager.js';
import { inputAssembler } from '../services/InputAssembler.js';
import { jsonOutputParser } from '../services/JsonOutputParser.js';
import { outputProcessor } from '../services/OutputProcessor.js';
import { entityUpdater } from '../services/EntityUpdater.js';
import { idAllocator } from '../services/IdAllocator.js';
import { saveExtractor } from '../services/SaveExtractor.js';
import { diceService } from '../services/DiceService.js';
import { HistorySummarizer } from '../services/HistorySummarizer.js';
import { FLOW_REQUIRED_FIELD } from '../services/PromptTemplateRegistry.js';
import { textRefiner } from '../services/TextRefiner.js';

function escapeHtml(s) {
  // 仅转义会破坏 HTML 结构的字符（& < >），不转义 "（innerHTML 会解码回来）
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class GameOrchestrator {
  /**
   * v2.0 strict 模式改造：移除 streamEmitter 依赖，所有 LLM 调用走非流式 generate。
   * debug 信息改为返回值中的 debugLogs 数组，前端一次性渲染。
   */
  constructor({ repository, llmProvider }) {
    this.repository = repository;
    this.llmProvider = llmProvider;
    this.historySummarizer = new HistorySummarizer({
      llmProvider,
      repository,
    });
  }

  _pushDisplay(session, role, content) {
    if (!session.displayLog) session.displayLog = [];
    session.displayLog.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 推送一条 debug 日志到累积数组 + 实时回调（SSE 流式推送用）。
   * 设计动机：v2.1 SSE 改造后，god's eye 面板需要在 LLM 调用过程中实时显示中间状态
   * （retry_clear / parse_fail / debug_raw 等），不能等整个回合结束才一次性返回。
   * onDebug 回调由调用方（GameController SSE 路由）注入，可能为 null（兼容旧的非流式调用）。
   */
  _pushDebug(debugLogs, onDebug, log) {
    debugLogs.push(log);
    if (onDebug) {
      try { onDebug(log); } catch { /* 回调异常不应影响主流程 */ }
    }
  }

  createSession(title) {
    return this.repository.create(title);
  }

  getSession(id) {
    const session = this.repository.findById(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  enterWorldSetting(sessionId) {
    const session = this.getSession(sessionId);
    session.phase = Phase.WORLD_SETTING;
    session.subState = SubState.AWAITING_INPUT;
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.WORLD_SETTING);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      guidance: GameConfig.GUIDANCE.WORLD_SETTING,
    };
  }

  enterCharacterSetting(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.ENTER_CHARACTER_SETTING
    );
    if (!check.allowed) throw new Error(check.reason);

    phaseManager.advancePhase(session, 'ENTER_CHARACTER_SETTING');
    session.subState = SubState.AWAITING_INPUT;
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.CHARACTER_SETTING);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      guidance: GameConfig.GUIDANCE.CHARACTER_SETTING,
    };
  }

  saveWorld(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(session, GameAction.SAVE_WORLD);
    if (!check.allowed) throw new Error(check.reason);

    const raw = saveExtractor.getLatestKpOutput(session, 'world');
    if (!raw) throw new Error('没有可存档的世界观输出');

    session.worldSettings = saveExtractor.extractWorldFromRaw(raw);
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.WORLD_SAVED);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      message: GameConfig.GUIDANCE.WORLD_SAVED,
    };
  }

  saveCharacter(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.SAVE_CHARACTER
    );
    if (!check.allowed) throw new Error(check.reason);
    const raw = saveExtractor.getLatestKpOutput(session, 'character');
    if (!raw) throw new Error('没有可存档的玩家设定输出');

    session.player = saveExtractor.extractCharacterFromRaw(raw);
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.CHARACTER_SAVED);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      message: GameConfig.GUIDANCE.CHARACTER_SAVED,
    };
  }

  updatePlayer(sessionId, player) {
    const session = this.getSession(sessionId);
    session.player = player;
    this._pushDisplay(session, 'system', '玩家设定已手动保存。');
    this.repository.save(session);
    return { session: session.toClientJSON() };
  }

  // ── 通用设定增删改 ──

  _saveAndReturn(session) {
    this.repository.save(session);
    return { session: session.toClientJSON() };
  }

  updateWorldSettings(sessionId, worldSettings) {
    const session = this.getSession(sessionId);
    session.worldSettings = worldSettings;
    this.repository.save(session);
    return { session: session.toClientJSON() };
  }

  /** 按索引更新地点 (index=-1 代表新增) */
  upsertLocation(sessionId, index, data) {
    const session = this.getSession(sessionId);
    const turn = session.chatRecord?.length ?? 0;
    if (index === -1) {
      session.locations.push({
        id: idAllocator.nextLocationId(session.locations),
        name: data.name || '',
        description: data.description ?? '',
        firstSeenAt: turn,
        lastUpdatedAt: turn,
      });
    } else if (session.locations[index]) {
      const old = session.locations[index];
      session.locations[index] = {
        ...old,
        name: data.name ?? old.name,
        description: data.description ?? old.description,
        lastUpdatedAt: turn,
      };
    } else {
      throw new Error('地点索引越界');
    }
    return this._saveAndReturn(session);
  }

  deleteLocation(sessionId, index) {
    const session = this.getSession(sessionId);
    if (!session.locations[index]) throw new Error('地点索引越界');
    session.locations.splice(index, 1);
    return this._saveAndReturn(session);
  }

  /** 按索引更新 NPC (index=-1 代表新增) */
  upsertNpc(sessionId, index, data) {
    const session = this.getSession(sessionId);
    const turn = session.chatRecord?.length ?? 0;
    if (index === -1) {
      session.npcs.push({
        id: idAllocator.nextNewNpcId(session.npcs),
        name: data.name || '',
        baseDescription: data.baseDescription ?? data.description ?? '',
        currentState: data.currentState ?? '',
        importance: data.importance || 'supporting',
        firstSeenAt: turn,
        lastUpdatedAt: turn,
      });
    } else if (session.npcs[index]) {
      const old = session.npcs[index];
      session.npcs[index] = {
        ...old,
        name: data.name ?? old.name,
        baseDescription: data.baseDescription ?? data.description ?? old.baseDescription,
        currentState: data.currentState ?? old.currentState,
        importance: data.importance ?? old.importance,
        lastUpdatedAt: turn,
      };
    } else {
      throw new Error('NPC 索引越界');
    }
    return this._saveAndReturn(session);
  }

  deleteNpc(sessionId, index) {
    const session = this.getSession(sessionId);
    if (!session.npcs[index]) throw new Error('NPC 索引越界');
    session.npcs.splice(index, 1);
    return this._saveAndReturn(session);
  }

  /** 按索引更新物品 (index=-1 代表新增) */
  upsertItem(sessionId, index, data) {
    const session = this.getSession(sessionId);
    const turn = session.chatRecord?.length ?? 0;
    if (index === -1) {
      session.inventory.push({
        id: idAllocator.nextItemId(session.inventory),
        name: data.name || '',
        status: data.status ?? '已获得',
        description: data.description ?? '',
        firstSeenAt: turn,
        lastUpdatedAt: turn,
      });
    } else if (session.inventory[index]) {
      const old = session.inventory[index];
      session.inventory[index] = {
        ...old,
        name: data.name ?? old.name,
        status: data.status ?? old.status,
        description: data.description ?? old.description,
        lastUpdatedAt: turn,
      };
    } else {
      throw new Error('物品索引越界');
    }
    return this._saveAndReturn(session);
  }

  deleteItem(sessionId, index) {
    const session = this.getSession(sessionId);
    if (!session.inventory[index]) throw new Error('物品索引越界');
    session.inventory.splice(index, 1);
    return this._saveAndReturn(session);
  }

  /** 按索引更新关键角色 (index=-1 代表新增) */
  upsertKeyCharacter(sessionId, index, data) {
    const session = this.getSession(sessionId);
    if (index === -1) {
      if (!session.keyCharacters) session.keyCharacters = [];
      session.keyCharacters.push(data);
    } else if (session.keyCharacters && session.keyCharacters[index]) {
      session.keyCharacters[index] = data;
    } else {
      throw new Error('关键角色索引越界');
    }
    return this._saveAndReturn(session);
  }

  deleteKeyCharacter(sessionId, index) {
    const session = this.getSession(sessionId);
    if (!session.keyCharacters || !session.keyCharacters[index]) {
      throw new Error('关键角色索引越界');
    }
    session.keyCharacters.splice(index, 1);
    if (session.keyCharacterIndex >= session.keyCharacters.length) {
      session.keyCharacterIndex = Math.max(0, session.keyCharacters.length - 1);
    }
    return this._saveAndReturn(session);
  }

  // ── 关键角色设定阶段 ──

  enterKeyCharacterSetting(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.ENTER_KEY_CHARACTER_SETTING
    );
    if (!check.allowed) throw new Error(check.reason);

    phaseManager.advancePhase(session, 'ENTER_KEY_CHARACTER_SETTING');
    session.subState = SubState.AWAITING_INPUT;
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.KEY_CHARACTER_SETTING);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      guidance: GameConfig.GUIDANCE.KEY_CHARACTER_SETTING,
    };
  }

  saveKeyCharacter(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.SAVE_KEY_CHARACTER
    );
    if (!check.allowed) throw new Error(check.reason);

    const raw = saveExtractor.getLatestKeyCharKpOutput(session);
    if (!raw) throw new Error('没有可存档的关键角色输出');

    const charText = saveExtractor.extractKeyCharacterFromRaw(raw);
    session.keyCharacters[session.keyCharacterIndex] = charText;

    const idx = session.keyCharacterIndex;
    const isMax = session.keyCharacters.length >= GameConfig.KEY_CHARACTER_MAX_COUNT;

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.KEY_CHARACTER_SAVED);
    this.repository.save(session);

    let nextGuidance = null;
    if (isMax) {
      nextGuidance = GameConfig.GUIDANCE.KEY_CHARACTER_MAX;
    }

    return {
      session: session.toClientJSON(),
      message: GameConfig.GUIDANCE.KEY_CHARACTER_SAVED,
      nextGuidance,
      savedIndex: idx,
    };
  }

  inviteNextKeyCharacter(sessionId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.INVITE_NEXT_KEY_CHARACTER
    );
    if (!check.allowed) throw new Error(check.reason);

    session.keyCharacterIndex = session.keyCharacterIndex + 1;
    session.subState = SubState.AWAITING_INPUT;

    const guidance = GameConfig.GUIDANCE.KEY_CHARACTER_NEXT(
      session.keyCharacterIndex
    );
    this._pushDisplay(session, 'system', guidance);
    this.repository.save(session);

    return {
      session: session.toClientJSON(),
      guidance,
    };
  }

  getStoryOpenConfirmInfo(sessionId) {
    const session = this.getSession(sessionId);
    const count = session.keyCharacters.filter(Boolean).length;
    return {
      count,
      message: GameConfig.GUIDANCE.STORY_OPEN_CONFIRM(count),
    };
  }

  async openStory(sessionId, { onDebug } = {}) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(session, GameAction.OPEN_STORY);
    if (!check.allowed) throw new Error(check.reason);

    phaseManager.advancePhase(session, 'OPEN_STORY');
    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.STORY_OPENING);

    try {
      const result = await this._runLlmFlow(session, FlowType.STORY_OPENING, '', onDebug);

      session.subState = SubState.AWAITING_INPUT;
      this.repository.save(session);

      return {
        session: session.toClientJSON(),
        result,
        systemMessages: [GameConfig.GUIDANCE.STORY_OPENING],
      };
    } catch (err) {
      session.subState = SubState.AWAITING_INPUT;
      this.repository.save(session);
      throw err;
    }
  }

  async handleMessage(sessionId, userText, { onDebug } = {}) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.SEND_MESSAGE
    );
    if (!check.allowed) throw new Error(check.reason);

    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    let diceAwaiting = false;

    try {
      if (session.phase === Phase.STORY_PLAY) {
        // 直接存用户原始输入（不替换选项字母）
        this._pushDisplay(session, 'player', userText);
        session.chatRecord.push({
          role: ChatRole.PLAYER,
          type: ChatEntryType.PROMPT,
          content: userText,
          timestamp: new Date().toISOString(),
        });
      } else if (session.phase === Phase.WORLD_SETTING) {
        this._pushDisplay(session, 'player', userText);
        entityUpdater.applySetupHistory(
          session,
          Phase.WORLD_SETTING,
          ChatRole.PLAYER,
          userText
        );
      } else if (session.phase === Phase.CHARACTER_SETTING) {
        this._pushDisplay(session, 'player', userText);
        entityUpdater.applySetupHistory(
          session,
          Phase.CHARACTER_SETTING,
          ChatRole.PLAYER,
          userText
        );
      } else if (session.phase === Phase.KEY_CHARACTER_SETTING) {
        this._pushDisplay(session, 'player', userText);
        entityUpdater.applySetupHistory(
          session,
          Phase.KEY_CHARACTER_SETTING,
          ChatRole.PLAYER,
          userText
        );
      }

      this.repository.save(session);

      if (session.phase === Phase.STORY_PLAY && session.chatRecord.length > 0) {
        await this.historySummarizer.checkAndRun(session);
      }

      const flowType = phaseManager.getFlowType(session);
      const result = await this._runLlmFlow(session, flowType, userText, onDebug);

      // 检查是否进入 dice 确认等待
      if (result.branch === 'DICE_AWAITING') {
        diceAwaiting = true;
        return {
          session: session.toClientJSON(),
          result,
          diceNotation: result.diceNotation,
        };
      }

      if (session.phase === Phase.STORY_PLAY && session.chatRecord.length > 0) {
        await this.historySummarizer.checkAndRun(session);
      }

      session.subState = SubState.AWAITING_INPUT;
      this.repository.save(session);

      return { session: session.toClientJSON(), result };
    } finally {
      if (!diceAwaiting) {
        if (session.subState === SubState.LLM_STREAMING) {
          session.subState = SubState.AWAITING_INPUT;
          this.repository.save(session);
        }
      }
    }
  }

  async _runLlmFlow(session, flowType, userText, onDebug) {
    const assembled = inputAssembler.assemble(flowType, session, { userText });
    const debugLogs = [];

    const { raw, refinedHtml, reasoningContent } = await this._callLLMWithRetry(session, assembled, flowType, debugLogs, onDebug);

    // 将 refined 内容推入显示日志（前端恢复时直接渲染）
    this._pushDisplay(session, 'kp', refinedHtml);

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(flowType, session, parsed, raw);
    result.debugLogs = debugLogs;
    result.refinedHtml = refinedHtml;

    // 持久化 reasoning_content 到 session（DeepSeek 官方要求：思考模式 + 工具调用场景下，后续轮次必须回传）
    // 直接存到 session.pendingReasoningContent，由下一次 assemble 时读取并注入到 messages
    if (reasoningContent) {
      if (!session.recentReasoningContents) session.recentReasoningContents = [];
      session.recentReasoningContents.push({
        flowType,
        reasoningContent,
        timestamp: new Date().toISOString(),
      });
      // 限制保留数量，避免无限增长
      if (session.recentReasoningContents.length > 10) {
        session.recentReasoningContents = session.recentReasoningContents.slice(-10);
      }
    }

    // 非 dice 分支：执行【】保底存储（dice 分支延迟到用户确认后）
    if (result.branch !== 'DICE') {
      const bracketFallback = this._extractBracketOutsideNarration(raw);
      if (bracketFallback) {
        session.chatRecord.push({
          role: ChatRole.KP,
          type: ChatEntryType.NARRATION,
          content: bracketFallback,
          timestamp: new Date().toISOString(),
        });
      }
    }

    while (result.branch === 'DICE') {
      result = await this._handleDiceBranch(session, result, debugLogs, onDebug);
    }

    return result;
  }

  /**
   * 非流式 LLM 调用 + 重试。
   * debug 日志通过 _pushDebug 同步推送给 onDebug 回调（SSE 流式推送），
   * 同时累积到 debugLogs 数组（最终随返回值一起返回，兼容旧前端）。
   */
  async _callLLMWithRetry(session, assembled, flowType, debugLogs, onDebug) {
    const requiredField = FLOW_REQUIRED_FIELD[flowType];
    let attemptNum = 0;

    // 缓存最近一次的 reasoning_content（思考模式 + 工具调用场景下后续轮次必须回传）
    let lastReasoningContent = null;

    const doCall = async (assembledPrompt) => {
      attemptNum++;
      session.subState = SubState.LLM_STREAMING;
      this.repository.save(session);

      this._pushDebug(debugLogs, onDebug, {
        type: 'debug_prompt',
        flowType,
        attempt: attemptNum,
        systemInstruction: assembledPrompt.messages[0]?.content || '',
        userContent: assembledPrompt.messages.slice(1).map(m =>
          `[${m.role}] ${m.content}`
        ).join('\n'),
      });

      // 重试策略（简化版）：所有调用统一使用思考模式 + reasoning_effort='high'
      // 不再降级到非思考模式 + tool_choice='required'，原因：
      //   1. 思考模式 + tool_choice 冲突（DeepSeek API 400）
      //   2. strict: true 已在 tools 中声明，DeepSeek 会强制 LLM 调用 function，无需 tool_choice 兜底
      //   3. 简化策略避免模式切换带来的输出风格不一致
      // 若思考被 max_tokens 截断（finish_reason=length），直接抛错让用户感知，由其调大 max_tokens
      const result = await this.llmProvider.generate(assembledPrompt);
      const raw = result.content;
      lastReasoningContent = result.reasoningContent;

      // KV Cache 监控：记录每次调用的 token 使用与缓存命中情况
      if (result.usage) {
        const u = result.usage;
        const total = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
        const hit = u.prompt_cache_hit_tokens || 0;
        const miss = u.prompt_cache_miss_tokens || 0;
        const hitRate = (hit + miss) > 0 ? Math.round(hit * 100 / (hit + miss)) : 0;
        this._pushDebug(debugLogs, onDebug, {
          type: 'system',
          flowType,
          attempt: attemptNum,
          content: `[Token] 输入=${u.prompt_tokens || 0} 输出=${u.completion_tokens || 0} 总=${total} | [Cache] 命中=${hit} 未命中=${miss} 命中率=${hitRate}%${result.hasToolCall ? '' : ' | ⚠️ 未走 tool_calls（strict 失效）'}`,
        });
      }

      // 诊断：LLM 走 content 而非 tool_calls 时，记录 content 前 500 字符到 god's eye
      // 用于排查"LLM 直接输出文本不调 function"的具体场景
      if (!result.hasToolCall) {
        const diag = result._diagnostic || {};
        this._pushDebug(debugLogs, onDebug, {
          type: 'system',
          flowType,
          attempt: attemptNum,
          content: `⚠️ strict 模式失效，LLM 走 content 而非 tool_calls\n【finish_reason】${diag.finishReason || 'unknown'}\n【reasoning_content 长度】${diag.reasoningLen ?? 0}\n【content 前 500 字符】\n${diag.contentHead || '(空)'}`,
        });
      }

      this._pushDebug(debugLogs, onDebug, {
        type: 'debug_raw',
        flowType,
        attempt: attemptNum,
        content: raw,
      });

      return raw;
    };

    if (!requiredField) {
      const raw = await doCall(assembled);
      const refined = textRefiner.refine(flowType, jsonOutputParser.parse(raw));
      return { raw, refinedHtml: refined.html, reasoningContent: lastReasoningContent };
    }

    let raw = await doCall(assembled);

    const tryRefine = async (rawText) => {
      const parsed = jsonOutputParser.parse(rawText);
      if (parsed && parsed[requiredField] !== undefined) {
        const refined = textRefiner.refine(flowType, parsed);
        return { ok: true, raw: rawText, refinedHtml: refined.html };
      }
      // 记录详细诊断信息：raw 内容 + 字段名 + 字段值类型
      // 用于排查"LLM 看起来按格式输出但系统判错"的场景
      const rawLen = (rawText || '').length;
      const rawHead = (rawText || '').slice(0, 500);
      if (!parsed) {
        this._pushDebug(debugLogs, onDebug, {
          type: 'parse_fail',
          flowType,
          attempt: attemptNum,
          content: `JSON 解析失败。raw 长度=${rawLen}\n【raw 前 500 字符】\n${rawHead}`,
        });
      } else {
        const fields = Object.keys(parsed);
        // 详细列出每个字段的类型，便于发现字段名问题（如英文 vs 中文）
        const fieldDetails = fields.map(k => {
          const v = parsed[k];
          const type = Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
          return `${k} (${type})`;
        }).join(', ');
        this._pushDebug(debugLogs, onDebug, {
          type: 'parse_fail',
          flowType,
          attempt: attemptNum,
          content: `JSON 解析成功，但缺少必需字段 "${requiredField}"。\n【已有字段】${fieldDetails || '(空对象)'}\n【raw 前 500 字符】\n${rawHead}`,
        });
      }
      return { ok: false };
    };

    let result = await tryRefine(raw);
    if (result.ok) return { raw: result.raw, refinedHtml: result.refinedHtml, reasoningContent: lastReasoningContent };

    // 第一次重试：追加 reminder 提示
    this._pushDebug(debugLogs, onDebug, {
      type: 'retry_clear',
      content: `系统正在规范LLM输出（缺少必需字段 "${requiredField}"），请稍候…`,
    });

    const reminder = `\n\n【请务必通过调用指定函数返回合法 JSON，且必须包含 "${requiredField}" 字段；不要直接输出文本、markdown 或代码块】`;
    const retryMessages = [...assembled.messages];
    const lastUserIdx = retryMessages.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      retryMessages[lastUserIdx] = {
        ...retryMessages[lastUserIdx],
        content: retryMessages[lastUserIdx].content + reminder,
      };
    } else {
      retryMessages[retryMessages.length - 1] = {
        ...retryMessages[retryMessages.length - 1],
        content: retryMessages[retryMessages.length - 1].content + reminder,
      };
    }
    const retryAssembled = { ...assembled, messages: retryMessages };

    raw = await doCall(retryAssembled);

    result = await tryRefine(raw);
    if (result.ok) return { raw: result.raw, refinedHtml: result.refinedHtml, reasoningContent: lastReasoningContent };

    // 第二次重试：继续用思考模式 high + 更强的 reminder（不再切换到非思考模式 + tool_choice）
    // 简化策略：strict: true 已强制 LLM 调用 function，无需 tool_choice 兜底；
    //          思考模式 + tool_choice 冲突（API 400），故所有重试都保持思考模式
    this._pushDebug(debugLogs, onDebug, {
      type: 'retry_clear',
      content: `第二次重试：继续使用思考模式 high + 强化 reminder（不再切换到非思考模式）`,
    });

    const strongerReminder = `\n\n【重要提醒】上一次响应未通过解析（缺少必需字段 "${requiredField}"）。请务必通过调用指定函数返回合法 JSON，且必须包含 "${requiredField}" 字段；不要直接输出文本、markdown 或代码块。请检查函数名和字段名是否正确。`;
    const retryMessages2 = [...assembled.messages];
    const lastUserIdx2 = retryMessages2.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx2 >= 0) {
      retryMessages2[lastUserIdx2] = {
        ...retryMessages2[lastUserIdx2],
        content: retryMessages2[lastUserIdx2].content + strongerReminder,
      };
    } else {
      retryMessages2[retryMessages2.length - 1] = {
        ...retryMessages2[retryMessages2.length - 1],
        content: retryMessages2[retryMessages2.length - 1].content + strongerReminder,
      };
    }
    const retryAssembled2 = { ...assembled, messages: retryMessages2 };

    raw = await doCall(retryAssembled2);

    result = await tryRefine(raw);
    if (result.ok) return { raw: result.raw, refinedHtml: result.refinedHtml, reasoningContent: lastReasoningContent };

    // 第三次仍失败：raw 兜底（必须包裹 <div class="kp-block">，否则前端 _restoreUI 的 startsWith('<div') 判断会失败）
    this._applyRawFallback(session, flowType, raw, requiredField, debugLogs, onDebug);
    return { raw, refinedHtml: `<div class="kp-block">${escapeHtml(raw)}</div>`, reasoningContent: lastReasoningContent };
  }

  _applyRawFallback(session, flowType, raw, requiredField, debugLogs, onDebug) {
    const msg = `LLM 三次均未输出合法 JSON（缺少 "${requiredField}" 字段），已使用完整输出作为备用。`;
    this._pushDebug(debugLogs, onDebug, { type: 'system', content: msg });
    this._pushDisplay(session, 'system', msg);

    if (flowType === FlowType.HISTORY_SUMMARY) {
      entityUpdater.applySummary(session, raw);
    } else if (
      flowType === FlowType.WORLD_GEN ||
      flowType === FlowType.CHARACTER_GEN ||
      flowType === FlowType.KEY_CHARACTER_GEN
    ) {
      // setupHistory 已由 OutputProcessor.process 流程存入 raw（applySetupHistory）
    } else {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.RAW,
        content: raw,
        timestamp: new Date().toISOString(),
      });
    }
  }

  _extractBracketOutsideNarration(raw) {
    if (!raw) return null;
    const withoutNarration = raw.replace(/"narration"\s*:\s*"[^"]*"/gi, '');
    const matches = withoutNarration.match(/【[\s\S]*?】/g);
    return matches ? matches.join('\n') : null;
  }

  // ── Dice 分支处理 ──

  async _handleDiceBranch(session, diceResult, debugLogs, onDebug) {
    session.subState = SubState.DICE_PENDING;
    session.pendingDiceFlow = {
      diceNotation: diceResult.diceNotation,
      pendingRaw: diceResult.raw,
      rollbackChatLen: session.chatRecord.length,
      rollbackDisplayLen: (session.displayLog || []).length,
    };
    this.repository.save(session);

    return { branch: 'DICE_AWAITING', diceNotation: diceResult.diceNotation };
  }

  async confirmDice(sessionId, { onDebug } = {}) {
    const session = this.getSession(sessionId);
    if (!session.pendingDiceFlow || session.subState !== SubState.DICE_PENDING) {
      throw new Error('当前无待确认的掷骰');
    }

    const { diceNotation, pendingRaw } = session.pendingDiceFlow;
    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    let diceAwaiting = false;
    try {
      const execResult = await this._executeDice(session, diceNotation, pendingRaw, onDebug);
      if (execResult && execResult.branch === 'DICE_AWAITING') {
        diceAwaiting = true;
      }
      return {
        session: session.toClientJSON(),
        result: execResult,
        diceNotation: execResult.diceNotation,
      };
    } catch (err) {
      session.pendingDiceFlow = null;
      session.subState = SubState.AWAITING_INPUT;
      this.repository.save(session);
      throw err;
    }
  }

  cancelDice(sessionId) {
    const session = this.getSession(sessionId);
    if (!session.pendingDiceFlow || session.subState !== SubState.DICE_PENDING) {
      throw new Error('当前无待确认的掷骰');
    }

    const { rollbackChatLen, rollbackDisplayLen } = session.pendingDiceFlow;

    if (session.chatRecord.length > rollbackChatLen) {
      session.chatRecord.length = rollbackChatLen;
    }
    if (session.displayLog && session.displayLog.length > rollbackDisplayLen) {
      session.displayLog.length = rollbackDisplayLen;
    }

    session.pendingDiceFlow = null;
    session.subState = SubState.AWAITING_INPUT;
    session.optionBuffer = '';
    this._pushDisplay(session, 'system', '已取消掷骰判定，请重新选择行动。');
    this.repository.save(session);

    return {
      session: session.toClientJSON(),
      message: '已取消掷骰判定，请重新选择行动。',
    };
  }

  async _executeDice(session, diceNotation, pendingRaw, onDebug) {
    // 用户已确认 —— 将本次触发 dice 的 narration 和【】写入 chatRecord
    const pendingParsed = jsonOutputParser.parse(pendingRaw);
    if (pendingParsed?.narration) {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: pendingParsed.narration,
        timestamp: new Date().toISOString(),
      });
    }
    const pendingBracket = this._extractBracketOutsideNarration(pendingRaw);
    if (pendingBracket) {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: pendingBracket,
        timestamp: new Date().toISOString(),
      });
    }

    const requests = diceService.parseNotation(diceNotation);
    const values = diceService.rollAll(requests);
    const systemMsg = diceService.formatSystemMessage(values);

    this._pushDisplay(session, 'system', systemMsg);

    session.chatRecord.push({
      role: ChatRole.SYSTEM,
      type: ChatEntryType.SYSTEM,
      content: systemMsg,
      timestamp: new Date().toISOString(),
    });

    if (session.chatRecord.length > 0) {
      await this.historySummarizer.checkAndRun(session);
    }

    const assembled = inputAssembler.assemble(
      FlowType.NARRATION_II,
      session,
      {}
    );

    const debugLogs = [];
    const { raw, refinedHtml, reasoningContent } = await this._callLLMWithRetry(
      session,
      assembled,
      FlowType.NARRATION_II,
      debugLogs,
      onDebug
    );

    const bracketFallback = this._extractBracketOutsideNarration(raw);
    if (bracketFallback) {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: bracketFallback,
        timestamp: new Date().toISOString(),
      });
    }
    this._pushDisplay(session, 'kp', refinedHtml);

    // 持久化 reasoning_content（思考模式 + 工具调用场景下后续轮次必须回传）
    if (reasoningContent) {
      if (!session.recentReasoningContents) session.recentReasoningContents = [];
      session.recentReasoningContents.push({
        flowType: FlowType.NARRATION_II,
        reasoningContent,
        timestamp: new Date().toISOString(),
      });
      while (session.recentReasoningContents.length > 10) {
        session.recentReasoningContents.shift();
      }
    }

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(FlowType.NARRATION_II, session, parsed, raw);
    result.debugLogs = debugLogs;
    result.refinedHtml = refinedHtml;
    this.repository.save(session);

    while (result.branch === 'DICE') {
      const diceCheck = await this._handleDiceBranch(session, result, debugLogs, onDebug);
      if (diceCheck.branch === 'DICE_AWAITING') {
        return {
          ...diceCheck,
          systemMessages: [systemMsg],
        };
      }
      result = diceCheck;
    }

    session.pendingDiceFlow = null;
    session.subState = SubState.AWAITING_INPUT;
    this.repository.save(session);

    return {
      ...result,
      systemMessages: [systemMsg],
    };
  }
}
