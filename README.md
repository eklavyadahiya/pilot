# Pilot Training Tools

Static web app designed to work with GitHub Pages.

## Tools

1. Homepage (default)
2. Map + KMZ circuit viewer + wind vector calculator
3. Quiz / flashcards (derived from unified DV20 knowledge JSON)
4. In-Flight Guide (derived from unified DV20 knowledge JSON)
5. Weight & Balance (converted from `W_and_B_Versie_10.03_EFIS.xls`)

## Wind workflow (simple)

1. Enter a wind code like `31004KT` (direction FROM / speed in knots).
2. Click **Select Point On Map**.
3. Click the map where that windsock reading was observed.
4. Repeat for multiple nearby readings.

The app sums the vectors and shows the resultant wind **at EHHV**.
A dashed 50 km ring is shown around EHHV, and the summary includes how many readings are outside that radius.
Wind readings are saved in browser `localStorage` and restored on refresh.
Use **Reset Wind Data** to clear only wind-related saved page data.

## Distance measuring

1. Click **Start Measuring**.
2. Click points on the map to build a route.
3. Read per-segment and cumulative distance in both km and nm.
4. Enter speed in knots to get estimated elapsed time.
5. Drag any measure point to adjust the route live.
6. Use **Undo Last Point** to remove the latest point.
7. Click **Stop Measuring** or **Clear Measure** when done.

## Quiz / flashcards

- Questions are derived from `data/dv20-knowledge.json`.
- Category filter defaults to `All categories` and applies to both modes.
- **Start Quiz (50)**: randomizes from the selected category pool and serves up to 50.
- **Start Flashcards**: randomizes the selected category pool and reveals answer text only.
- Each question's options are built from `value` + `distractors` and shuffled once per page load.
- Source citations from the PDF are shown in quiz and flashcard feedback.
- Chair-flying practice categories include:
  - `Chair Flying - Mental Flows`
  - `Chair Flying - Phase Actions`
  - `Chair Flying - Full Sequence` (takeoff -> climb -> level flight -> climb -> descend -> turns -> downwind -> base -> final)

## Unified DV20 knowledge schema

All DV20 training facts are sourced from one file: `data/dv20-knowledge.json`.
The app derives all three views from it:
- Quiz questions (multiple-choice)
- Flashcards
- In-Flight Guide sections and items

```json
[
  {
    "id": "DV20-011",
    "category": "Performance & Limits",
    "type": "speed",
    "label": "Vy (best rate of climb)",
    "value": "70 kts",
    "note": "",
    "source": "General aircraft numbers - Speeds (p.17)",
    "question": "What is Vy (best rate of climb) for the DV20?",
    "distractors": ["58 kts", "65 kts", "90 kts"]
  }
]
```

Required fields per knowledge entry:
- `id` (string)
- `category` (string; used as guide section title and quiz category)
- `type` (string; e.g. `speed`, `limit`, `power`, `procedure`, `checklist`, `reference`)
- `label` (string; guide item label)
- `value` (string; correct quiz answer and primary flashcard answer)
- `question` (string; quiz/flashcard prompt)
- `distractors` (array of 3 strings)

Optional fields:
- `note` (string; extra context shown in guide/flashcards)
- `source` (string; citation from `PROCEDURES-DV20-V1.8-01052026.pdf`)

The unified knowledge file is sourced exclusively from `PROCEDURES-DV20-V1.8-01052026.pdf` (ACHA DV20 procedures, v1.8).

## Weight & Balance

- Aircraft registry data: `data/aircraft.json`
- Aircraft type limits/performance: `data/aircraft-types.json`
- Parity test cases: `data/wb-parity-cases.json`
- Calculation engine: `src/tools/weight-balance/engine.js`
- UI module: `src/tools/weight-balance/ui.js`

The tool reproduces workbook calculations, limit warnings, envelope chart points, and EFIS export values. Inputs are saved in browser `localStorage`.

## In-Flight Guide

- Guide content is derived from `data/dv20-knowledge.json`.
- Entries are grouped by `category`, with each item showing `type`, `label`, `value`, optional `note`, and `source`.
- Use section and search filters to quickly find a value/procedure/reference.

## Extending To More Aircraft

Current app path:
- `data/dv20-knowledge.json`

To extend:
1. Add a new aircraft knowledge file, e.g. `data/da40-knowledge.json`.
2. Keep the same unified schema so existing renderers continue working.
3. Add an aircraft selector later and map selected aircraft to the corresponding JSON paths.
4. Keep AFM/POH values conservative and checklist-aligned.

## Local run

Because browsers restrict `fetch()` from `file://`, run a local server:

```bash
python -m http.server 8080
```

Open <http://localhost:8080>.

## KMZ files

1. Put your KMZ files in `data/`.
2. Edit `data/kmz-manifest.json`:

```json
{
  "files": [
    "./data/your-file-1.kmz",
    "./data/your-file-2.kmz"
  ]
}
```

3. Reload the page if you changed the manifest.
4. Use the per-file toggle buttons to turn each KMZ layer on/off (multiple can be active).

## GitHub Pages deploy

This project is now configured for GitHub Pages via GitHub Actions.

### One-time setup on GitHub

1. Push this repository to GitHub.
2. Open repository **Settings** -> **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Keep your default branch as `main` (or update workflow branch trigger if you use a different branch).

### Deploy flow

- Workflow file: `.github/workflows/deploy-pages.yml`
- Trigger: every push to `main` (and manual `workflow_dispatch`)
- Publish target: repository root as static artifact

After pushing to `main`, GitHub will build and publish automatically. Your site URL will appear in the workflow summary and Pages settings.

### If you prefer branch deploy instead of Actions

Set Pages source to branch `main` and folder `/ (root)`.

## Git ignore policy

The project `.gitignore` is set to ignore document/spreadsheet binaries such as:

- `*.pdf`
- `*.xls`, `*.xlsx`, `*.xlsm`, `*.xlsb`
- `*.ods`, `*.doc`, `*.docx`, `*.ppt`, `*.pptx`

And it explicitly keeps:

- `*.json` (including `data/dv20-knowledge.json`)
- `*.kmz`
