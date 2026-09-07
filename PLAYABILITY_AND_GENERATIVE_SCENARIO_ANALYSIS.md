# AI-TRPG Playability and Generative Scenario Analysis

Date: 2026-09-07

## Executive conclusion

The project already has a useful rules-and-state skeleton: strict structured LLM output, server-side dice, tracked entities, HP/SAN consequences, a tutorial clock, evidence state, and deterministic ending guards. The current Birch Station run is therefore more than a chat demo.

However, it still behaves like an LLM narrating around a collection of counters, rather than a game master running a coherent scenario. The central problem is the order of authority:

1. The LLM first writes what happened.
2. The server then updates location and advances time.
3. Every event whose timestamp was crossed is marked as fired and shown as a global system message.

That ordering prevents the narrator from staging a newly due event in the scene where it happens. It also means the event engine cannot account for the protagonist's location, NPC travel, prerequisites, intervention, or alternative outcomes. The result can be temporally correct but spatially and dramatically false.

The long-term solution should not be “let the narrator improvise more.” It should be a hybrid system:

- An AI scenario compiler creates a hidden, validated scenario graph before play.
- A deterministic world simulation owns time, location, reachability, event eligibility, evidence, and rule consequences.
- A scene director selects what is actually happening now.
- The narrator writes only from the already-adjudicated scene state.

The plot should be a flexible graph of revelations, situations, NPC goals, and possible climaxes—not a fixed sequence of prose and not pure turn-by-turn improvisation.

## What the current implementation actually does

### Birch Station

Birch Station has a pre-authored definition containing ten locations, six SAN events, eight clues, four truths, ten scheduled events, opening prose, NPCs, and initial state. This is a sound vertical-slice direction.

At runtime:

- `ScheduleService.applyNarrativeRuling` accepts the LLM's `time_cost_minutes`, clamps the base value, adds suspicion/trauma penalties, advances the clock, and fires every unfired event with `event.at <= currentTime`.
- Scheduled events have only `id`, `at`, `text`, `phase`, `revealsLocations`, `fired`, and `outcome`.
- They do not have a location, participants, prerequisites, visibility, a time window, priority, or outcome branches.
- `GameOrchestrator._applyScenarioRuling` updates the protagonist's location, advances time, and appends raw scheduled-event text after the LLM's narration has already been generated.
- The event's `outcome` is always initialized to `scheduled`; no service resolves a better/worse/interrupted outcome.
- SAN events do check time and current location, but they are a separate mechanism from scheduled plot events.

### Free runs

Normal runs generate a world summary, a character, optional key characters, and then a story opening. They do not generate or persist:

- a hidden premise or solution;
- plot goals or act/beat structure;
- a location graph;
- NPC agendas, knowledge, relationships, or whereabouts;
- clue/revelation redundancy;
- event rules;
- pacing clocks;
- non-death ending conditions.

For those sessions `scenarioId` and `scenarioClock` remain empty, and the prompt instructs the model to return neutral values for time, evidence, suspicion, combat, ending recommendation, and current location. The ordinary mode therefore lacks most of the mechanics that make the tutorial scenario game-like.

### Persistence

The README still describes SQLite persistence, but the active controller constructs a request-local repository from the complete session object sent by the browser. The browser saves the session in IndexedDB. The SQLite repository is not used by the active server entry point, and its schema does not persist the newer scenario fields.

This matters beyond deployment architecture:

- Clearing browser data loses saves.
- A disconnected or failed request has no authoritative committed server state.
- Retrying a dice request can produce a different result if the response was lost after execution.
- The client receives the complete secret scenario rules, clue catalogue, truths, event table, and hidden NPC data.
- Save payloads and chat history grow on every request and are constrained by the 2 MB Express body limit.

## The time-location-event problem

“An event happens at 02:40” is not a complete event rule. A tabletop GM also decides where it happens, who is present, whether the player can witness or interrupt it, and what changes if the player is elsewhere.

The current timestamp-only model conflates four distinct concepts:

- **Eligible:** the event is now allowed to happen.
- **Selected:** this event is the best dramatic development for the current scene.
- **Resolved:** its effects have been applied to world state.
- **Revealed:** the protagonist has perceived or learned about it.

Currently all four occur together when the clock crosses `at`. That creates several failure modes:

1. **Remote omniscience:** the player is told that an NPC fainted or destroyed records while somewhere else.
2. **No intervention:** being present at the right place cannot prevent or alter the fixed event text.
3. **Impossible staging:** an NPC can act at a location without tracked whereabouts or travel time.
4. **Narrative lag:** the model only learns about the event on the next request, after the player has already seen a system notification.
5. **Event bursts:** a long action can cross several timestamps and dump multiple unrelated events at once.
6. **Late horror:** a location-gated SAN event remains available indefinitely after its timestamp, so an old event can occur much later without an explicit expiry or transformed version.
7. **Discovery circularity:** authored movement accepts only already discovered location IDs, while several locations become discovered only when timed events reveal them.

### Recommended event lifecycle

Use `dormant -> eligible -> queued -> resolved | expired`, with revelation tracked separately.

An event should have at least:

```json
{
  "id": "records_destruction",
  "trigger": {
    "earliestTime": "02:30",
    "latestTime": "03:00",
    "conditions": ["power_restored", "cheng_yue_active"]
  },
  "placement": {
    "mode": "fixed",
    "locationId": "loc_006",
    "requiredParticipants": ["npc_003"]
  },
  "scope": "local",
  "priority": 80,
  "branches": {
    "playerPresent": "contest_destruction",
    "playerNearby": "chance_to_intercept",
    "playerAbsent": "records_partially_destroyed",
    "expired": "residual_clue_remains"
  },
  "status": "dormant"
}
```

Placement modes should cover:

- `fixed`: the world event occurs at a specific place.
- `player_current`: a portable dramatic beat is staged where the protagonist is, if its actors can plausibly reach that place.
- `actor_current`: an event follows an NPC's actual position.
- `global`: a broadcast, blackout, weather change, or train departure affects all locations.
- `evidence_current`: an antagonist targets wherever a tracked object or evidence bundle is stored.

If the protagonist is not present at a local event, resolve it off-screen without narrating omniscient details. Apply world-state consequences and create perceivable traces, rumors, missing objects, changed NPC states, or fallback clues for later discovery.

### Birch Station examples

- **01:10 blackout:** This is global. If the player is with Xu Wei, make it a foreground interruption and allow prevention of the suitcase swap. If elsewhere, update Xu Wei and the suitcase off-screen; reveal only lights going out now and the aftermath later.
- **02:40 record destruction:** This is fixed at the station office and should have a window. Presence allows intervention; being nearby may allow an intercept; absence produces damaged records plus a guaranteed residual clue.
- **03:10 Lin Wan confession:** This should not be a pure clock event. It becomes eligible after 03:10 only if trust, safety, co-location, and relevant questions are satisfied. Otherwise Lin Wan can seek the player, leave a map, remain silent, or be intercepted by an antagonist.
- **04:40 evidence seizure:** This should target the current evidence holder/location. It may follow the protagonist only if the antagonists know where the evidence is and can arrive through the location graph in time.

## Other high-priority playability gaps

| Priority | Gap | Current player impact | Normal TRPG expectation |
| --- | --- | --- | --- |
| Critical | Narration happens before simulation | Prose, time, events, dice, and state can disagree within one turn | GM adjudicates the attempted action and changing situation before describing the result |
| Critical | No NPC location or agenda state | NPCs teleport, remain passive until narrated, or act impossibly | NPCs have goals, knowledge, positions, and off-screen actions |
| Critical | Free mode has no scenario plan | Stories meander, reveal arbitrary facts, forget objectives, and struggle to end | GM knows the situation, secrets, clues, threats, and likely climaxes |
| Critical | Browser owns the entire session | Secret plot data is visible; lost responses and retries can reroll outcomes; saves are device-local | GM-only information and committed game state are authoritative and hidden |
| High | Time cost is an unconstrained narrative judgment | Similar actions cost inconsistent amounts; meta questions and trivial inputs can consume ten minutes | Time follows understandable action and travel rules, with GM exceptions |
| High | Event effects are fixed text, not state transitions | Earlier player choices do not change scheduled outcomes | Events branch according to intervention and prior consequences |
| High | Evidence discovery is keyword-based | Naming a clue keyword can award it without a successful fictional approach; failure may still lock the route | Clues follow valid methods and checks; core revelations have redundant paths and fail-forward outcomes |
| High | Ending selection can override player intent | Full proof always maps to `truth_exposed`, even if the player chose suppression or destruction | The finale reflects the player's explicit decision plus achieved state |
| High | Final-choice detection uses a text regex | Negations, questions, “leave the room,” and hypothetical statements can look like final choices | The game asks for and records an explicit structured commitment |
| High | Deadline is checked before a confirmed roll resolves | A player can confirm a check at the deadline and receive an ending instead of the promised roll | The current action resolves atomically, then the deadline consequence occurs |
| High | Dice cancellation is not a clean rollback | The player action remains in history and the canceled narration remains in persisted display state, although the visible bubble is removed until reload | Canceling before commitment either retracts the intent completely or becomes an in-fiction refusal with a clear cost |
| High | Combat is stored but not governed | `combat_update` records an object, but no engine checks objectives, rounds, initiative, reach, or exit conditions | Conflicts have turns, stakes, legal actions, and non-lethal completion conditions |
| Medium | Suspicion promises more than it implements | The UI says opponents may restrict or seize evidence, but the engine primarily adds time | Threat state causes explicit, testable changes in access, behavior, and event priority |
| Medium | Choices have no IDs or preconditions | Suggested options can be stale, impossible, or combine several actions at one low cost | Choices are current affordances; freeform remains available and impossible actions get clarification |
| Medium | Every reply is pushed toward 300–700 Chinese characters and four options | Conversation is slow, over-written, and can resolve more than the player intended | The GM varies response length and stops at the next meaningful decision |
| Medium | Memory is prose-only | Summaries can omit unresolved promises, NPC knowledge, clue provenance, and causal facts | GM notes preserve structured facts and open threads separately from narration recap |
| Medium | Setup saves only the short world summary | Nuance from the longer world impression is lost before scenario generation | The scenario compiler receives explicit canon, themes, constraints, and player preferences |
| Medium | Mystery UI exposes totals and conclusions | Exact evidence/truth counts and some clue descriptions turn discovery into a checklist or reveal deductions early | A player notebook shows known observations; GM truth and total solution structure remain hidden |
| Medium | Arbitrary worldview is still hard-coded to CoC 7e | Genres that need heroic, social, romantic, or tactical mechanics are forced through HP/SAN and CoC skills | Setting/genre and ruleset are separate choices or a clearly communicated fixed pairing |

### Specific correctness concerns worth fixing early

1. State and evidence changes in a pre-roll `NARRATION_I` output are applied before the roll. A clue can therefore be awarded even when its check later fails.
2. Evidence state is not monotonic; a later model response can set an already secured clue back to unsecured.
3. Existing evidence updates are reported again as new “discovered/secured” messages, which can spam or confuse progression feedback.
4. Multiple due events are all marked fired. There is no one-foreground-event-per-scene policy, deferral, conflict resolution, or priority.
5. `chooseEndingType` bases the result mainly on proof completeness, suspicion, and deadline, not a structured player choice.
6. The tutorial opening front-loads names, relationships, and likely clue connections—including a hidden antagonist—before the player can discover them. This reduces mystery and creates high initial cognitive load.
7. Players can manually edit locations, NPCs, and inventory in the same interface used for play. Unless explicitly presented as a sandbox/GM mode, this can break authored invariants and confuse what is canonical.

## Recommended runtime architecture

The cleanest design is a four-layer turn pipeline.

```text
Player intent
    -> Intent/adjudication layer
    -> Deterministic world and rules simulation
    -> Scene director
    -> Narrative renderer
    -> Committed turn + player-visible output
```

### 1. Intent/adjudication layer

Convert free text or a selected option into a bounded `ActionIntent`:

```json
{
  "kind": "investigate",
  "actorId": "npc_000",
  "targetIds": ["evidence_005"],
  "destinationId": "loc_006",
  "method": "search_records",
  "riskAccepted": true,
  "declaredGoal": "save the original dispatch log"
}
```

This layer can ask one concise clarification when the target or intended risk is ambiguous. It should not write the final prose.

### 2. Deterministic world/rules simulation

The server should own:

- current location and a connected location graph;
- NPC locations, goals, knowledge, attitudes, and resources;
- travel and action time;
- event eligibility, priority, resolution status, and hidden consequences;
- check selection and dice results;
- HP/SAN/resources/status effects;
- clue discovery, custody, destruction, and revelation progress;
- end-condition eligibility.

The model may suggest a time modifier or unusual consequence, but the service validates it against action type, route cost, and scenario bounds.

### 3. Scene director

The director selects one coherent scene from the committed state:

- What is foreground now?
- Which actors are physically present?
- Did a due event interrupt, combine with, or remain off-screen from the attempted action?
- What does the protagonist perceive?
- What unresolved decision should end the response?
- Which two or three suggestions are genuinely legal and useful now?

This can be deterministic for simple cases and use a small structured LLM call for ambiguous dramatic selection.

### 4. Narrative renderer

The final LLM call receives a scene packet whose facts are already decided. It renders atmosphere, dialogue, and consequences but cannot create proof, move actors, alter time, or select an ending outside the packet.

Response length should be scene-sensitive: short for dialogue and failed/impossible actions, longer for discoveries and transitions. Stop before choosing the protagonist's next action.

### Atomicity

A turn should commit exactly once. Use a server-side session revision plus an idempotent `turnId`:

- The client sends `sessionId`, `expectedRevision`, `turnId`, and player intent—not the whole authoritative scenario.
- A retry with the same `turnId` returns the same committed dice and narration.
- A stale revision is rejected or reconciled.
- Partial LLM failure does not leave time advanced without a visible result, or a dice result delivered without persisted state.

## Generating plots and places for any requested worldview

### Add a scenario-compilation phase

Insert a `SCENARIO_PLANNING` phase between character setup and story opening. It may be invisible to the player except for a short loading/progress view.

The input should be a structured campaign brief rather than only a prose world summary:

- worldview canon and hard constraints;
- genre and tone;
- desired player fantasy;
- intended length and session count;
- mystery/action/social/exploration emphasis;
- lethality and difficulty;
- ruleset profile;
- content boundaries and themes to avoid;
- protagonist hooks and invited-character roles;
- desired linearity versus sandbox freedom.

### Generate a scenario graph, not a screenplay

The scenario compiler should produce two views.

**GM-only scenario bible**

- central situation and hidden truth;
- antagonist/faction goals and escalation plans;
- revelation graph and redundant clue sources;
- location graph with travel costs, access conditions, and scene tags;
- NPC agendas, knowledge, relationships, starting positions, and likely movements;
- flexible dramatic beats and escalation clocks;
- event definitions with eligibility and branch outcomes;
- climax candidates and ending eligibility;
- fail-forward routes and recovery nodes.

**Player-facing campaign pitch**

- premise, tone, known setting, initial hook, and safety expectations;
- no hidden truths, exact clue totals, secret actors, or event schedule.

### Validate and repair before play

Never trust a generated scenario merely because it matches JSON Schema. Run semantic validation:

- Every referenced ID exists.
- The starting location connects to all required regions.
- Every required revelation has at least two, preferably three, independent clue paths.
- No single failed roll can make every viable ending unreachable.
- NPC movement and event timing are physically possible.
- Each event has a valid foreground, off-screen, and expiry behavior where applicable.
- At least one conclusion is reachable within the target turn/time budget.
- Required capabilities exist in the selected ruleset.
- Player-facing text contains no GM-only secrets.

Have a repair pass correct validation errors, then reject/regenerate if hard invariants still fail.

### Keep generation bounded during play

Pre-generate the structural skeleton and only lazily expand detail:

- Generate location summaries and connections up front; elaborate sensory details on first visit.
- Generate important NPC motives and capabilities up front; elaborate dialogue and mannerisms in scene.
- Generate truth, clue topology, threats, and ending logic up front; improvise local complications within validated slots.
- Allow genuinely unexpected player actions to create new nodes, but attach them to the existing graph and re-run reachability checks.

This gives the AI freedom without letting canon and causality drift each turn.

### Separate worldview from ruleset

If “any worldview” still means “every story uses CoC 7e,” say so explicitly and generate settings compatible with investigative horror mechanics. If it means any genre, introduce a `RulesetProfile` abstraction for:

- resolution mechanics and success levels;
- character resources and conditions;
- conflict procedures;
- advancement/recovery;
- genre-specific stakes;
- available action/check types.

Otherwise a superhero, court romance, cozy mystery, or space-opera world will still be forced into SAN loss and CoC skill assumptions.

## Practical implementation roadmap

### Phase 0: Make Birch Station internally coherent

Implementation note (2026-09-07): the first vertical slice is now implemented for the event lifecycle, location graph, NPC positions, the four named event branches, pre-narration scene directives, post-roll turn settlement, transactional dice cancellation, monotonic evidence state, and structured final-choice tracking. Deterministic action-cost classification, fully validated clue methods, richer relationship/knowledge simulation, and server-authoritative persistence remain follow-up work.

1. Add `activeScene`, a location graph, NPC `locationId`, and evidence custody/location.
2. Replace `fired` timestamps with the event lifecycle and placement model above.
3. Convert the four most important events—blackout, record destruction, confession, and seizure—to explicit outcome branches.
4. Move event selection before final narration.
5. Resolve a confirmed action and roll before testing the deadline.
6. Replace ending regexes with an explicit final-decision interaction and make ending selection choice-aware.
7. Make core clue acquisition fail-forward and state-validated instead of keyword-awarded.
8. Fix dice cancellation so chat, display log, options, and pending state all roll back together—or treat cancellation as a new in-fiction choice rather than rollback.

Completion criterion: the same timestamp event produces coherent but different outcomes when the player is present, nearby, or elsewhere, and no player sees information their character could not perceive.

### Phase 1: Stabilize the game loop

1. Split adjudication/simulation from narration.
2. Use deterministic action/travel cost bands with bounded AI modifiers.
3. Implement NPC goals, relationship/trust, knowledge, and off-screen turns.
4. Implement combat/conflict objectives and exits in the rule layer.
5. Replace prose-only memory with structured canon, open threads, promises, and last-known actor state.
6. Move authoritative state and GM-only data to persistent server storage with revisioned, idempotent turns.
7. Hide developer “god's eye” information in a separate development mode.

Completion criterion: reloads, retries, and long sessions preserve exactly one coherent state, and state changes can be explained from rules and prior actions.

### Phase 2: Generate reusable scenarios

1. Add the campaign brief and `SCENARIO_PLANNING` flow.
2. Define versioned `ScenarioDefinition` and `ScenarioRuntimeState` schemas.
3. Build semantic validators for graph reachability, clue redundancy, timing, and ending viability.
4. Compile several test scenarios of different genres and lengths.
5. Run automated playthrough simulations with conservative, aggressive, distracted, adversarial, and freeform player policies.
6. Measure completion rate, contradiction rate, average turns, clue starvation, event invisibility, repeated actions, and ending diversity.

Completion criterion: generated scenarios pass validation and remain finishable under multiple play styles without the narrator inventing core truth during play.

### Phase 3: Support arbitrary genres and campaigns

1. Add ruleset/genre profiles.
2. Support multi-session fronts, downtime, advancement, and recap.
3. Add controlled scenario graph expansion when players leave the prepared region.
4. Add author/debug tools to inspect event queues, reachability, hidden state, and causality without exposing them to players.

## Suggested test matrix

The current unit suite and Vite build pass, but they mainly confirm the implemented mechanics, including the timestamp-only behavior. Add semantic playability tests:

- Player is present / adjacent / remote for every major event.
- Player prevents, delays, accelerates, or causes an event.
- One action crosses several event thresholds.
- An event becomes eligible but cannot yet be staged.
- NPC cannot reach the required location in time.
- Player asks a meta question or performs a zero-time inspection.
- Player repeats, combines, aborts, or changes an action before commitment.
- Connection drops before and after dice commitment; retry returns the same result.
- Every core check fails; at least one weaker clue path remains.
- Player has full proof but chooses suppression, preservation, destruction, or withdrawal.
- Negated and hypothetical ending statements do not end the game.
- A long session survives multiple summaries without losing open promises or actor locations.
- Generated scenario references are valid, all required locations are reachable, and all endings have satisfiable conditions.

## Recommended immediate decision

Do not start by generalizing the current timestamp array into AI-generated timestamps. That would reproduce the same flaw at a larger scale.

First rebuild Birch Station around a location-aware event lifecycle and a pre-narration simulation/director step. Once that vertical slice demonstrates coherent intervention, off-screen consequences, fallback clues, and choice-aware endings, extract the scenario schema and let AI populate it for new worldviews.

That sequence preserves the project's strongest idea—AI as a creative game master—while putting causality, fairness, and finishability under dependable game-system control.
