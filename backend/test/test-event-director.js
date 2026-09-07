import { BIRCH_STATION_TUTORIAL } from '../src/scenarios/birchStation.js';
import { ScheduleService } from '../src/services/ScheduleService.js';
import { necessarySettingsBuilder } from '../src/services/NecessarySettingsBuilder.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const definition = BIRCH_STATION_TUTORIAL;
const service = new ScheduleService();

function makeSession(eventIds, currentTime, playerLocationId) {
  const ids = Array.isArray(eventIds) ? eventIds : [eventIds];
  return {
    scenarioId: definition.id,
    scenarioRules: structuredClone(definition.scenarioRules),
    scenarioClock: { currentTime, deadline: '06:00', turn: 0, phase: 'investigation' },
    playerLocationId,
    locations: structuredClone(definition.locations),
    npcs: structuredClone(definition.npcs),
    scheduledEvents: definition.scheduledEvents
      .filter(event => ids.includes(event.id))
      .map(event => structuredClone(event)),
    activeScene: null,
    scenarioFlags: {},
    evidence: structuredClone(definition.evidence),
    suspicion: 0,
    combat: null,
    sanity: { activeTrauma: null },
  };
}

// Same global event, different protagonist position.
{
  const present = makeSession('blackout_0110', '01:10', 'loc_001');
  let prep = service.prepareTurn(present, { userText: '我继续观察许薇' });
  assert(prep.activeScene?.eventId === 'blackout_0110', 'due blackout should be selected before narration');
  assert(prep.activeScene?.branchKey === 'present', 'blackout should use the intervention branch when the player is with Xu Wei');
  assert(!present.scheduledEvents[0].fired, 'a queued foreground event must not resolve before narration/dice commit');
  const promptContext = necessarySettingsBuilder.build(present);
  assert(promptContext.includes('GM-ONLY ACTIVE SCENE DIRECTIVE') && promptContext.includes('人为停电'), 'queued event should be injected into the narrator context before prose is generated');
  const committed = service.commitActiveScene(present);
  assert(committed.event.status === 'resolved' && committed.event.revealed, 'present blackout should resolve as a witnessed event');
  assert(present.locations.some(location => location.id === 'loc_004'), 'witnessed blackout should reveal the roof access lead');

  const remote = makeSession('blackout_0110', '01:10', 'loc_005');
  prep = service.prepareTurn(remote, { userText: '我检查候车厅的画' });
  assert(prep.activeScene?.branchKey === 'remote', 'blackout should hide corridor details when the player is elsewhere');
  service.commitActiveScene(remote);
  assert(remote.scheduledEvents[0].revealed === false, 'remote blackout should leave unrevealed local aftermath');
  assert(!remote.locations.some(location => location.id === 'loc_004'), 'remote player must not learn the roof-access location immediately');
  remote.playerLocationId = 'loc_001';
  prep = service.prepareTurn(remote, { userText: '我回到头等包厢外' });
  assert(prep.activeScene?.kind === 'aftermath', 'returning to the corridor should stage the hidden blackout aftermath');
  service.commitActiveScene(remote);
  assert(remote.scheduledEvents[0].revealed, 'aftermath should become revealed only after the player encounters it');
  assert(remote.locations.some(location => location.id === 'loc_004'), 'aftermath investigation should reveal the roof-access lead');
}

// Record destruction supports present, adjacent, and remote outcomes.
{
  const present = makeSession('records_0240', '02:40', 'loc_006');
  let prep = service.prepareTurn(present);
  assert(prep.activeScene?.branchKey === 'present', 'player in the office should get a direct intervention window');

  const nearby = makeSession('records_0240', '02:40', 'loc_005');
  prep = service.prepareTurn(nearby);
  assert(prep.activeScene?.branchKey === 'nearby', 'adjacent player should get an interception window');

  const remote = makeSession('records_0240', '02:40', 'loc_001');
  prep = service.prepareTurn(remote);
  const event = remote.scheduledEvents[0];
  assert(!prep.activeScene && event.outcome === 'records_partially_destroyed', 'remote record destruction should resolve off-screen without a player announcement');
  assert(event.revealed === false && remote.scenarioFlags.records_partially_destroyed, 'off-screen outcome should update private world state');
  remote.playerLocationId = 'loc_006';
  prep = service.prepareTurn(remote, { userText: '我进入站务办公室' });
  assert(prep.activeScene?.kind === 'aftermath', 'later office entry should expose the record-destruction aftermath');
}

// A declared destination is considered when placing an event.
{
  const session = makeSession('records_0240', '02:40', 'loc_001');
  session.locations.push({ id: 'loc_006', ...definition.scenarioRules.locationCatalog.loc_006 });
  const prep = service.prepareTurn(session, { userText: '我赶到站务办公室阻止烧毁记录' });
  assert(prep.intendedLocationId === 'loc_006', 'movement intent should resolve a known destination');
  assert(prep.activeScene?.branchKey === 'present', 'arrival intent should allow a same-place intervention scene');
}

// Confession waits for co-location, then leaves a fallback after its window.
{
  const deferred = makeSession('confession_0310', '03:10', 'loc_001');
  let prep = service.prepareTurn(deferred);
  assert(!prep.activeScene && deferred.scheduledEvents[0].status === 'eligible', 'confession should wait rather than happen remotely at an exact timestamp');
  deferred.playerLocationId = 'loc_008';
  prep = service.prepareTurn(deferred);
  assert(prep.activeScene?.branchKey === 'present', 'co-location should stage the trust conversation');

  const expired = makeSession('confession_0310', '04:11', 'loc_001');
  prep = service.prepareTurn(expired);
  assert(!prep.activeScene && expired.scheduledEvents[0].status === 'expired', 'missed confession window should resolve to a fallback instead of blocking the plot');
  expired.playerLocationId = 'loc_008';
  prep = service.prepareTurn(expired);
  assert(prep.activeScene?.kind === 'aftermath', 'expired confession should leave a discoverable fallback hint');
}

// The seizure follows the protagonist and starts an objective-based conflict.
{
  const session = makeSession('seizure_0440', '04:40', 'loc_005');
  const prep = service.prepareTurn(session);
  assert(prep.activeScene?.locationId === 'loc_005', 'portable seizure should be staged at the protagonist current location');
  service.commitActiveScene(session);
  assert(session.combat?.active && session.combat.objective.includes('保护证据'), 'seizure should start a conflict with an explicit objective');
  assert(session.npcs.find(npc => npc.id === 'npc_003').locationId === 'loc_005', 'participating antagonist should move to the staged scene');
}

// Crossing a time threshold makes a modern event eligible; it does not narrate it after the fact.
{
  const session = makeSession('records_0240', '02:30', 'loc_001');
  const result = service.applyNarrativeRuling(session, { time_cost_minutes: 10 });
  assert(result.newlyEligibleEvents[0]?.id === 'records_0240', 'crossed event should become eligible');
  assert(result.firedEvents.length === 0 && !session.scheduledEvents[0].fired, 'crossed event should wait for location-aware preparation');
}

// Only one foreground interruption is selected; the rest remain eligible.
{
  const session = makeSession(['broadcast_0040', 'blackout_0110'], '01:10', 'loc_001');
  const prep = service.prepareTurn(session);
  assert(prep.activeScene?.eventId === 'blackout_0110', 'higher-priority foreground event should win the scene');
  assert(session.scheduledEvents.find(event => event.id === 'broadcast_0040').status === 'eligible', 'lower-priority event should remain queued for a later turn');
}

console.log(`${passed} passed`);
