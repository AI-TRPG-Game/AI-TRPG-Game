import { ChatRole, ChatEntryType } from '../domain/enums.js';
import {
  NARRATION, LOCATIONS, NPCS, ITEMS, OPTIONS,
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
    // name：仅当 existing 为空时填入（不覆盖）
    if (!existing.name && entry.name) existing.name = entry.name;
    // baseDescription：仅当 existing 为空时填入（稳定人设不覆盖）
    if (!existing.baseDescription && entry.baseDescription) {
      existing.baseDescription = entry.baseDescription;
    }
    // currentState：只要 entry 非空就覆盖（动态状态）
    if (entry.currentState !== undefined && entry.currentState !== '') {
      existing.currentState = entry.currentState;
    }

    // === HP/SAN 相关字段 ===
    // hp/san/maxHp/maxSan：仅首次创建时填入（existing 无值时），后续由 DamageResolver 管理
    if (entry.hp != null && existing.hp == null) existing.hp = entry.hp;
    if (entry.maxHp != null && existing.maxHp == null) existing.maxHp = entry.maxHp;
    if (entry.san != null && existing.san == null) existing.san = entry.san;
    if (entry.maxSan != null && existing.maxSan == null) existing.maxSan = entry.maxSan;

    // visibility：可更新（非空即覆盖）
    // LLM 可根据剧情切换（神秘人现身 hidden→visible 等）
    if (entry.visibility) {
      existing.visibility = entry.visibility;
    }

    // attributes：仅首次填入后锁定（与 baseDescription 同样的保护逻辑）
    // 仅 key 角色输出，supporting 留 null；existing 已有值时不覆盖
    if (entry.attributes && !existing.attributes) {
      existing.attributes = entry.attributes;
    }

    // status：只由系统设置（DamageResolver），LLM 输出的 status 字段被忽略
    // 不在此处理 status

    // importance：可升级（supporting→key），但 player/key 锁定不可降级
    if (entry.importance) {
      const cur = existing.importance;
      const newVal = entry.importance;
      const rank = { supporting: 1, key: 2, player: 3 };
      // existing 是 player 或 key 时不允许降级
      if (cur && rank[cur] >= rank['key'] && rank[cur] > rank[newVal]) {
        // player/key 锁定，不允许降级
      } else if (!cur || (rank[newVal] && rank[newVal] > (rank[cur] || 0))) {
        existing.importance = newVal;
      }
    }
  } else {
    if (!existing.name && entry.name) existing.name = entry.name;
    // 防护：新值非空才覆盖，避免 LLM 引用已有实体但未填描述时用空串覆盖原描述
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
    const keyCharCount = session.keyCharacters?.length || 0;
    return {
      id: idAllocator.nextNewNpcId(list, keyCharCount),
      name: entry.name || '',
      baseDescription: entry.baseDescription ?? entry.description ?? '',
      currentState: entry.currentState ?? '',
      importance: entry.importance || 'supporting',
      // HP/SAN 相关字段
      hp: entry.hp ?? null,
      maxHp: entry.maxHp ?? null,
      san: entry.san ?? null,
      maxSan: entry.maxSan ?? null,
      visibility: entry.visibility || 'visible',
      status: 'active',  // 默认 active，departed 由系统设置
      attributes: entry.attributes ?? null,
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
        if (!loc[ENTITY_NAME]) continue;
        // 防护：只有名字没描述（LLM 引用已有实体但未填写任何新描述）→ 跳过
        // 避免 upsertEntity 触发 lastUpdatedAt 错误刷新（即便 mergeEntity 已防护不覆盖描述）
        if (!loc[ENTITY_DESC]) continue;
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

    // npcs（JSON 数组）
    // background 已从 schema enum 移除，路人直接在 narration 中描写，不需要过滤
    const npcList = parsed?.[NPCS];
    if (Array.isArray(npcList)) {
      for (const npc of npcList) {
        if (!npc[ENTITY_NAME]) continue;
        // 防护：只有名字没 currentState（LLM 引用已有 NPC 但未填写任何动态状态）→ 跳过
        if (!npc[ENTITY_CURRENT_STATE]) continue;
        upsertEntity(
          patch.npcs,
          {
            id: npc[ENTITY_ID] || null,
            name: npc[ENTITY_NAME],
            baseDescription: npc[ENTITY_BASE_DESC] || '',
            currentState: npc[ENTITY_CURRENT_STATE] || '',
            importance: npc.importance || 'supporting',
            // HP/SAN 相关字段（首次出场时由 LLM 输出，后续轮次为 null）
            hp: npc.hp ?? null,
            maxHp: npc.maxHp ?? null,
            san: npc.san ?? null,
            maxSan: npc.maxSan ?? null,
            visibility: npc.visibility || null,
            // status 由系统设置，不从 LLM 输出中取
            // attributes 仅 key 角色输出
            attributes: npc.attributes ?? null,
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
        if (!item[ENTITY_NAME]) continue;
        // 防护：只有名字没描述（LLM 引用已有实体但未填写任何新描述）→ 跳过
        if (!item[ENTITY_DESC]) continue;
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

    session.locations = patch.locations;
    session.npcs = patch.npcs;
    session.inventory = patch.inventory;

    // HP/SAN 由 DamageResolver 根据 actions 字段计算并直接更新 npc 条目，本函数不处理顶层 hp/san

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
