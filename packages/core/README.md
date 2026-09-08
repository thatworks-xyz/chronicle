# @chronicle/core

Chronicle is an engine for building **timelines, LLM summaries, and analytics ("insights") over work-item change events** — the kind of data produced by project-management, training, CRM, and similar tools.

Storage, LLM providers, caching, access control, and connectors are all pluggable ports: the core has no database, queue, or vendor dependencies.

## The model

- **WorkItem** — one unit of work from a connected source (task, event, booking, document, CRM entry, …), identified by a UUID and its connector-native ids.
- **ChangeEvent** — one recorded change to a work item (created, status change, comment, …) at a point in time.
- **MetricSnapshot** — a point-in-time measurement attached to an item (counts, fill rates, tables). Only change-points are stored.
- **Timeline (context)** — everything known about a set of _scopes_ (root items) for a time window: resolved child items, condensed change summaries, scores, doc diffs. Addressable by a deterministic id and cached.
- **SummaryPreset** — a summary defined as data: filters, grouping, summarization settings, and optional prompt guidance (few-shot examples, focus prompts).
- **InsightConfig** — an analytics unit: fetch/group/analyze/format into a `VisualizationResult` (metric cards, tables, charts), with optional delta comparison and LLM-context caching.

## Quick start

```ts
import { ChronicleEngine, LlmClient } from '@chronicle/core';
import { createMongoRepositories } from '@chronicle/mongo';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL!);

const engine = new ChronicleEngine({
    ...createMongoRepositories(mongoose.connection),
    llm: new LlmClient({ anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } }),
});

// Register your connector's behaviors, presets, and insights
engine.connectorTraits.register({ id: 'my-crm', deepHierarchy: true });
engine.insights.register(myOpenDealsInsight);

const principal = { userId: 'user-1' };

// 1. Create a context (timeline) over some scopes
const ctx = await engine.createContext(principal, {
    scopes: [{ uuid: accountItemUuid, connector: 'my-crm', hierarchyType: 'MyCrmAccount' }],
    fromDateIso: '2026-01-01T00:00:00Z',
    timeZone: 'UTC',
});

// 2. Generate a summary for a preset
const summary = await engine.generateSummary(principal, ctx.id, myTasksPreset);

// 3. Run an insight
const insight = await engine.runInsight(principal, 'my_crm_open_deals', scopes, {
    fromDate: { type: 'ISO', isoDate: '2026-01-01T00:00:00Z', userIanaZone: 'UTC' },
});

// 4. Ingest fresh data from a connector
await engine.ingest(myCrmConnector, { userId: 'user-1' });
```

For tests and prototyping, `createInMemoryRepositories()` gives you a full set
of in-memory storage adapters — no database needed.

## Ports

| Port                                                                                                             | Purpose                                                                | Default                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `WorkItemRepository`, `ChangeEventRepository`, `MetricSnapshotRepository`, `DocDiffRepository`, `WatermarkStore` | storage                                                                | none — bring an adapter (`@chronicle/mongo` is the reference; in-memory adapters ship with core) |
| `KeyValueCache`                                                                                                  | timeline/prompt/insight caching                                        | in-memory                                                                                        |
| `LlmClient`                                                                                                      | chat completions (Anthropic / Bedrock / OpenAI-compatible protocols)   | none — summaries/LLM insights require one                                                        |
| `AccessControl`                                                                                                  | who can read which items                                               | permissive (single-tenant)                                                                       |
| `EngineConfig`                                                                                                   | model selections, ranking weights, limits, truncation                  | sensible defaults                                                                                |
| `ConnectorTraitsRegistry`                                                                                        | per-connector behaviors (hierarchy, prompt properties, grouping rules) | neutral defaults; connector packages register their traits                                       |
| `EngineHooks`                                                                                                    | e.g. trigger a data refresh when a timeline is requested               | none                                                                                             |

## Connectors

A connector is a `ConnectorSource` subclass (fetch changes → map to items/events)
plus `ConnectorTraits`, optional `MetricSnapshotConfig`s, `SummaryPreset`s, and
`InsightConfig`s. The `ingestion/` module provides the field-mapper helpers
(`mapItem`, `mapChangelog`) and an `IngestionRunner` that handles watermarks,
hash-guarded upserts, and metric snapshot computation.

Connector ids are open strings — Chronicle ships no fixed vendor list.

## HTTP layer

The engine is HTTP-agnostic: expose `createContext` / `generateSummary` /
`runInsight` through whatever transport you like, validating requests with
your own schemas.
