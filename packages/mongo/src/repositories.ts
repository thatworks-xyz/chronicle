import {
    AccessFilter,
    ChangeEvent,
    ChangeEventRepository,
    ConnectorId,
    ConnectorItemId,
    DocDiffRepository,
    getChangeEventActionIdForDeduplication,
    getHashedItem,
    MetricSnapshot,
    MetricSnapshotRepository,
    PlainTextDiffEntry,
    WatermarkStore,
    WorkItem,
    WorkItemRepository,
    WorkItemUpsertResult,
} from '@chronicle/core';
import mongoose from 'mongoose';
import {
    changeEventAccessQuery,
    metricSnapshotAccessQuery,
    plainTextAccessQuery,
    plainTextDiffAccessQuery,
    workItemAccessQuery,
} from './access.js';
import {
    ChangeEventDoc,
    ItemPlainTextDiffDoc,
    ItemPlainTextDoc,
    makeChangeEventModel,
    makeItemPlainTextDiffModel,
    makeItemPlainTextModel,
    makeMetricSnapshotModel,
    makeWatermarkModel,
    makeWorkItemModel,
    MetricSnapshotDoc,
    WatermarkDoc,
} from './schemas.js';

function getItemQueryForConnectorIds(idsFromConnector: ConnectorItemId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: mongoose.FilterQuery<any> = {};
    query['idsFromConnector.idFromConnector'] = idsFromConnector.idFromConnector;
    if (!idsFromConnector.idIsUnique) {
        query['idsFromConnector.connectorObjectType'] = idsFromConnector.connectorObjectType;
        query['idsFromConnector.connectorUserId'] = idsFromConnector.connectorUserId;
    }
    if (idsFromConnector.additionalIdFromConnector) {
        query['idsFromConnector.additionalIdFromConnector'] = idsFromConnector.additionalIdFromConnector;
    }
    return query;
}

// ============================================================================
// Work items
// ============================================================================

export class MongoWorkItemRepository implements WorkItemRepository {
    private readonly _model: ReturnType<typeof makeWorkItemModel>;

    constructor(conn: mongoose.Connection, collectionName?: string) {
        this._model = makeWorkItemModel(conn, collectionName);
    }

    async getByUuids(uuids: string[], access: AccessFilter): Promise<WorkItem[]> {
        if (uuids.length === 0) {
            return [];
        }
        const res = await this._model
            .find({ $and: [{ uuid: { $in: uuids } }, workItemAccessQuery(access)] }, undefined, { lean: true })
            .exec();
        return (res as unknown as WorkItem[]) || [];
    }

    async getByConnectorIds(
        userId: string,
        connector: ConnectorId,
        ids: ConnectorItemId,
    ): Promise<WorkItem | undefined> {
        const query = getItemQueryForConnectorIds(ids);
        query.connector = connector;
        query.userId = userId;
        const res = await this._model.findOne(query, undefined, { lean: true }).exec();
        return (res as unknown as WorkItem) || undefined;
    }

    async getByParent(
        parentUuid: string,
        access: AccessFilter,
        opts?: { connectorObjectType?: string; updatedSince?: Date },
    ): Promise<WorkItem[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: mongoose.FilterQuery<any> = { 'parents.itemUuid': parentUuid };
        if (opts?.connectorObjectType) {
            query['idsFromConnector.connectorObjectType'] = opts.connectorObjectType;
        }
        if (opts?.updatedSince) {
            query.lastUpdate = { $gt: opts.updatedSince };
        }
        query.deleted = { $exists: false };
        const res = await this._model
            .find({ $and: [query, workItemAccessQuery(access)] }, undefined, { lean: true })
            .exec();
        return (res as unknown as WorkItem[]) || [];
    }

    async getDescendantUuids(
        rootUuids: string[],
        access: AccessFilter,
        opts: { maxDepth: number; maxItems: number },
    ): Promise<string[]> {
        if (rootUuids.length === 0) {
            return [];
        }
        type GraphQueryResult = { results: { uuid: string }[] };
        const accessControlFilter = workItemAccessQuery(access);
        const maxDepth = opts.maxDepth === Number.MAX_SAFE_INTEGER ? undefined : opts.maxDepth;

        const graphLookup = await this._model
            .aggregate<GraphQueryResult>(
                [
                    {
                        $match: {
                            uuid: { $in: rootUuids },
                            ...accessControlFilter,
                        },
                    },
                    {
                        $graphLookup: {
                            from: this._model.collection.collectionName,
                            startWith: '$uuid',
                            connectFromField: 'uuid',
                            connectToField: 'parents.itemUuid',
                            as: 'results',
                            ...(maxDepth !== undefined && { maxDepth }),
                            // Ensure we apply access control at each step of the lookup
                            restrictSearchWithMatch: accessControlFilter,
                        },
                    },
                    {
                        $project: { 'results.uuid': 1 },
                    },
                ],
                { allowDiskUse: true },
            )
            .exec();

        const uuids = new Set<string>();
        for (const row of graphLookup) {
            if (!Array.isArray(row.results)) {
                continue;
            }
            for (const r of row.results) {
                uuids.add(r.uuid);
                if (uuids.size >= opts.maxItems) {
                    return Array.from(uuids);
                }
            }
        }
        return Array.from(uuids);
    }

    async getByConnectorObjectTypes(
        userId: string,
        connector: ConnectorId,
        connectorObjectTypes: string[],
        connectorUserId?: string,
    ): Promise<WorkItem[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: mongoose.FilterQuery<any> = {
            userId,
            connector,
            'idsFromConnector.connectorObjectType': { $in: connectorObjectTypes },
            deleted: { $exists: false },
        };
        if (connectorUserId) {
            query['idsFromConnector.connectorUserId'] = connectorUserId;
        }
        const res = await this._model.find(query, undefined, { lean: true }).exec();
        return (res as unknown as WorkItem[]) || [];
    }

    async getUuidsByConnector(
        connector: ConnectorId,
        access: AccessFilter,
        opts?: { updatedSince?: Date },
    ): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: mongoose.FilterQuery<any> = { connector, deleted: { $exists: false } };
        if (opts?.updatedSince) {
            query.lastUpdate = { $gt: opts.updatedSince };
        }
        return this._model.distinct('uuid', { $and: [query, workItemAccessQuery(access)] }).exec();
    }

    async upsertIfChanged(items: { item: WorkItem; forceUpdate?: boolean }[]): Promise<WorkItemUpsertResult> {
        const result: WorkItemUpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
        await Promise.all(
            items.map(async ({ item, forceUpdate }) => {
                const hashedItem = getHashedItem(item);

                const exists = (await this._model.exists({ uuid: hashedItem.uuid })) !== null;

                const updateQuery = getItemQueryForConnectorIds(hashedItem.idsFromConnector);
                updateQuery.userId = hashedItem.userId;
                updateQuery.uuid = hashedItem.uuid;

                if (!forceUpdate) {
                    updateQuery.hash = { $ne: hashedItem.hash };
                }

                const res = await this._model.updateOne(updateQuery, { $set: hashedItem }, { upsert: !exists }).exec();

                if (!res.acknowledged) {
                    throw new Error(`Failed to write or update item to database`);
                }
                if (res.upsertedCount > 0) {
                    result.inserted++;
                } else if (res.modifiedCount > 0) {
                    result.updated++;
                } else {
                    result.unchanged++;
                }
            }),
        );
        return result;
    }
}

// ============================================================================
// Change events
// ============================================================================

function toChangeEvent(doc: ChangeEventDoc): ChangeEvent {
    return {
        timestamp: doc.time,
        itemUuid: doc.meta.itemUuid,
        userId: doc.meta.userId,
        connector: doc.meta.connector,
        idsFromConnector: doc.meta.idsFromConnector,
        action: doc.action,
    };
}

function toChangeEventDoc(event: ChangeEvent): ChangeEventDoc {
    return {
        time: event.timestamp,
        meta: {
            itemUuid: event.itemUuid,
            userId: event.userId,
            connector: event.connector,
            idsFromConnector: event.idsFromConnector,
        },
        action: event.action,
    };
}

export class MongoChangeEventRepository implements ChangeEventRepository {
    private readonly _model: ReturnType<typeof makeChangeEventModel>;

    constructor(conn: mongoose.Connection, collectionName?: string) {
        this._model = makeChangeEventModel(conn, collectionName);
    }

    async getSortedBatch(q: {
        itemUuids: string[];
        access: AccessFilter;
        from: Date;
        to?: Date;
        limitPerItem?: number;
    }): Promise<ChangeEvent[]> {
        if (q.itemUuids.length === 0) {
            return [];
        }

        const pipeline: mongoose.PipelineStage[] = [
            {
                $match: {
                    'meta.itemUuid': { $in: q.itemUuids },
                    ...changeEventAccessQuery(q.access),
                    time: { $gt: q.from, ...(q.to && { $lt: q.to }) },
                },
            },
            {
                $sort: {
                    time: -1,
                },
            },
        ];

        if (q.limitPerItem) {
            pipeline.push(
                {
                    $group: {
                        _id: '$meta.itemUuid',
                        items: { $push: '$$ROOT' },
                    },
                },
                {
                    $project: {
                        _id: 1,
                        items: { $slice: ['$items', q.limitPerItem] },
                    },
                },
            );
        } else {
            pipeline.push({
                $group: {
                    _id: '$meta.itemUuid',
                    items: { $push: '$$ROOT' },
                },
            });
        }

        const results = await this._model.aggregate<{ _id: string; items: ChangeEventDoc[] }>(pipeline).exec();

        // Deduplicate per item (multiple identical actions can be recorded)
        const events: ChangeEvent[] = [];
        for (const result of results) {
            const seenKeys = new Set<string>();
            for (const doc of result.items) {
                const event = toChangeEvent(doc);
                const key = getChangeEventActionIdForDeduplication(event, {
                    includeTimestamp: true,
                    includingEntityId: true,
                });
                if (seenKeys.has(key)) {
                    continue;
                }
                seenKeys.add(key);
                events.push(event);
            }
        }
        return events;
    }

    async getChangedItemUuids(itemUuids: string[], from: Date, to?: Date): Promise<string[]> {
        if (itemUuids.length === 0) {
            return [];
        }
        return this._model
            .distinct('meta.itemUuid', {
                'meta.itemUuid': { $in: itemUuids },
                time: { $gt: from, ...(to && { $lt: to }) },
            })
            .exec();
    }

    async hasEvents(
        userId: string,
        itemUuid: string,
        match?: { fromStatusCategory?: string; toStatusCategory?: string },
    ): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: mongoose.FilterQuery<any> = {
            'meta.userId': userId,
            'meta.itemUuid': itemUuid,
        };
        if (match?.fromStatusCategory) {
            query['action.property.from.statusCategory'] = match.fromStatusCategory;
        }
        if (match?.toStatusCategory) {
            query['action.property.to.statusCategory'] = match.toStatusCategory;
        }
        const found = await this._model.findOne(query, undefined, { lean: true }).exec();
        return found !== null;
    }

    async store(events: ChangeEvent[]): Promise<void> {
        if (events.length === 0) {
            return;
        }
        const docs = events.map(toChangeEventDoc);
        const res = await this._model.insertMany(docs, { rawResult: true });
        if (!res.acknowledged || res.insertedCount !== docs.length) {
            throw new Error(
                `Failed to write change events. Expected number ${docs.length}. Inserted number: ${res.insertedCount}.`,
            );
        }
    }
}

// ============================================================================
// Metric snapshots
// ============================================================================

function toMetricSnapshot(doc: MetricSnapshotDoc): MetricSnapshot {
    return {
        timestamp: doc.time,
        itemUuid: doc.meta.itemUuid,
        connectorUserId: doc.meta.connectorUserId,
        connector: doc.meta.connector,
        userId: doc.meta.userId,
        snapshotConfigUuid: doc.meta.snapshotConfigUuid,
        measurement: doc.snapshot.measurement,
        measurementHash: doc.snapshot.measurementHash,
    };
}

function toMetricSnapshotDoc(s: MetricSnapshot): MetricSnapshotDoc {
    return {
        time: s.timestamp,
        meta: {
            itemUuid: s.itemUuid,
            connectorUserId: s.connectorUserId,
            connector: s.connector,
            userId: s.userId,
            snapshotConfigUuid: s.snapshotConfigUuid,
        },
        snapshot: {
            measurement: s.measurement,
            measurementHash: s.measurementHash,
        },
    };
}

export class MongoMetricSnapshotRepository implements MetricSnapshotRepository {
    private readonly _model: ReturnType<typeof makeMetricSnapshotModel>;

    constructor(conn: mongoose.Connection, collectionName?: string) {
        this._model = makeMetricSnapshotModel(conn, collectionName);
    }

    private async getLatestDoc(itemUuid: string, snapshotConfigUuid: string): Promise<MetricSnapshotDoc | undefined> {
        const found = await this._model
            .aggregate<MetricSnapshotDoc>([
                {
                    $match: {
                        'meta.itemUuid': itemUuid,
                        'meta.snapshotConfigUuid': snapshotConfigUuid,
                    },
                },
                { $sort: { time: -1 } },
                { $limit: 1 },
            ])
            .exec();
        return found[0];
    }

    async getForDateRange(q: {
        userId: string;
        access: AccessFilter;
        itemUuid: string;
        snapshotConfigUuid: string;
        from: Date;
        to: Date;
    }): Promise<MetricSnapshot[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const match: mongoose.FilterQuery<any> = {
            time: { $gte: q.from, $lt: q.to },
            'meta.itemUuid': q.itemUuid,
            'meta.snapshotConfigUuid': q.snapshotConfigUuid,
            ...metricSnapshotAccessQuery(q.access),
        };

        const found = await this._model
            .aggregate<MetricSnapshotDoc>([{ $match: match }, { $sort: { time: -1 } }])
            .exec();

        if (found.length > 0) {
            return found.map(toMetricSnapshot);
        }

        // Fall back to the latest available snapshot if it predates the analysis period
        // (the metric system only stores when values change, so stable items may not have recent snapshots)
        const latest = await this._model
            .aggregate<MetricSnapshotDoc>([
                {
                    $match: {
                        'meta.itemUuid': q.itemUuid,
                        'meta.snapshotConfigUuid': q.snapshotConfigUuid,
                        ...metricSnapshotAccessQuery(q.access),
                    },
                },
                { $sort: { time: -1 } },
                { $limit: 1 },
            ])
            .exec();

        if (latest[0] && new Date(latest[0].time) < q.from) {
            return [toMetricSnapshot(latest[0])];
        }

        return [];
    }

    async getLatest(itemUuid: string, snapshotConfigUuid: string): Promise<MetricSnapshot | undefined> {
        const doc = await this.getLatestDoc(itemUuid, snapshotConfigUuid);
        return doc ? toMetricSnapshot(doc) : undefined;
    }

    async storeIfChanged(snapshots: MetricSnapshot[]): Promise<number> {
        if (snapshots.length === 0) {
            return 0;
        }
        let stored = 0;
        await Promise.all(
            snapshots.map(async (snapshot) => {
                const lastEntry = await this.getLatestDoc(snapshot.itemUuid, snapshot.snapshotConfigUuid);
                const lastEntryHash = lastEntry?.snapshot.measurementHash || undefined;
                if (lastEntryHash !== snapshot.measurementHash) {
                    const res = await this._model.insertMany([toMetricSnapshotDoc(snapshot)], { rawResult: true });
                    if (!res.acknowledged || res.insertedCount !== 1) {
                        throw new Error(
                            `Failed to write metric snapshot with config id ${snapshot.snapshotConfigUuid} and item id ${snapshot.itemUuid}`,
                        );
                    }
                    stored++;
                }
            }),
        );
        return stored;
    }

    async replaceForItem(itemUuid: string, snapshotConfigUuid: string, snapshots: MetricSnapshot[]): Promise<void> {
        await this._model
            .deleteMany({ 'meta.itemUuid': itemUuid, 'meta.snapshotConfigUuid': snapshotConfigUuid })
            .exec();
        if (snapshots.length > 0) {
            await this._model.insertMany(snapshots.map(toMetricSnapshotDoc));
        }
    }

    async deleteForItem(userId: string, itemUuid: string, snapshotConfigUuid: string): Promise<void> {
        const res = await this._model
            .deleteMany({
                'meta.userId': userId,
                'meta.itemUuid': itemUuid,
                'meta.snapshotConfigUuid': snapshotConfigUuid,
            })
            .exec();
        if (!res.acknowledged) {
            throw new Error(`Failed to delete metric snapshots for item ${itemUuid}`);
        }
    }
}

// ============================================================================
// Doc diffs / plain text
// ============================================================================

export class MongoDocDiffRepository implements DocDiffRepository {
    private readonly _diffModel: ReturnType<typeof makeItemPlainTextDiffModel>;
    private readonly _plainTextModel: ReturnType<typeof makeItemPlainTextModel>;

    constructor(conn: mongoose.Connection, collectionNames?: { diffs?: string; plainText?: string }) {
        this._diffModel = makeItemPlainTextDiffModel(conn, collectionNames?.diffs);
        this._plainTextModel = makeItemPlainTextModel(conn, collectionNames?.plainText);
    }

    async getDiffsForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        from: Date;
        to?: Date;
    }): Promise<Map<string, PlainTextDiffEntry[]>> {
        if (q.itemUuids.length === 0) {
            return new Map();
        }

        const pipeline: mongoose.PipelineStage[] = [
            {
                $match: {
                    'meta.itemUuid': { $in: q.itemUuids },
                    ...plainTextDiffAccessQuery(q.access),
                    time: { $gt: q.from, ...(q.to && { $lt: q.to }) },
                },
            },
            {
                $sort: {
                    time: -1,
                },
            },
        ];

        const res = await this._diffModel.aggregate<ItemPlainTextDiffDoc>(pipeline).exec();

        // Group results by itemUuid
        const resultMap = new Map<string, PlainTextDiffEntry[]>();
        // Initialize all requested itemUuids with empty arrays
        q.itemUuids.forEach((uuid) => resultMap.set(uuid, []));
        // Populate with actual results
        (res || []).forEach((diff) => {
            const uuid = diff.meta.itemUuid;
            const existing = resultMap.get(uuid);
            if (existing) {
                existing.push({
                    itemUuid: uuid,
                    timestamp: diff.time,
                    diff: diff.diff.diff,
                });
            }
        });

        return resultMap;
    }

    async getPlainTextForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        limit?: number;
    }): Promise<Map<string, string>> {
        if (q.itemUuids.length === 0) {
            return new Map();
        }
        const docs = await this._plainTextModel
            .find({ ...plainTextAccessQuery(q.access), itemUuid: { $in: q.itemUuids } }, undefined, { lean: true })
            .limit(q.limit ?? 100)
            .exec();
        const map = new Map<string, string>();
        ((docs as unknown as ItemPlainTextDoc[]) || []).forEach((d) => {
            map.set(d.itemUuid, d.text);
        });
        return map;
    }
}

// ============================================================================
// Watermarks
// ============================================================================

export class MongoWatermarkStore implements WatermarkStore {
    private readonly _model: ReturnType<typeof makeWatermarkModel>;

    constructor(conn: mongoose.Connection, collectionName?: string) {
        this._model = makeWatermarkModel(conn, collectionName);
    }

    async getLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string): Promise<Date | undefined> {
        const doc = await this._model.findOne({ userId, connector, connectorUserId }, undefined, { lean: true }).exec();
        return (doc as unknown as WatermarkDoc | null)?.lastPollDate ?? undefined;
    }

    async setLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string, date: Date): Promise<void> {
        await this._model
            .updateOne(
                { userId, connector, connectorUserId },
                { $set: { lastPollDate: date }, $setOnInsert: { firstPollCompleted: false } },
                { upsert: true },
            )
            .exec();
    }

    async isFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<boolean> {
        const doc = await this._model.findOne({ userId, connector, connectorUserId }, undefined, { lean: true }).exec();
        return !(doc as unknown as WatermarkDoc | null)?.firstPollCompleted;
    }

    async clearFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<void> {
        await this._model
            .updateOne({ userId, connector, connectorUserId }, { $set: { firstPollCompleted: true } }, { upsert: true })
            .exec();
    }
}
