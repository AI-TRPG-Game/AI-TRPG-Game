/**
 * IdAllocator —— 实体 ID 分配器（无状态工具类）。
 *
 * 设计：
 * - npcs 分区段：npc_000（主角，逻辑预留）/ npc_001~003（已邀请角色，逻辑预留）/ npc_100+（新角色）
 * - locations 单段递增：loc_001, loc_002, ...
 * - items 单段递增：inv_001, inv_002, ...
 *
 * 无状态：每次调用时根据 session 中现有实体的最大编号动态计算下一个 id，
 * 这样无需在 session 中维护额外的计数器字段，存档恢复后也能正确继续编号。
 *
 * 旧数据迁移：`ensureXxxId` 系列方法用于给历史 session 中无 id 的实体补 id。
 */

const NPC_PLAYER_ID = 'npc_000';
const NPC_INVITED_MAX = 3;        // 邀请角色最多 003
const NPC_NEW_FLOOR = 100;        // 新角色起始编号（与邀请角色区段分离）

function pad3(n) {
  return String(n).padStart(3, '0');
}

/** 从实体列表中提取某前缀下的最大编号数字 */
function maxIdNum(list, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  for (const item of list) {
    if (!item?.id || typeof item.id !== 'string') continue;
    const m = item.id.match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
}

/** 从 session.player 字符串中提取主角姓名 */
function extractPlayerName(session) {
  const m = (session.player || '').match(/姓名：(.+)/);
  return m ? m[1].trim() : null;
}

/** 从 session.keyCharacters 字符串数组中提取邀请角色姓名列表 */
function extractInvitedNames(session) {
  return (session.keyCharacters || [])
    .map((c) => {
      const m = (c || '').match(/姓名：(.+)/);
      return m ? m[1].trim() : null;
    })
    .filter(Boolean);
}

export class IdAllocator {
  /** 主角 NPC id（固定为 npc_000，逻辑预留） */
  playerNpcId() {
    return NPC_PLAYER_ID;
  }

  /**
   * 分配下一个邀请角色 NPC id（npc_001~003）。
   * 仅在 saveKeyCharacter 主动推入 session.npcs 时使用；
   * 当前第一版修复不主动推入，故此方法主要用于未来扩展。
   */
  nextInvitedNpcId(session) {
    const existingCount = session.npcs.filter((n) =>
      /^npc_00[1-3]$/.test(n?.id)
    ).length;
    if (existingCount >= NPC_INVITED_MAX) {
      throw new Error('邀请角色超过上限 003');
    }
    return `npc_${pad3(existingCount + 1)}`;
  }

  /** 分配下一个新角色 NPC id（从 npc_100 起） */
  nextNewNpcId(session) {
    const maxNum = maxIdNum(session.npcs, 'npc');
    const nextNum = Math.max(maxNum + 1, NPC_NEW_FLOOR);
    return `npc_${pad3(nextNum)}`;
  }

  /**
   * 为无 id 的旧 NPC 补 id（一次性迁移用）。
   * 启发式：name 匹配主角→npc_000；匹配邀请角色→npc_001~003；否则→npc_100+
   */
  ensureNpcId(session, npc) {
    if (npc.id) return npc.id;
    const name = (npc.name || '').trim();
    if (name) {
      // 主角匹配
      const playerName = extractPlayerName(session);
      if (playerName && name === playerName) {
        return NPC_PLAYER_ID;
      }
      // 邀请角色匹配
      const invitedNames = extractInvitedNames(session);
      const idx = invitedNames.indexOf(name);
      if (idx >= 0 && idx < NPC_INVITED_MAX) {
        return `npc_${pad3(idx + 1)}`;
      }
    }
    // 否则当作新角色
    return this.nextNewNpcId(session);
  }

  /** 分配下一个地点 id（loc_001 起，单段递增） */
  nextLocationId(session) {
    return `loc_${pad3(maxIdNum(session.locations, 'loc') + 1)}`;
  }

  /** 为无 id 的旧地点补 id */
  ensureLocationId(session, loc) {
    if (loc.id) return loc.id;
    return this.nextLocationId(session);
  }

  /** 分配下一个物品 id（inv_001 起，单段递增） */
  nextItemId(session) {
    return `inv_${pad3(maxIdNum(session.inventory, 'inv') + 1)}`;
  }

  /** 为无 id 的旧物品补 id */
  ensureItemId(session, item) {
    if (item.id) return item.id;
    return this.nextItemId(session);
  }
}

export const idAllocator = new IdAllocator();
