# @chronicle/mongo

`@chronicle/mongo` is the reference persistent-storage adapter for `@chronicle/core`. It implements Chronicle's repository interfaces with MongoDB and Mongoose.

MongoDB maps naturally to Chronicle's data model: time-series collections retain change events and metric histories, while `$graphLookup` traverses work-item hierarchies. These are implementation choices, not core requirements; applications can supply equivalent repositories backed by other systems.

## Installation

The packages are not published to npm. Build and pack them from the repository, then install both tarballs:

```sh
npm ci
npm run build
npm pack -w packages/core -w packages/mongo
npm install /path/to/chronicle-core-0.1.1.tgz
npm install /path/to/chronicle-mongo-0.1.1.tgz
```

Requires Node.js 22 or newer and an application-managed Mongoose connection.

## Usage

```ts
import { ChronicleEngine, LlmClient } from '@chronicle/core';
import { createMongoRepositories } from '@chronicle/mongo';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL!);

const repos = createMongoRepositories(mongoose.connection);
const engine = new ChronicleEngine({
    ...repos,
    llm: new LlmClient({
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    }),
});
```

The caller owns the connection lifecycle, including connecting before constructing the repositories and disconnecting during shutdown.

## Collections

`createMongoRepositories()` returns the complete repository set expected by `ChronicleEngine`:

| Default collection     | Repository                      | Purpose                                                                                 |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `items`                | `MongoWorkItemRepository`       | Work items, hash-guarded upserts, and `$graphLookup` descendant resolution              |
| `changelog`            | `MongoChangeEventRepository`    | Change events in a time-series collection                                               |
| `metric_snapshots`     | `MongoMetricSnapshotRepository` | Metric change points in a time-series collection; reads can fall back before the window |
| `item_plain_text`      | `MongoDocDiffRepository`        | Extracted document text                                                                 |
| `item_plain_text_diff` | `MongoDocDiffRepository`        | Document diffs                                                                          |
| `chronicle_watermarks` | `MongoWatermarkStore`           | Per-user connector ingestion watermarks                                                 |

The adapter maps the flat `ChangeEvent` domain type to and from MongoDB's `{ time, meta, action }` time-series envelope.

On a fresh database, the change-event and metric-snapshot collections are created as time-series collections on first write. If collections with the configured names already exist, ensure their collection types and schemas are compatible before using them for Chronicle data.

## Custom collection names

Every collection name can be overridden:

```ts
const repos = createMongoRepositories(mongoose.connection, {
    collections: {
        items: 'my_chronicle_items',
        changeEvents: 'my_chronicle_events',
        metricSnapshots: 'my_chronicle_metrics',
        plainText: 'my_chronicle_text',
        plainTextDiffs: 'my_chronicle_diffs',
        watermarks: 'my_chronicle_watermarks',
    },
});
```

Models are created on the supplied connection. Existing models with the same names are reused.

## Using another storage system

MongoDB is optional. To use another database, implement the repository interfaces exported by `@chronicle/core` and supply them to `ChronicleEngine`. The expected behavior is demonstrated by the core in-memory implementations and their [contract tests](../core/src/testing/in-memory-repos.test.ts).

See the [core package guide](../core) for the full engine lifecycle and dependency table.
