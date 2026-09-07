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
import { damageResolver } from '../services/DamageResolver.js';
import { endingService } from '../services/EndingService.js';
import { HistorySummarizer } from '../services/HistorySummarizer.js';
import { FLOW_REQUIRED_FIELD } from '../services/PromptTemplateRegistry.js';
import {
  ACTIONS,
  ACTION_TYPE,
  TRIGGER, TRIGGER_PLAYER, TRIGGER_OTHERS,
  DIALOG_STAGE, DIALOG_A_CONFIRM, DIALOG_B_SANCHECK_CONFIRM, DIALOG_EXECUTING,
  BRANCH_B_SANCHECK_AWAITING,
  SANCHECK,
} from '../domain/NarrativeSchema.js';
import { textRefiner } from '../services/TextRefiner.js';
import { scheduleService } from '../services/ScheduleService.js';
import { scenarioProgressService } from '../services/ScenarioProgressService.js';
import { optionResolver } from '../services/OptionResolver.js';
import { BIRCH_STATION_TUTORIAL } from '../scenarios/birchStation.js';

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

  createBirchStationTutorial() {
    const definition = BIRCH_STATION_TUTORIAL;
    const session = this.repository.create(definition.title);
    session.phase = Phase.STORY_PLAY;
    session.subState = SubState.AWAITING_INPUT;
    session.openingDone = true;
    session.scenarioId = definition.id;
    session.scenarioRules = structuredClone(definition.scenarioRules);
    session.scenarioClock = { currentTime: '00:10', deadline: '06:00', turn: 0, phase: 'hook' };
    session.playerLocationId = definition.scenarioRules.initialLocationId;
    session.sanity = { startSan: 60, state: 'stable', resolvedEventIds: [], traumaHistory: [], activeTrauma: null };
    session.scheduledEvents = structuredClone(definition.scheduledEvents);
    session.activeScene = null;
    session.scenarioFlags = {};
    session.worldSettings = definition.worldSettings;
    session.player = definition.player;
    session.locations = structuredClone(definition.locations);
    session.npcs = structuredClone(definition.npcs);
    session.inventory = structuredClone(definition.inventory);
    session.evidence = structuredClone(definition.evidence);
    session.suspicion = 0;
    const openingParsed = {
      narration: definition.opening.narration,
      locations: [], npcs: [], items: [], actions: null,
      options: definition.opening.options,
      time_cost_minutes: 0,
      time_cost_rationale: '',
      evidence_changes: [],
      suspicion_delta: 0,
      combat_update: null,
      ending_recommendation: { should_end: false, reason: '' },
      current_location_id: definition.scenarioRules.initialLocationId,
    };
    session.optionBuffer = definition.opening.options.join('\n');
    session.storyOpeningCache = { raw: JSON.stringify(openingParsed), parsed: openingParsed, timestamp: new Date().toISOString() };
    session.characterInitialStats = this._captureInitialStats(session);
    session.chatRecord.push({
      role: ChatRole.KP,
      type: ChatEntryType.NARRATION,
      content: `${definition.opening.narration}\n\n【请选择你接下来的行动】\n${definition.opening.options.join('\n')}`,
      parsed: openingParsed,
      flowType: FlowType.STORY_OPENING,
      timestamp: new Date().toISOString(),
    });
    this._pushDisplay(session, 'system', '【欢迎来到白桦站】现在是00:10，列车将在06:00发车。点击选项或直接描述行动；调查会消耗时间，地点与线索会随进展逐步揭示。');
    this._pushDisplay(session, 'kp', textRefiner.refine(FlowType.STORY_OPENING, openingParsed).html);
    this.repository.save(session);
    return { session: session.toClientJSON() };
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

    // 初始化 npc_000 的姓名/HP/SAN（从角色卡解析）
    const stats = saveExtractor.extractCharacterStats(raw);
    if (stats) {
      this._ensurePlayerNpc(session, stats.name, stats.hp, stats.san);
    }

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.CHARACTER_SAVED);
    this.repository.save(session);
    return {
      session: session.toClientJSON(),
      message: GameConfig.GUIDANCE.CHARACTER_SAVED,
    };
  }

  /**
   * 确保 npc_000 存在并初始化 姓名/HP/SAN。
   * 已存在的 npc_000 若 name 仍为占位"玩家"，则用真实姓名覆盖。
   */
  _ensurePlayerNpc(session, name, hp, san) {
    let playerNpc = session.npcs.find(n => n.id === 'npc_000');
    if (!playerNpc) {
      playerNpc = {
        id: 'npc_000',
        name,
        baseDescription: '',
        currentState: '',
        importance: 'player',
        hp, maxHp: hp,
        san, maxSan: san,
        visibility: 'visible',
        status: 'active',
        attributes: null,
        firstSeenAt: session.chatRecord?.length ?? 0,
        lastUpdatedAt: session.chatRecord?.length ?? 0,
      };
      session.npcs.unshift(playerNpc);
    } else {
      // 已存在则更新（可能从旧数据迁移）
      // name 仍为占位"玩家"时用真实姓名覆盖；已有真实姓名则不覆盖（避免回退）
      if (playerNpc.name === '玩家' && name) playerNpc.name = name;
      if (playerNpc.hp == null) { playerNpc.hp = hp; playerNpc.maxHp = hp; }
      if (playerNpc.san == null) { playerNpc.san = san; playerNpc.maxSan = san; }
      if (!playerNpc.visibility) playerNpc.visibility = 'visible';
      if (!playerNpc.status) playerNpc.status = 'active';
    }
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
    const savedCount = session.keyCharacters.filter(Boolean).length;
    const isMax = savedCount >= GameConfig.KEY_CHARACTER_MAX_COUNT;

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.KEY_CHARACTER_SAVED);

    // 保存后如果有剩余名额，自动邀请下一个角色
    // 避免 bug：用户忘记点"邀请下一个"就直接生成新角色，导致 keyCharacters[keyCharacterIndex] 覆盖旧角色
    let nextGuidance = null;
    if (isMax) {
      nextGuidance = GameConfig.GUIDANCE.KEY_CHARACTER_MAX;
    } else {
      session.keyCharacterIndex = session.keyCharacterIndex + 1;
      session.subState = SubState.AWAITING_INPUT;
      nextGuidance = GameConfig.GUIDANCE.KEY_CHARACTER_NEXT(session.keyCharacterIndex);
      this._pushDisplay(session, 'system', nextGuidance);
    }

    this.repository.save(session);

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

      // 缓存故事开幕（用于结局重置时重新发送）
      if (result?.parsed) {
        session.storyOpeningCache = {
          raw: result.raw || '',
          parsed: result.parsed,
          timestamp: new Date().toISOString(),
        };

        // 缓存玩家/关键角色初始状态（用于结局重置时恢复）
        session.characterInitialStats = this._captureInitialStats(session);
      }

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

  /**
   * 捕获玩家/关键角色的初始状态快照（用于结局重置时恢复）。
   */
  _captureInitialStats(session) {
    const keyCharCount = session.keyCharacters?.length || 0;
    const stats = [];
    for (let i = 0; i <= keyCharCount; i++) {
      const npcId = i === 0 ? 'npc_000' : `npc_${String(i).padStart(3, '0')}`;
      const npc = session.npcs.find(n => n.id === npcId);
      if (npc) {
        stats.push({
          npcId,
          hp: npc.hp,
          maxHp: npc.maxHp,
          san: npc.san,
          maxSan: npc.maxSan,
          currentState: npc.currentState || '',
        });
      }
    }
    return stats;
  }

  async handleMessage(sessionId, userText, { onDebug } = {}) {
    const session = this.getSession(sessionId);
    const check = phaseManager.canPerformAction(
      session,
      GameAction.SEND_MESSAGE
    );
    if (!check.allowed) throw new Error(check.reason);

    const turnRollback = session.phase === Phase.STORY_PLAY
      ? this._captureTurnRollback(session)
      : null;

    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    let diceAwaiting = false;
    const resolvedUserText = session.phase === Phase.STORY_PLAY
      ? optionResolver.resolve(userText, session.optionBuffer)
      : userText;
    const modelUserText = resolvedUserText !== userText
      ? `玩家选择：${userText}\n对应行动：${resolvedUserText}`
      : userText;

    try {
      if (session.phase === Phase.STORY_PLAY) {
        // 直接存用户原始输入（不替换选项字母）
        this._pushDisplay(session, 'player', userText);
        session.chatRecord.push({
          role: ChatRole.PLAYER,
          type: ChatEntryType.PROMPT,
          content: modelUserText,
          selectedOption: resolvedUserText !== userText ? userText : null,
          resolvedAction: resolvedUserText !== userText ? resolvedUserText : null,
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
      const result = await this._runLlmFlow(session, flowType, modelUserText, onDebug, { turnRollback });

      // 检查是否进入掷骰确认等待
      if (result.branch === 'DICE_AWAITING') {
        diceAwaiting = true;
        return {
          session: session.toClientJSON(),
          result,
          actions: result.actions,
        };
      }

      if (result.scenarioDeadlineReached || result.endingRecommended) {
        const endingResult = await this._triggerEnding(session, null, onDebug, null, result.endingReason);
        endingResult.refinedHtml = `${result.refinedHtml || ''}${endingResult.refinedHtml || ''}`;
        endingResult.scenarioMessages = result.scenarioMessages || [];
        return { session: session.toClientJSON(), result: endingResult };
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

  async _runLlmFlow(session, flowType, userText, onDebug, { turnRollback = null } = {}) {
    const turnPreparation = flowType === FlowType.NARRATION_I
      ? scheduleService.prepareTurn(session, { userText })
      : null;
    const assembled = inputAssembler.assemble(flowType, session, { userText });
    const debugLogs = [];

    const { raw, refinedHtml, reasoningContent } = await this._callLLMWithRetry(session, assembled, flowType, debugLogs, onDebug);

    // 将 refined 内容推入显示日志（前端恢复时直接渲染）
    this._pushDisplay(session, 'kp', refinedHtml);

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(flowType, session, parsed, raw);
    result.debugLogs = debugLogs;
    result.refinedHtml = refinedHtml;
    if (turnPreparation) result.turnPreparation = turnPreparation;

    // 持久化 reasoning_content 到最近推入 chatRecord 的 KP 条目（DeepSeek 官方要求：工具调用轮次后续必须回传）
    // 设计：reasoningContent 直接附加到 chatRecord 条目上，1:1 精确匹配，避免独立队列 FIFO 错位
    // - NARRATIVE 分支：applyNarrative 已推入 KP 条目（含 parsed），附加到该条目
    // - ACTIONS 分支：applyNarrative 未调用（提前 return），narration 尚未进入 chatRecord
    //   → reasoningContent 通过 _handleDiceBranch 存入 pendingDiceFlow.pendingReasoningContent，
    //     在用户确认后由 _executeDice 附加到 pending narration 条目（工具调用轮次必须回传）
    // - SETUP 分支（WORLD/CHARACTER）：applySetupHistory 推入的是 raw 文本，无 parsed，走兜底路径不注入
    if (reasoningContent && result.branch === 'NARRATIVE') {
      const lastKpEntry = [...session.chatRecord].reverse().find(
        e => e.role === ChatRole.KP && e.parsed && e.flowType
      );
      if (lastKpEntry && !lastKpEntry.reasoningContent) {
        lastKpEntry.reasoningContent = reasoningContent;
      }
    }

    // 非 ACTIONS 分支：执行【】保底存储（ACTIONS 分支延迟到用户确认后）
    if (result.branch !== 'ACTIONS') {
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

    while (result.branch === 'ACTIONS') {
      result = await this._handleDiceBranch(
        session,
        result,
        reasoningContent,
        debugLogs,
        onDebug,
        flowType,
        turnRollback
      );
    }

    if (flowType === FlowType.NARRATION_I && result.branch === 'NARRATIVE') {
      const scenarioResult = this._applyScenarioRuling(session, result.parsed);
      Object.assign(result, scenarioResult);
    }

    return result;
  }

  _applyScenarioRuling(session, parsed, { advanceClock = true, userText = null } = {}) {
    if (!session.scenarioId) return {};
    const lastPlayerAction = userText ?? ([...(session.chatRecord || [])]
      .reverse()
      .find(entry => entry?.role === ChatRole.PLAYER)?.content || '');
    const stateResult = scheduleService.applyStateRuling(session, parsed, { userText: lastPlayerAction });
    const eventResult = scheduleService.commitActiveScene(session);
    const clockResult = advanceClock
      ? scheduleService.applyNarrativeRuling(session, parsed)
      : { advanced: false, deadlineReached: false, firedEvents: [], revealedLocations: [] };
    const scenarioMessages = [];
    const appendSystemMessage = (message) => {
      scenarioMessages.push(message);
      this._pushDisplay(session, 'system', message);
      session.chatRecord.push({ role: ChatRole.SYSTEM, type: ChatEntryType.SYSTEM, content: message, timestamp: new Date().toISOString() });
    };

    if (clockResult.advanced) {
      const rationale = parsed?.time_cost_rationale || '本次行动推进了调查。';
      const currentMinutes = Number(clockResult.currentTime.slice(0, 2)) * 60 + Number(clockResult.currentTime.slice(3));
      const remainingMinutes = Math.max(0, 360 - currentMinutes);
      const timeMessage = `【第${session.scenarioClock.turn}回合 · 耗时 ${clockResult.cost} 分钟 · 当前 ${clockResult.currentTime} · 距发车 ${Math.floor(remainingMinutes / 60)}小时${remainingMinutes % 60}分】${rationale}`;
      appendSystemMessage(timeMessage);
    }
    if (stateResult.crossedSuspicionState) {
      const suspicionMessage = `【怀疑度：${session.suspicion}/10 · ${stateResult.suspicionState.label}】${stateResult.suspicionState.effect}`;
      appendSystemMessage(suspicionMessage);
    }
    for (const evidence of stateResult.evidenceChanges || []) {
      const evidenceLabel = evidence.source || evidence.id;
      appendSystemMessage(evidence.secured
        ? `【证据已保全】${evidenceLabel}`
        : `【发现线索】${evidenceLabel}（尚未保全）`);
    }
    if (stateResult.locationChanged) {
      const locationMessage = `【移动】你现在位于：${stateResult.locationChanged.name}。`;
      appendSystemMessage(locationMessage);
    }
    for (const location of eventResult.revealedLocations || []) {
      const locationMessage = `【新地点已发现】${location.name}已加入地点列表。`;
      appendSystemMessage(locationMessage);
    }
    for (const event of clockResult.firedEvents || []) {
      const message = `【${event.at} 事件】${event.text}`;
      appendSystemMessage(message);
    }
    for (const location of clockResult.revealedLocations || []) {
      const locationMessage = `【新地点已发现】${location.name}已加入地点列表。`;
      appendSystemMessage(locationMessage);
    }
    const recommendation = parsed?.ending_recommendation;
    const truthProgress = scenarioProgressService.evaluateTruth(session);
    const playerChoiceReady = scenarioProgressService.canAcceptRecommendedEnding(session);
    const endingRecommended = playerChoiceReady && (
      Boolean(recommendation?.should_end) || truthProgress.truthProvable
    );
    return {
      scenarioDeadlineReached: Boolean(clockResult.deadlineReached),
      endingRecommended,
      endingReason: endingRecommended ? recommendation.reason : (clockResult.deadlineReached ? 'deadline' : null),
      scenarioMessages,
      truthProgress,
      eventResolution: eventResult.event
        ? { id: eventResult.event.id, outcome: eventResult.event.outcome, aftermath: Boolean(eventResult.aftermath) }
        : null,
    };
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
    // 保存最近一次 doCall 的诊断信息（finish_reason 等），供 tryRefine 在解析失败时使用
    // 必须在 doCall 定义之前声明，否则 doCall 内部赋值会触发 TDZ（暂时性死区）
    let lastDiagnostic = null;

    const doCall = async (assembledPrompt) => {
      attemptNum++;
      session.subState = SubState.LLM_STREAMING;
      this.repository.save(session);

      this._pushDebug(debugLogs, onDebug, {
        type: 'debug_prompt',
        flowType,
        attempt: attemptNum,
        systemInstruction: assembledPrompt.messages[0]?.content || '',
        // 方案 B+：消息可能含 tool_calls 结构，需要正确渲染
        // - tool_calls 消息：content=null，但有 tool_calls 字段 → 显示函数名 + arguments
        // - tool 消息：tool_call_id + content（通常为空）→ 显示 tool_call_id
        // - 普通消息：直接显示 content
        userContent: assembledPrompt.messages.slice(1).map(m => {
          if (m.tool_calls) {
            const tc = m.tool_calls[0];
            const argsPreview = tc.function.arguments.length > 200
              ? tc.function.arguments.slice(0, 200) + '...(' + tc.function.arguments.length + ' chars)'
              : tc.function.arguments;
            return `[${m.role}] tool_calls: ${tc.function.name}(${argsPreview})`;
          }
          if (m.tool_call_id) {
            return `[${m.role}] tool_call_id=${m.tool_call_id}, content=${JSON.stringify(m.content)}`;
          }
          return `[${m.role}] ${m.content}`;
        }).join('\n'),
      });

      // 重试沿用本次 assembled 的模型/思考配置；Flash 默认由 provider 关闭思考，
      // pro 或显式 LLM_THINKING_TYPE=enabled 则保留 reasoning_effort='high'。
      // 思考模式不能传 tool_choice，非思考模式由 provider 使用 required 强制 function。
      // 若思考被 max_tokens 截断（finish_reason=length），直接抛错让用户感知，由其调大 max_tokens
      const llmStartedAt = Date.now();
      const result = await this.llmProvider.generate(assembledPrompt);
      const latencyMs = Date.now() - llmStartedAt;
      const raw = result.content;
      lastReasoningContent = result.reasoningContent;

      const effectiveModel = assembledPrompt.modelOverride || this.llmProvider.model || 'default';
      const thinkingUsed = result.thinkingEnabled ?? Boolean(result.reasoningContent);
      this._pushDebug(debugLogs, onDebug, {
        type: 'system',
        flowType,
        attempt: attemptNum,
        content: `[LLM] ${effectiveModel} · ${latencyMs}ms · thinking=${thinkingUsed ? 'enabled' : 'disabled'} · tool_calls=${result.hasToolCall ? 'yes' : 'no'}`,
      });

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

      // 保存诊断信息到闭包变量，供 tryRefine 在解析失败时使用
      lastDiagnostic = {
        finishReason: result._diagnostic?.finishReason || result.finishReason || 'unknown',
        hasToolCall: result.hasToolCall,
      };

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
      // 记录详细诊断信息：raw 内容 + 字段名 + 字段值类型 + 尾部内容 + finish_reason
      // 用于排查"LLM 看起来按格式输出但系统判错"的场景
      //   - raw 尾部 200 字符：判断是否被截断（未闭合的 JSON）
      //   - finish_reason：'length' 表示 max_tokens 不足，'stop' 表示正常结束
      //   - hasToolCall：false 表示 strict 失效，走 content 兜底（content 可能不完整）
      const rawLen = (rawText || '').length;
      const rawHead = (rawText || '').slice(0, 500);
      const rawTail = (rawText || '').slice(-200);
      const finishReason = lastDiagnostic?.finishReason || 'unknown';
      const hasToolCall = lastDiagnostic?.hasToolCall ? 'yes' : 'no';
      if (!parsed) {
        this._pushDebug(debugLogs, onDebug, {
          type: 'parse_fail',
          flowType,
          attempt: attemptNum,
          content: `JSON 解析失败。raw 长度=${rawLen} | finish_reason=${finishReason} | hasToolCall=${hasToolCall}\n【raw 前 500 字符】\n${rawHead}\n【raw 尾部 200 字符】\n${rawTail}`,
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

      // 专门针对 token 截断（finish_reason=length）的显式抛出
      // 场景：思考模式 + reasoning_effort 过高时，reasoning_content 消耗全部 max_tokens，
      //       导致 tool_calls.arguments 或 content 被截断，JSON 无法闭合 → 解析失败
      // 动机：用户要求在 god's eye 里对 token 截断问题加专门抛出，便于一眼定位根因
      if (finishReason === 'length') {
        this._pushDebug(debugLogs, onDebug, {
          type: 'system',
          flowType,
          attempt: attemptNum,
          content:
            `⚠️ Token 截断 detected（finish_reason=length）\n` +
            `根本原因：max_tokens 不足，LLM 输出被强制截断（思考模式下 reasoning_content 与 tool_calls.arguments 共享 max_tokens 配额）。\n` +
            `现象：raw 长度=${rawLen}，JSON 未闭合或必需字段 "${requiredField}" 未输出完。\n` +
            `诊断：hasToolCall=${hasToolCall}（yes=tool_calls.arguments 被截断；no=strict 失效走 content 且 content 被截断）\n` +
            `【raw 尾部 200 字符】\n${rawTail}\n` +
            `解决建议：\n` +
            `  1. 增大 FLOW_MAX_TOKENS[${flowType}]（当前值见 PromptTemplateRegistry.js）\n` +
            `  2. 或降低 FLOW_REASONING_EFFORT[${flowType}]（high→默认，减少思考消耗）\n` +
            `  3. 或精简 prompt / 历史消息长度，减少输入 token 占用`,
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

    // 第二次重试：继续沿用当前模型的思考配置，并追加更强的 reminder。
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

  _captureTurnRollback(session) {
    return structuredClone({
      chatRecord: session.chatRecord || [],
      displayLog: session.displayLog || [],
      optionBuffer: session.optionBuffer || '',
      locations: session.locations || [],
      npcs: session.npcs || [],
      inventory: session.inventory || [],
      scenarioClock: session.scenarioClock,
      playerLocationId: session.playerLocationId,
      scheduledEvents: session.scheduledEvents || [],
      activeScene: session.activeScene,
      scenarioFlags: session.scenarioFlags || {},
      evidence: session.evidence || [],
      suspicion: session.suspicion,
      combat: session.combat,
      sanity: session.sanity,
    });
  }

  _restoreTurnRollback(session, rollback) {
    if (!rollback) return false;
    for (const key of Object.keys(rollback)) session[key] = structuredClone(rollback[key]);
    return true;
  }

  // ── Dice 分支处理 ──

  async _handleDiceBranch(
    session,
    actionsResult,
    reasoningContent,
    debugLogs,
    onDebug,
    sourceFlowType,
    turnRollback = null
  ) {
    const previousPending = session.pendingDiceFlow;
    const parsed = actionsResult.parsed || jsonOutputParser.parse(actionsResult.raw);
    session.subState = SubState.DICE_PENDING;
    // 计算 hasS：actions 数组中是否含 sancheck
    const actions = actionsResult.actions || [];
    const hasS = actions.some(a => {
      const type = a[ACTION_TYPE] || a.type;
      return type === SANCHECK;
    });
    session.pendingDiceFlow = {
      actions: actionsResult.actions,
      pendingRaw: actionsResult.raw,
      // 保存该轮次的 reasoning_content（DeepSeek 官方要求：工具调用轮次后续必须回传，否则 API 400）
      pendingReasoningContent: reasoningContent || null,
      // 保存来源 flowType，_executeDice 推入 chatRecord 时使用（避免硬编码 NARRATION_I）
      sourceFlowType: sourceFlowType || FlowType.NARRATION_I,
      turnRuling: previousPending?.turnRuling || {
        time_cost_minutes: parsed?.time_cost_minutes,
        time_cost_rationale: parsed?.time_cost_rationale || '',
        current_location_id: parsed?.current_location_id || '',
      },
      rollbackState: previousPending?.rollbackState || turnRollback || null,
      rollbackChatLen: session.chatRecord.length,
      rollbackDisplayLen: (session.displayLog || []).length,
      // 新增：弹窗阶段状态机
      dialogStage: DIALOG_A_CONFIRM,
      hasS,
    };
    this.repository.save(session);

    // 保留 refinedHtml，让前端 _renderLlmResponse 能渲染 narration + actions 提示
    return {
      branch: 'DICE_AWAITING',
      actions: actionsResult.actions,
      refinedHtml: actionsResult.refinedHtml,
    };
  }

  async confirmDice(sessionId, { onDebug, onSystemMessage } = {}) {
    const session = this.getSession(sessionId);
    if (!session.pendingDiceFlow || session.subState !== SubState.DICE_PENDING) {
      throw new Error('当前无待确认的掷骰');
    }

    const { actions, pendingRaw, dialogStage, hasS } = session.pendingDiceFlow;

    // === A→B 状态机 ===
    // A_CONFIRM 阶段：检查是否需要 B 二次弹窗
    if (dialogStage === DIALOG_A_CONFIRM) {
      if (hasS) {
        // 有 sancheck：切换到 B_SANCHECK_CONFIRM，返回 B_SANCHECK_AWAITING 让前端弹 B1
        session.pendingDiceFlow.dialogStage = DIALOG_B_SANCHECK_CONFIRM;
        this.repository.save(session);
        return {
          session: session.toClientJSON(),
          result: { branch: BRANCH_B_SANCHECK_AWAITING },
        };
      }
      // 无 sancheck：直接进入 EXECUTING
      session.pendingDiceFlow.dialogStage = DIALOG_EXECUTING;
    } else if (dialogStage === DIALOG_B_SANCHECK_CONFIRM) {
      // B 确认后：进入 EXECUTING
      session.pendingDiceFlow.dialogStage = DIALOG_EXECUTING;
    } else if (dialogStage === DIALOG_EXECUTING) {
      throw new Error('掷骰已在执行中，不应再次确认');
    }

    session.subState = SubState.LLM_STREAMING;
    this.repository.save(session);

    try {
      const execResult = await this._executeDice(
        session,
        actions,
        pendingRaw,
        onDebug,
        onSystemMessage
      );
      // 系统消息已通过 onSystemMessage 实时推送给前端，不再在 done 事件里重复返回
      return {
        session: session.toClientJSON(),
        result: execResult,
        actions: execResult.actions,
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

    const { rollbackChatLen, rollbackDisplayLen, rollbackState } = session.pendingDiceFlow;

    const restored = this._restoreTurnRollback(session, rollbackState);
    if (!restored && session.chatRecord.length > rollbackChatLen) {
      session.chatRecord.length = rollbackChatLen;
    }
    if (!restored && session.displayLog && session.displayLog.length > rollbackDisplayLen) {
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

  async _executeDice(session, actions, pendingRaw, onDebug, onSystemMessage) {
    // 用户已确认 —— 将本次触发 actions 的 narration 和【】写入 chatRecord
    // 方案 B：pendingParsed 带 parsed + flowType，让历史 assistant 消息呈 tool_calls 结构
    const pendingParsed = jsonOutputParser.parse(pendingRaw);
    // 从 pendingDiceFlow 取回该轮次的 reasoning_content 和来源 flowType
    // DeepSeek 官方要求：思考模式下工具调用轮次的 reasoning_content 在后续所有请求中必须回传，否则 API 400
    const pendingFlow = session.pendingDiceFlow;
    const pendingReasoningContent = pendingFlow?.pendingReasoningContent || null;
    const sourceFlowType = pendingFlow?.sourceFlowType || FlowType.NARRATION_I;
    const turnRuling = pendingFlow?.turnRuling || {
      time_cost_minutes: pendingParsed?.time_cost_minutes,
      time_cost_rationale: pendingParsed?.time_cost_rationale || '',
      current_location_id: pendingParsed?.current_location_id || '',
    };

    // 清空遗留的 optionBuffer（与 cancelDice 一致，避免确认路径残留上一轮 options）
    session.optionBuffer = '';

    if (pendingParsed?.narration) {
      const pendingEntry = {
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: pendingParsed.narration,
        parsed: pendingParsed,
        flowType: sourceFlowType,
        timestamp: new Date().toISOString(),
      };
      // 附加 reasoning_content，使 chatRecordToMessages 能注入到 assistant 消息中回传给 API
      if (pendingReasoningContent) {
        pendingEntry.reasoningContent = pendingReasoningContent;
      }
      session.chatRecord.push(pendingEntry);
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

    // 补充处理 pendingParsed 中的实体更新（npcs/locations/items）
    // OutputProcessor 的 ACTIONS 分支跳过了 applyNarrative，此处补调以恢复实体更新
    // skipChatRecord=true 避免重复推入 chatRecord（上方已手动推入以附加 reasoningContent）
    if (pendingParsed) {
      entityUpdater.applyNarrative(session, pendingParsed, pendingRaw, sourceFlowType, { skipChatRecord: true });
    }

    // 调用 DamageResolver 处理 actions 数组（掷骰 + HP/SAN 计算 + 系统消息生成）
    const damageResult = damageResolver.resolve(session, { actions });

    // SSE 推送系统判定消息（在 LLM 调用前，让用户在 LLM 回复前就能看到判定结果）
    for (const msg of damageResult.systemMessages) {
      this._pushDisplay(session, 'system', msg);
      if (onSystemMessage) {
        try { onSystemMessage(msg); } catch { /* 回调异常不影响主流程 */ }
      }
      session.chatRecord.push({
        role: ChatRole.SYSTEM,
        type: ChatEntryType.SYSTEM,
        content: msg,
        timestamp: new Date().toISOString(),
      });
    }

    // 检查是否触发结局（玩家 HP/SAN 清零 → 跳过 NARRATION_II，进入结局流程）
    if (damageResult.playerDied) {
      scheduleService.commitActiveScene(session);
      return await this._triggerEnding(session, damageResult, onDebug, onSystemMessage);
    }

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

    this._pushDisplay(session, 'kp', refinedHtml);

    const parsed = jsonOutputParser.parse(raw);
    let result = outputProcessor.process(FlowType.NARRATION_II, session, parsed, raw);
    result.debugLogs = debugLogs;
    result.refinedHtml = refinedHtml;

    // NARRATION_II 输出 actions 时，不推入 bracket（延迟到用户确认后由 _executeDice 推入）
    // 与 _runLlmFlow 的 ACTIONS 分支处理保持一致，避免取消掷骰后 bracket 残留
    if (result.branch !== 'ACTIONS') {
      const bracketFallback = this._extractBracketOutsideNarration(raw);
      if (bracketFallback) {
        session.chatRecord.push({
          role: ChatRole.KP,
          type: ChatEntryType.NARRATION,
          content: bracketFallback,
          timestamp: new Date().toISOString(),
        });
      }

      // 持久化 reasoning_content 到最近推入 chatRecord 的 KP 条目（1:1 精确匹配）
      if (reasoningContent) {
        const lastKpEntry = [...session.chatRecord].reverse().find(
          e => e.role === ChatRole.KP && e.parsed && e.flowType
        );
        if (lastKpEntry && !lastKpEntry.reasoningContent) {
          lastKpEntry.reasoningContent = reasoningContent;
        }
      }
    }

    this.repository.save(session);

    // 递归检测：从 'DICE' 改为 'ACTIONS'（与 OutputProcessor 返回值一致）
    while (result.branch === 'ACTIONS') {
      // NARRATION_II 返回 ACTIONS 时，同样需要保存该轮次的 reasoning_content
      const diceCheck = await this._handleDiceBranch(
        session,
        result,
        reasoningContent,
        debugLogs,
        onDebug,
        FlowType.NARRATION_II,
        pendingFlow?.rollbackState || null
      );
      if (diceCheck.branch === 'DICE_AWAITING') {
        return diceCheck;
      }
      result = diceCheck;
    }

    // 只有检定和承接叙事都完成后才一次性结算场景与时钟。这样截止时间
    // 不会吞掉玩家已经确认的掷骰，证据也不会在检定结果出来前提前授予。
    let scenarioResult = { scenarioMessages: [] };
    if (result.branch === 'NARRATIVE' && result.parsed) {
      const finalRuling = {
        ...result.parsed,
        time_cost_minutes: turnRuling.time_cost_minutes,
        time_cost_rationale: turnRuling.time_cost_rationale,
        current_location_id: result.parsed.current_location_id || turnRuling.current_location_id || '',
      };
      scenarioResult = this._applyScenarioRuling(session, finalRuling);
    }

    if (scenarioResult.scenarioDeadlineReached || scenarioResult.endingRecommended) {
      const endingResult = await this._triggerEnding(
        session,
        null,
        onDebug,
        onSystemMessage,
        scenarioResult.endingReason
      );
      // Both pieces are already persisted separately in displayLog. Combine them
      // only for this live response so the player sees the resolved action before
      // the ending instead of apparently jumping straight to the epilogue.
      endingResult.refinedHtml = `${result.refinedHtml || ''}${endingResult.refinedHtml || ''}`;
      endingResult.scenarioMessages = scenarioResult.scenarioMessages;
      return endingResult;
    }

    // NARRATION_II 输出后触发摘要检查（与 handleMessage 的 LLM 调用后处理一致）
    if (session.chatRecord.length > 0) {
      await this.historySummarizer.checkAndRun(session);
    }

    session.pendingDiceFlow = null;
    session.subState = SubState.AWAITING_INPUT;
    this.repository.save(session);

    result.scenarioMessages = scenarioResult.scenarioMessages;
    return result;
  }

  /**
   * 触发结局流程。
   * 1. 推送结局触发系统消息
   * 2. 设置 ENDING_PENDING 状态
   * 3. 调用 ENDING_GEN flow 生成结局文本
   * 4. 设置 RESTART_PENDING 状态
   */
  async _triggerEnding(session, damageResult, onDebug, onSystemMessage, explicitReason = null) {
    const debugLogs = [];

    // 1. 推送结局触发消息
    const player = session.npcs.find(n => n.id === 'npc_000');
    const triggerMsg = explicitReason
      ? `【故事进入结局判定：${explicitReason === 'deadline' ? '06:00已到，雾港号即将恢复通行' : explicitReason}】`
      : endingService.buildEndingTriggerMessage(player);
    this._pushDisplay(session, 'system', triggerMsg);
    if (onSystemMessage) {
      try { onSystemMessage(triggerMsg); } catch {}
    }
    session.chatRecord.push({
      role: ChatRole.SYSTEM,
      type: ChatEntryType.SYSTEM,
      content: triggerMsg,
      timestamp: new Date().toISOString(),
    });

    // 2. 设置 ENDING_PENDING 状态
    session.subState = SubState.ENDING_PENDING;
    session.endingState = {
      reason: explicitReason || endingService.getEndingType(player),
      endingType: scenarioProgressService.chooseEndingType(session, explicitReason),
      playerChoice: session.finalChoice || null,
      evidenceSummary: (session.evidence || []).filter(e => e.secured).map(e => e.id),
      truthProgress: scenarioProgressService.evaluateTruth(session),
    };
    this.repository.save(session);

    // 3. 调用 ENDING_GEN flow
    const assembled = inputAssembler.assemble(FlowType.ENDING_GEN, session, {});
    const { raw, refinedHtml, reasoningContent } = await this._callLLMWithRetry(
      session, assembled, FlowType.ENDING_GEN, debugLogs, onDebug
    );

    // 处理结局文本（解析 LLM 输出）
    const endingParsed = jsonOutputParser.parse(raw);
    const endingText = endingParsed?.ending_text || '故事到此结束。';
    const endingType = session.endingState.endingType || endingParsed?.ending_type || (explicitReason ? 'withdrawal' : 'death');
    session.endingState.playerChoice = session.finalChoice || endingParsed?.player_choice || null;

    // 使用 TextRefiner 渲染结局文本（统一 escape/markdown/<br> 处理）
    this._pushDisplay(session, 'kp', refinedHtml);
    if (endingParsed?.debrief) {
      const debrief = endingParsed.debrief;
      const debriefText = `【主持人复盘（含剧透）】\n隐藏真相：${debrief.hidden_plot || '—'}\n重要事件：${(debrief.important_events || []).join('；') || '—'}\n实际使用的证据：${(debrief.evidence_used || []).join('；') || '—'}\n错过线索：${(debrief.missed_leads || []).join('；') || '—'}\n下次可尝试：${debrief.next_try || '—'}`;
      this._pushDisplay(session, 'system', debriefText);
    }
    const endingEntry = {
      role: ChatRole.KP,
      type: ChatEntryType.NARRATION,
      content: endingText,
      parsed: endingParsed,
      flowType: FlowType.ENDING_GEN,
      timestamp: new Date().toISOString(),
    };
    // 持久化 reasoning_content 到该 KP 条目（1:1 精确匹配，后续轮次回传）
    if (reasoningContent) {
      endingEntry.reasoningContent = reasoningContent;
    }
    session.chatRecord.push(endingEntry);

    // 4. 设置 RESTART_PENDING 状态
    session.subState = SubState.RESTART_PENDING;
    session.pendingDiceFlow = null;
    this.repository.save(session);

    return { debugLogs, endingTriggered: true, endingText, endingType, refinedHtml };
  }

  /**
   * 重启故事（用户点"是"后调用）。
   * 委托 EndingService 执行重启流程，并推送 displayLog 让前端能看到新开幕。
   */
  restartStory(sessionId) {
    const session = this.getSession(sessionId);
    // 预设试炼的“再试一次”始终创建新会话，避免覆盖当前结局或自由剧本存档。
    if (session.scenarioId) return this.createBirchStationTutorial();
    endingService.restartStory(session);

    // 推送 displayLog（EndingService 只写 chatRecord，displayLog 由 orchestrator 统一管理）
    this._pushDisplay(session, 'player', '请重新开启一轮故事，世界观与主要人设不变');
    const cache = session.storyOpeningCache;
    if (cache?.parsed) {
      const refined = textRefiner.refine(FlowType.STORY_OPENING, cache.parsed);
      this._pushDisplay(session, 'kp', refined.html);
    }

    this.repository.save(session);
    return { session: session.toClientJSON() };
  }
}
