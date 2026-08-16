const SUSPICION_STATES = [
  { min: 8, id: 'crisis', label: 'crisis', effect: 'The opposition is acting openly; expect an immediate confrontation or seizure attempt.' },
  { min: 6, id: 'obstructed', label: 'obstructed', effect: 'Suspects restrict access and may move or damage unprotected evidence.' },
  { min: 3, id: 'watched', label: 'watched', effect: 'The investigator is being watched; investigative actions take 5 extra minutes.' },
  { min: 0, id: 'unnoticed', label: 'unnoticed', effect: 'The investigation has not yet drawn organised attention.' },
];

const SAN_STATES = [
  { min: 51, id: 'stable', label: 'stable', penaltyDice: 0 },
  { min: 46, id: 'uneasy', label: 'uneasy', penaltyDice: 0 },
  { min: 31, id: 'shaken', label: 'shaken', penaltyDice: 1 },
  { min: 16, id: 'unstable', label: 'unstable', penaltyDice: 2 },
  { min: 1, id: 'critical', label: 'critical', penaltyDice: 2 },
  { min: 0, id: 'madness', label: 'madness', penaltyDice: 2 },
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
      const record = existing || {
        id,
        category: definition?.category ?? 'other',
        source: definition?.source ?? 'unknown source',
        reliability: definition?.reliability ?? 'low',
        secured: false,
        description: definition?.description ?? '',
        truths: definition?.truths ?? [],
      };

      Object.assign(record, {
        category: definition?.category ?? change.category ?? record.category,
        source: definition?.source ?? change.source ?? record.source,
        reliability: definition?.reliability ?? change.reliability ?? record.reliability,
        secured: typeof change.secured === 'boolean' ? change.secured : record.secured,
        description: definition?.description ?? change.description ?? record.description,
        truths: definition?.truths ?? record.truths ?? [],
      });
      if (!existing) session.evidence.push(record);
      accepted.push(record);
    }
    return accepted;
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
    const playerMadeFinalChoice = /expose|publish|reveal|report|preserve|take (it|the evidence)|suppress|destroy|withdraw|leave|公开|揭露|公布|交给|带走|保全|封存|销毁|撤离|离开/i
      .test(lastPlayerMessage);
    return this.evaluateTruth(session).truthKnown && playerMadeFinalChoice;
  }

  chooseEndingType(session, reason) {
    const player = session.npcs?.find(npc => npc.id === 'npc_000');
    if (player?.hp <= 0) return 'death';
    if (player?.san <= 0) return 'madness';

    const truth = this.evaluateTruth(session);
    if (truth.truthProvable) return 'truth_exposed';
    if (session.suspicion >= 8) return 'suppressed';
    if (reason === 'deadline') return truth.truthKnown ? 'forbidden_cargo' : 'truth_sunk';
    return 'withdrawal';
  }
}

export const scenarioProgressService = new ScenarioProgressService();
