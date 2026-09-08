import mongoose from 'mongoose';
import {
    MongoChangeEventRepository,
    MongoDocDiffRepository,
    MongoMetricSnapshotRepository,
    MongoWatermarkStore,
    MongoWorkItemRepository,
} from './repositories.js';

export * from './access.js';
export * from './repositories.js';
export * from './schemas.js';

export interface MongoRepositoryOptions {
    collections?: {
        items?: string;
        changeEvents?: string;
        metricSnapshots?: string;
        plainText?: string;
        plainTextDiffs?: string;
        watermarks?: string;
    };
}

/**
 * Creates the full set of Chronicle repository implementations over a mongoose
 * connection. Collection names default to the reference layout
 * (items / changelog / metric_snapshots / item_plain_text / item_plain_text_diff).
 *
 * NOTE: the change events and metric snapshots collections are MongoDB
 * time-series collections; on a fresh database they are created as such on
 * first write.
 */
export function createMongoRepositories(conn: mongoose.Connection, options?: MongoRepositoryOptions) {
    const c = options?.collections;
    return {
        items: new MongoWorkItemRepository(conn, c?.items),
        events: new MongoChangeEventRepository(conn, c?.changeEvents),
        snapshots: new MongoMetricSnapshotRepository(conn, c?.metricSnapshots),
        docDiffs: new MongoDocDiffRepository(conn, { diffs: c?.plainTextDiffs, plainText: c?.plainText }),
        watermarks: new MongoWatermarkStore(conn, c?.watermarks),
    };
}
