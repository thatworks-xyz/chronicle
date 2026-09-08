# @chronicle/mongo

MongoDB storage adapter for `@chronicle/core`: implements the repository ports
over Mongo collections.

- `items` — work items (hash-guarded upserts, `$graphLookup` descendant resolution)
- `changelog` — change events (MongoDB **time-series** collection; the flat
  `ChangeEvent` domain type is mapped to/from the `{time, meta, action}` envelope)
- `metric_snapshots` — metric snapshots (time-series; reads fall back to the
  latest snapshot before the window since only change-points are stored)
- `item_plain_text` / `item_plain_text_diff` — document text and diffs
- `chronicle_watermarks` — ingestion watermarks

```ts
import { createMongoRepositories } from '@chronicle/mongo';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL!);
const repos = createMongoRepositories(mongoose.connection);
```

Collection names are configurable; models are created on the given connection
(existing models with the same names are reused).
