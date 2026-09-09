# Chronicle demo app

This runnable example shows Chronicle end to end without requiring a database or LLM account. A synthetic `demo-crm` connector ingests a company and its tasks, while a small `node:http` server exposes context, summary, and insight operations.

The same application also serves as the repository's end-to-end test.

## Run the server locally

From the repository root:

```sh
npm ci
npm run build
npm run start -w examples/demo-app
```

The server starts on [http://localhost:3000](http://localhost:3000), ingests the deterministic demo data, and uses in-memory repositories with scripted LLM responses.

Set `PORT` to listen on another port:

```sh
PORT=4000 npm run start -w examples/demo-app
```

## Call the API

All endpoints accept and return JSON. Create a context first, then pass its `id` to the summary endpoint:

```sh
curl -s -X POST http://localhost:3000/context \
  -H 'Content-Type: application/json' \
  -d '{"fromDateIso":"2026-01-01T00:00:00Z","timeZone":"UTC"}'

curl -s -X POST http://localhost:3000/summary \
  -H 'Content-Type: application/json' \
  -d '{"contextId":"<id returned by /context>"}'

curl -s -X POST http://localhost:3000/insight \
  -H 'Content-Type: application/json' \
  -d '{"fromDateIso":"2026-01-01T00:00:00Z"}'
```

| Endpoint        | Request                     | Response                                                      |
| --------------- | --------------------------- | ------------------------------------------------------------- |
| `POST /context` | `{ fromDateIso, timeZone }` | `{ id, createdDateIso }`                                      |
| `POST /summary` | `{ contextId }`             | `{ presetId, summary }`, with resolved item links in Markdown |
| `POST /insight` | `{ fromDateIso }`           | `{ analysisId, visualization }`, containing a metric card     |

## Run the end-to-end test

From the repository root:

```sh
npm run build
npm run e2e
```

The default test is hermetic: it uses in-memory storage and a scripted LLM, requires no network services, and asserts exact outputs. It exercises ingestion, idempotent re-ingestion, deterministic context ids, link resolution, and insight execution through the HTTP layer.

## Use MongoDB

Set `MONGO_URL` when starting the server or test to replace the in-memory repositories with `@chronicle/mongo`:

```sh
MONGO_URL=mongodb://localhost:27017/chronicle-demo npm run start -w examples/demo-app
MONGO_URL=mongodb://localhost:27017/chronicle-demo npm run e2e
```

Use a dedicated development database. Chronicle creates its time-series collections on first write in a fresh database.

## Use Anthropic

Set `ANTHROPIC_API_KEY` to replace the scripted LLM with the Anthropic Messages API:

```sh
ANTHROPIC_API_KEY=... npm run start -w examples/demo-app
ANTHROPIC_API_KEY=... npm run e2e
```

`MONGO_URL` and `ANTHROPIC_API_KEY` can be set independently or together. When either is present, the end-to-end test uses structural assertions rather than requiring every scripted value to match.

## Where to look

| File                                   | What it demonstrates                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| [`src/connector.ts`](src/connector.ts) | Source fetching, item and event mapping, and metric snapshots           |
| [`src/server.ts`](src/server.ts)       | Engine wiring, connector traits, the summary preset, and HTTP endpoints |
| [`src/insight.ts`](src/insight.ts)     | A snapshot-backed metric-card insight                                   |
| [`src/llm.ts`](src/llm.ts)             | Scripted and Anthropic-backed `LlmService` implementations              |
| [`src/e2e.test.ts`](src/e2e.test.ts)   | The complete ingest-to-output lifecycle                                 |

The HTTP server is illustrative, not part of Chronicle. Bring your own framework, authentication, and request validation in a real application.
