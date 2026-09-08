# demo-app

A runnable Chronicle example that doubles as the end-to-end test: a synthetic
`demo-crm` connector ingests a deterministic company + tasks, and a minimal
`node:http` server exposes the engine.

```sh
npm run build                # from the repo root
npm run e2e                  # hermetic: in-memory storage + scripted LLM
node dist/main.js            # or run the server on :3000
```

Endpoints (all JSON):

- `POST /context` `{ fromDateIso, timeZone }` → `{ id, createdDateIso }`
- `POST /summary` `{ contextId }` → `{ presetId, summary }` (markdown with resolved item links)
- `POST /insight` `{ fromDateIso }` → `{ analysisId, visualization }` (open-tasks metric card)

Environment switches:

- `MONGO_URL=mongodb://localhost:27017/chronicle-demo` — use `@chronicle/mongo` instead of in-memory storage
- `ANTHROPIC_API_KEY=...` — use the real Anthropic API instead of the scripted LLM

The E2E test asserts exact outputs in hermetic mode and relaxes to structural
assertions when either env var is set.
