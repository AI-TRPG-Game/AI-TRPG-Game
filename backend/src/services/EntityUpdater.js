import { ChatRole, ChatEntryType } from '../domain/enums.js';
import {
  NARRATION, LOCATIONS, NPCS, ITEMS, HP, SAN, OPTIONS,
  ENTITY_NAME, ENTITY_DESC, ITEM_STATUS,
} from '../domain/NarrativeSchema.js';

function upsertByName(list, entry) {
  const idx = list.findIndex((item) => item.name === entry.name);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
  }
}

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
  applyNarrative(session, parsed, rawText) {
    const patch = {
      locations: [...session.locations],
      npcs: [...session.npcs],
      inventory: [...session.inventory],
    };

    // 存储 narration 到 chatRecord
    const narration = parsed?.[NARRATION];
    if (narration && typeof narration === 'string') {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: narration,
        timestamp: new Date().toISOString(),
      });
    }

    // locations（JSON 数组）
    const locs = parsed?.[LOCATIONS];
    if (Array.isArray(locs)) {
      for (const loc of locs) {
        if (loc[ENTITY_NAME]) {
          upsertByName(patch.locations, {
            name: loc[ENTITY_NAME],
            description: loc[ENTITY_DESC] || '',
          });
        }
      }
    }

    // npcs（JSON 数组）
    const npcList = parsed?.[NPCS];
    if (Array.isArray(npcList)) {
      for (const npc of npcList) {
        if (npc[ENTITY_NAME]) {
          upsertByName(patch.npcs, {
            name: npc[ENTITY_NAME],
            description: npc[ENTITY_DESC] || '',
          });
        }
      }
    }

    // items（JSON 数组）
    const itemList = parsed?.[ITEMS];
    if (Array.isArray(itemList)) {
      for (const item of itemList) {
        if (item[ENTITY_NAME]) {
          upsertByName(patch.inventory, {
            name: item[ENTITY_NAME],
            status: item[ITEM_STATUS] || '已获得',
            description: item[ENTITY_DESC] || '',
          });
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

    // options（JSON 数组 → 文本）
    const opts = parsed?.[OPTIONS];
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
