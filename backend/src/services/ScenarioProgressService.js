const SUSPICION_STATES = [
  { min: 8, id: 'crisis', label: '危机', effect: '对手已经公开行动，随时可能发生正面对抗或证据抢夺。' },
  { min: 6, id: 'obstructed', label: '受阻', effect: '嫌疑人会限制调查，并可能转移或损坏尚未保全的证据。' },
  { min: 3, id: 'watched', label: '被监视', effect: '调查者正受到监视，调查行动额外耗时5分钟。' },
  { min: 0, id: 'unnoticed', label: '未引起注意', effect: '调查尚未引起有组织的警觉。' },
];

const SAN_STATES = [
  { min: 51, id: 'stable', label: '稳定', penaltyDice: 0 },
  { min: 46, id: 'uneasy', label: '不安', penaltyDice: 0 },
  { min: 31, id: 'shaken', label: '动摇', penaltyDice: 1 },
  { min: 16, id: 'unstable', label: '不稳定', penaltyDice: 2 },
  { min: 1, id: 'critical', label: '濒临崩溃', penaltyDice: 2 },
  { min: 0, id: 'madness', label: '疯狂', penaltyDice: 2 },
];

function toMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export class ScenarioProgressService {
  getSuspicionState(value = 0) {
    const safeValue = Math.max(0, Math.min(10, Number(value) || 0));
    return SUSPICION_STATES.find(state => safeValue >= state.min);
  }

  getSanState(value = 0) {
    const safeValue = Math.max(0, Number(value) || 0);
    return SAN_STATES.find(state => safeValue >= state.min);
  }

  getPlayerSanState(session) {
    const player = session.npcs?.find(npc => npc.id === 'npc_000');
    return this.getSanState(player?.san ?? 0);
  }

  refreshSanity(session) {
    const player = session.npcs?.find(npc => npc.id === 'npc_000');
    const previousState = session.sanity?.state ?? this.getSanState(player?.san ?? 0).id;
    const currentState = this.getSanState(player?.san ?? 0);
    session.sanity = {
      startSan: session.sanity?.startSan ?? player?.maxSan ?? player?.san ?? 0,
      state: currentState.id,
      resolvedEventIds: Array.isArray(session.sanity?.resolvedEventIds) ? session.sanity.resolvedEventIds : [],
      traumaHistory: Array.isArray(session.sanity?.traumaHistory) ? session.sanity.traumaHistory : [],
      activeTrauma: session.sanity?.activeTrauma ?? null,
    };
    return { previousState, currentState };
  }

  getAvailableSanEvents(session) {
    const events = session.scenarioRules?.sanEvents;
    if (!events || typeof events !== 'object') return [];
    const current = toMinutes(session.scenarioClock?.currentTime);
    const resolved = new Set(session.sanity?.resolvedEventIds || []);
    return Object.entries(events)
      .filter(([id, event]) => !resolved.has(id)
        && (toMinutes(event.at) ?? Infinity) <= (current ?? -1)
        && (!event.locationId || event.locationId === session.playerLocationId))
      .map(([id, event]) => ({ id, ...event }));
  }

  revealLocations(session, locationIds = []) {
    const catalog = session.scenarioRules?.locationCatalog;
    if (!catalog || !Array.isArray(locationIds)) return [];
    if (!Array.isArray(session.locations)) session.locations = [];
    const revealed = [];
    for (const id of locationIds) {
      const definition = catalog[id];
      if (!definition || session.locations.some(location => location.id === id)) continue;
      const location = {
        id,
        name: definition.name,
        description: definition.description,
        firstSeenAt: session.scenarioClock?.turn ?? 0,
        lastUpdatedAt: session.scenarioClock?.turn ?? 0,
      };
      session.locations.push(location);
      revealed.push(location);
    }
    return revealed;
  }

  updatePlayerLocation(session, locationId) {
    if (!session.scenarioId || typeof locationId !== 'string' || !locationId) return null;
    const location = (session.locations || []).find(entry => entry.id === locationId);
    if (!location || session.playerLocationId === locationId) return null;
    session.playerLocationId = locationId;
    return location;
  }

  recordSanEvent(session, eventId) {
    this.refreshSanity(session);
    if (!session.sanity.resolvedEventIds.includes(eventId)) {
      session.sanity.resolvedEventIds.push(eventId);
    }
  }

  applyEvidenceChanges(session, changes = []) {
    const catalog = session.scenarioRules?.clueCatalog;
    const accepted = [];
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const id = change.id || `evidence_${String((session.evidence?.length || 0) + 1).padStart(3, '0')}`;
      const definition = catalog?.[id];

      // Authored scenarios only accept clue IDs from their catalog. This keeps the
      // model from inventing proof that can unlock an ending.
      if (catalog && !definition) continue;

      const existing = session.evidence.find(evidence => evidence.id === id);
      const before = existing ? JSON.stringify(existing) : null;
      const record = existing || {
        id,
        category: definition?.category ?? 'other',
        source: definition?.source ?? 'unknown source',
        reliability: definition?.reliability ?? 'low',
        secured: false,
        discovered: true,
        description: definition?.description ?? '',
        truths: definition?.truths ?? [],
      };

      Object.assign(record, {
        category: definition?.category ?? change.category ?? record.category,
        source: definition?.source ?? change.source ?? record.source,
        reliability: definition?.reliability ?? change.reliability ?? record.reliability,
        // Discovery and custody are monotonic. Losing the physical object should
        // be represented by custody/status, not by erasing knowledge or silently
        // downgrading proof that was already recorded.
        secured: record.secured || change.secured === true,
        discovered: typeof change.discovered === 'boolean'
          ? (record.discovered !== false || change.discovered)
          : (record.discovered !== false),
        description: definition?.description ?? change.description ?? record.description,
        truths: definition?.truths ?? record.truths ?? [],
      });
      if (!existing) session.evidence.push(record);
      if (!existing || JSON.stringify(record) !== before) accepted.push(record);
    }
    return accepted;
  }

  inferEvidenceChanges(session, userText = '') {
    const catalog = session.scenarioRules?.clueCatalog;
    if (!catalog || typeof catalog !== 'object' || typeof userText !== 'string') return [];
    const text = userText.trim().toLowerCase();
    if (!text) return [];
    const investigativeIntent = /检查|查看|观察|搜索|搜查|调查|翻找|比对|核对|询问|追问|记录|录音|拍照|保全|取得|拿走|检验|分析|inspect|examine|search|investigate|compare|question|record|preserve|secure/i;
    if (!investigativeIntent.test(text)) return [];
    const currentLocationId = session.playerLocationId;
    const existingIds = new Set((session.evidence || [])
      .filter(evidence => evidence.discovered !== false)
      .map(evidence => evidence.id));
    return Object.entries(catalog)
      .filter(([id, clue]) => {
        if (existingIds.has(id)) return false;
        const allowedLocations = Array.isArray(clue.locationIds)
          ? clue.locationIds
          : (clue.locationId ? [clue.locationId] : []);
        if (allowedLocations.length > 0 && !allowedLocations.includes(currentLocationId)) return false;
        const keywords = Array.isArray(clue.keywords) ? clue.keywords : [];
        return keywords.some(keyword => text.includes(String(keyword).toLowerCase()));
      })
      .map(([id]) => ({ id, secured: false }));
  }

  getEvidenceProgress(session) {
    const catalog = session.scenarioRules?.clueCatalog;
    const total = catalog && typeof catalog === 'object'
      ? Object.keys(catalog).length
      : (session.evidence || []).length;
    const discovered = (session.evidence || []).filter(evidence => evidence.discovered !== false).length;
    const secured = (session.evidence || []).filter(evidence => evidence.secured).length;
    return { discovered, secured, total };
  }

  evaluateTruth(session) {
    const facts = session.scenarioRules?.truths || {};
    const secured = new Set((session.evidence || [])
      .filter(evidence => evidence.secured)
      .map(evidence => evidence.id));
    const resolvedFacts = Object.fromEntries(Object.entries(facts).map(([id, requiredEvidence]) => [
      id,
      requiredEvidence.every(evidenceId => secured.has(evidenceId)),
    ]));
    const factCount = Object.values(resolvedFacts).filter(Boolean).length;
    const totalFacts = Object.keys(resolvedFacts).length;
    const truthKnown = totalFacts > 0 && factCount >= Math.min(3, totalFacts);
    const truthProvable = totalFacts > 0 && factCount === totalFacts;
    return {
      facts: resolvedFacts,
      factCount,
      totalFacts,
      truthKnown,
      truthProvable,
      securedEvidence: [...secured],
    };
  }

  canAcceptRecommendedEnding(session) {
    const lastPlayerMessage = [...(session.chatRecord || [])].reverse()
      .find(entry => entry?.role === 'player')?.content || '';
    const finalChoice = this.detectFinalChoice(lastPlayerMessage);
    if (finalChoice) session.finalChoice = finalChoice;
    return this.evaluateTruth(session).truthKnown && Boolean(finalChoice);
  }

  detectFinalChoice(text = '') {
    const normalized = String(text).trim();
    if (!normalized) return null;
    // Questions, hypotheticals, and explicit negations are not commitments.
    if (/[?？]|是否|要不要|如果|假如|考虑|should\s+i|what\s+if|whether|maybe|perhaps/i.test(normalized)) return null;
    if (/不(?:会|要|想|打算|决定)?\s*(?:公开|揭露|公布|保全|封存|销毁|撤离|离开)|do\s+not|don't|won't|not\s+(?:publish|reveal|preserve|destroy|leave)/i.test(normalized)) return null;

    const choices = [
      { id: 'expose', pattern: /(?:我|玩家|最终决定|对应行动)[\s\S]{0,20}(?:公开|揭露|公布|发布|上报)|\bi\s+(?:will\s+|choose\s+to\s+|decide\s+to\s+)?(?:expose|publish|reveal|report)\b/i },
      { id: 'preserve', pattern: /(?:我|玩家|最终决定|对应行动)[\s\S]{0,20}(?:保全|封存|带走|保存)|\bi\s+(?:will\s+|choose\s+to\s+|decide\s+to\s+)?(?:preserve|secure|take the evidence)\b/i },
      { id: 'destroy', pattern: /(?:我|玩家|最终决定|对应行动)[\s\S]{0,20}(?:销毁|烧毁|毁掉)|\bi\s+(?:will\s+|choose\s+to\s+|decide\s+to\s+)?destroy\b/i },
      { id: 'suppress', pattern: /(?:我|玩家|最终决定|对应行动)[\s\S]{0,20}(?:压下|隐瞒|掩盖)|\bi\s+(?:will\s+|choose\s+to\s+|decide\s+to\s+)?suppress\b/i },
      { id: 'withdraw', pattern: /(?:我|玩家|最终决定|对应行动)[\s\S]{0,20}(?:撤离|离开白桦站|登车离开)|\bi\s+(?:will\s+|choose\s+to\s+|decide\s+to\s+)?(?:withdraw|leave the station)\b/i },
    ];
    return choices.find(choice => choice.pattern.test(normalized))?.id || null;
  }

  chooseEndingType(session, reason) {
    const player = session.npcs?.find(npc => npc.id === 'npc_000');
    if (player?.hp <= 0) return 'death';
    if (player?.san <= 0) return 'madness';

    const truth = this.evaluateTruth(session);
    if (session.finalChoice === 'expose' && truth.truthKnown) return 'truth_exposed';
    if (session.finalChoice === 'preserve' && truth.truthKnown) return 'forbidden_cargo';
    if ((session.finalChoice === 'destroy' || session.finalChoice === 'suppress') && truth.truthKnown) return 'truth_sunk';
    if (session.finalChoice === 'withdraw') return 'withdrawal';
    if (session.suspicion >= 8) return 'suppressed';
    if (reason === 'deadline') return truth.truthKnown ? 'forbidden_cargo' : 'truth_sunk';
    if (truth.truthProvable) return 'truth_exposed';
    return 'withdrawal';
  }
}

export const scenarioProgressService = new ScenarioProgressService();
