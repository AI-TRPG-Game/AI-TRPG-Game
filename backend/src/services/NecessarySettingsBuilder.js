export class NecessarySettingsBuilder {
  build(session) {
    const lines = [
      '故事必要设定如下：',
      `世界观：${session.worldSettings || '（未设定）'}`,
      `玩家：${session.player || '（未设定）'}`,
    ];

    if (session.keyCharacters && session.keyCharacters.length > 0) {
      const keyCharsList = session.keyCharacters
        .map((c, i) => {
          // 提取角色名（第一行"姓名：xxx"）
          const nameMatch = c.match(/姓名：(.+)/);
          const name = nameMatch ? nameMatch[1] : '未知';
          // 推断对应 npc_id（邀请角色区段 001~003）
          const npcId = `npc_${String(i + 1).padStart(3, '0')}`;
          return `[${npcId}] ${name}\n${c}`;
        })
        .join('\n\n');
      lines.push('关键角色（已邀请，对应 NPC id 见方括号；不要作为新 NPC 重复输出）：');
      lines.push(keyCharsList);
    }

    // 已有实体清单（带 id）—— 只在三类实体任一非空时输出
    const hasEntities =
      (session.locations?.length ?? 0) > 0 ||
      (session.npcs?.length ?? 0) > 0 ||
      (session.inventory?.length ?? 0) > 0;

    if (hasEntities) {
      lines.push('');
      lines.push('==== 已有实体清单（引用时必须填入对应 id） ====');

      if (session.locations && session.locations.length > 0) {
        lines.push('[地点 locations]');
        for (const l of session.locations) {
          const desc = l.description || '';
          lines.push(`- ${l.id}: ${l.name} —— ${desc}`);
        }
      }

      if (session.npcs && session.npcs.length > 0) {
        lines.push('[NPC npcs]');
        for (const n of session.npcs) {
          const roleTag = n.id === 'npc_000'
            ? '（主角）'
            : /^npc_00[1-3]$/.test(n.id)
              ? '（已邀请角色）'
              : '';
          // 兼容旧数据：baseDescription 可能未拆分，fallback 到 description
          const base = n.baseDescription ?? n.description ?? '';
          const state = n.currentState ?? '';
          const parts = [`- ${n.id}: ${n.name}${roleTag}`];
          if (base) parts.push(`—— ${base}`);
          if (state) parts.push(`—— ${state}`);
          lines.push(parts.join(' '));
        }
      }

      if (session.inventory && session.inventory.length > 0) {
        lines.push('[物品 inventory]');
        for (const i of session.inventory) {
          const parts = [`- ${i.id}: ${i.name}`];
          if (i.status) parts.push(`—— ${i.status}`);
          if (i.description) parts.push(`—— ${i.description}`);
          lines.push(parts.join(' '));
        }
      }

      lines.push('');
      lines.push('⚠️ 提醒：');
      lines.push('1. 引用已存在实体时必须填入对应 id，仅更新需要变化的字段；不要修改 name');
      lines.push('2. 仅当实体确实首次出场时，才将 id 设为 null（系统会自动分配新 id）');
      lines.push('3. 不要用昵称、敬称、缩写、全称变体重新命名已存在的实体');
      lines.push('4. 主角(npc_000)和已邀请角色(npc_001~npc_003)已固定存在，不要作为新 NPC 输出');
    }

    return lines.join('\n');
  }
}

export const necessarySettingsBuilder = new NecessarySettingsBuilder();
