import { scenarioProgressService } from './ScenarioProgressService.js';

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

export class ScheduleService {
  applyNarrativeRuling(session, parsed = {}) {
    parsed = parsed || {};
    if (!session.scenarioClock) return { advanced: false, firedEvents: [] };

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

    const firedEvents = [];
    for (const event of session.scheduledEvents || []) {
      const eventTime = toMinutes(event.at);
      if (!event.fired && eventTime !== null && eventTime <= current) {
        event.fired = true;
        event.outcome = event.outcome || 'scheduled';
        firedEvents.push(event);
      }
    }
    const phase = [...(session.scheduledEvents || [])].reverse().find(event => event.fired)?.phase;
    if (phase) session.scenarioClock.phase = phase;
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
    const inferredEvidenceChanges = scenarioProgressService.inferEvidenceChanges(
      session,
      `${userText || ''}\n${parsed.narration || ''}`
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
}

export const scheduleService = new ScheduleService();
