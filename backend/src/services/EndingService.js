import { Phase, SubState, FlowType, ChatRole, ChatEntryType } from '../domain/enums.js';

/**
 * 结局触发与重启服务。
 * 职责：
 * - 检测玩家 HP/SAN 是否清零（触发结局）
 * - 执行重启流程（恢复初始状态 + 删除普通 NPC + 重发故事开幕）
 *
 * 设计动机：
 * - 仅玩家清零触发结局，NPC 清零只标记 departed
 * - 重启保留对话记忆（chatRecord 不删除），给用户呼应感
 * - 玩家/关键角色状态回退到 storyOpeningCache 时的初始值
 */
export class EndingService {
  /**
   * 检测是否应触发结局（仅玩家 npc_000 清零）。
   */
  shouldTriggerEnding(session) {
    const player = session.npcs.find(n => n.id === 'npc_000');
    if (!player) return false;
    return (player.hp !== null && player.hp <= 0) ||
           (player.san !== null && player.san <= 0);
  }

  /**
   * 获取结局类型。
   * @param {Object} player - npc_000 条目
   * @returns {'death' | 'madness'}
   */
  getEndingType(player) {
    // HP 优先（同时清零时按死亡处理）
    if (player.hp !== null && player.hp <= 0) return 'death';
    return 'madness';
  }

  /**
   * 生成结局触发的系统消息。
   */
  buildEndingTriggerMessage(player) {
    const type = this.getEndingType(player);
    if (type === 'death') {
      return '【玩家HP归零，触发死亡结局】';
    }
    return '【玩家SAN归零，触发疯狂结局】';
  }

  /**
   * 执行重启流程（不删除对话记录）。
   * 1. 恢复玩家/关键角色初始状态（从 characterInitialStats）
   * 2. 删除普通 NPC（id > npc_00X）
   * 3. 清除 locations/inventory
   * 4. 重置 phase/subState
   * 5. 注入故事开幕消息
   */
  restartStory(session) {
    // 1. 恢复玩家/关键角色初始状态
    const stats = session.characterInitialStats || [];
    for (const stat of stats) {
      const npc = session.npcs.find(n => n.id === stat.npcId);
      if (npc) {
        npc.hp = stat.hp;
        npc.maxHp = stat.maxHp;
        npc.san = stat.san;
        npc.maxSan = stat.maxSan;
        npc.currentState = stat.currentState || '';
        npc.status = 'active';
      }
    }

    // 2. 删除普通 NPC（保留 npc_000~00X，X = keyCharacters.length）
    const keyCharCount = session.keyCharacters?.length || 0;
    const preserveFloor = keyCharCount; // 保留 npc_000~00X
    session.npcs = session.npcs.filter(n => {
      const num = parseInt(n.id.replace('npc_', ''), 10);
      return num <= preserveFloor;
    });

    // 3. 清除 locations/inventory
    session.locations = [];
    session.inventory = [];

    // 4. 重置状态
    session.phase = Phase.STORY_PLAY;
    session.subState = SubState.AWAITING_INPUT;
    session.optionBuffer = '';
    session.pendingDiceFlow = null;
    session.activeScene = null;
    session.combat = null;
    session.finalChoice = null;
    session.endingState = null;
    session.finaleState = null;

    // 5. 注入故事开幕消息
    this.injectStoryOpeningMessages(session);
  }

  /**
   * 注入故事开幕消息到 chatRecord（方案 B+ tool_calls 结构）。
   * - 写入 user 消息："请重新开启一轮故事..."
   * - 写入 assistant 消息：从 storyOpeningCache 恢复（带 parsed + flowType）
   */
  injectStoryOpeningMessages(session) {
    if (!session.storyOpeningCache) {
      throw new Error('无法重启：storyOpeningCache 为空');
    }

    // user 消息：重启指示
    session.chatRecord.push({
      role: ChatRole.PLAYER,
      type: ChatEntryType.PROMPT,
      content: '请重新开启一轮故事，世界观与主要人设不变',
      timestamp: new Date().toISOString(),
    });

    // assistant 消息：故事开幕（带 parsed + flowType，方案 B+）
    const cache = session.storyOpeningCache;
    session.chatRecord.push({
      role: ChatRole.KP,
      type: ChatEntryType.NARRATION,
      content: cache.parsed?.narration || cache.raw || '',
      parsed: cache.parsed,
      flowType: FlowType.STORY_OPENING,
      timestamp: cache.timestamp || new Date().toISOString(),
    });
  }
}

export const endingService = new EndingService();
