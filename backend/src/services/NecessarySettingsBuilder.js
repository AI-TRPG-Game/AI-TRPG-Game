import { scenarioProgressService } from './ScenarioProgressService.js';

export class NecessarySettingsBuilder {
  build(session, { narrationProfile = null } = {}) {
    const lines = [
      '故事必要设定如下：',
      `世界观：${session.worldSettings || '（未设定）'}`,
      `玩家：${session.player || '（未设定）'}`,
    ];
    if (session.scenarioRules?.pacingVersion === 3) {
      const director = session.scenarioFlags?.investigation;
      lines.push(`【引擎行动记录】${JSON.stringify(director?.transaction || {})}`);
      lines.push('仅描述引擎已解决的结果。不得自行增加伤害、证据保全、获得物品或战斗结果。未解决检定只能描述准备，不能声称命中。重复前文不算推进。章节与行动决定进度，分钟仅为氛围，不得自行宣布发车。');
      lines.push(`【章节】${director?.act || 'opening'}；已完成行动${director?.actions || 0}/26。每次回应必须体现本次行动的新结果。`);
    }

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
      if (session.combat) lines.push(`当前直接危险：${JSON.stringify(session.combat)}。成功逃脱、谈判或满足退出条件时必须明确combat_update.active=false；不要把普通调查描述成仍在战斗。`);
      if (session.finaleState) lines.push(`终局阶段：${session.finaleState.stage}；已完成危机行动${session.finaleState.completedActions || 0}/3。只解决眼前危险，不引入新调查、无关威胁或新的战斗。最多第三次行动后由引擎收束。`);
      if (session.finaleState?.resolutionOutcome) lines.push(`已确定的危机结果，结局必须承接：${JSON.stringify(session.finaleState.resolutionOutcome)}`);
      if (session.scenarioFlags?.train_departed) lines.push('列车已离站，这是不可改写的事实。禁止登车、赶上列车或声称主角在发车前离开；撤离路线为站外公路。');
      if (session.scenarioRules?.pacingVersion === 2) {
        lines.push('耗时由引擎按行动类别决定。复合请求只处理第一个有意义的行动，其余步骤留待下一次选择。');
        if (session.scenarioClock.currentTime >= '05:00') lines.push('调查进入收束阶段：选项只围绕已发现证据的保全、已遇证人的立场和撤离，不再开辟无关调查支线。');
      }
      const sanState = scenarioProgressService.getPlayerSanState(session);
      const suspicionState = scenarioProgressService.getSuspicionState(session.suspicion);
      const truthProgress = scenarioProgressService.evaluateTruth(session);
      lines.push(`SAN state: ${sanState.label}. Suspicion state: ${suspicionState.label} (${suspicionState.effect})`);
      const currentLocation = (session.locations || []).find(location => location.id === session.playerLocationId);
      lines.push(`Current player location: ${currentLocation ? `${currentLocation.id} (${currentLocation.name})` : 'unknown'}. Set current_location_id to a discovered location only when the player actually moves there.`);
      const actorLocations = (session.npcs || [])
        .filter(npc => npc.locationId && npc.status !== 'departed')
        .map(npc => `${npc.id}=${npc.locationId}`);
      if (actorLocations.length) {
        if (session.scenarioRules?.pacingVersion === 3) lines.push('引擎已结算本轮行动。NPC位置、合作、撤退和证据保全以结构化状态及本轮回执为准；不可只在文字中让人物同行、移动、同意作证或解除围堵。若回执没有记录成功，不得补写成功。林晚的证词跟随本人，既有副本跟随持有人，不绑定休息室。');
        lines.push(`GM-only actor positions: ${actorLocations.join(', ')}. Do not teleport actors; only narrate a move when the route and elapsed time make it plausible. A non-co-located actor's state is private GM information until the protagonist perceives evidence of it.`);
      }
      if (session.activeScene) {
        const sceneLocation = (session.locations || []).find(location => location.id === session.activeScene.locationId);
        lines.push('');
        lines.push('==== GM-ONLY ACTIVE SCENE DIRECTIVE (highest priority for this turn) ====');
        lines.push(`Scene kind: ${session.activeScene.kind}; event=${session.activeScene.eventId}; outcome=${session.activeScene.outcome || 'pending'}; location=${sceneLocation?.name || session.activeScene.locationId || 'current location'}.`);
        lines.push(session.activeScene.instruction);
        if (session.activeScene.announcedAtBoundary) {
          lines.push(`玩家在上一回合末尾已经感知到：${session.activeScene.playerCue}`);
          lines.push('从玩家对该变化的回应开始继续，呈现新的后果；不要逐字重复或重新介绍上一回合已经显示的事件线索。');
        } else {
          if (session.activeScene.playerCue) lines.push(`玩家至少必须感知到这一变化：${session.activeScene.playerCue}`);
          lines.push('Integrate this development into the narration itself. Show only what the protagonist can perceive. Do not print event IDs, branch names, scheduler metadata, or a separate system-event announcement. If it interrupts the declared action, make the interruption clear and stop at the next meaningful player decision.');
        }
      }
      const activeTrauma = session.sanity?.activeTrauma;
      if (activeTrauma) lines.push(`Active acute trauma: ${activeTrauma.label}. ${activeTrauma.message}`);
      const availableSanEvents = scenarioProgressService.getAvailableSanEvents(session);
      if (session.scenarioRules?.sanEvents) {
        lines.push(`Allowed SAN event IDs now (only trigger when narratively earned; target is fixed by the server): ${availableSanEvents.length ? availableSanEvents.map(event => `${event.id} [${event.severity}]`).join(', ') : 'none'}.`);
      }
      lines.push(`Truth progress: ${truthProgress.factCount}/${truthProgress.totalFacts} proven facts; known=${truthProgress.truthKnown}; provable=${truthProgress.truthProvable}.`);
      if (session.scenarioRules?.clueCatalog) {
        const clueLines = Object.entries(session.scenarioRules.clueCatalog).map(([id, clue]) => {
          const state = (session.evidence || []).find(evidence => evidence.id === id);
          const progress = state?.secured ? 'secured' : state ? 'discovered-not-secured' : 'not-yet-discovered';
          const location = clue.locationId ? `；recommended location=${clue.locationId}` : '';
          const hint = clue.discoveryHint ? `；discovery hint=${clue.discoveryHint}` : '';
          const preservation = state && !state.secured && clue.preservationHint
            ? `；preservation hint=${clue.preservationHint}`
            : '';
          return `${id} [${progress}] source=${clue.source || 'unknown'}; description=${clue.description || ''}${location}${hint}${preservation}`;
        });
        lines.push('Authored evidence catalogue (award only when the player has actually found or secured it; use the exact ID):');
        lines.push(...clueLines);
      }
      lines.push('', `剧本时钟：${session.scenarioClock.currentTime}，截止 ${session.scenarioClock.deadline}，第 ${session.scenarioClock.turn} 回合，阶段 ${session.scenarioClock.phase}。`);
      lines.push(`怀疑度：${session.suspicion ?? 0}/10。`);
      const secured = (session.evidence || []).filter(e => e.secured);
      if (secured.length) lines.push(`已保全证据：${secured.map(e => `${e.id}(${e.source})`).join('；')}。`);
      if (narrationProfile) {
        const profileText = narrationProfile === 'major'
          ? '重大场景：700-1100个中文字符，约6-9个有信息量的段落。'
          : '普通场景：450-750个中文字符，约4-6个有信息量的段落。若本轮触发检定actions，则改为200-400字并停在判定前。';
        lines.push(`本轮叙事档位：${profileText}`);
      }
    }

    return lines.join('\n');
  }
}

export const necessarySettingsBuilder = new NecessarySettingsBuilder();
