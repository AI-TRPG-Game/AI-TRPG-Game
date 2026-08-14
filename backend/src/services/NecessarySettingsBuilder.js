import { scenarioProgressService } from './ScenarioProgressService.js';

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
    }

    if (session.scenarioClock) {
      const sanState = scenarioProgressService.getPlayerSanState(session);
      const suspicionState = scenarioProgressService.getSuspicionState(session.suspicion);
      const truthProgress = scenarioProgressService.evaluateTruth(session);
      lines.push(`SAN state: ${sanState.label}. Suspicion state: ${suspicionState.label} (${suspicionState.effect})`);
      lines.push(`Truth progress: ${truthProgress.factCount}/${truthProgress.totalFacts} proven facts; known=${truthProgress.truthKnown}; provable=${truthProgress.truthProvable}.`);
      if (session.scenarioRules?.clueCatalog) {
        lines.push(`Allowed evidence IDs (do not reveal or award one without narrative support): ${Object.keys(session.scenarioRules.clueCatalog).join(', ')}.`);
      }
      lines.push('', `剧本时钟：${session.scenarioClock.currentTime}，截止 ${session.scenarioClock.deadline}，第 ${session.scenarioClock.turn} 回合，阶段 ${session.scenarioClock.phase}。`);
      lines.push(`怀疑度：${session.suspicion ?? 0}/10。`);
      const secured = (session.evidence || []).filter(e => e.secured);
      if (secured.length) lines.push(`已保全证据：${secured.map(e => `${e.id}(${e.source})`).join('；')}。`);
    }

    return lines.join('\n');
  }
}

export const necessarySettingsBuilder = new NecessarySettingsBuilder();
