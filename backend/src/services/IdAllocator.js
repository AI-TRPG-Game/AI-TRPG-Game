/**
 * IdAllocator —— 实体 ID 分配器（无状态工具类）。
 *
 * 设计：
 * - npcs 分区段：npc_000（玩家）/ npc_001~00X（已邀请关键角色，X=keyCharacters.length）/ npc_00(X+1)+（普通 NPC）
 * - locations 单段递增：loc_001, loc_002, ...
 * - items 单段递增：inv_001, inv_002, ...
 *
 * 无状态：每次调用时根据 session 中现有实体的最大编号动态计算下一个 id，
 * 这样无需在 session 中维护额外的计数器字段，存档恢复后也能正确继续编号。
 *
 * 旧数据迁移：`ensureXxxId` 系列方法用于给历史 session 中无 id 的实体补 id。
 */

const NPC_PLAYER_ID = 'npc_000';

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
   * 分配下一个邀请角色 NPC id（npc_001~00X，X=keyCharacters.length）。
   * 仅在 saveKeyCharacter 主动推入 session.npcs 时使用。
   */
  nextInvitedNpcId(session) {
    const keyCharCount = session.keyCharacters?.length || 0;
    const existingCount = session.npcs.filter((n) =>
      /^npc_0\d{2}$/.test(n?.id) && n.id !== NPC_PLAYER_ID
    ).length;
    return `npc_${pad3(existingCount + 1)}`;
  }

  /**
   * 分配新 NPC 的 id。
   * 起始编号 = keyCharCount + 1（000 是玩家，001~00X 是关键角色）。
   * 若 list 中已有更高编号，则继续递增。
   *
   * @param {Array} list - 当前的 npcs 数组（patch 副本）
   * @param {number} keyCharCount - 已邀请的关键角色数量（决定起始编号下限）
   * @returns {string} 如 'npc_004' 或 'npc_101'
   */
  nextNewNpcId(list, keyCharCount = 0) {
    const maxNum = maxIdNum(list, 'npc');
    // 起始编号下限：关键角色数量 + 1（如 3 个关键角色，普通 NPC 从 004 起）
    const floor = keyCharCount + 1;
    const nextNum = Math.max(maxNum + 1, floor);
    return `npc_${pad3(nextNum)}`;
  }

  /**
   * 获取关键角色 NPC 的编号上限（用于结局重置时确定删除范围）。
   * @param {number} keyCharCount - keyCharacters.length
   * @returns {number} 如 keyCharCount=3 → 返回 3（保留 npc_000~003）
   */
  getKeyCharNpcFloor(keyCharCount) {
    return keyCharCount;
  }

  /**
   * 为无 id 的旧 NPC 补 id（一次性迁移用）。
   * 启发式：name 匹配主角→npc_000；匹配邀请角色→npc_001~00X；否则→npc_00(X+1)+
   * 注意：迁移时直接 mutate session.npcs，所以传 session.npcs 给 nextNewNpcId 即可。
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
      if (idx >= 0) {
        return `npc_${pad3(idx + 1)}`;
      }
    }
    // 否则当作新角色
    const keyCharCount = session.keyCharacters?.length || 0;
    return this.nextNewNpcId(session.npcs, keyCharCount);
  }

  /**
   * 分配下一个地点 id（loc_001 起，单段递增）。
   * @param {Array} list - 当前 location 列表（接收 patch 副本，确保同批多个新实体 id 递增不重复）
   */
  nextLocationId(list) {
    return `loc_${pad3(maxIdNum(list, 'loc') + 1)}`;
  }

  /** 为无 id 的旧地点补 id */
  ensureLocationId(session, loc) {
    if (loc.id) return loc.id;
    return this.nextLocationId(session.locations);
  }

  /**
   * 分配下一个物品 id（inv_001 起，单段递增）。
   * @param {Array} list - 当前 inventory 列表（接收 patch 副本，确保同批多个新实体 id 递增不重复）
   */
  nextItemId(list) {
    return `inv_${pad3(maxIdNum(list, 'inv') + 1)}`;
  }

  /** 为无 id 的旧物品补 id */
  ensureItemId(session, item) {
    if (item.id) return item.id;
    return this.nextItemId(session.inventory);
  }
}

export const idAllocator = new IdAllocator();
