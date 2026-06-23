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
import { saveExtractor } from '../services/SaveExtractor.js';
import { optionResolver } from '../services/OptionResolver.js';
import { diceService } from '../services/DiceService.js';
import { HistorySummarizer } from '../services/HistorySummarizer.js';
import { FLOW_REQUIRED_FIELD } from '../services/PromptTemplateRegistry.js';
import { textRefiner } from '../services/TextRefiner.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class GameOrchestrator {
  constructor({ repository, llmProvider, streamEmitter }) {
    this.repository = repository;
    this.llmProvider = llmProvider;
    this.streamEmitter = streamEmitter;
    this.historySummarizer = new HistorySummarizer({
      llmProvider,
      repository,
      streamEmitter,
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
    this.repository.save(session);
    return {
      session: session.toJSON(),
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
    this.repository.save(session);
    return {
      session: session.toJSON(),
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
    this.repository.save(session);
    return {
      session: session.toJSON(),
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
    if (!raw) throw new Error('没有可存档的主角设定输出');

    session.protagonist = saveExtractor.extractCharacterFromRaw(raw);
    this.repository.save(session);
    return {
      session: session.toJSON(),
      message: GameConfig.GUIDANCE.CHARACTER_SAVED,
    };
  }

  updateProtagonist(sessionId, protagonist) {
    const session = this.getSession(sessionId);
    session.protagonist = protagonist;
    this.repository.save(session);
    return { session: session.toJSON() };
  }

  async openStory(sessionId, streamId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(session, GameAction.OPEN_STORY);
    if (!check.allowed) throw new Error(check.reason);

    phaseManager.advancePhase(session, 'OPEN_STORY');
    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'system',
        content: GameConfig.GUIDANCE.STORY_OPENING,
      });
      this.streamEmitter.emit(streamId, { type: 'input_lock', locked: true });
    }
    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.STORY_OPENING);

    try {
      const result = await this._runLlmFlow(
        session,
        FlowType.STORY_OPENING,
        '',
        streamId
      );

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'done',
          session: session.toJSON(),
          result,
        });
      }

      return { session: session.toJSON(), result };
    } finally {
      session.subState = SubState.AWAITING_INPUT;
      this.repository.save(session);

      if (streamId) {
        this.streamEmitter.emit(streamId, { type: 'input_lock', locked: false });
      }
    }
  }

  async handleMessage(sessionId, userText, streamId) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.SEND_MESSAGE
    );
    if (!check.allowed) throw new Error(check.reason);

    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'input_lock', locked: true });
    }

    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    let diceAwaiting = false;

    try {
      let resolvedText = userText;
      if (session.phase === Phase.STORY_PLAY) {
        resolvedText = optionResolver.resolve(userText, session.optionBuffer);
        this._pushDisplay(session, 'player', resolvedText);
        session.chatRecord.push({
          role: ChatRole.PLAYER,
          type: ChatEntryType.PROMPT,
          content: resolvedText,
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
      }

      this.repository.save(session);

      if (session.phase === Phase.STORY_PLAY && session.chatRecord.length > 0) {
        await this.historySummarizer.checkAndRun(session, streamId);
      }

      const flowType = phaseManager.getFlowType(session);
      const result = await this._runLlmFlow(
        session,
        flowType,
        resolvedText,
        streamId
      );

      // 检查是否进入 dice 确认等待
      if (result.branch === 'DICE_AWAITING') {
        diceAwaiting = true;
        if (streamId) {
          this.streamEmitter.emit(streamId, {
            type: 'dice_confirm',
            diceNotation: result.diceNotation,
          });
          this.streamEmitter.emit(streamId, {
            type: 'done',
            session: session.toJSON(),
            result,
          });
        }
        return { session: session.toJSON(), result };
      }

      if (session.phase === Phase.STORY_PLAY && session.chatRecord.length > 0) {
        await this.historySummarizer.checkAndRun(session, streamId);
      }

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'done',
          session: session.toJSON(),
          result,
        });
      }

      return { session: session.toJSON(), result };
    } finally {
      if (!diceAwaiting) {
        session.subState = SubState.AWAITING_INPUT;
      }
      this.repository.save(session);

      if (streamId && !diceAwaiting) {
        this.streamEmitter.emit(streamId, { type: 'input_lock', locked: false });
      }
    }
  }

  async _runLlmFlow(session, flowType, userText, streamId) {
    const assembled = inputAssembler.assemble(flowType, session, { userText });

    const { raw, refinedHtml } = await this._callLLMWithRetry(session, assembled, flowType, streamId);

    // 将 refined 内容推入显示日志（前端恢复时直接渲染）
    this._pushDisplay(session, 'kp', refinedHtml);

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(flowType, session, parsed, raw);

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
      result = await this._handleDiceBranch(session, result, streamId);
    }

    return result;
  }

  /**
   * 模拟流式输出：将 refined 的 plainText 逐 chunk emit 到前端。
   */
  async _streamSimulated(text, streamId) {
    if (!streamId || !text) return;
    const CHUNK_SIZE = 5;
    const DELAY_MS = 20;

    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE);
      this.streamEmitter.emit(streamId, { type: 'chunk', content: chunk });
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  async _callLLMWithRetry(session, assembled, flowType, streamId) {
    const requiredField = FLOW_REQUIRED_FIELD[flowType];

    let attemptNum = 0;

    // doCall 不再 emit chunk —— 缓冲模式，由 _streamSimulated 统一发送
    const doCall = async (assembledPrompt) => {
      attemptNum++;
      session.subState = SubState.LLM_STREAMING;
      this.repository.save(session);

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'debug_prompt',
          flowType,
          attempt: attemptNum,
          systemInstruction: assembledPrompt.messages[0]?.content || '',
          userContent: assembledPrompt.messages.slice(1).map(m =>
            `[${m.role}] ${m.content}`
          ).join('\n'),
        });
      }

      const raw = await this.llmProvider.generateStream(assembledPrompt, null);

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'debug_raw',
          flowType,
          attempt: attemptNum,
          content: raw,
        });
      }

      return raw;
    };

    // 无需验证字段（通常不会走到这里，但保留兜底）
    if (!requiredField) {
      const raw = await doCall(assembled);
      const refined = textRefiner.refine(flowType, jsonOutputParser.parse(raw));
      await this._streamSimulated(refined.plainText, streamId);
      if (streamId) {
        this.streamEmitter.emit(streamId, { type: 'llm_complete', content: refined.html });
      }
      return { raw, refinedHtml: refined.html };
    }

    let raw = await doCall(assembled);

    // ── 尝试解析并 refine ──
    const tryRefine = async (rawText) => {
      const parsed = jsonOutputParser.parse(rawText);
      if (parsed && parsed[requiredField] !== undefined) {
        const refined = textRefiner.refine(flowType, parsed);
        await this._streamSimulated(refined.plainText, streamId);
        if (streamId) {
          this.streamEmitter.emit(streamId, { type: 'llm_complete', content: refined.html });
        }
        return { ok: true, raw: rawText, refinedHtml: refined.html };
      }
      return { ok: false };
    };

    let result = await tryRefine(raw);
    if (result.ok) return { raw: result.raw, refinedHtml: result.refinedHtml };

    // 第一次重试
    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'retry_clear',
        content: '系统正在规范LLM输出，请稍候…',
      });
    }

    const reminder = `\n\n【请一定只输出合法的 JSON，且必须包含 "${requiredField}" 字段】`;
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
    if (result.ok) return { raw: result.raw, refinedHtml: result.refinedHtml };

    // 第二次仍失败：raw 兜底
    this._applyRawFallback(session, flowType, raw, requiredField, streamId);
    // raw 兜底内容直接作为 llm_complete 发送
    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'llm_complete', content: escapeHtml(raw) });
    }
    return { raw, refinedHtml: raw };
  }

  _applyRawFallback(session, flowType, raw, requiredField, streamId) {
    const msg = `LLM 两次均未输出合法 JSON（缺少 "${requiredField}" 字段），已使用完整输出作为备用。`;

    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'system', content: msg });
    }
    this._pushDisplay(session, 'system', msg);

    if (flowType === FlowType.HISTORY_SUMMARY) {
      entityUpdater.applySummary(session, raw);
    } else if (
      flowType === FlowType.WORLD_GEN ||
      flowType === FlowType.CHARACTER_GEN
    ) {
      // setupHistory 中已由 _processOutput 存入 raw
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
    // 移除所有 narration 文本块后再扫描【】
    // narration 在 JSON 中以 "narration": "..." 形式存在
    const withoutNarration = raw.replace(/"narration"\s*:\s*"[^"]*"/gi, '');
    const matches = withoutNarration.match(/【[\s\S]*?】/g);
    return matches ? matches.join('\n') : null;
  }

  // ── Dice 分支处理 ──

  async _handleDiceBranch(session, diceResult, streamId) {
    session.subState = SubState.DICE_PENDING;
    session.pendingDiceFlow = {
      diceNotation: diceResult.diceNotation,
      pendingRaw: diceResult.raw,
      rollbackChatLen: session.chatRecord.length,
      rollbackDisplayLen: (session.displayLog || []).length,
    };
    this.repository.save(session);

    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'bot_break' });
    }

    return { branch: 'DICE_AWAITING', diceNotation: diceResult.diceNotation };
  }

  async confirmDice(sessionId, streamId) {
    const session = this.getSession(sessionId);
    if (!session.pendingDiceFlow || session.subState !== SubState.DICE_PENDING) {
      throw new Error('当前无待确认的掷骰');
    }

    const { diceNotation, pendingRaw } = session.pendingDiceFlow;
    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'input_lock', locked: true });
    }

    let diceAwaiting = false;
    try {
      const execResult = await this._executeDice(session, diceNotation, pendingRaw, streamId);
      if (execResult && execResult.branch === 'DICE_AWAITING') {
        diceAwaiting = true;
      }
      return execResult;
    } finally {
      if (!diceAwaiting) {
        session.pendingDiceFlow = null;
        session.subState = SubState.AWAITING_INPUT;
        this.repository.save(session);
        if (streamId) {
          this.streamEmitter.emit(streamId, { type: 'input_lock', locked: false });
        }
      }
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
    this.repository.save(session);

    return {
      session: session.toJSON(),
      message: '已取消掷骰判定，请重新选择行动。',
    };
  }

  async _executeDice(session, diceNotation, pendingRaw, streamId) {
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

    if (streamId) {
      this.streamEmitter.emit(streamId, { type: 'bot_break' });
      this.streamEmitter.emit(streamId, {
        type: 'system',
        content: systemMsg,
      });
    }

    this._pushDisplay(session, 'system', systemMsg);

    session.chatRecord.push({
      role: ChatRole.SYSTEM,
      type: ChatEntryType.SYSTEM,
      content: systemMsg,
      timestamp: new Date().toISOString(),
    });

    if (session.chatRecord.length > 0) {
      await this.historySummarizer.checkAndRun(session, streamId);
    }

    const assembled = inputAssembler.assemble(
      FlowType.NARRATION_II,
      session,
      {}
    );

    const { raw, refinedHtml } = await this._callLLMWithRetry(
      session,
      assembled,
      FlowType.NARRATION_II,
      streamId
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

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(FlowType.NARRATION_II, session, parsed, raw);
    this.repository.save(session);

    while (result.branch === 'DICE') {
      const diceCheck = await this._handleDiceBranch(session, result, streamId);
      if (diceCheck.branch === 'DICE_AWAITING') {
        if (streamId) {
          this.streamEmitter.emit(streamId, {
            type: 'dice_confirm',
            diceNotation: diceCheck.diceNotation,
          });
          this.streamEmitter.emit(streamId, {
            type: 'done',
            session: session.toJSON(),
            result: diceCheck,
          });
        }
        return diceCheck;
      }
      result = diceCheck;
    }

    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'done',
        session: session.toJSON(),
        result,
      });
    }

    return result;
  }
}
