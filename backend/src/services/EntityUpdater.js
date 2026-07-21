import { ChatRole, ChatEntryType } from '../domain/enums.js';
import {
  NARRATION, LOCATIONS, NPCS, ITEMS, HP, SAN, OPTIONS,
  ENTITY_NAME, ENTITY_DESC, ENTITY_ID, ENTITY_BASE_DESC, ENTITY_CURRENT_STATE, ITEM_STATUS,
} from '../domain/NarrativeSchema.js';
import { idAllocator } from './IdAllocator.js';

// ── 名字归一化与模糊匹配（兜底 LLM 忘填 id 的情况） ──

/**
 * 名字归一化：trim + 折叠空白 + 去常见尾缀敬称。
 * 不做全角/半角字母转换（中文场景下中文字符不应被改动）。
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.trim().replace(/\s+/g, '');
  // 去常见尾缀敬称（中英文）
  s = s.replace(
    /(先生|女士|小姐|博士|教授|君|老爷|夫人|老板|老板娘|大叔|大哥|大姐|老哥|同志|师傅|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)$/,
    ''
  );
  return s;
}

/**
 * 名字模糊匹配：归一化后严格相等优先；其次短包含（长度差 ≤ 2）。
 * 返回 list 中的下标，未匹配返回 -1。
 */
function findByNameFuzzy(list, name) {
  if (!name) return -1;
  const target = normalizeName(name);
  if (!target) return -1;

  // 优先：归一化后严格相等
  for (let i = 0; i < list.length; i++) {
    if (normalizeName(list[i]?.name) === target) return i;
  }

  // 其次：短包含（防止"张"误匹配"张三李四"）
  if (target.length >= 2) {
    for (let i = 0; i < list.length; i++) {
      const candidate = normalizeName(list[i]?.name);
      if (candidate.length < 2) continue;
      if (candidate === target) return i; // 已检查过，跳过
      const diff = Math.abs(candidate.length - target.length);
      if (diff <= 2 && (candidate.includes(target) || target.includes(candidate))) {
        return i;
      }
    }
  }
  return -1;
}

// ── 轮次号（用于 firstSeenAt / lastUpdatedAt） ──

function currentTurn(session) {
  // 用 chatRecord 长度作为伪轮次号——不严格对应玩家心智中的"第几轮"，
  // 但足以区分实体先后顺序，满足调试与未来上下文裁剪需求。
  return session.chatRecord?.length ?? 0;
}

// ── 实体合并/创建（按 entityType 分支） ──

/**
 * 合并 entry 到已有实体（不覆盖稳定字段）。
 * - npc: name/baseDescription 不覆盖；currentState 覆盖
 * - location/item: name 不覆盖；description 仅在新值非空时覆盖；item 的 status 同理
 */
function mergeEntity(existing, entry, entityType) {
  if (entityType === 'npc') {
    if (!existing.name && entry.name) existing.name = entry.name;
    if (!existing.baseDescription && entry.baseDescription) {
      existing.baseDescription = entry.baseDescription;
    }
    if (entry.currentState !== undefined && entry.currentState !== '') {
      existing.currentState = entry.currentState;
    }
    // importance：LLM 可以重新评估重要性（升级或降级）
    if (entry.importance) existing.importance = entry.importance;
  } else {
    if (!existing.name && entry.name) existing.name = entry.name;
    // 防护：新值非空才覆盖，避免 LLM 引用已有实体但未填描述时用空串覆盖原描述
    // 触发场景：LLM 输出已存在的 location/item 但 description 字段为 null/空，
    //          upsertEntity 调用处已把 null 兜底为 ''，若不加防护会清空已有描述
    if (entry.description) existing.description = entry.description;
    if (entityType === 'item' && entry.status) {
      existing.status = entry.status;
    }
  }
}

/** 创建新实体（带 id + firstSeenAt/lastUpdatedAt） */
function createNewEntity(entry, list, session, entityType) {
  const turn = currentTurn(session);
  if (entityType === 'npc') {
    return {
      id: idAllocator.nextNewNpcId(list),
      name: entry.name || '',
      baseDescription: entry.baseDescription ?? entry.description ?? '',
      currentState: entry.currentState ?? '',
      importance: entry.importance || 'supporting',   // 兜底默认值（不应触发，schema 已强制 enum）
      firstSeenAt: turn,
      lastUpdatedAt: turn,
    };
  }
  if (entityType === 'location') {
    return {
      id: idAllocator.nextLocationId(list),
      name: entry.name || '',
      description: entry.description ?? '',
      firstSeenAt: turn,
      lastUpdatedAt: turn,
    };
  }
  // item
  return {
    id: idAllocator.nextItemId(list),
    name: entry.name || '',
    status: entry.status ?? '已获得',
    description: entry.description ?? '',
    firstSeenAt: turn,
    lastUpdatedAt: turn,
  };
}

/**
 * 通用 upsert：按 id 优先匹配，name 模糊兜底，新实体分配 id。
 * @param {Array} list - 实体列表（patch 副本，新实体 push 后立即可见，确保同批 id 递增）
 * @param {Object} entry - LLM 输出的实体（可能含 id、name 等）
 * @param {Object} session
 * @param {'npc'|'location'|'item'} entityType
 */
function upsertEntity(list, entry, session, entityType) {
  // 1. 优先按 id 匹配
  if (entry.id) {
    const idx = list.findIndex((item) => item.id === entry.id);
    if (idx >= 0) {
      mergeEntity(list[idx], entry, entityType);
      list[idx].lastUpdatedAt = currentTurn(session);
      return list[idx];
    }
    // id 给了但找不到对应条目：LLM 可能误填了不存在的 id
    // → 走 name 兜底；若 name 也匹配不到，作为新实体（用 LLM 给的 id 推入）
  }

  // 2. name 模糊兜底（仅当 id 未命中或 id 缺失时）
  if (entry.name) {
    const idx = findByNameFuzzy(list, entry.name);
    if (idx >= 0) {
      mergeEntity(list[idx], entry, entityType);
      // 若 LLM 给了 id 且原实体无 id，补上
      if (entry.id && !list[idx].id) list[idx].id = entry.id;
      list[idx].lastUpdatedAt = currentTurn(session);
      return list[idx];
    }
  }

  // 3. 新实体
  const newEntity = createNewEntity(entry, list, session, entityType);
  // 若 LLM 显式给了 id（如误填 npc_001 引用不存在的邀请角色），保留其 id
  // 但要避免与现有 id 冲突
  if (entry.id && !list.some((item) => item.id === entry.id)) {
    newEntity.id = entry.id;
  }
  list.push(newEntity);
  return newEntity;
}

// ── 旧数据一次性迁移（首次进入叙事流程时触发） ──

/**
 * 给历史 session 中无 id 的实体补 id，给缺字段补默认值。
 * 直接 mutate session 中的实体列表，幂等。
 */
function ensureIdsForExistingEntities(session) {
  // locations
  for (const loc of session.locations) {
    if (!loc.id) loc.id = idAllocator.ensureLocationId(session, loc);
    if (loc.firstSeenAt === undefined) loc.firstSeenAt = 0;
    if (loc.lastUpdatedAt === undefined) loc.lastUpdatedAt = 0;
  }
  // items
  for (const item of session.inventory) {
    if (!item.id) item.id = idAllocator.ensureItemId(session, item);
    if (item.firstSeenAt === undefined) item.firstSeenAt = 0;
    if (item.lastUpdatedAt === undefined) item.lastUpdatedAt = 0;
  }
  // npcs（需先迁移，因为 ensureNpcId 会动态查询 session.npcs 中已分配的最大编号）
  for (const npc of session.npcs) {
    if (!npc.id) npc.id = idAllocator.ensureNpcId(session, npc);
    // 兼容旧 description 字段：迁移到 baseDescription
    if (npc.description !== undefined && npc.baseDescription === undefined) {
      npc.baseDescription = npc.description;
      delete npc.description;
    }
    if (npc.currentState === undefined) npc.currentState = '';
    // 兼容旧 session 无 importance 字段：默认 'key'（已存在的实体视为重要）
    if (npc.importance === undefined) npc.importance = 'key';
    if (npc.firstSeenAt === undefined) npc.firstSeenAt = 0;
    if (npc.lastUpdatedAt === undefined) npc.lastUpdatedAt = 0;
  }
}

// ── HP/SAN 更新（与原逻辑一致，未改动） ──

function updatePlayerStats(player, hp, san) {
  let updated = player;
  if (hp !== null && hp !== undefined) {
    updated = updated.replace(/HP[：:]\s*\d+/, `HP：${hp}`);
    if (!/HP[：:]/.test(updated)) {
      updated += `\nHP：${hp}`;
    }
  }
  if (san !== null && san !== undefined) {
    updated = updated.replace(/SAN[：:]\s*\d+/, `SAN：${san}`);
    if (!/SAN[：:]/.test(updated)) {
      updated += `\nSAN：${san}`;
    }
  }
  return updated;
}

export class EntityUpdater {
  /**
   * 应用叙述阶段输出。
   * @param {object} session
   * @param {object} parsed - JSON.parse 后的对象
   * @param {string} rawText - 原始 JSON 文本
   */
  applyNarrative(session, parsed, rawText, flowType) {
    // 一次性迁移：给所有旧实体补 id 和缺失字段
    ensureIdsForExistingEntities(session);

    const patch = {
      locations: [...session.locations],
      npcs: [...session.npcs],
      inventory: [...session.inventory],
    };

    // 存储 narration + options 到 chatRecord（合并为一条 assistant 消息）
    // 方案 B 改造：同时存储 parsed 对象和 flowType，让 InputAssembler 能构造
    //   {role: assistant, tool_calls: [...]} + {role: tool, ...} 消息对
    // 这样 LLM 看到的历史 assistant 消息格式 = 它被要求输出的格式，强化格式一致性
    // content 字段保留拼接文本，用于 rebuildDisplayLog 兜底（旧数据刷新时重建 displayLog）
    const narration = parsed?.[NARRATION];
    const opts = parsed?.[OPTIONS];
    if (narration && typeof narration === 'string') {
      let content = narration;
      if (Array.isArray(opts) && opts.length > 0) {
        content += '\n\n【请选择你接下来的行动】\n' + opts.join('\n');
      }
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content,
        parsed,
        flowType: flowType || null,
        timestamp: new Date().toISOString(),
      });
    }

    // locations（JSON 数组）
    const locs = parsed?.[LOCATIONS];
    if (Array.isArray(locs)) {
      for (const loc of locs) {
        if (loc[ENTITY_NAME]) {
          upsertEntity(
            patch.locations,
            {
              id: loc[ENTITY_ID] || null,
              name: loc[ENTITY_NAME],
              description: loc[ENTITY_DESC] || '',
            },
            session,
            'location'
          );
        }
      }
    }

    // npcs（JSON 数组）—— 过滤 background 角色（连带解决"LLM 记录过多不重要对象"问题）
    // 三层防护 L3：后端兜底过滤。即便 LLM 违反 prompt 把 background 角色输出到列表，也在此剔除。
    // 例外：若 LLM 给了 id（引用已有实体），则保留（可能是状态更新，不应因 importance 被误删）
    const npcList = parsed?.[NPCS];
    if (Array.isArray(npcList)) {
      for (const npc of npcList) {
        if (!npc[ENTITY_NAME]) continue;
        // 过滤 background 新实体（id 为 null 的 background 角色不进 session）
        if (npc.importance === 'background' && !npc[ENTITY_ID]) {
          continue;
        }
        upsertEntity(
          patch.npcs,
          {
            id: npc[ENTITY_ID] || null,
            name: npc[ENTITY_NAME],
            baseDescription: npc[ENTITY_BASE_DESC] || '',
            currentState: npc[ENTITY_CURRENT_STATE] || '',
            importance: npc.importance || 'supporting',
          },
          session,
          'npc'
        );
      }
    }

    // items（JSON 数组）
    const itemList = parsed?.[ITEMS];
    if (Array.isArray(itemList)) {
      for (const item of itemList) {
        if (item[ENTITY_NAME]) {
          upsertEntity(
            patch.inventory,
            {
              id: item[ENTITY_ID] || null,
              name: item[ENTITY_NAME],
              status: item[ITEM_STATUS] || '已获得',
              description: item[ENTITY_DESC] || '',
            },
            session,
            'item'
          );
        }
      }
    }

    session.locations = patch.locations;
    session.npcs = patch.npcs;
    session.inventory = patch.inventory;

    // HP / SAN
    const hp = parsed?.[HP];
    const san = parsed?.[SAN];
    if (hp !== null && hp !== undefined && san !== null && san !== undefined) {
      session.player = updatePlayerStats(session.player, hp, san);
    } else if (hp !== null && hp !== undefined) {
      session.player = updatePlayerStats(session.player, hp, null);
    } else if (san !== null && san !== undefined) {
      session.player = updatePlayerStats(session.player, null, san);
    }

    // options（JSON 数组 → 文本）—— 保留 optionBuffer 供前端渲染选项按钮
    if (Array.isArray(opts) && opts.length > 0) {
      session.optionBuffer = opts.join('\n');
    }

    return {
      locations: session.locations,
      npcs: session.npcs,
      inventory: session.inventory,
      player: session.player,
      optionBuffer: session.optionBuffer,
    };
  }

  applySetupHistory(session, phase, role, content) {
    let bucket;
    if (phase === 'WORLD_SETTING') {
      bucket = session.setupHistory.world;
    } else if (phase === 'KEY_CHARACTER_SETTING') {
      bucket = session.getCurrentKeyCharSetupHistory();
    } else {
      bucket = session.setupHistory.character;
    }
    bucket.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  applySummary(session, summaryText) {
    // 保留最新两条（最新 user prompt + assistant 输出），其余用 summary 替换
    const keep = session.chatRecord.slice(-2);
    session.chatRecord = [
      {
        role: ChatRole.KP,
        type: ChatEntryType.SUMMARY,
        content: summaryText,
        timestamp: new Date().toISOString(),
      },
      ...keep,
    ];
  }
}

export const entityUpdater = new EntityUpdater();
