# Roster JSON format

How to turn a roster screenshot into a file or pasted text that Court Commander imports.

## Workflow

1. Screenshot the opponent's roster (the roster page, the program, a MaxPreps or school-site table).
2. Give Claude the screenshot and the prompt below.
3. Copy Claude's JSON reply.
4. In Court Commander: **Manage Roster** (open the Home or Visitor roster, depending on where the team should be saved) > **Backup & Sharing** > **Paste JSON** > paste > **Import Pasted JSON**. Or save the reply as a `.json` file and use **Import**.
5. Read the preview. It lists every player the app understood, plus warnings (skipped rows, duplicate jerseys). Confirm only if it matches the screenshot.
6. The team is saved to that side's Saved Teams / Saved Opponents list. Import never changes what is on court, and it is disabled while a match is in progress (End Match first).

Names, jersey numbers and grades from a screenshot can be misread. Compare the preview with the screenshot before confirming. A wrong entry can be fixed afterward in Manage Roster.

## Prompt to paste with the screenshot

```text
Read the volleyball roster in the attached screenshot and reply with ONLY a
JSON code block in exactly this shape, nothing before or after it:

{
  "type": "court-commander-roster",
  "version": 1,
  "teamName": "<school or club name, as written on the page>",
  "roster": [
    { "name": "<first last>", "jersey": "<number as text, or empty>",
      "position": "<one of the allowed values, or empty>",
      "grade": "<Fr. | So. | Jr. | Sr., or empty>", "libero": false }
  ]
}

Rules:
- One object per player, in the order shown. Do not invent players, jersey
  numbers, positions or grades. If a value is not visible, use an empty
  string. Never guess.
- "jersey" is a string without "#", for example "12".
- "position" must be exactly one of: "Outside Hitter", "Middle Blocker",
  "Setter", "Right Side", "Libero", or "" if unknown. Map abbreviations
  (OH, MB, S, RS/Opp/OPP, L/Lib) to those words. Defensive specialists
  (DS) have no matching value: use "".
- "grade" must be "Fr.", "So.", "Jr.", "Sr." or "". Map 9/10/11/12 and
  Freshman/Sophomore/Junior/Senior to those.
- "libero" is true only for a player listed as a libero. For those players
  also set "position" to "Libero".
- Exclude coaches and staff.
- If the text is blurry or cut off, keep the player and leave the unreadable
  field empty. Do not drop the row.
- After the JSON block, add nothing.
```

For several teams at once (several screenshots), ask for the team-bank shape instead: replace the outer object with `{ "type": "court-commander-team-bank", "version": 1, "teams": [ { "name": "...", "roster": [ ... ] } ] }`.

## The unified format

Court Commander writes and reads one format. The two envelopes below are what **Export** produces, so an exported file always imports back unchanged.

### Single roster (`court-commander-roster`)

```json
{
  "type": "court-commander-roster",
  "version": 1,
  "teamName": "Example High",
  "roster": [
    { "name": "Jane Doe", "jersey": "12", "position": "Setter", "grade": "Jr.", "libero": false },
    { "name": "Alex Roe", "jersey": "3", "position": "Libero", "grade": "Sr.", "libero": true }
  ]
}
```

### Whole team list (`court-commander-team-bank`)

```json
{
  "type": "court-commander-team-bank",
  "version": 1,
  "teams": [
    { "name": "Example High", "roster": [ { "name": "Jane Doe", "jersey": "12" } ] },
    { "name": "Sample Prep",  "roster": [ { "name": "Kim Lee", "jersey": "7" } ] }
  ]
}
```

### Player fields

| Field | Type | Values | Notes |
|---|---|---|---|
| `name` | string | any | Required. Entries with no name are skipped and reported. |
| `jersey` | string | digits | Optional. A leading `#` is removed. Duplicates produce a warning. |
| `position` | string | `Outside Hitter`, `Middle Blocker`, `Setter`, `Right Side`, `Libero`, or empty | Unrecognized text becomes empty. |
| `grade` | string | `Fr.`, `So.`, `Jr.`, `Sr.`, or empty | Other text is kept as written. |
| `libero` | boolean | `true` / `false` | Also set to true when `position` is `Libero`. |

## Looser input the importer also accepts

The importer normalizes these, so a slightly different reply still loads. Prefer the exact shape above.

- No `type` or `version`.
- A bare array of players: `[ { "name": "Jane Doe", "jersey": "12" } ]`.
- `players` instead of `roster`; `team`, `team_name` or `name` instead of `teamName`.
- A bare array of team objects, each with a roster or players list, treated as a team list.
- Player keys: `player`, `playerName`, `fullName`, or `firstName` + `lastName` for the name; `number`, `num`, `no`, `#`, `jerseyNumber` for the jersey; `pos` for the position; `year`, `class`, `yr` for the grade.
- Position abbreviations (`OH`, `MB`, `S`, `RS`, `Opp`, `L`, `Lib`) and grade forms (`9`, `10th`, `Senior`).
- Plain-text players such as `"12 Jane Doe"`.
- A reply wrapped in a ```` ```json ```` fence, or with a sentence before or after the JSON, when pasted.

Anything else is rejected with "That file doesn't look like a Court Commander roster or team export." Nothing is saved when an import is rejected or you cancel the preview.

## Privacy

Rosters contain named students, many of them minors. This repository is public. Do not commit roster files, screenshots or exports to it. The app stores imported teams only in the browser's local storage on your device.
