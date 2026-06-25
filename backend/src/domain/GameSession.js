import { Phase, SubState } from './enums.js';

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
    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();
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
      this.subState === SubState.SUMMARIZING
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
