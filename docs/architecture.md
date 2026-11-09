# Court Commander v2: architecture and decisions

## 1. Match engine (src/core/engine.js)

A match is an append-only event log. Nothing about the live game state is stored; `replay(match)` folds the log into a view (sets, score, serve, rotation, lineup, libero, substitutions used, timeouts, rally records).

Events: `set.start`, `rally`, `sub`, `libero.in`, `libero.out`, `timeout`, `stat`, `set.end`, `match.end`.

Consequences:

| v1 defect | v2 behaviour |
| --- | --- |
| X7: undo left the undone point's stats in place | Stats are derived from the same log; undo removes them. |
| X6: undo after Start New Set rolled back the previous set while set history kept it | Undo pops one event. Undoing a set start returns to between-sets; undoing a set-winning rally reopens the set. |
| X1: Tampa Prep team kills never counted | Team totals are summed from rallies. |
| X5: reloading a bank team regenerated player ids and orphaned saved rotations | Player ids are stable; the seed sync preserves ids by name. |
| Roster edits between sets created orphaned court players | A match snapshots both rosters at creation. Team edits apply to the next match; no roster lock is needed. |
| U5: a point scored while the stat prompt was open could lose its timeline entry | The rally is committed on tap. The stat sheet amends that same event (`amendRally`). |

Commands validate against the current view and return `{ ok, match, event }` or `{ ok: false, error }`. The UI never mutates match state directly. Undo and redo operate on the event list; redo is session-only.

Replay cost: a full five-set match replays in well under 5 ms (unit-tested), so the view is recomputed on every change and memoised per match object.

## 2. Court geometry (src/core/rules.js)

- Zone index `z = zone number - 1`; `z = 0` is zone 1 (server). Front row is `z = 1..3`.
- Lineup slot `s` is the serving order on the lineup card. After `r` side-out rotations, zone `z` holds slot `(z + r) mod 6`. A side-out moves the zone-2 player to zone 1.
- The libero is an overlay on a slot. It leaves automatically when that slot rotates into the front row.

## 3. Rules profile (NFHS defaults)

| Rule | Value | Source |
| --- | --- | --- |
| Set target | 25, win by 2, no cap | NFHS |
| Deciding set | 15 (best of 3 and best of 5) | NFHS default; state associations may adopt 25 for best of 3. Configurable. |
| Team substitutions per set | 18 | NFHS 10-3-1. v1 and the earlier iOS rules document used 12. Configurable (12/15/18). |
| Re-entry | A player is bound to one lineup position per set and may only return there | NFHS 10-3-3 |
| Libero | Back row only, not counted as a substitution, may not enter as a regular substitute | NFHS |
| Timeouts | 2 per set, 60 s | NFHS |
| Toss | Set 1 (visiting captain calls) and the deciding set (home captain calls); serve alternates otherwise | NFHS 5-4 |
| Side change | Flagged when a team reaches 8 in the deciding set | NFHS |

Rules values are copied into each match at creation, so changing settings never alters a match in progress.

## 4. Statistics (src/core/stats.js)

Rally codes: credited to the winner `K`, `ACE`, `BLK`; charged to the loser `SE`, `E`, `RE`, `BHE`, `NET`; `PT` when unattributed. Serve attempts come from the server recorded on every rally. Plus/minus counts every rally a player was on court. Rotation +/- groups rallies by our serving slot.

Hitting percentage at player level counts recorded attempts only (kills and errors). Zero-result attacks are not captured live, so team-level hitting percentage is not presented.

## 5. Persistence (src/app/store.js, src/core/model.js)

- Key `courtCommander.v2`: the whole document (teams, selection, setup, live match, archive, saved lineups, planner notes, whiteboard, settings).
- First launch with no v2 document migrates `courtCommanderState_v1`. The v1 key is never modified or deleted, so the v1 build can still be restored.
- Migration carries teams, rosters, saved rotations (matched to players by name), settings, match history and whiteboard strokes. A v1 match in progress becomes a History entry marked "carried over" because v1 did not record lineups and substitutions as replayable events.
- Autosave: 250 ms debounce plus flush on `pagehide` and `visibilitychange`.
- Two tabs: each tab claims an owner key; when another tab claims it, this tab stops writing and offers "Use it here instead".
- Backup files: `{ type: 'court-commander-backup', version: 2, doc }`. Restore also accepts v1 backups.
- All loaded and restored text is stripped of `<`, `>` and `"`; the UI renders text nodes only.

## 6. Build

`scripts/build.mjs` bundles with esbuild (Preact with JSX, IIFE, Safari 15+), inlines CSS, fonts and images as data URLs, and writes `index.html` (339 KB versus 743 KB for v1). The inline script is escaped against `</script` sequences.

## 7. Open items

- Native iPad (SwiftUI) track: the engine's event model maps directly onto the Command pattern in the iOS plan; `src/core` is the reference implementation to port.
- Apple Pencil is supported on the whiteboard through Pointer Events pressure; a PencilKit version belongs to the native track.
- Offline install (service worker) is not added; the single file already runs without a network once loaded.
