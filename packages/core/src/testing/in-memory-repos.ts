import { canAccessItem } from '../domain/access.js';
import { ChangeEvent, getChangeEventActionIdForDeduplication } from '../domain/change-event.js';
import { ConnectorItemId } from '../domain/connector-item-id.js';
import { ConnectorId } from '../domain/connector.js';
import { MetricSnapshot } from '../domain/metric-snapshot.js';
import { getHashedItem, HashedWorkItem, WorkItem } from '../domain/work-item.js';
import { AccessFilter } from '../ports/access-control.js';
import {
    ChangeEventRepository,
    DocDiffRepository,
    MetricSnapshotRepository,
    PlainTextDiffEntry,
    WatermarkStore,
    WorkItemRepository,
    WorkItemUpsertResult,
} from '../ports/repositories.js';

/**
 * In-memory implementations of the Chronicle storage ports.
 *
 * Useful for tests and prototyping; they implement the same contracts as real
 * adapters (access filtering, newest-first change batches, the metric-snapshot
 * latest-before-window fallback, hash-guarded upserts).
 */

function itemMatchesAccess(item: WorkItem, access: AccessFilter): boolean {
    if (access.kind === 'all') {
        return true;
    }
    return canAccessItem({ requesterUserId: access.requesterUserId, allowedRules: access.rules }, item);
}

function connectorIdsMatch(a: ConnectorItemId, b: ConnectorItemId): boolean {
    if (a.idFromConnector !== b.idFromConnector) {
        return false;
    }
    if (b.idIsUnique) {
        return true;
    }
    return (
        a.connectorObjectType === b.connectorObjectType &&
        a.connectorUserId === b.connectorUserId &&
        (b.additionalIdFromConnector === undefined || a.additionalIdFromConnector === b.additionalIdFromConnector)
    );
}

export class InMemoryWorkItemRepository implements WorkItemRepository {
    readonly items = new Map<string, HashedWorkItem>();

    seed(items: WorkItem[]): void {
        items.forEach((item) => this.items.set(item.uuid, getHashedItem(item)));
    }

    async getByUuids(uuids: string[], access: AccessFilter): Promise<WorkItem[]> {
        const res: WorkItem[] = [];
        uuids.forEach((uuid) => {
            const item = this.items.get(uuid);
            if (item && itemMatchesAccess(item, access)) {
                res.push(item);
            }
        });
        return res;
    }

    async getByConnectorIds(
        userId: string,
        connector: ConnectorId,
        ids: ConnectorItemId,
    ): Promise<WorkItem | undefined> {
        return Array.from(this.items.values()).find(
            (i) => i.userId === userId && i.connector === connector && connectorIdsMatch(i.idsFromConnector, ids),
        );
    }

    async getByParent(
        parentUuid: string,
        access: AccessFilter,
        opts?: { connectorObjectType?: string; updatedSince?: Date },
    ): Promise<WorkItem[]> {
        return Array.from(this.items.values()).filter((i) => {
            if (!i.parents.some((p) => p.itemUuid === parentUuid)) {
                return false;
            }
            if (i.deleted) {
                return false;
            }
            if (opts?.connectorObjectType && i.idsFromConnector.connectorObjectType !== opts.connectorObjectType) {
                return false;
            }
            if (opts?.updatedSince && !(i.lastUpdate && i.lastUpdate > opts.updatedSince)) {
                return false;
            }
            return itemMatchesAccess(i, access);
        });
    }

    async getDescendantUuids(
        rootUuids: string[],
        access: AccessFilter,
        opts: { maxDepth: number; maxItems: number },
    ): Promise<string[]> {
        const found = new Set<string>();
        let frontier = new Set(rootUuids);
        for (let depth = 0; depth <= opts.maxDepth && frontier.size > 0 && found.size < opts.maxItems; depth++) {
            const next = new Set<string>();
            for (const item of this.items.values()) {
                if (item.deleted || !itemMatchesAccess(item, access)) {
                    continue;
                }
                if (item.parents.some((p) => frontier.has(p.itemUuid)) && !found.has(item.uuid)) {
                    found.add(item.uuid);
                    next.add(item.uuid);
                    if (found.size >= opts.maxItems) {
                        break;
                    }
                }
            }
            frontier = next;
        }
        return Array.from(found);
    }

    async getByConnectorObjectTypes(
        userId: string,
        connector: ConnectorId,
        connectorObjectTypes: string[],
        connectorUserId?: string,
    ): Promise<WorkItem[]> {
        return Array.from(this.items.values()).filter(
            (i) =>
                i.userId === userId &&
                i.connector === connector &&
                connectorObjectTypes.includes(i.idsFromConnector.connectorObjectType) &&
                (!connectorUserId || i.idsFromConnector.connectorUserId === connectorUserId) &&
                !i.deleted,
        );
    }

    async getUuidsByConnector(
        connector: ConnectorId,
        access: AccessFilter,
        opts?: { updatedSince?: Date },
    ): Promise<string[]> {
        return Array.from(this.items.values())
            .filter(
                (i) =>
                    i.connector === connector &&
                    !i.deleted &&
                    (!opts?.updatedSince || (i.lastUpdate && i.lastUpdate > opts.updatedSince)) &&
                    itemMatchesAccess(i, access),
            )
            .map((i) => i.uuid);
    }

    async upsertIfChanged(items: { item: WorkItem; forceUpdate?: boolean }[]): Promise<WorkItemUpsertResult> {
        const result: WorkItemUpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
        items.forEach(({ item, forceUpdate }) => {
            const hashed = getHashedItem(item);
            const existing = this.items.get(item.uuid);
            if (!existing) {
                this.items.set(item.uuid, hashed);
                result.inserted++;
            } else if (forceUpdate || existing.hash !== hashed.hash) {
                this.items.set(item.uuid, hashed);
                result.updated++;
            } else {
                result.unchanged++;
            }
        });
        return result;
    }
}

export class InMemoryChangeEventRepository implements ChangeEventRepository {
    readonly events: ChangeEvent[] = [];

    seed(events: ChangeEvent[]): void {
        this.events.push(...events);
    }

    async getSortedBatch(q: {
        itemUuids: string[];
        access: AccessFilter;
        from: Date;
        to?: Date;
        limitPerItem?: number;
    }): Promise<ChangeEvent[]> {
        const uuidSet = new Set(q.itemUuids);
        const byItem = new Map<string, ChangeEvent[]>();
        this.events
            .filter((e) => uuidSet.has(e.itemUuid) && e.timestamp > q.from && (!q.to || e.timestamp < q.to))
            .sort((a, b) => b.timestamp.valueOf() - a.timestamp.valueOf())
            .forEach((e) => {
                const list = byItem.get(e.itemUuid) ?? [];
                if (!q.limitPerItem || list.length < q.limitPerItem) {
                    list.push(e);
                    byItem.set(e.itemUuid, list);
                }
            });

        // Deduplicate per item, mirroring the reference adapter
        const res: ChangeEvent[] = [];
        byItem.forEach((events) => {
            const seen = new Set<string>();
            events.forEach((e) => {
                const key = getChangeEventActionIdForDeduplication(e, {
                    includeTimestamp: true,
                    includingEntityId: true,
                });
                if (!seen.has(key)) {
                    seen.add(key);
                    res.push(e);
                }
            });
        });
        return res;
    }

    async getChangedItemUuids(itemUuids: string[], from: Date, to?: Date): Promise<string[]> {
        const uuidSet = new Set(itemUuids);
        const changed = new Set<string>();
        this.events.forEach((e) => {
            if (uuidSet.has(e.itemUuid) && e.timestamp > from && (!to || e.timestamp < to)) {
                changed.add(e.itemUuid);
            }
        });
        return Array.from(changed);
    }

    async hasEvents(
        userId: string,
        itemUuid: string,
        match?: { fromStatusCategory?: string; toStatusCategory?: string },
    ): Promise<boolean> {
        return this.events.some((e) => {
            if (e.userId !== userId || e.itemUuid !== itemUuid) {
                return false;
            }
            if (match?.fromStatusCategory && e.action.property?.from?.statusCategory !== match.fromStatusCategory) {
                return false;
            }
            if (match?.toStatusCategory && e.action.property?.to?.statusCategory !== match.toStatusCategory) {
                return false;
            }
            return true;
        });
    }

    async store(events: ChangeEvent[]): Promise<void> {
        this.events.push(...events);
    }
}

export class InMemoryMetricSnapshotRepository implements MetricSnapshotRepository {
    readonly snapshots: MetricSnapshot[] = [];

    seed(snapshots: MetricSnapshot[]): void {
        this.snapshots.push(...snapshots);
    }

    private series(itemUuid: string, snapshotConfigUuid: string): MetricSnapshot[] {
        return this.snapshots
            .filter((s) => s.itemUuid === itemUuid && s.snapshotConfigUuid === snapshotConfigUuid)
            .sort((a, b) => b.timestamp.valueOf() - a.timestamp.valueOf());
    }

    async getForDateRange(q: {
        userId: string;
        access: AccessFilter;
        itemUuid: string;
        snapshotConfigUuid: string;
        from: Date;
        to: Date;
    }): Promise<MetricSnapshot[]> {
        const series = this.series(q.itemUuid, q.snapshotConfigUuid);
        const inWindow = series.filter((s) => s.timestamp >= q.from && s.timestamp < q.to);
        if (inWindow.length > 0) {
            return inWindow;
        }
        // Only change-points are stored: fall back to the latest snapshot before the window
        const latest = series[0];
        if (latest && latest.timestamp < q.from) {
            return [latest];
        }
        return [];
    }

    async getLatest(itemUuid: string, snapshotConfigUuid: string): Promise<MetricSnapshot | undefined> {
        return this.series(itemUuid, snapshotConfigUuid)[0];
    }

    async storeIfChanged(snapshots: MetricSnapshot[]): Promise<number> {
        let stored = 0;
        for (const snapshot of snapshots) {
            const latest = await this.getLatest(snapshot.itemUuid, snapshot.snapshotConfigUuid);
            if (latest?.measurementHash !== snapshot.measurementHash) {
                this.snapshots.push(snapshot);
                stored++;
            }
        }
        return stored;
    }

    async replaceForItem(itemUuid: string, snapshotConfigUuid: string, snapshots: MetricSnapshot[]): Promise<void> {
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const s = this.snapshots[i];
            if (s.itemUuid === itemUuid && s.snapshotConfigUuid === snapshotConfigUuid) {
                this.snapshots.splice(i, 1);
            }
        }
        this.snapshots.push(...snapshots);
    }

    async deleteForItem(userId: string, itemUuid: string, snapshotConfigUuid: string): Promise<void> {
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const s = this.snapshots[i];
            if (s.userId === userId && s.itemUuid === itemUuid && s.snapshotConfigUuid === snapshotConfigUuid) {
                this.snapshots.splice(i, 1);
            }
        }
    }
}

export class InMemoryDocDiffRepository implements DocDiffRepository {
    readonly diffs: PlainTextDiffEntry[] = [];
    readonly plainText = new Map<string, string>();

    async getDiffsForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        from: Date;
        to?: Date;
    }): Promise<Map<string, PlainTextDiffEntry[]>> {
        const res = new Map<string, PlainTextDiffEntry[]>();
        q.itemUuids.forEach((uuid) => res.set(uuid, []));
        this.diffs
            .filter((d) => q.itemUuids.includes(d.itemUuid) && d.timestamp > q.from && (!q.to || d.timestamp < q.to))
            .sort((a, b) => b.timestamp.valueOf() - a.timestamp.valueOf())
            .forEach((d) => {
                res.get(d.itemUuid)?.push(d);
            });
        return res;
    }

    async getPlainTextForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        limit?: number;
    }): Promise<Map<string, string>> {
        const res = new Map<string, string>();
        for (const uuid of q.itemUuids.slice(0, q.limit ?? 100)) {
            const text = this.plainText.get(uuid);
            if (text !== undefined) {
                res.set(uuid, text);
            }
        }
        return res;
    }
}

export class InMemoryWatermarkStore implements WatermarkStore {
    private readonly _marks = new Map<string, { lastPollDate: Date; firstPollCompleted: boolean }>();

    private key(userId: string, connector: ConnectorId, connectorUserId: string): string {
        return `${userId}:${connector}:${connectorUserId}`;
    }

    async getLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string): Promise<Date | undefined> {
        return this._marks.get(this.key(userId, connector, connectorUserId))?.lastPollDate;
    }

    async setLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string, date: Date): Promise<void> {
        const k = this.key(userId, connector, connectorUserId);
        const existing = this._marks.get(k);
        this._marks.set(k, { lastPollDate: date, firstPollCompleted: existing?.firstPollCompleted ?? false });
    }

    async isFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<boolean> {
        return !this._marks.get(this.key(userId, connector, connectorUserId))?.firstPollCompleted;
    }

    async clearFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<void> {
        const k = this.key(userId, connector, connectorUserId);
        const existing = this._marks.get(k);
        this._marks.set(k, {
            lastPollDate: existing?.lastPollDate ?? new Date(0),
            firstPollCompleted: true,
        });
    }
}

/** Creates the full set of in-memory repositories. */
export function createInMemoryRepositories() {
    return {
        items: new InMemoryWorkItemRepository(),
        events: new InMemoryChangeEventRepository(),
        snapshots: new InMemoryMetricSnapshotRepository(),
        docDiffs: new InMemoryDocDiffRepository(),
        watermarks: new InMemoryWatermarkStore(),
    };
}
