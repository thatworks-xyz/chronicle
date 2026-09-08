import { ChangeEvent } from '../domain/change-event.js';
import { ConnectorItemId } from '../domain/connector-item-id.js';
import { ConnectorId } from '../domain/connector.js';
import { ItemWithHierarchyType } from '../domain/context.js';
import { BatchMetricSnapshotConfig, MetricSnapshotConfig } from '../domain/metric-snapshot.js';
import { WorkItem } from '../domain/work-item.js';
import { ItemWithChanges } from '../engine/changelog-summary.js';
import { AccessFilter } from '../ports/access-control.js';
import { Logger } from '../ports/logger.js';
import { WorkItemRepository } from '../ports/repositories.js';
import { ConnectorItemIdMap, ConnectorItemIdSet } from './connector-item-id-map.js';
import { ItemWithParentData, ItemWithParentDataChangelog } from './mapper.js';

/** Services the ingestion base class needs from the host. */
export interface IngestionServices {
    items: WorkItemRepository;
    access: AccessFilter;
    log: Logger;
}

export interface ConnectorGetResult {
    itemWithChanges: ItemWithChanges[];
    deletionChangelogs?: ChangeEvent[];
}

/**
 * Base class for a data source connector: fetches changed objects from an
 * external system and maps them to work items + change events.
 *
 * `ChangeObject` is the connector's raw change payload, `State` its runtime
 * state (e.g. instance URLs), and `ParentDataType` any data attached to parent
 * references until parents are resolved.
 */
export abstract class ConnectorSource<ChangeObject, State, ParentDataType> {
    /** The connector this source ingests (persisted on all produced data). */
    abstract get connectorId(): ConnectorId;

    /** The connector-side account id this source ingests for. */
    abstract get connectorUserId(): string;

    abstract initializeState(): Promise<void>;
    abstract getState(): State;

    /**
     * Fetch raw changes from the external system.
     * Returns undefined changes to signal "nothing to do".
     */
    abstract getChanges(
        fromDate: Date,
        toDate: Date | undefined,
        poll: { firstPoll: boolean },
    ): Promise<{ changes: ChangeObject[] | undefined }>;

    /** Fetch a single item from the external system by its connector-native id. */
    abstract getItemForId(
        userId: string,
        id: ConnectorItemId,
        data?: ParentDataType,
    ): Promise<ItemWithParentData<ParentDataType> | undefined>;

    /** Map raw change payloads to work items with their change events. */
    abstract map(
        userId: string,
        objs: ChangeObject[],
        fromDate: Date,
    ): Promise<{
        itemsWithChanges: ItemWithParentDataChangelog<ParentDataType>[];
        deletionChangelogs?: ChangeEvent[];
    }>;

    /** When true, mapped change events before `fromDate` are kept instead of filtered. */
    get returnsDataBeyondFromDate(): boolean {
        return false;
    }

    /** Metric snapshot configs this connector computes on each ingestion run. */
    get metricSnapshotConfigs(): (MetricSnapshotConfig<this> | BatchMetricSnapshotConfig<this>)[] {
        return [];
    }

    /** Items metrics are attached to (e.g. the account-level company item). */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getItemsForMetrics(userId: string): Promise<ItemWithHierarchyType[]> {
        return [];
    }

    /**
     * Optional first-poll/backfill hook: fetch additional items (and events)
     * beyond the incremental window, e.g. historical events or metric backfills.
     */
    pollAdditionalItems?(
        userId: string,
        fromDate: Date,
        firstPoll: boolean,
        services: IngestionServices,
    ): Promise<{ additionalItems: ItemWithParentData<ParentDataType>[]; changelogs?: ChangeEvent[] }>;

    /** Optional hook to attach full plain text to document items. */
    protected addPlainText?(items: ItemWithParentDataChangelog<ParentDataType>[], log: Logger): Promise<void>;

    /**
     * Fetches, maps, filters, sorts, and parent-resolves one incremental batch.
     */
    async get(
        userId: string,
        fromDate: Date,
        toDate: Date | undefined,
        poll: { firstPoll: boolean },
        services: IngestionServices,
    ): Promise<ConnectorGetResult | undefined> {
        const log = services.log;
        const { changes: objs } = await this.getChanges(fromDate, toDate, poll);
        log.info(`Ingestion: Connector user id ${this.connectorUserId} got ${objs?.length} changes`);
        if (objs === undefined) {
            return undefined;
        }

        log.info(`Ingestion: Connector user id ${this.connectorUserId} starting map()`);
        const { itemsWithChanges, deletionChangelogs } = await this.map(userId, objs, fromDate);
        log.info(`Ingestion: Connector user id ${this.connectorUserId} finished map()`);

        // Remove changes that are outside our range and then sort by most recent
        itemsWithChanges.forEach((v) => {
            v.changelog = v.changelog.filter((ch) => {
                if (this.returnsDataBeyondFromDate) {
                    return true;
                }
                return ch.timestamp >= fromDate;
            });
            v.changelog.sort((a, b) => {
                if (a.timestamp < b.timestamp) {
                    return 1;
                }
                if (a.timestamp > b.timestamp) {
                    return -1;
                }
                return 0;
            });
        });

        if (this.addPlainText) {
            log.info(`Ingestion: Connector user id ${this.connectorUserId} starting addPlainText`);
            await this.addPlainText(itemsWithChanges, log);
            log.info(`Ingestion: Connector user id ${this.connectorUserId} finished addPlainText`);
        }

        // Add the parents
        log.info(`Ingestion: Connector user id ${this.connectorUserId} starting addParents`);
        const itemWithChanges = await this.addParents(userId, itemsWithChanges, services);
        log.info(`Ingestion: Connector user id ${this.connectorUserId} finished addParents`);

        // Return
        return { itemWithChanges, deletionChangelogs };
    }

    async addParents(
        userId: string,
        itemsWithChanges: ItemWithParentDataChangelog<ParentDataType>[],
        services: IngestionServices,
    ): Promise<ItemWithChanges[]> {
        const idItemMap = new ConnectorItemIdMap<ItemWithParentDataChangelog<ParentDataType>>(
            itemsWithChanges,
            (item) => item.item.idsFromConnector,
        );
        await this.populateParents(userId, idItemMap, services);

        const res: ItemWithChanges[] = [];
        Array.from(idItemMap.values()).forEach((v) => {
            v.item.parents.forEach((p) => {
                if (p.data) {
                    delete p.data;
                }
            });
            res.push({
                item: v.item,
                changes: v.changelog,
                docPlainText: v.docPlainText,
                additionalData: v.additionalData,
            });
        });

        return res;
    }

    private async findAndPopulateParents(
        userId: string,
        idItemMap: ConnectorItemIdMap<ItemWithParentDataChangelog<ParentDataType>>,
        parentsToIgnore: ConnectorItemIdSet,
        services: IngestionServices,
    ) {
        const incompleteParents = new ConnectorItemIdMap<{
            data: ParentDataType | undefined;
            idsFromConnector: ConnectorItemId;
            connector: ConnectorId;
        }>();
        idItemMap.forEach((v) => {
            v.item.parents.forEach((parent) => {
                if (!idItemMap.has(parent.idsFromConnector) && !parentsToIgnore.has(parent.idsFromConnector)) {
                    incompleteParents.set(parent.idsFromConnector, {
                        data: parent.data,
                        idsFromConnector: parent.idsFromConnector,
                        connector: v.item.connector,
                    });
                }
            });
        });

        if (incompleteParents.size < 1) {
            return;
        }

        // Populate these parents, if possible.
        for (const [namespacedKey, value] of incompleteParents) {
            const newItem = await this.getItemForId(userId, value.idsFromConnector, value.data);
            if (newItem) {
                idItemMap.set(newItem.idsFromConnector, { item: newItem, changelog: [] });
            } else {
                // Check if it exists in storage:
                const foundInDb = await services.items.getByConnectorIds(
                    userId,
                    value.connector,
                    value.idsFromConnector,
                );
                if (foundInDb) {
                    idItemMap.set(foundInDb.idsFromConnector, {
                        item: foundInDb as ItemWithParentData<ParentDataType>,
                        changelog: [],
                    });
                } else {
                    // A parent object might not be valid, available, or visible.
                    // If the item is undefined we will also want to ignore it on the next recursive run
                    parentsToIgnore.addNamespaced(namespacedKey);
                }
            }
        }
        parentsToIgnore.forEach((v) => idItemMap.deleteUsingTypespacedKey(v));
        // The new parents might also have parents that require populating
        await this.findAndPopulateParents(userId, idItemMap, parentsToIgnore, services);
    }

    async populateParents(
        userId: string,
        idItemMap: ConnectorItemIdMap<ItemWithParentDataChangelog<ParentDataType>>,
        services: IngestionServices,
    ) {
        const parentsToIgnore = new ConnectorItemIdSet();
        await this.findAndPopulateParents(userId, idItemMap, parentsToIgnore, services);
    }
}

/** Loosely-typed connector source, as stored/handled by the engine. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyConnectorSource = ConnectorSource<any, any, any>;

/** Fully-typed WorkItem check helper: strips parent `data` payloads. */
export function toWorkItem<T>(item: ItemWithParentData<T>): WorkItem {
    return {
        ...item,
        parents: item.parents.map((p) => ({
            itemUuid: p.itemUuid,
            idsFromConnector: p.idsFromConnector,
            relationship: p.relationship,
        })),
    };
}
