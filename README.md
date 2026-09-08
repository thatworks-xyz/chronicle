# Chronicle

Chronicle turns activity from your work tools into summaries and analytics.

Say your team's work lives in a CRM, a project tracker, or a training platform. Things change all day: tasks get completed, deals move stages, bookings come in. Chronicle ingests that activity and lets you ask, for any part of the data and any time period:

- **"What happened under Acme Corp last week?"** → an LLM-written summary, with links back to each item it mentions
- **"How many tasks are open right now? How does that compare to last month?"** → computed metrics and charts

You write a small adapter (a "connector") that feeds your tool's data in. Chronicle handles the rest: storing items and their history, figuring out what's relevant in a time window, prompting the LLM, and computing metrics. It works with any database and any LLM provider — those are swappable pieces, and working defaults are included.

## Packages

| Package                              | Description                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [`@chronicle/core`](packages/core)   | The engine. Includes an in-memory storage option for trying things out. |
| [`@chronicle/mongo`](packages/mongo) | Stores the data in MongoDB instead.                                     |

Requires Node.js 22 or newer. See [Installation](#installation).

## Installation

The packages are not published to npm. Build them from this repository and install the resulting tarballs into your project:

```sh
git clone <this repository> && cd chronicle
npm ci
npm run build
npm pack -w packages/core -w packages/mongo
# produces chronicle-core-0.1.0.tgz and chronicle-mongo-0.1.0.tgz

# then, in your own project:
npm install /path/to/chronicle-core-0.1.0.tgz
npm install /path/to/chronicle-mongo-0.1.0.tgz   # only if you use MongoDB storage
```

## The concepts, by example

Imagine your CRM holds a company, **Acme Corp**, with a project and some tasks. The sections below cover every Chronicle concept using that example.

### The data

Chronicle stores your tool's data as two required units — items and their changelog — plus an optional third for analytics.

**WorkItem** — one thing being worked on: a company, a project, a task, a document. Work items link to their parents, mirroring your tool's own structure at any depth:

```
Acme Corp                          (company -> WorkItem)
├── Website revamp                 (project -> WorkItem)
│   ├── Design the homepage        (task -> WorkItem)
│   │   └── Pick a color palette   (subtask -> WorkItem)
│   └── Draft pricing copy         (task -> WorkItem)
└── Prepare launch checklist       (task -> WorkItem)
```

This tree is what makes questions like "what happened under Acme Corp?" answerable — Chronicle walks down from the company and gathers everything beneath it, however deep.

**ChangeEvent** — one entry in an item's changelog. Any change to an item is captured as a change event: the task was created, its status moved to Done, its description was edited, someone was assigned, a comment was added — each with a timestamp and who did it. Most tools only show you the current state of things; Chronicle stores the history of changes, which is what lets it answer questions about a time period. Summaries are written by reading the changelog for that period.

Items plus their changelog are enough for timelines and summaries to work. The third unit is optional:

**MetricSnapshot** — a pre-computed metric, saved over time. Take a derived number your tool doesn't store anywhere, like a task completion rate: "Acme Corp was at 67% completion on March 1st". Answering "how did completion trend this quarter?" from raw data would mean reconstructing every past state — slow, and impossible if the source doesn't keep history. Instead, your connector computes the rate during each data pull and Chronicle saves it whenever the value changes. Analytics then just read the saved series back. Skip snapshots entirely if you don't need analytics.

### Getting data in

**Connector** — the one piece of code that knows about your tool; everything else in Chronicle is generic. It has two jobs: fetch what changed since the last run (Chronicle tells it where it left off), and translate your tool's payloads into work items and change events. Write one connector and every Chronicle feature — summaries, insights, timelines — works for that tool.

### Asking questions

**Scope** — the item a question is about. Everything beneath the chosen item is included:

```
Scope: Acme Corp                       Scope: Website revamp

✓ Acme Corp                              Acme Corp
├── ✓ Website revamp                   ├── ✓ Website revamp
│   ├── ✓ Design the homepage          │   ├── ✓ Design the homepage
│   │   └── ✓ Pick a color palette     │   │   └── ✓ Pick a color palette
│   └── ✓ Draft pricing copy           │   └── ✓ Draft pricing copy
└── ✓ Prepare launch checklist         └──   Prepare launch checklist
```

Scopes are what users of your product would pick from a list — the same ingested data answers questions at every level of the tree without any extra setup.

**Context** — the collected picture of what happened for one scope and one time window: the relevant items, their changelog entries, and rankings of what matters most. Collecting all that takes work, so Chronicle does it once, saves the result under a stable id, and returns the same cached context whenever the same question is asked again. You create a context first, then run summaries against it — several different summaries can share one context.

**SummaryPreset** — a summary recipe, defined as data: which items to include, how to group them, how detailed to be. You'll usually want the same few summaries again and again ("weekly task highlights"); a preset captures that once, so your product can offer it as a menu option instead of hand-crafting a prompt each time.

**Insight** — a chart or metric your product can show for any scope: "task completion rate, with the trend against last month". You define once how to compute the number (usually by reading metric snapshots) and how to present it (metric card, table, chart); Chronicle then runs it for whichever scope and time period a user is looking at, and can compare periods for trends. This is how you build an analytics dashboard on top of the ingested data without writing per-customer query and charting code.

## Quick start

```ts
import { ChronicleEngine, createInMemoryRepositories, LlmClient } from '@chronicle/core';

// Storage. In-memory is great for trying things out; use @chronicle/mongo
// (or your own adapter) to persist for real.
const repos = createInMemoryRepositories();

// The LLM used to write summaries. The built-in client talks to Anthropic
// and OpenAI-compatible APIs; you can plug in any other provider.
const llm = new LlmClient({ anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } });

const engine = new ChronicleEngine({ ...repos, llm });

// Tell the engine about your connector and register any insights.
engine.connectorTraits.register({ id: 'my-crm', deepHierarchy: true });
engine.insights.register(openTasksInsight);

// Pull in fresh data. Run this on a schedule; each run only fetches
// what changed since the last one.
await engine.ingest(myCrmConnector, { userId: 'user-1' });

// Now ask questions. The "principal" is whoever is asking.
const principal = { userId: 'user-1' };
const scopes = [{ uuid: acmeCorpUuid, connector: 'my-crm', hierarchyType: 'MyCrmAccount' }];

// 1. "What happened under Acme Corp since Jan 1?"
const ctx = await engine.createContext(principal, {
    scopes,
    fromDateIso: '2026-01-01T00:00:00Z',
    timeZone: 'UTC',
});

// 2. "Summarize it." Returns markdown; links point back to your items.
const { summary } = await engine.generateSummary(principal, ctx.id, tasksPreset);

// 3. "How many tasks are open?" Returns a metric card to render.
const insight = await engine.runInsight(principal, 'open_tasks', scopes, {
    fromDate: { type: 'ISO', isoDate: '2026-01-01T00:00:00Z', userIanaZone: 'UTC' },
});
```

Chronicle has no opinion about how you expose this — wrap these three calls in whatever HTTP server, CLI, or job you already have.

## Start from the example app

[`examples/demo-app`](examples/demo-app) is a small, complete, heavily commented application: a fake CRM connector, one insight, one summary preset, and a tiny HTTP server. Every file explains what it's doing and why, so it doubles as a tutorial — copy it and swap the fake connector for your real one.

```sh
npm ci
npm run build
npm test                            # runs everything, no external services needed
node examples/demo-app/dist/main.js # or run the demo server on :3000
```

By default the example runs fully self-contained (in-memory storage, scripted LLM responses). Two environment variables switch in real infrastructure:

```sh
MONGO_URL=mongodb://localhost:27017/demo npm run e2e   # real MongoDB
ANTHROPIC_API_KEY=sk-... npm run e2e                   # real LLM
```

## Writing your own connector

Subclass `ConnectorSource` and implement two methods:

- `getChanges(fromDate, toDate)` — call your tool's API and return whatever changed in that window. Chronicle tells you where the last run left off.
- `map(userId, rawChanges)` — translate your tool's payloads into `WorkItem`s and `ChangeEvent`s.

That's the core of it. Optional extras: provide items that aren't part of the change feed (like the company itself), and define metric snapshot calculations that run after each ingest. The engine handles scheduling bookkeeping, skipping unchanged items, and deduplicating events.

The commented reference is [`examples/demo-app/src/connector.ts`](examples/demo-app/src/connector.ts).

## Swappable pieces

Everything external to the engine is an interface you can replace. You only need to think about the ones marked "none" below; the rest have working defaults:

| Piece                | What it does                                  | Default                                                      |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Storage repositories | persist items, events, snapshots              | none — use in-memory (ships with core) or `@chronicle/mongo` |
| `LlmService`         | writes the summaries                          | none — `LlmClient` covers Anthropic / OpenAI-compatible APIs |
| `KeyValueCache`      | caches contexts and LLM responses             | in-memory                                                    |
| `AccessControl`      | decides who can see which items               | everyone sees everything (fine for single-tenant)            |
| `EngineConfig`       | model choices, limits, where item links point | sensible defaults                                            |

Writing a storage adapter for another database means implementing the repository interfaces in `@chronicle/core`. The tests in `packages/core/src/testing/in-memory-repos.test.ts` spell out the behaviors an adapter must get right.

## Development

```sh
npm run watch     # recompile on change
npm test          # build + run all tests
npm run lint
npm run format
```

Tests use Node's built-in test runner (`node:test`) — there are no test framework dependencies. Packages compile to `dist/` (gitignored); published entry points reference the compiled output.

## License

MIT
