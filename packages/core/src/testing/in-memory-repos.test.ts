import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessModes } from '../domain/access.js';
import { ActionTarget, ChangeEvent } from '../domain/change-event.js';
import { ChangeActionType, ChangeType, UserMentionType } from '../domain/filters.js';
import { getHash, MetricSnapshot, MetricSnapshotTypes } from '../domain/metric-snapshot.js';
import { WorkItem } from '../domain/work-item.js';
import { AccessFilter } from '../ports/access-control.js';
import {
    InMemoryChangeEventRepository,
    InMemoryMetricSnapshotRepository,
    InMemoryWatermarkStore,
    InMemoryWorkItemRepository,
} from './in-memory-repos.js';

/**
 * Contract tests for the in-memory storage adapters. These encode the behavior
 * every storage adapter must honor (see the port docs in ports/repositories.ts):
 * two-phase access filtering, newest-first change batches with per-item limits
 * and dedup, the metric-snapshot latest-before-window fallback, and
 * hash-guarded upserts.
 */

const USER = 'creator-1';
const READER = 'reader-1';
const CONNECTOR = 'testcrm';
const ACCOUNT = 'acct-1';

const ALL: AccessFilter = { kind: 'all' };
const READER_VIA_CONNECTION: AccessFilter = {
    kind: 'rules',
    requesterUserId: READER,
    rules: [{ kind: 'perConnection', creatorUserId: USER, connector: CONNECTOR, connectorUserId: ACCOUNT }],
};

function makeItem(overrides: Partial<WorkItem> & { uuid: string }): WorkItem {
    return {
        userId: USER,
        connector: CONNECTOR,
        idsFromConnector: {
            idFromConnector: overrides.uuid,
            connectorObjectType: 'task',
            connectorUserId: ACCOUNT,
        },
        title: `Item ${overrides.uuid}`,
        createdBy: [],
        createdDate: new Date('2026-01-01T00:00:00Z'),
        properties: [],
        parents: [],
        types: [],
        lastUpdate: new Date('2026-02-01T00:00:00Z'),
        ...overrides,
    };
}

function makeEvent(itemUuid: string, timestamp: Date, simple = 'Updated'): ChangeEvent {
    return {
        timestamp,
        itemUuid,
        userId: USER,
        connector: CONNECTOR,
        idsFromConnector: { idFromConnector: itemUuid, connectorObjectType: 'task', connectorUserId: ACCOUNT },
        action: {
            changeType: ChangeType.Item,
            actionType: ChangeActionType.Updated,
            userMentionType: UserMentionType.None,
            actionTarget: ActionTarget.Task,
            actorDisplayName: 'Alex',
            actorIsUser: false,
            description: { simple },
        },
    };
}

function makeSnapshot(itemUuid: string, configUuid: string, timestamp: Date, value: number): MetricSnapshot {
    const measurement = [
        {
            data: {
                type: MetricSnapshotTypes.GenericMetric as const,
                payload: { generic: { value, valueFormatted: String(value) } },
            },
        },
    ];
    return {
        timestamp,
        itemUuid,
        connector: CONNECTOR,
        connectorUserId: ACCOUNT,
        userId: USER,
        snapshotConfigUuid: configUuid,
        measurement,
        measurementHash: getHash(measurement),
    };
}

describe('InMemoryWorkItemRepository', () => {
    describe('upsertIfChanged', () => {
        it('classifies inserts, updates, and unchanged writes by content hash', async () => {
            const repo = new InMemoryWorkItemRepository();

            const first = await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a' }) }]);
            assert.deepEqual(first, { inserted: 1, updated: 0, unchanged: 0 });

            const same = await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a' }) }]);
            assert.deepEqual(same, { inserted: 0, updated: 0, unchanged: 1 });

            const changed = await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a', title: 'New title' }) }]);
            assert.deepEqual(changed, { inserted: 0, updated: 1, unchanged: 0 });
        });

        it('excludes lastUpdate from the change hash', async () => {
            const repo = new InMemoryWorkItemRepository();
            await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a', lastUpdate: new Date('2026-02-01') }) }]);

            const result = await repo.upsertIfChanged([
                { item: makeItem({ uuid: 'a', lastUpdate: new Date('2026-03-15') }) },
            ]);
            assert.deepEqual(result, { inserted: 0, updated: 0, unchanged: 1 });
        });

        it('always writes when forceUpdate is set', async () => {
            const repo = new InMemoryWorkItemRepository();
            await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a' }) }]);

            const result = await repo.upsertIfChanged([{ item: makeItem({ uuid: 'a' }), forceUpdate: true }]);
            assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 0 });
        });
    });

    describe('access filtering on reads', () => {
        it('enforces phase 1 (connection rules) on getByUuids', async () => {
            const repo = new InMemoryWorkItemRepository();
            repo.seed([
                makeItem({ uuid: 'mine' }),
                makeItem({
                    uuid: 'other-connection',
                    idsFromConnector: {
                        idFromConnector: 'x',
                        connectorObjectType: 'task',
                        connectorUserId: 'other-account',
                    },
                }),
            ]);

            const visible = await repo.getByUuids(['mine', 'other-connection'], READER_VIA_CONNECTION);
            assert.deepEqual(
                visible.map((i) => i.uuid),
                ['mine'],
            );

            const all = await repo.getByUuids(['mine', 'other-connection'], ALL);
            assert.equal(all.length, 2);
        });

        it('enforces phase 2 (item ACL) on getByUuids', async () => {
            const repo = new InMemoryWorkItemRepository();
            repo.seed([
                makeItem({ uuid: 'open', accessPolicy: { mode: AccessModes.ConnectionAudience } }),
                makeItem({ uuid: 'listed', accessPolicy: { mode: AccessModes.AllowList, allowUserIds: [READER] } }),
                makeItem({ uuid: 'excluded', accessPolicy: { mode: AccessModes.AllowList, allowUserIds: [] } }),
            ]);

            const visible = await repo.getByUuids(['open', 'listed', 'excluded'], READER_VIA_CONNECTION);
            assert.deepEqual(visible.map((i) => i.uuid).sort(), ['listed', 'open']);
        });
    });

    describe('getDescendantUuids', () => {
        function seedTree(repo: InMemoryWorkItemRepository) {
            // root -> child1 -> grandchild ; root -> child2
            const parentRef = (uuid: string) => ({
                itemUuid: uuid,
                idsFromConnector: { idFromConnector: uuid, connectorObjectType: 'task', connectorUserId: ACCOUNT },
            });
            repo.seed([
                makeItem({ uuid: 'root' }),
                makeItem({ uuid: 'child1', parents: [parentRef('root')] }),
                makeItem({ uuid: 'child2', parents: [parentRef('root')] }),
                makeItem({ uuid: 'grandchild', parents: [parentRef('child1')] }),
            ]);
        }

        it('walks the hierarchy breadth-first', async () => {
            const repo = new InMemoryWorkItemRepository();
            seedTree(repo);
            const uuids = await repo.getDescendantUuids(['root'], ALL, { maxDepth: 5, maxItems: 100 });
            assert.deepEqual(uuids.sort(), ['child1', 'child2', 'grandchild']);
        });

        it('respects maxDepth', async () => {
            const repo = new InMemoryWorkItemRepository();
            seedTree(repo);
            const uuids = await repo.getDescendantUuids(['root'], ALL, { maxDepth: 0, maxItems: 100 });
            assert.deepEqual(uuids.sort(), ['child1', 'child2']);
        });

        it('respects maxItems', async () => {
            const repo = new InMemoryWorkItemRepository();
            seedTree(repo);
            const uuids = await repo.getDescendantUuids(['root'], ALL, { maxDepth: 5, maxItems: 2 });
            assert.equal(uuids.length, 2);
        });
    });
});

describe('InMemoryChangeEventRepository', () => {
    const T = (iso: string) => new Date(iso);

    it('returns events inside the window only (from exclusive, to exclusive)', async () => {
        const repo = new InMemoryChangeEventRepository();
        repo.seed([
            makeEvent('a', T('2026-02-01T00:00:00Z'), 'at-from'),
            makeEvent('a', T('2026-02-02T00:00:00Z'), 'inside'),
            makeEvent('a', T('2026-02-05T00:00:00Z'), 'at-to'),
        ]);

        const batch = await repo.getSortedBatch({
            itemUuids: ['a'],
            access: ALL,
            from: T('2026-02-01T00:00:00Z'),
            to: T('2026-02-05T00:00:00Z'),
        });
        assert.deepEqual(
            batch.map((e) => e.action.description?.simple),
            ['inside'],
        );
    });

    it('sorts newest-first and applies limitPerItem per item, keeping the newest', async () => {
        const repo = new InMemoryChangeEventRepository();
        repo.seed([
            makeEvent('a', T('2026-02-02T00:00:00Z'), 'a-old'),
            makeEvent('a', T('2026-02-03T00:00:00Z'), 'a-mid'),
            makeEvent('a', T('2026-02-04T00:00:00Z'), 'a-new'),
            makeEvent('b', T('2026-02-03T12:00:00Z'), 'b-only'),
        ]);

        const batch = await repo.getSortedBatch({
            itemUuids: ['a', 'b'],
            access: ALL,
            from: T('2026-02-01T00:00:00Z'),
            limitPerItem: 2,
        });

        const forA = batch.filter((e) => e.itemUuid === 'a').map((e) => e.action.description?.simple);
        assert.deepEqual(forA, ['a-new', 'a-mid']); // newest first, oldest dropped
        assert.equal(batch.filter((e) => e.itemUuid === 'b').length, 1); // limit is per item
    });

    it('deduplicates identical actions at the same timestamp per item', async () => {
        const repo = new InMemoryChangeEventRepository();
        const ts = T('2026-02-02T00:00:00Z');
        // The dedup identity is item + action type/target + entity + timestamp;
        // the description text is NOT part of it, so these two collapse into one.
        const otherEntity = makeEvent('a', ts);
        otherEntity.action.entityId = 'entity-2';
        repo.seed([makeEvent('a', ts, 'dupe'), makeEvent('a', ts, 'same action, different text'), otherEntity]);

        const batch = await repo.getSortedBatch({ itemUuids: ['a'], access: ALL, from: T('2026-02-01T00:00:00Z') });
        assert.equal(batch.length, 2);
    });

    it('getChangedItemUuids returns each changed item once', async () => {
        const repo = new InMemoryChangeEventRepository();
        repo.seed([
            makeEvent('a', T('2026-02-02T00:00:00Z')),
            makeEvent('a', T('2026-02-03T00:00:00Z')),
            makeEvent('b', T('2026-01-01T00:00:00Z')), // before window
        ]);

        const changed = await repo.getChangedItemUuids(['a', 'b'], T('2026-02-01T00:00:00Z'));
        assert.deepEqual(changed, ['a']);
    });
});

describe('InMemoryMetricSnapshotRepository', () => {
    const CONFIG = 'config-1';
    const T = (iso: string) => new Date(iso);

    it('returns snapshots inside the window when any exist', async () => {
        const repo = new InMemoryMetricSnapshotRepository();
        repo.seed([
            makeSnapshot('a', CONFIG, T('2026-01-15T00:00:00Z'), 1),
            makeSnapshot('a', CONFIG, T('2026-02-02T00:00:00Z'), 2),
        ]);

        const result = await repo.getForDateRange({
            userId: USER,
            access: ALL,
            itemUuid: 'a',
            snapshotConfigUuid: CONFIG,
            from: T('2026-02-01T00:00:00Z'),
            to: T('2026-02-10T00:00:00Z'),
        });
        assert.equal(result.length, 1);
        assert.equal(result[0].timestamp.toISOString(), '2026-02-02T00:00:00.000Z');
    });

    it('falls back to the latest snapshot before the window when the window is empty', async () => {
        // Only change-points are stored, so an empty window means "the metric
        // did not change" — the latest earlier snapshot is still the current value.
        const repo = new InMemoryMetricSnapshotRepository();
        repo.seed([
            makeSnapshot('a', CONFIG, T('2026-01-05T00:00:00Z'), 1),
            makeSnapshot('a', CONFIG, T('2026-01-15T00:00:00Z'), 2),
        ]);

        const result = await repo.getForDateRange({
            userId: USER,
            access: ALL,
            itemUuid: 'a',
            snapshotConfigUuid: CONFIG,
            from: T('2026-02-01T00:00:00Z'),
            to: T('2026-02-10T00:00:00Z'),
        });
        assert.equal(result.length, 1);
        assert.equal(result[0].timestamp.toISOString(), '2026-01-15T00:00:00.000Z');
    });

    it('returns empty when no snapshot exists before or inside the window', async () => {
        const repo = new InMemoryMetricSnapshotRepository();
        repo.seed([makeSnapshot('a', CONFIG, T('2026-03-01T00:00:00Z'), 1)]); // after the window

        const result = await repo.getForDateRange({
            userId: USER,
            access: ALL,
            itemUuid: 'a',
            snapshotConfigUuid: CONFIG,
            from: T('2026-02-01T00:00:00Z'),
            to: T('2026-02-10T00:00:00Z'),
        });
        assert.deepEqual(result, []);
    });

    it('storeIfChanged stores only when the measurement hash differs from the latest', async () => {
        const repo = new InMemoryMetricSnapshotRepository();

        const first = await repo.storeIfChanged([makeSnapshot('a', CONFIG, T('2026-02-01T00:00:00Z'), 5)]);
        assert.equal(first, 1);

        // Same value the next day: no change-point
        const same = await repo.storeIfChanged([makeSnapshot('a', CONFIG, T('2026-02-02T00:00:00Z'), 5)]);
        assert.equal(same, 0);

        const changed = await repo.storeIfChanged([makeSnapshot('a', CONFIG, T('2026-02-03T00:00:00Z'), 6)]);
        assert.equal(changed, 1);
        assert.equal(repo.snapshots.length, 2);
    });

    it('deleteForItem removes only the matching series', async () => {
        const repo = new InMemoryMetricSnapshotRepository();
        repo.seed([
            makeSnapshot('a', CONFIG, T('2026-02-01T00:00:00Z'), 1),
            makeSnapshot('a', 'other-config', T('2026-02-01T00:00:00Z'), 1),
            makeSnapshot('b', CONFIG, T('2026-02-01T00:00:00Z'), 1),
        ]);

        await repo.deleteForItem(USER, 'a', CONFIG);
        assert.equal(repo.snapshots.length, 2);
        assert.equal(
            repo.snapshots.some((s) => s.itemUuid === 'a' && s.snapshotConfigUuid === CONFIG),
            false,
        );
    });
});

describe('InMemoryWatermarkStore', () => {
    it('tracks first-poll state independently of the poll date', async () => {
        const store = new InMemoryWatermarkStore();

        assert.equal(await store.isFirstPoll(USER, CONNECTOR, ACCOUNT), true);
        assert.equal(await store.getLastPollDate(USER, CONNECTOR, ACCOUNT), undefined);

        // Setting the poll date alone does not complete the first poll
        await store.setLastPollDate(USER, CONNECTOR, ACCOUNT, new Date('2026-02-01T00:00:00Z'));
        assert.equal(await store.isFirstPoll(USER, CONNECTOR, ACCOUNT), true);

        await store.clearFirstPoll(USER, CONNECTOR, ACCOUNT);
        assert.equal(await store.isFirstPoll(USER, CONNECTOR, ACCOUNT), false);
        assert.equal(
            (await store.getLastPollDate(USER, CONNECTOR, ACCOUNT))?.toISOString(),
            '2026-02-01T00:00:00.000Z',
        );
    });

    it('keys watermarks by user, connector, and account', async () => {
        const store = new InMemoryWatermarkStore();
        await store.setLastPollDate(USER, CONNECTOR, ACCOUNT, new Date('2026-02-01T00:00:00Z'));

        assert.equal(await store.getLastPollDate(USER, CONNECTOR, 'other-account'), undefined);
        assert.equal(await store.getLastPollDate('other-user', CONNECTOR, ACCOUNT), undefined);
    });
});
