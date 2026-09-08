import { ChangeEvent } from '../domain/change-event.js';
import { ConnectorItemId } from '../domain/connector-item-id.js';
import { ConnectorId } from '../domain/connector.js';
import { MetricSnapshot } from '../domain/metric-snapshot.js';
import { WorkItem } from '../domain/work-item.js';
import { AccessFilter } from './access-control.js';

/**
 * Storage ports. The engine only ever touches persistent data through these
 * interfaces; implement them for your storage of choice (see @chronicle/mongo
 * for the reference MongoDB implementation). A port-conformance test suite is
 * exported from the package to validate implementations.
 */

export interface WorkItemUpsertResult {
    inserted: number;
    updated: number;
    unchanged: number;
}

export interface WorkItemRepository {
    /** Fetch items by UUID, applying the access filter. Missing/inaccessible uuids are omitted. */
    getByUuids(uuids: string[], access: AccessFilter): Promise<WorkItem[]>;

    /** Fetch a single item by its connector-native id triple, scoped to its owner. */
    getByConnectorIds(userId: string, connector: ConnectorId, ids: ConnectorItemId): Promise<WorkItem | undefined>;

    /**
     * Fetch direct children of a parent item (items whose `parents[].itemUuid` matches),
     * optionally restricted to a connectorObjectType and/or updated-since date.
     */
    getByParent(
        parentUuid: string,
        access: AccessFilter,
        opts?: { connectorObjectType?: string; updatedSince?: Date },
    ): Promise<WorkItem[]>;

    /**
     * Recursively collect the UUIDs of all descendants of the given roots
     * (following child `parents[].itemUuid` references), excluding deleted items.
     * `maxDepth` bounds recursion; `maxItems` bounds the total result size.
     */
    getDescendantUuids(
        rootUuids: string[],
        access: AccessFilter,
        opts: { maxDepth: number; maxItems: number },
    ): Promise<string[]>;

    /**
     * Fetch all non-deleted items for a connector account restricted to the given
     * object types (e.g. all companies for a CRM connection).
     */
    getByConnectorObjectTypes(
        userId: string,
        connector: ConnectorId,
        connectorObjectTypes: string[],
        connectorUserId?: string,
    ): Promise<WorkItem[]>;

    /**
     * UUIDs of non-deleted items for a connector, optionally restricted to those
     * updated since a date (whole-connector scopes).
     */
    getUuidsByConnector(
        connector: ConnectorId,
        access: AccessFilter,
        opts?: { updatedSince?: Date },
    ): Promise<string[]>;

    /**
     * Insert or update items, skipping writes whose change-detection hash is
     * unchanged (see domain/work-item.getHashedItem).
     */
    upsertIfChanged(items: { item: WorkItem; forceUpdate?: boolean }[]): Promise<WorkItemUpsertResult>;
}

export interface ChangeEventRepository {
    /**
     * Fetch change events for the given items in [from, to), sorted newest-first
     * per item, with at most `limitPerItem` events per item.
     */
    getSortedBatch(q: {
        itemUuids: string[];
        access: AccessFilter;
        from: Date;
        to?: Date;
        limitPerItem?: number;
    }): Promise<ChangeEvent[]>;

    /** Of the given item uuids, return those that have at least one change event in [from, to). */
    getChangedItemUuids(itemUuids: string[], from: Date, to?: Date): Promise<string[]>;

    /** Whether the given item has at least one event matching the (optional) action fields. */
    hasEvents(
        userId: string,
        itemUuid: string,
        match?: { fromStatusCategory?: string; toStatusCategory?: string },
    ): Promise<boolean>;

    store(events: ChangeEvent[]): Promise<void>;
}

export interface MetricSnapshotRepository {
    /**
     * Fetch snapshots for one item + config in [from, to], sorted newest-first.
     *
     * CONTRACT: only change-points are stored, so when the window contains no
     * snapshots the implementation MUST return the latest snapshot strictly
     * before `from` (if any) so callers see the value that was in effect.
     */
    getForDateRange(q: {
        userId: string;
        access: AccessFilter;
        itemUuid: string;
        snapshotConfigUuid: string;
        from: Date;
        to: Date;
    }): Promise<MetricSnapshot[]>;

    /** Latest stored snapshot for an item + config, if any. */
    getLatest(itemUuid: string, snapshotConfigUuid: string): Promise<MetricSnapshot | undefined>;

    /**
     * Store snapshots whose `measurementHash` differs from the latest stored one
     * for the same (itemUuid, snapshotConfigUuid) series. Returns how many were written.
     */
    storeIfChanged(snapshots: MetricSnapshot[]): Promise<number>;

    /** Delete all previous snapshots for the series, then store the given ones (overwriteHistory configs). */
    replaceForItem(itemUuid: string, snapshotConfigUuid: string, snapshots: MetricSnapshot[]): Promise<void>;

    /** Delete all snapshots for an item + config. */
    deleteForItem(userId: string, itemUuid: string, snapshotConfigUuid: string): Promise<void>;
}

/** One stored text diff for a document item. */
export interface PlainTextDiffEntry {
    itemUuid: string;
    timestamp: Date;
    diff: {
        diffType: number;
        text: string;
        /**
         * Signals that the whole document or a subset of it was stored as a diff
         * the first time it was tracked
         */
        firstStorageDocStoredAsDiff?: {
            storedWordCount: number;
            originalWordCount: number;
        };
    }[];
}

/** Raw document text and text diffs, feeding summarization prompt bodies. Optional. */
export interface DocDiffRepository {
    /** Text diffs per item over (from, to), sorted oldest-first per item. */
    getDiffsForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        from: Date;
        to?: Date;
    }): Promise<Map<string, PlainTextDiffEntry[]>>;

    /** Full plain-text content per item (for summaries that include document content). */
    getPlainTextForItems(q: {
        access: AccessFilter;
        itemUuids: string[];
        limit?: number;
    }): Promise<Map<string, string>>;
}

/**
 * Ingestion watermarks: tracks per-connection poll state so incremental
 * ingestion knows where it left off (formerly `ChangelogMetadata`).
 */
export interface WatermarkStore {
    /** Last successful poll date for a connector account, if any. */
    getLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string): Promise<Date | undefined>;
    setLastPollDate(userId: string, connector: ConnectorId, connectorUserId: string, date: Date): Promise<void>;
    /** Whether this connector account has never completed a poll. */
    isFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<boolean>;
    clearFirstPoll(userId: string, connector: ConnectorId, connectorUserId: string): Promise<void>;
}
