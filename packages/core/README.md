# @chronicle/core

`@chronicle/core` is Chronicle's database-independent engine for turning changing, hierarchical work data into a queryable history for grounded summaries and insights.

It handles incremental ingestion, hierarchy traversal, context selection and ranking, summary generation, and insight execution. Storage, LLM providers, caching, access control, and source connectors sit behind interfaces; core has no database, queue, or vendor dependency.

## Installation

The package is not published to npm. Build and pack it from the repository, then install the resulting tarball in your project:

```sh
npm ci
npm run build
npm pack -w packages/core
npm install /path/to/chronicle-core-0.1.1.tgz
```

Requires Node.js 22 or newer.

## Quick start

This example uses the in-memory repositories included with core. Replace them with `@chronicle/mongo` or your own repository implementations for persistence.

```ts
import { ChronicleEngine, createInMemoryRepositories, LlmClient, TimelineDateType } from '@chronicle/core';

const engine = new ChronicleEngine({
    ...createInMemoryRepositories(),
    llm: new LlmClient({
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    }),
});

engine.connectorTraits.register({ id: 'my-crm', deepHierarchy: true });
engine.insights.register(openDealsInsight);

const principal = { userId: 'user-1' };
const scopes = [
    {
        uuid: accountItemUuid,
        connector: 'my-crm',
        hierarchyType: 'MyCrmAccount',
    },
];

// Ingest before querying. Later runs resume from the stored watermark.
await engine.ingest(myCrmConnector, { userId: principal.userId });

const context = await engine.createContext(principal, {
    scopes,
    fromDateIso: '2026-01-01T00:00:00Z',
    timeZone: 'UTC',
});

const { summary } = await engine.generateSummary(principal, context.id, tasksPreset);

const insight = await engine.runInsight(principal, 'open_deals', scopes, {
    fromDate: {
        type: TimelineDateType.Iso,
        isoDate: '2026-01-01T00:00:00Z',
        userIanaZone: 'UTC',
    },
});
```

`myCrmConnector`, `openDealsInsight`, `tasksPreset`, and the item UUID are application-defined. The [demo app](../../examples/demo-app) contains complete implementations that run without external services.

Chronicle does not include an HTTP server. Call the engine from your existing server, worker, or job runner.

## Core concepts

- **WorkItem** — one item from a connected source, such as a company, project, task, booking, or document. It has a Chronicle UUID, retains its connector-native identifiers, and may link to parent items.
- **ChangeEvent** — one recorded change to a work item, such as its creation, a status change, or a comment, at a particular time.
- **MetricSnapshot** — a point-in-time measurement attached to an item. Chronicle stores change points, allowing insights to read counts, rates, tables, and trends that the source did not retain.
- **Scope** — the root item for a question. Context and insight operations can include its descendants, so one ingest supports queries at several levels of a hierarchy.
- **Context** — the relevant items and condensed changes for a set of scopes and a time window. Its internal representation is a ranked timeline. A deterministic id makes the context inspectable, reproducible, and reusable across summaries.
- **SummaryPreset** — a summary recipe defined as data: filters, grouping, level of detail, and optional prompt guidance.
- **InsightConfig** — the definition of an insight: applicability, data selection, analysis, period comparison, and formatting into a `VisualizationResult` such as a metric card, table, or chart.

## Engine dependencies

| Dependency                                                                                                       | Purpose                                                               | Default                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `WorkItemRepository`, `ChangeEventRepository`, `MetricSnapshotRepository`, `DocDiffRepository`, `WatermarkStore` | Store Chronicle data                                                  | none — use the in-memory implementations, `@chronicle/mongo`, or your own adapter |
| `LlmService`                                                                                                     | Generate summaries and LLM-assisted insights                          | none — `LlmClient` implements Anthropic and OpenAI-compatible protocols           |
| `KeyValueCache`                                                                                                  | Cache contexts, prompts, model responses, and insight context         | in-memory                                                                         |
| `AccessControl`                                                                                                  | Decide which items a principal may read                               | permissive; suitable only for local or single-tenant use                          |
| `EngineConfig`                                                                                                   | Configure models, ranking weights, limits, truncation, TTLs, and URLs | built-in defaults                                                                 |
| `ConnectorTraitsRegistry`                                                                                        | Describe hierarchy and prompt behavior for each connector             | neutral behavior until traits are registered                                      |
| `EngineHooks`                                                                                                    | Integrate application behavior such as refreshing before context load | none                                                                              |

`LlmClient` speaks the Anthropic Messages protocol and OpenAI-compatible chat-completions protocols over HTTPS. For Bedrock, a private gateway, an SDK-based transport, or another protocol, implement `LlmService` directly.

## Storage adapters

The engine depends only on repository interfaces. `createInMemoryRepositories()` supplies a complete implementation for tests, prototypes, and single-process evaluation. `@chronicle/mongo` is the reference persistent adapter, using time-series collections for change events and metric snapshots and `$graphLookup` for hierarchy traversal.

Another database—or a combination of systems—can provide the same capabilities by implementing the repository interfaces. The behavioral contract is exercised by [`src/testing/in-memory-repos.test.ts`](src/testing/in-memory-repos.test.ts).

## Connectors and ingestion

A connector subclasses `ConnectorSource` and implements two operations:

- Fetch source changes for the window Chronicle supplies.
- Map source payloads into `WorkItem`s and `ChangeEvent`s.

Connector traits, metric snapshot configurations, summary presets, and insight configurations belong to the surrounding integration; they are not methods on `ConnectorSource`.

`IngestionRunner` manages watermarks, hash-guarded item upserts, duplicate-event removal, and metric snapshot calculation. Connector ids are open strings; Chronicle ships no fixed list of vendors.

## Summaries

`createContext()` builds or reuses a ranked context for a principal, a set of scopes, and a time window. `generateSummary()` applies a `SummaryPreset` to that context and returns a `SummaryResult` containing the rendered summary, format, and preset id.

The model emits item-link tokens rather than URLs. Chronicle resolves those tokens through `EngineConfig.itemLink`, so every generated link points to an ingested item. If no item-link configuration is supplied, links degrade to plain text.

## Insights

Register an `InsightConfig` once and call `runInsight()` for any applicable scopes and time window. An insight can read the item graph, change history, document diffs, and metric snapshots; compare the current period with earlier periods; and return a typed visualization.

Insights may be entirely computed or may use an LLM for interpretation. The analysis logic—not the model—remains responsible for deterministic figures.

## Access control

The default `AccessControl` implementation is deliberately permissive. It is appropriate for local evaluation and single-tenant deployments only. Multi-tenant applications must provide an implementation that converts the calling `Principal` into repository access filters.

## Further reading

- [Chronicle overview](../../README.md)
- [MongoDB adapter](../mongo)
- [Runnable demo](../../examples/demo-app)
