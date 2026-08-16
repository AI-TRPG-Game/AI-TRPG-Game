import { Phase, SubState } from './enums.js';
import { BIRCH_STATION_ID, BIRCH_STATION_TUTORIAL } from '../scenarios/birchStation.js';

const RECOVERABLE_SUB_STATES = new Set([
  SubState.LLM_STREAMING,
  SubState.SUMMARIZING,
]);

export class GameSession {
  constructor(data = {}) {
    this.id = data.id ?? null;
    this.title = data.title ?? '新剧本';
    this.phase = data.phase ?? Phase.WORLD_SETTING;
    this.subState = data.subState ?? SubState.AWAITING_INPUT;
    this.openingDone = data.openingDone ?? false;
    this.worldSettings = data.worldSettings ?? '';
    this.player = data.player ?? '';
    this.keyCharacters = data.keyCharacters ?? [];
    this.keyCharacterIndex = data.keyCharacterIndex ?? 0;
    this.chatRecord = data.chatRecord ?? [];
    this.setupHistory = data.setupHistory ?? { world: [], character: [] };
    this.keyCharSetupHistory = data.keyCharSetupHistory ?? [];
    this.displayLog = data.displayLog ?? [];
    this.optionBuffer = data.optionBuffer ?? '';
    this.locations = data.locations ?? [];
    this.npcs = data.npcs ?? [];
    this.inventory = data.inventory ?? [];
    this.pendingDiceFlow = data.pendingDiceFlow ?? null;
    // === HP/SAN 机制新增字段 ===
    this.storyOpeningCache = data.storyOpeningCache ?? null;          // 故事开幕缓存（结局重置时重新发送）
    this.characterInitialStats = data.characterInitialStats ?? null;  // 玩家/关键角色初始状态缓存（结局重置时恢复）
    // 思考模式 reasoning_content 缓存（DeepSeek 要求后续轮次回传，必须跨 session 刷新持久化）
    this.recentReasoningContents = Array.isArray(data.recentReasoningContents)
      ? data.recentReasoningContents.slice(-10)
      : [];
    // 剧本驱动状态。普通自由剧本保持 null / 空数组，保证旧存档兼容。
    this.scenarioId = data.scenarioId ?? null;
    this.scenarioRules = data.scenarioRules ?? null;
    this.scenarioClock = data.scenarioClock ?? null;
    this.playerLocationId = data.playerLocationId ?? null;
    this.sanity = data.sanity ?? null;
    this.scheduledEvents = Array.isArray(data.scheduledEvents) ? data.scheduledEvents : [];
    this.evidence = Array.isArray(data.evidence) ? data.evidence : [];
    this.suspicion = Number.isFinite(data.suspicion) ? data.suspicion : 0;
    this.combat = data.combat ?? null;
    this.endingState = data.endingState ?? null;
    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();

    // === 数据迁移（向后兼容旧格式） ===
    this._migrateLegacyData();
  }

  /**
   * 迁移旧格式数据到新格式。
   * - 旧 session.npcs 元素可能缺少 hp/san/maxHp/maxSan/visibility/status/attributes 字段
   * - 旧 session 可能有 session.player 但无 npc_000 条目
   * - 旧 npc.importance 可能为 'background'（已移除的枚举值），需清理
   * 迁移是幂等的：已是新格式的数据不会受影响。
   */
  _migrateLegacyData() {
    if (!this.npcs) this.npcs = [];

    // 1. 确保 npc 元素有完整的 hp/san/visibility/status/attributes 字段
    for (const npc of this.npcs) {
      if (npc.hp === undefined) npc.hp = null;
      if (npc.maxHp === undefined) npc.maxHp = null;
      if (npc.san === undefined) npc.san = null;
      if (npc.maxSan === undefined) npc.maxSan = null;
      if (!npc.visibility) npc.visibility = 'visible';
      if (!npc.status) npc.status = 'active';
      if (npc.attributes === undefined) npc.attributes = null;
      // 清理已移除的 background 枚举值（旧数据可能有）
      if (npc.importance === 'background') {
        // background 角色本不应进入 npcs 数组，迁移时降级为 supporting
        npc.importance = 'supporting';
      }
    }

    // 2. 确保 npc_000 存在（如果 session.player 存在但 npc_000 不在 npcs 数组中）
    //    姓名/HP/SAN 从 session.player 字符串中解析（_serializeCharacterCard 格式：首行"姓名：XXX"）
    //    如果解析失败，姓名默认"玩家"，HP/SAN 默认 10/50
    //    已存在的 npc_000 若 name 仍为占位"玩家"，也尝试从 player 字符串补全真实姓名
    const playerNpc = this.npcs.find(n => n.id === 'npc_000');
    if (!playerNpc && this.player) {
      const nameMatch = String(this.player).match(/姓名[::]\s*([^\n]+)/);
      const hpMatch = String(this.player).match(/HP[::]\s*(\d+)/i);
      const sanMatch = String(this.player).match(/SAN[::]\s*(\d+)/i);
      const name = nameMatch ? nameMatch[1].trim() : '玩家';
      const hp = hpMatch ? parseInt(hpMatch[1], 10) : 10;
      const san = sanMatch ? parseInt(sanMatch[1], 10) : 50;
      this.npcs.unshift({
        id: 'npc_000',
        name,
        baseDescription: '',
        currentState: '',
        importance: 'player',
        hp, maxHp: hp,
        san, maxSan: san,
        visibility: 'visible',
        status: 'active',
        attributes: null,  // 玩家属性从角色卡取，不在此迁移
        firstSeenAt: 0,
        lastUpdatedAt: 0,
      });
    } else if (playerNpc && playerNpc.name === '玩家' && this.player) {
      const nameMatch = String(this.player).match(/姓名[::]\s*([^\n]+)/);
      if (nameMatch && nameMatch[1].trim()) playerNpc.name = nameMatch[1].trim();
    }

    // 3. 确保新增的缓存字段存在
    if (this.storyOpeningCache === undefined) this.storyOpeningCache = null;
    if (this.characterInitialStats === undefined) this.characterInitialStats = null;
    if (this.scenarioClock && !Number.isInteger(this.scenarioClock.turn)) {
      this.scenarioClock.turn = 0;
    }
    this.suspicion = Math.max(0, Math.min(10, Number(this.suspicion) || 0));
    if (this.sanity && typeof this.sanity !== 'object') this.sanity = null;
    if (!this.playerLocationId && this.scenarioRules?.initialLocationId) {
      this.playerLocationId = this.scenarioRules.initialLocationId;
    }
    this._migrateBirchStationLocations();

    // 4. 迁移 pendingDiceFlow（新增 dialogStage / hasS 字段）
    if (this.pendingDiceFlow) {
      if (this.pendingDiceFlow.dialogStage === undefined) {
        // 旧数据默认处于 A 阶段（用户尚未确认）
        this.pendingDiceFlow.dialogStage = 'A_CONFIRM';
      }
      if (this.pendingDiceFlow.hasS === undefined) {
        // 根据现有 actions 推断是否含 sancheck
        this.pendingDiceFlow.hasS = (this.pendingDiceFlow.actions || [])
          .some(a => a.action_type === 'sancheck' || a.type === 'sancheck');
      }
      // 旧 actions 元素可能无 trigger 字段，保守默认为 'others'
      // （避免误判为 player 弹 A 弹窗，让用户重新确认更安全）
      if (Array.isArray(this.pendingDiceFlow.actions)) {
        for (const a of this.pendingDiceFlow.actions) {
          if (a.trigger === undefined) a.trigger = 'others';
        }
      }
    }
  }

  _migrateBirchStationLocations() {
    if (this.scenarioId !== BIRCH_STATION_ID) return;
    const authoredRules = BIRCH_STATION_TUTORIAL.scenarioRules;
    const oldRules = this.scenarioRules || {};
    const oldSanEvents = oldRules.sanEvents || {};
    this.scenarioRules = {
      ...authoredRules,
      ...oldRules,
      initialLocationId: oldRules.initialLocationId || authoredRules.initialLocationId,
      locationCatalog: oldRules.locationCatalog || authoredRules.locationCatalog,
      sanEvents: Object.fromEntries(Object.entries(authoredRules.sanEvents).map(([id, event]) => [
        id,
        { ...event, ...(oldSanEvents[id] || {}) },
      ])),
    };

    const scheduledById = new Map(BIRCH_STATION_TUTORIAL.scheduledEvents.map(event => [event.id, event]));
    this.scheduledEvents = (this.scheduledEvents || []).map(event => {
      const authored = scheduledById.get(event.id);
      return authored
        ? { ...authored, ...event, revealsLocations: event.revealsLocations ?? authored.revealsLocations ?? [] }
        : event;
    });

    if (!Array.isArray(this.locations)) this.locations = [];
    for (const event of this.scheduledEvents.filter(event => event.fired)) {
      for (const locationId of event.revealsLocations || []) {
        const location = this.scenarioRules.locationCatalog[locationId];
        if (location && !this.locations.some(entry => entry.id === locationId)) {
          this.locations.push({ id: locationId, ...location, firstSeenAt: 0, lastUpdatedAt: 0 });
        }
      }
    }
    if (!this.playerLocationId) this.playerLocationId = this.scenarioRules.initialLocationId;
  }

  isOpeningDone() {
    return this.openingDone;
  }

  getActiveSettings() {
    return {
      worldSettings: this.worldSettings,
      player: this.player, 
      keyCharacters: this.keyCharacters,
    };
  }

  getCurrentKeyCharSetupHistory() {
    if (!this.keyCharSetupHistory[this.keyCharacterIndex]) {
      this.keyCharSetupHistory[this.keyCharacterIndex] = [];
    }
    return this.keyCharSetupHistory[this.keyCharacterIndex];
  }

  isInputLocked() {
    return (
      this.subState === SubState.LLM_STREAMING ||
      this.subState === SubState.DICE_PENDING ||
      this.subState === SubState.SUMMARIZING ||
      this.subState === SubState.ENDING_PENDING ||
      this.subState === SubState.RESTART_PENDING
    );
  }

  touch() {
    this.updatedAt = new Date().toISOString();
  }

  recoverTransientState() {
    if (RECOVERABLE_SUB_STATES.has(this.subState)) {
      this.subState = SubState.AWAITING_INPUT;
      this.pendingDiceFlow = null;
    }
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      phase: this.phase,
      subState: this.subState,
      openingDone: this.openingDone,
      worldSettings: this.worldSettings,
      player: this.player, 
      keyCharacters: this.keyCharacters,
      keyCharacterIndex: this.keyCharacterIndex,
      chatRecord: this.chatRecord,
      setupHistory: this.setupHistory,
      keyCharSetupHistory: this.keyCharSetupHistory,
      displayLog: this.displayLog,
      optionBuffer: this.optionBuffer,
      locations: this.locations,
      npcs: this.npcs,
      inventory: this.inventory,
      pendingDiceFlow: this.pendingDiceFlow,
      storyOpeningCache: this.storyOpeningCache,
      characterInitialStats: this.characterInitialStats,
      recentReasoningContents: this.recentReasoningContents,
      scenarioId: this.scenarioId,
      scenarioRules: this.scenarioRules,
      scenarioClock: this.scenarioClock,
      playerLocationId: this.playerLocationId,
      sanity: this.sanity,
      scheduledEvents: this.scheduledEvents,
      evidence: this.evidence,
      suspicion: this.suspicion,
      combat: this.combat,
      endingState: this.endingState,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  toClientJSON() {
    const snapshot = this.toJSON();
    if (RECOVERABLE_SUB_STATES.has(snapshot.subState)) {
      snapshot.subState = SubState.AWAITING_INPUT;
      snapshot.pendingDiceFlow = null;
    }
    return snapshot;
  }
}
