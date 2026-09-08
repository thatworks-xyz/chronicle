import { DateTime } from 'luxon';
import { Scope } from '../domain/context.js';
import { EverythingInConnectorId } from '../domain/hierarchy.js';
import {
    ItemMetaFilter,
    ItemMetaFilterParseValueAs,
    ItemMetaFilterPropertyComparisonOperator,
    ItemMetaFilterPropertyDateInterval,
    ItemMetaFilterPropertyOperator,
} from '../domain/item-meta-filter.js';
import { AdditionalRelevantItemType } from '../domain/timeline.js';
import { WorkItem } from '../domain/work-item.js';
import { AccessFilter, Principal } from '../ports/access-control.js';
import { EngineRuntime } from '../ports/runtime.js';
import { ItemWithChanges } from './changelog-summary.js';
import { getItemTypeProps } from './get-item-type.js';

export interface AdditionalRelevantWorkItems {
    additionalRelevantItems: WorkItem[];
    type: AdditionalRelevantItemType;
}

function valueMatch(
    value: string,
    match: string,
    operator: ItemMetaFilterPropertyComparisonOperator,
    type: ItemMetaFilterParseValueAs.String | ItemMetaFilterParseValueAs.Number | ItemMetaFilterParseValueAs.Date,
) {
    let parsedValue: string | number = value;
    let parsedMatch: string | number = match;

    // If the value is a number or date, we need to parse it differently
    if (type === ItemMetaFilterParseValueAs.Number) {
        parsedValue = Number(value);
        parsedMatch = Number(match);

        if (isNaN(parsedValue) || isNaN(parsedMatch)) {
            return false;
        }
    } else if (type === ItemMetaFilterParseValueAs.Date) {
        const valueDate = DateTime.fromISO(value);
        const matchDate = DateTime.fromISO(match);
        if (!valueDate.isValid || !matchDate.isValid) {
            return false;
        }

        parsedValue = valueDate.valueOf();
        parsedMatch = matchDate.valueOf();
    }

    switch (operator) {
        case ItemMetaFilterPropertyComparisonOperator.EQ:
            return value === match;
        case ItemMetaFilterPropertyComparisonOperator.NEQ:
            return value !== match;
        case ItemMetaFilterPropertyComparisonOperator.GT:
            return value > match;
        case ItemMetaFilterPropertyComparisonOperator.GTE:
            return value >= match;
        case ItemMetaFilterPropertyComparisonOperator.LT:
            return value < match;
        case ItemMetaFilterPropertyComparisonOperator.LTE:
            return value <= match;
    }
}

function relativeDateMatch(value: string, interval: ItemMetaFilterPropertyDateInterval): boolean {
    const valueDate = DateTime.fromISO(value);
    if (!valueDate.isValid) {
        return false;
    }

    switch (interval) {
        case ItemMetaFilterPropertyDateInterval.MONTHS_BEFORE_NOW: {
            const now = DateTime.now();
            const months = Number(value);
            if (isNaN(months)) {
                return false;
            }
            return valueDate < now.minus({ months });
        }
        case ItemMetaFilterPropertyDateInterval.MONTHS_AFTER_NOW: {
            const now = DateTime.now();
            const months = Number(value);
            if (isNaN(months)) {
                return false;
            }
            return valueDate > now.plus({ months });
        }
    }
}

export function itemMetaFilterMatch(item: WorkItem, filter: ItemMetaFilter): boolean {
    const filtered = filter.filters.filter((f) => {
        const matched = f.match.filter((m) => {
            // Find all filters that match the property id
            // We could have properties with the same id but different values (e.g. tags, multiple assignees)
            const properties = item.properties.filter((p) => p.connectorPropertyId === m.propertyId);
            if (!properties.length) {
                return false;
            }

            const mValue = m.value;
            const mValueId = m.valueId;
            const mValueParsedValueAs = mValue?.parseValueAs;

            // If the filter has a value id, we need to check if the property value or the connector value id matches.
            // We check for both because in some tools (e.g. tags/labels) the value id is the value itself
            if (
                mValueId &&
                (properties.some((p) => p.connectorValueId === mValueId) ||
                    properties.some((p) => p.value === mValueId))
            ) {
                return true;
            }

            if (!mValue) {
                return false;
            }

            switch (mValueParsedValueAs) {
                case ItemMetaFilterParseValueAs.String:
                case ItemMetaFilterParseValueAs.Number:
                case ItemMetaFilterParseValueAs.Date:
                    return properties.some((p) =>
                        valueMatch(p.value, mValue.value, mValue.operator, mValueParsedValueAs),
                    );
                case ItemMetaFilterParseValueAs.DateFromNow: {
                    return properties.some((p) => relativeDateMatch(p.value, mValue.interval));
                }
            }

            return false;
        });
        if (f.operator === ItemMetaFilterPropertyOperator.And) {
            return matched.length === f.match.length;
        }
        return matched.length > 0;
    });
    // Default to AND operator (matching JPD behavior)
    return filtered.length === filter.filters.length;
}

/**
 * Resolves one scope into its changed items (with change events) and, when the
 * connector declares it, additional relevant unchanged items.
 * (Port of the former `CollectionItemData`.)
 */
export class ScopeData {
    private _everythingInConnector: boolean;

    constructor(
        private _runtime: EngineRuntime,
        private _principal: Principal,
        private _scope: Scope,
    ) {
        this._everythingInConnector = this._scope.uuid === EverythingInConnectorId;
    }

    get scope() {
        return this._scope;
    }

    private shouldReturnItemsBeyondFromDate(): AdditionalRelevantItemType | undefined {
        const trait = this._runtime.connectorTraits.get(this._scope.connector).includeItemsBeyondFromDate;
        if (!trait) {
            return undefined;
        }
        if (trait.forHierarchyTypes && !trait.forHierarchyTypes.includes(this._scope.hierarchyType)) {
            return undefined;
        }
        return AdditionalRelevantItemType.ListOfTasks;
    }

    async getRoot(access: AccessFilter): Promise<WorkItem | undefined> {
        if (this._everythingInConnector) {
            return undefined;
        }

        const items = await this._runtime.repos.items.getByUuids([this._scope.uuid], access);
        return items[0];
    }

    async getChildren(
        fromDate: Date,
        skipChangelogFilter = false,
        toDate?: Date,
    ): Promise<{ items: ItemWithChanges[]; additionalRelevantItems: AdditionalRelevantWorkItems | undefined }> {
        const runtime = this._runtime;
        const access = await runtime.accessControl.getAccessFilter(this._principal);
        const maxChildren = runtime.config.graph.maxChildren;

        let allItemUuids: string[] = [];
        const root = await this.getRoot(access);
        // If the item has a meta filter, we need to get the filter
        // and the parent item to get all the child items for
        const metaFilter = await this.getMetaFilter(root, access);

        if (this._everythingInConnector) {
            allItemUuids = await runtime.repos.items.getUuidsByConnector(this._scope.connector, access, {
                updatedSince: fromDate,
            });
        } else {
            const rootUuid = metaFilter?.scopeUuid || this._scope.uuid;
            allItemUuids = await runtime.repos.items.getDescendantUuids([rootUuid], access, {
                maxDepth: runtime.config.graph.maxDepth ?? Number.MAX_SAFE_INTEGER,
                maxItems: Number.MAX_SAFE_INTEGER,
            });
        }

        // Let's get the items that actually have changelog items
        let changedItemUuids = await runtime.repos.events.getChangedItemUuids(allItemUuids, fromDate, toDate);

        // Limit the number of items so we don't overload everything
        // we don't have any ranking information so we just take the first x items
        if (changedItemUuids.length > maxChildren) {
            changedItemUuids = changedItemUuids.slice(0, maxChildren);
        }
        if (allItemUuids.length > maxChildren) {
            allItemUuids = allItemUuids.slice(0, maxChildren);
        }

        const itemFilter = (itemToFilter: WorkItem) => {
            if (metaFilter) {
                // Filter the items based on the meta filter
                return itemMetaFilterMatch(itemToFilter, metaFilter.filter);
            }
            return true;
        };

        // Query the changed items (updated within the window)
        const mainItems = (await runtime.repos.items.getByUuids(changedItemUuids, access)).filter(
            (item) => item.lastUpdate && item.lastUpdate > fromDate && itemFilter(item),
        );

        // additional items query: used to get items that are relevant but outside the from date
        // e.g. to do tasks in the backlog with no updates
        const additionalRelevantItemType = this.shouldReturnItemsBeyondFromDate();
        const additionalRelevantItems =
            additionalRelevantItemType != null
                ? (await runtime.repos.items.getByUuids(allItemUuids, access)).filter(itemFilter)
                : undefined;

        // If the root is an item that includes a changelog, then we need to include it in the graph
        if (this.rootItemShouldBeIncludedInGraph()) {
            if (root) {
                mainItems.push(root);
            }
        }

        const additionalItemsData = additionalRelevantItemType
            ? {
                  type: additionalRelevantItemType,
                  additionalRelevantItems: additionalRelevantItems || [],
              }
            : undefined;

        if (skipChangelogFilter) {
            return {
                items: mainItems.map((c) => ({ item: c, changes: [] })),
                additionalRelevantItems: additionalItemsData,
            };
        }

        // Get the changelog for the items
        const filteredByChangelog = await this.filterAndGetByChangelog(access, mainItems, fromDate, toDate);
        return { items: filteredByChangelog, additionalRelevantItems: additionalItemsData };
    }

    private rootItemShouldBeIncludedInGraph() {
        const rootTypes = this._runtime.connectorTraits.get(this._scope.connector).rootItemInGraphHierarchyTypes;
        return rootTypes.includes(this._scope.hierarchyType);
    }

    private async getMetaFilter(
        item: WorkItem | undefined,
        access: AccessFilter,
    ): Promise<{ filter: ItemMetaFilter; scopeUuid: string } | undefined> {
        if (!item) {
            return undefined;
        }

        const filter = item.metaFilter;
        if (!filter || !filter.targetItemId || filter.filters.length === 0) {
            return undefined;
        }

        const parentItem = await this._runtime.repos.items.getByConnectorIds(
            item.userId,
            item.connector,
            filter.targetItemId,
        );
        if (!parentItem) {
            return undefined;
        }
        // access check: only use the parent if the principal can read it
        const accessible = await this._runtime.repos.items.getByUuids([parentItem.uuid], access);
        if (accessible.length === 0) {
            return undefined;
        }
        return {
            filter,
            scopeUuid: parentItem.uuid,
        };
    }

    private async filterAndGetByChangelog(
        access: AccessFilter,
        items: WorkItem[],
        fromDate: Date,
        toDate?: Date,
    ): Promise<ItemWithChanges[]> {
        if (items == null || items.length === 0) {
            return [];
        }
        const itemsByUuid = new Map(items.map((i) => [i.uuid, i]));
        const events = await this._runtime.repos.events.getSortedBatch({
            itemUuids: items.map((i) => i.uuid),
            access,
            from: fromDate,
            to: toDate,
            limitPerItem: this._runtime.config.limits.maxChangeEventsPerItem,
        });

        const changesByItem = new Map<string, ItemWithChanges>();
        events.forEach((e) => {
            const item = itemsByUuid.get(e.itemUuid);
            if (!item) {
                return;
            }
            const found = changesByItem.get(e.itemUuid);
            if (found) {
                found.changes.push(e);
            } else {
                changesByItem.set(e.itemUuid, { item, changes: [e] });
            }
        });
        return Array.from(changesByItem.values()).filter((item) => item.changes.length > 0);
    }
}

/**
 * Resolves many scopes into their combined changed items (formerly `CollectionData`).
 */
export class ScopesData {
    private _scopeData: ScopeData[];

    constructor(
        private _runtime: EngineRuntime,
        private _principal: Principal,
        private _scopes: Scope[],
    ) {
        this._scopeData = this._scopes.map((v) => new ScopeData(this._runtime, this._principal, v));
    }

    async getRoots(): Promise<WorkItem[]> {
        const access = await this._runtime.accessControl.getAccessFilter(this._principal);
        const roots = await Promise.all(this._scopeData.map((v) => v.getRoot(access)));
        const res: WorkItem[] = [];
        roots.forEach((v) => {
            if (v !== undefined) {
                res.push(v);
            }
        });
        return res;
    }

    async getChildren(
        fromDate: Date,
        toDate?: Date,
        skipChangelogFilter = false,
    ): Promise<{
        items: ItemWithChanges[];
        additionalRelevantItems: AdditionalRelevantWorkItems[];
        scopesWithChildUuids: {
            scopeUuid: string;
            childItemUuids: string[];
        }[];
    }> {
        const children = await Promise.all(
            this._scopeData.map(async (v) => {
                const items = await v.getChildren(fromDate, skipChangelogFilter, toDate);
                return {
                    items,
                    scopeUuid: v.scope.uuid,
                };
            }),
        );
        const scopesWithChildUuids = children.map((v) => ({
            scopeUuid: v.scopeUuid,
            childItemUuids: v.items.items.map((item) => item.item.uuid),
        }));

        const itemsInChildren = children.map((v) => v.items);
        const additionalRelevantItems: AdditionalRelevantWorkItems[] = [];
        itemsInChildren.forEach((v) => {
            if (v.additionalRelevantItems) {
                // Filter items
                const items = v.additionalRelevantItems.additionalRelevantItems.filter((i) => i.deleted == null);
                v.additionalRelevantItems.additionalRelevantItems = items;

                // Update the array
                additionalRelevantItems.push(v.additionalRelevantItems);
            }
        });
        return {
            items: itemsInChildren.flatMap((v) => v.items).filter((i) => i.item.deleted == null),
            additionalRelevantItems,
            scopesWithChildUuids,
        };
    }
}

/** Classifies a work item into a Scope using the connector's hierarchy-type mapping trait. */
export function scopeFromWorkItem(runtime: EngineRuntime, item: WorkItem): Scope {
    const traits = runtime.connectorTraits.get(item.connector);
    return {
        uuid: item.uuid,
        connector: item.connector,
        hierarchyType: traits.hierarchyTypeFromObjectType(
            item.idsFromConnector.connectorObjectType,
            getItemTypeProps(item).name,
        ),
    };
}
