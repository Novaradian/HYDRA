# Contributing to HYDRA

Thanks for helping. A few things keep HYDRA consistent and safe to publish.

## Before you start
- Open an issue first for anything larger than a small fix, so the approach can be agreed.
- HYDRA must stay **offline**: no CDN links, no network calls at run time, no telemetry.
- Symbols follow **ISO 1219** (fluid power) and **IEC 60617** (electrical).

## Samples
Only **original** circuits can be added. Never submit a circuit copied from a manufacturer, a customer or an employer:
it may be confidential or copyrighted. Sample contributions are accepted under MIT / CC BY 4.0.

## Development
```
cd app
npm install
node build.mjs           # → dist/HYDRA
npm run typecheck
```
Open `dist/HYDRA/HYDRA.html` in Chrome or Edge to try your change.

## Tests
Run the suites that cover the area you changed (see `tests/README.md`), and add checks for new behaviour. A pull request
should not turn a passing suite red.

## Style
- TypeScript, Preact function components, signals for state; every project change goes through `S.mutate(label, recipe)`
  so undo / redo keeps working.
- User-facing text: short, plain English, sentence case.
- Colours come from the theme tokens in `app/src/styles.css` (`--panel`, `--ink`, `--acc` …), not hard-coded values.
  The operator panel keeps its own colours.
