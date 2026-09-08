import { scenarioProgressService } from './ScenarioProgressService.js';

const EVENT_STATES = new Set(['dormant', 'eligible', 'queued', 'resolved', 'expired']);
const MOVEMENT_WORDS = /(?:前往|去往|赶往|赶到|进入|回到|返回|移动到|走向|来到|登上|下到|离开.*去|\bgo\b|\bvisit\b|\btravel\b|\bmove\b|\bhead\b|\benter\b|\breturn\b)/i;

function toMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class ScheduleService {
  /**
   * Prepare at most one foreground development before the narrator is called.
   * Local events that happen elsewhere are resolved privately; deferred events
   * remain eligible until the player can plausibly encounter them or they expire.
   */
  prepareTurn(session, { userText = '' } = {}) {
    if (!session.scenarioClock) {
      return { activeScene: null, intendedLocationId: null, resolvedOffscreenEvents: [] };
    }

    this._normalizeEvents(session);
    if (session.scenarioClock.mode === 'finale' && !session.activeScene) {
      return { activeScene: null, intendedLocationId: null, resolvedOffscreenEvents: [] };
    }
    this._promoteEligibleEvents(session);

    if (session.activeScene) {
      return {
        activeScene: session.activeScene,
        intendedLocationId: session.activeScene.intendedLocationId || null,
        resolvedOffscreenEvents: [],
      };
    }

    const intendedLocationId = this._inferIntendedLocation(session, userText);
    const effectiveLocationId = intendedLocationId || session.playerLocationId;
    const resolvedOffscreenEvents = [];

    // A player arriving where an off-screen event left traces should encounter
    // the aftermath before another foreground event is selected.
    const aftermath = this._findAftermath(session, effectiveLocationId);
    if (aftermath) {
      session.activeScene = this._buildAftermathScene(aftermath, effectiveLocationId, intendedLocationId);
      return { activeScene: session.activeScene, intendedLocationId, resolvedOffscreenEvents };
    }

    const eligible = (session.scheduledEvents || [])
      .filter(event => event.status === 'eligible')
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0)
        || (toMinutes(a.at) ?? Infinity) - (toMinutes(b.at) ?? Infinity));

    for (const event of eligible) {
      const decision = this._decidePlacement(session, event, effectiveLocationId);
      if (decision.kind === 'defer') continue;

      if (decision.kind === 'offscreen') {
        const resolution = this._resolveEvent(session, event, decision.branchKey, {
          visible: false,
          locationId: decision.locationId,
        });
        resolvedOffscreenEvents.push(resolution);
        continue;
      }

      event.status = 'queued';
      session.activeScene = this._buildForegroundScene(
        event,
        decision.branchKey,
        decision.locationId,
        intendedLocationId,
        decision.resolutionLocationId
      );
      break;
    }

    return { activeScene: session.activeScene || null, intendedLocationId, resolvedOffscreenEvents };
  }

  /**
   * Commit the event selected by prepareTurn after a complete narrated action.
   * This intentionally happens after dice resolution, so canceling a pending
   * check does not silently resolve the scene.
   */
  commitActiveScene(session) {
    const scene = session.activeScene;
    if (!scene) return { event: null, revealedLocations: [] };

    const event = (session.scheduledEvents || []).find(candidate => candidate.id === scene.eventId);
    if (!event) {
      session.activeScene = null;
      return { event: null, revealedLocations: [] };
    }

    if (scene.kind === 'aftermath') {
      event.revealed = true;
      event.revealedAt = session.scenarioClock?.currentTime ?? null;
      session.activeScene = null;
      const revealedLocations = scenarioProgressService.revealLocations(
        session,
        scene.revealsLocations || []
      );
      return { event, revealedLocations, aftermath: true };
    }

    const resolution = this._resolveEvent(session, event, scene.branchKey, {
      visible: true,
      locationId: scene.resolutionLocationId || scene.locationId,
    });
    session.activeScene = null;
    return resolution;
  }

  applyNarrativeRuling(session, parsed = {}) {
    parsed = parsed || {};
    if (!session.scenarioClock) return { advanced: false, firedEvents: [], newlyEligibleEvents: [] };

    this._normalizeEvents(session);
    if (session.scenarioClock.mode === 'finale') {
      session.scenarioClock.turn = (session.scenarioClock.turn || 0) + 1;
      return {
        advanced: false,
        cost: 0,
        currentTime: session.scenarioClock.currentTime,
        deadlineReached: false,
        firedEvents: [],
        newlyEligibleEvents: [],
        revealedLocations: [],
        suspicionState: scenarioProgressService.getSuspicionState(session.suspicion),
        obstructionCost: 0,
        traumaCost: 0,
      };
    }
    const previous = toMinutes(session.scenarioClock.currentTime) ?? 0;
    const deadline = toMinutes(session.scenarioClock.deadline) ?? previous;
    const requested = Number(parsed.time_cost_minutes);
    const timeRules = session.scenarioRules?.time ?? {};
    const minimum = Number.isInteger(timeRules.minimumMinutes) ? timeRules.minimumMinutes : 10;
    const maximum = Number.isInteger(timeRules.maximumMinutes) ? timeRules.maximumMinutes : 60;
    const baseCost = Number.isInteger(requested) && requested > 0 ? requested : minimum;
    const suspicionState = scenarioProgressService.getSuspicionState(session.suspicion);
    const obstructionCost = suspicionState.id === 'watched' ? 5
      : suspicionState.id === 'obstructed' ? 10
        : suspicionState.id === 'crisis' ? 15 : 0;
    const activeTrauma = session.sanity?.activeTrauma;
    const traumaCost = Math.max(0, Math.min(15, Number(activeTrauma?.pendingTimePenaltyMinutes) || 0));
    if (traumaCost > 0 || activeTrauma?.expiresAfterNarrativeTurn) session.sanity.activeTrauma = null;
    const cost = Math.max(minimum, Math.min(maximum, baseCost)) + obstructionCost + traumaCost;
    const current = Math.min(deadline, previous + cost);
    session.scenarioClock.currentTime = formatMinutes(current);
    session.scenarioClock.turn = (session.scenarioClock.turn || 0) + 1;

    const newlyEligibleEvents = [];
    const firedEvents = [];
    for (const event of session.scheduledEvents || []) {
      const eventTime = toMinutes(event.at);
      if (eventTime === null || eventTime > current) continue;

      if (this._isLifecycleEvent(event)) {
        if (event.status === 'dormant') {
          event.status = 'eligible';
          event.eligibleAt = session.scenarioClock.currentTime;
          newlyEligibleEvents.push(event);
        }
      } else if (!event.fired) {
        // Compatibility for third-party/legacy definitions that still use the
        // old timestamp-only contract.
        event.fired = true;
        event.status = 'resolved';
        event.revealed = true;
        event.outcome = event.outcome || 'scheduled';
        firedEvents.push(event);
      }
    }

    const phaseEvent = [...(session.scheduledEvents || [])]
      .filter(event => event.status !== 'dormant' || event.fired)
      .sort((a, b) => (toMinutes(b.at) ?? -1) - (toMinutes(a.at) ?? -1))[0];
    if (phaseEvent?.phase) session.scenarioClock.phase = phaseEvent.phase;

    const revealedLocations = scenarioProgressService.revealLocations(
      session,
      firedEvents.flatMap(event => event.revealsLocations || [])
    );
    return {
      advanced: true,
      cost,
      currentTime: session.scenarioClock.currentTime,
      deadlineReached: current >= deadline,
      firedEvents,
      newlyEligibleEvents,
      revealedLocations,
      suspicionState,
      obstructionCost,
      traumaCost,
    };
  }

  applyStateRuling(session, parsed = {}, { userText = '' } = {}) {
    parsed = parsed || {};
    if (!session.scenarioId) return { evidenceChanges: [], suspicionState: null, crossedSuspicionState: null };

    const previousState = scenarioProgressService.getSuspicionState(session.suspicion);
    const delta = Number(parsed.suspicion_delta);
    if (Number.isFinite(delta)) session.suspicion = Math.max(0, Math.min(10, session.suspicion + Math.trunc(delta)));
    if (parsed.combat_update && typeof parsed.combat_update === 'object') session.combat = parsed.combat_update;

    const locationChanged = scenarioProgressService.updatePlayerLocation(session, parsed.current_location_id);
    if (locationChanged) {
      const player = session.npcs?.find(npc => npc.id === 'npc_000');
      if (player) player.locationId = locationChanged.id;
    }
    const inferredEvidenceChanges = scenarioProgressService.inferEvidenceChanges(
      session,
      userText || ''
    );
    const requestedEvidenceChanges = [...inferredEvidenceChanges, ...(parsed.evidence_changes || [])];
    const deduplicatedEvidenceChanges = [...new Map(
      requestedEvidenceChanges
        .filter(change => change && typeof change === 'object' && change.id)
        .map(change => [change.id, change])
    ).values()];
    const evidenceChanges = scenarioProgressService.applyEvidenceChanges(session, deduplicatedEvidenceChanges);
    const suspicionState = scenarioProgressService.getSuspicionState(session.suspicion);
    return {
      evidenceChanges,
      suspicionState,
      crossedSuspicionState: previousState.id !== suspicionState.id ? suspicionState : null,
      locationChanged,
    };
  }

  _normalizeEvents(session) {
    for (const event of session.scheduledEvents || []) {
      if (!EVENT_STATES.has(event.status)) {
        event.status = event.fired ? 'resolved' : 'dormant';
      }
      if (event.fired && event.status !== 'resolved' && event.status !== 'expired') {
        event.status = 'resolved';
      }
      if (event.revealed === undefined) event.revealed = Boolean(event.fired);
    }
    if (!session.scenarioFlags || typeof session.scenarioFlags !== 'object') session.scenarioFlags = {};
  }

  _isLifecycleEvent(event) {
    return Boolean(event?.placement || event?.branches || event?.latestAt || event?.absencePolicy);
  }

  _promoteEligibleEvents(session) {
    const current = toMinutes(session.scenarioClock?.currentTime);
    if (current === null) return [];
    const promoted = [];
    for (const event of session.scheduledEvents || []) {
      if (!this._isLifecycleEvent(event) || event.status !== 'dormant') continue;
      const earliest = toMinutes(event.at);
      if (earliest !== null && earliest <= current) {
        event.status = 'eligible';
        event.eligibleAt = session.scenarioClock.currentTime;
        promoted.push(event);
      }
    }
    return promoted;
  }

  _inferIntendedLocation(session, userText) {
    const text = String(userText || '');
    if (!MOVEMENT_WORDS.test(text)) return null;
    const matches = (session.locations || [])
      .filter(location => location?.id && (text.includes(location.id) || (location.name && text.includes(location.name))))
      .sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
    return matches[0]?.id || null;
  }

  _findAftermath(session, locationId) {
    if (!locationId) return null;
    return (session.scheduledEvents || [])
      .filter(event => (event.status === 'resolved' || event.status === 'expired')
        && event.revealed === false
        && event.resolutionLocationId === locationId
        && event.aftermathInstruction)
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))[0] || null;
  }

  _buildAftermathScene(event, locationId, intendedLocationId) {
    return {
      kind: 'aftermath',
      eventId: event.id,
      locationId,
      intendedLocationId,
      outcome: event.outcome,
      instruction: event.aftermathInstruction,
      playerCue: event.aftermathPlayerCue || '你抵达现场后，发现这里留下了无法忽视的变化与线索。',
      revealsLocations: clone(event.pendingRevealLocations || []),
      preparedAt: new Date().toISOString(),
    };
  }

  _decidePlacement(session, event, effectiveLocationId) {
    const placement = event.placement || { mode: 'global' };
    const current = toMinutes(session.scenarioClock?.currentTime) ?? 0;
    const latest = toMinutes(event.latestAt);
    const expired = latest !== null && current > latest;

    if (placement.mode === 'global') {
      const focus = placement.focusLocationId;
      const branchKey = focus && event.branches?.present && effectiveLocationId === focus
        ? 'present'
        : (focus && event.branches?.remote ? 'remote' : 'foreground');
      return { kind: 'foreground', branchKey, locationId: effectiveLocationId };
    }

    if (placement.mode === 'player_current') {
      return { kind: 'foreground', branchKey: 'foreground', locationId: effectiveLocationId };
    }

    const eventLocationId = placement.locationId;
    if (effectiveLocationId && effectiveLocationId === eventLocationId) {
      return { kind: 'foreground', branchKey: 'present', locationId: eventLocationId };
    }
    if (effectiveLocationId && this._areAdjacent(session, effectiveLocationId, eventLocationId)
      && event.branches?.nearby) {
      return { kind: 'foreground', branchKey: 'nearby', locationId: eventLocationId };
    }

    if (event.absencePolicy === 'defer' && !expired) return { kind: 'defer' };
    const branchKey = expired && event.branches?.expired ? 'expired' : 'absent';
    const branch = event.branches?.[branchKey] || {};
    if (branch.playerCue) {
      return {
        kind: 'foreground',
        branchKey,
        locationId: effectiveLocationId,
        resolutionLocationId: eventLocationId,
      };
    }
    return { kind: 'offscreen', branchKey, locationId: eventLocationId };
  }

  _areAdjacent(session, fromId, toId) {
    if (!fromId || !toId) return false;
    const graph = session.scenarioRules?.locationGraph || {};
    return Array.isArray(graph[fromId]) && graph[fromId].includes(toId);
  }

  _buildForegroundScene(event, branchKey, locationId, intendedLocationId, resolutionLocationId = null) {
    const branch = event.branches?.[branchKey] || event.branches?.foreground || {};
    return {
      kind: 'foreground',
      eventId: event.id,
      branchKey,
      outcome: branch.outcome || branchKey,
      locationId,
      resolutionLocationId,
      intendedLocationId,
      instruction: branch.instruction || event.text || '把这一事件自然地编入当前场景。',
      playerCue: branch.playerCue || '周围的局势突然发生变化，迫使你立刻作出回应。',
      preparedAt: new Date().toISOString(),
    };
  }

  _resolveEvent(session, event, branchKey, { visible, locationId } = {}) {
    const branch = event.branches?.[branchKey] || event.branches?.foreground || {};
    event.status = branchKey === 'expired' ? 'expired' : 'resolved';
    event.fired = true;
    event.outcome = branch.outcome || branchKey || 'resolved';
    event.resolvedAt = session.scenarioClock?.currentTime ?? null;
    event.resolutionLocationId = branch.aftermathLocationId
      || locationId
      || event.placement?.locationId
      || session.playerLocationId
      || null;
    event.revealed = Boolean(visible) && !branch.leavesAftermath;
    event.aftermathInstruction = event.revealed ? null : (branch.aftermathInstruction || null);
    event.aftermathPlayerCue = event.revealed ? null : (branch.aftermathPlayerCue || null);
    event.pendingRevealLocations = clone(branch.revealsLocations || event.revealsLocations || []);

    this._applyBranchConsequences(session, branch, event.resolutionLocationId);
    const revealedLocations = visible && !branch.leavesAftermath
      ? scenarioProgressService.revealLocations(session, event.pendingRevealLocations)
      : [];
    if (event.revealed) event.revealedAt = session.scenarioClock?.currentTime ?? null;

    return { event, revealedLocations, visible: Boolean(visible), branchKey };
  }

  _applyBranchConsequences(session, branch, resolutionLocationId) {
    for (const [npcId, update] of Object.entries(branch.npcUpdates || {})) {
      const npc = session.npcs?.find(candidate => candidate.id === npcId);
      if (!npc) continue;
      if (update.currentState) npc.currentState = update.currentState;
      if (update.locationId) npc.locationId = update.locationId;
      else if (branch.moveParticipantsToScene) npc.locationId = resolutionLocationId;
      if (update.visibility) npc.visibility = update.visibility;
      if (update.status) npc.status = update.status;
    }
    if (branch.combatUpdate) session.combat = clone(branch.combatUpdate);
    if (!session.scenarioFlags || typeof session.scenarioFlags !== 'object') session.scenarioFlags = {};
    Object.assign(session.scenarioFlags, branch.setFlags || {});
  }
}

export const scheduleService = new ScheduleService();
