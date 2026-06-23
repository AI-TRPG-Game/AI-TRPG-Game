import { ChatRole, ChatEntryType } from '../domain/enums.js';

function upsertByName(list, entry) {
  const idx = list.findIndex((item) => item.name === entry.name);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
  }
}

function updateProtagonistStats(protagonist, hp, san) {
  let updated = protagonist;
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
    const narration = parsed?.narration;
    if (narration && typeof narration === 'string') {
      session.chatRecord.push({
        role: ChatRole.KP,
        type: ChatEntryType.NARRATION,
        content: narration,
        timestamp: new Date().toISOString(),
      });
    }

    // locations（JSON 数组）
    const locs = parsed?.locations;
    if (Array.isArray(locs)) {
      for (const loc of locs) {
        if (loc.name) {
          upsertByName(patch.locations, {
            name: loc.name,
            description: loc.description || '',
          });
        }
      }
    }

    // npcs（JSON 数组）
    const npcList = parsed?.npcs;
    if (Array.isArray(npcList)) {
      for (const npc of npcList) {
        if (npc.name) {
          upsertByName(patch.npcs, {
            name: npc.name,
            description: npc.description || '',
          });
        }
      }
    }

    // items（JSON 数组）
    const itemList = parsed?.items;
    if (Array.isArray(itemList)) {
      for (const item of itemList) {
        if (item.name) {
          upsertByName(patch.inventory, {
            name: item.name,
            status: item.status || '已获得',
            description: item.description || '',
          });
        }
      }
    }

    session.locations = patch.locations;
    session.npcs = patch.npcs;
    session.inventory = patch.inventory;

    // HP / SAN
    const hp = parsed?.hp;
    const san = parsed?.san;
    if (hp !== null && hp !== undefined && san !== null && san !== undefined) {
      session.protagonist = updateProtagonistStats(session.protagonist, hp, san);
    } else if (hp !== null && hp !== undefined) {
      session.protagonist = updateProtagonistStats(session.protagonist, hp, null);
    } else if (san !== null && san !== undefined) {
      session.protagonist = updateProtagonistStats(session.protagonist, null, san);
    }

    // options（JSON 数组 → 文本）
    const opts = parsed?.options;
    if (Array.isArray(opts) && opts.length > 0) {
      session.optionBuffer = opts.join('\n');
    }

    return {
      locations: session.locations,
      npcs: session.npcs,
      inventory: session.inventory,
      protagonist: session.protagonist,
      optionBuffer: session.optionBuffer,
    };
  }

  applySetupHistory(session, phase, role, content) {
    const bucket =
      phase === 'WORLD_SETTING'
        ? session.setupHistory.world
        : session.setupHistory.character;
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
