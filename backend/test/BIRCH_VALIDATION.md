# Birch Station pacing and finale validation

## Scene consistency correction — 2026-09-15

Added regressions for the exact reported negotiation on the first response to an
announced confrontation (including dice cancellation), portable witness testimony,
absent witnesses, copying held testimony without inventing a missing map, blackout
SAN, avoiding premature confession SAN, action-based expiry, and keeping ordinary
choices at pressure 20 while offering final choices at 24.

The four existing version-3 mock routes still finish at 27 meaningful actions;
the evidence route uses 28 submissions and proves four facts. Full backend tests
and frontend production build were rerun for this correction. No new live-provider
or interactive browser playthrough was performed; the September 13 live results
below are historical, not validation of this patch's prose quality. Keyword-based
intent and prose guards remain limited, not a general semantic consistency proof.

## Version 3 implementation validation — 2026-09-13

New tutorials now use acts and action pressure. The version 2 report below is
retained as historical coverage, not the current pacing specification.

`npm run test:hybrid` uses the real orchestrator with scripted provider responses,
reconstructing the session between actions. Checks are forced to succeed or fail;
damage dice remain random. This is regression coverage, not a seeded balance study.

| Scripted route | Meaningful actions including decision | Submissions | Proven facts | Result |
|---|---:|---:|---:|---|
| Cautious incomplete investigation | 27 | 27 | 0 | Complete |
| Failed physical checks | 27 | 27 | 0 | Complete; actual HP loss |
| Narrator never clears combat | 27 | 27 | 0 | Complete |
| Evidence preservation and movement | 27 | 28 | 4 | Complete; one free return journey |

Additional tests cover English preservation intents, partial compound evidence,
explicit receipts, missing prerequisites, null-stat NPC observation, finite wound
treatment, once-only horror exposure, grounding without SAN farming, dice
cancellation, an early commitment retained through combat and save/reload,
ending-generation failure fallback, and duplicate HTTP submission replay.

### Full real-provider automatic routes

`node test/live-birch.js <profile-id> --full` starts a fresh isolated tutorial,
follows option A outside the finale, confirms dice, and reconstructs the save
between submissions. These calls used actual configured APIs and quota. They did
not access browser saves and are not human playtests.

| Provider/model | Submissions through ending | Ending clock | Result |
|---|---:|---|---|
| SoCLaaS / qwen3.8:27b | 21 | 04:39 | Structured ending complete |
| DeepSeek / deepseek-v4-flash, rerun | 24 | 05:19 | Structured ending complete |

These routes chose an available early commitment after the central conflict. The
24–30 action target is not a minimum: an incomplete-case early ending is allowed.
The Qwen process was started before the final transport-fallback patch; the final
code's transport failure path is also covered by the offline regression suite.

The first DeepSeek full attempt reached ending generation but failed with
`finish_reason=length`: all 4096 output tokens were reasoning tokens. Ending
generation now catches transport/truncation failures and builds a structured
state-based closure. The subsequent full run completed; it does not establish
that providers will never exhaust their output allowance.

### Remaining limitations

- Real output still contained repeated motifs and invented or inconsistent item
  descriptions. Text guards catch selected patterns and substantial paragraph
  repetition, not every semantic contradiction. Engine inventory, evidence and
  damage are authoritative; fluent narration alone cannot grant them.
- Intent and observation recognition currently use authored keyword rules. Novel
  paraphrases, complex negation and implied actions need more player testing.
- Current unsafe-prose handling immediately substitutes an engine receipt; it
  does not perform a dedicated rewrite retry first. Fallback prose can be short.
- Duplicate-request replay is in-memory and bounded, not persistent idempotency
  across a server restart.
- Frontend production build and presentation tests pass. No interactive browser
  layout, Windows double-click launcher, or browser-save smoke test was performed
  as part of this redesign. Existing launcher work was preserved.

Restart the server/launcher and choose a **new 新手试炼** to test version 3. Existing
runs retain their pacing version and chronology. No commit or push was performed.

## Historical version 2 report

Date: 2026-09-12

## Offline full-run simulations

Run `npm run test:simulate` from `backend`. Uses the real orchestrator, scheduler,
evidence inference and save reconstruction on every action. Provider responses are
scripted, not an evaluation of human playability or model prose.

| Route | Completed actions including final choice | Post-deadline crisis actions | Proven facts | Result |
|---|---:|---:|---:|---|
| Exploratory (stationary investigation) | 25 | 0 | 0 | Complete, incomplete case |
| Guided evidence preservation and movement | 27 | 0 | 4 | Complete |
| High suspicion without actual obstruction | 25 | 0 | 0 | Complete, incomplete case |
| Failed finale checks | 30 | 3 | 0 | Complete, forced setback |
| Model never clears combat | 30 | 3 | 0 | Complete, forced setback |

The high-suspicion fixture intentionally has no actual obstruction: suspicion
alone must not tax every conversation. These routes do not establish a universal
24–30 action guarantee. Movement-heavy routes and extensive work differ.

`npm run test:finale` additionally covers saved resolution progress, cancellation,
explicit item surrender, successful checked escape, conflicting choices, departure
text filtering and a late remote records announcement's protected response window.
The existing `npm run test:all` and frontend `npm run build` pass.

## Real-provider finale smoke checks

Run `npm run test:live -- <profile-id>`. These checks seeded a 06:00 confrontation
in an isolated in-memory tutorial. They did not access browser saves or simulate
the preceding investigation.

| Configured model | Crisis actions | Final decision actions | Result |
|---|---:|---:|---|
| DeepSeek v4 flash | 1 | 1 | Complete ending |
| SoCLaaS Qwen 3.8 27b | 3 | 1 | Engine forced retreat, then complete ending |

Qwen retained combat and repeated parts of the confrontation before the third-action
fallback. Both providers still used some carriage/platform imagery in these synthetic
departure scenes. Departure filtering blocks explicit boarding offers, but does not
prove arbitrary prose is semantically consistent. Narrative continuity needs further
real-player testing; state-machine termination is the verified guarantee here.

Full live-provider playthroughs were **not** run. Add `--full` to the optional live
harness to run from a fresh tutorial (uses API quota, automatically follows option A
outside the finale). That scripted policy is not a substitute for a human playtest.

## Rollout

Restart the backend/player launcher to load the new engine. Existing saves receive
the finale budget correction and preserve their chronology. Start a new Birch Station
tutorial for the revised event schedule and server-controlled action costs.
Existing uncommitted launcher changes were preserved; nothing was committed or pushed.
