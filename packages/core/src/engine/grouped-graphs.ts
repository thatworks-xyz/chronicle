import { DateTime } from 'luxon';
import {
    ActivityItem,
    GroupSettings,
    ItemGroupPredefinedType,
    ItemSort,
    ItemSubgroup,
    ItemTypeGrouping,
    TimelineActivity,
} from '../domain/api-types.js';
import { ConnectorId } from '../domain/connector.js';
import { Scope } from '../domain/context.js';
import {
    ChangeActionType,
    ContextItemsFiltersWithOperator,
    ItemPropertyStatusCategory,
    ItemPropertyType,
    ItemType,
} from '../domain/filters.js';
import { SummarizedChanges, SummarizedStatusChange, Timeline, TimelineItem } from '../domain/timeline.js';
import { getTextFromItemProperty, ItemProperty, WorkItem } from '../domain/work-item.js';
import { Logger } from '../ports/logger.js';
import { EngineRuntime } from '../ports/runtime.js';
import { Capitalize, pluralizeWord } from '../vendor/string-utils.js';
import { ActivityItemGraph, ActivityItemGraphGroupFunc } from './activity-graph.js';
import { getActivityItemGraphFromTimeline } from './activity-search.js';
import { dateSortOldestFirst } from './date-sort.js';
import { getItemTypeProps } from './get-item-type.js';

export const UNASSIGNED_GROUP_NAME = '(unassigned)';

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getStatusChanges(changes: SummarizedChanges['changes']): SummarizedStatusChange[] {
    // Initialize the status changes
    const statusChanges: SummarizedStatusChange[] = [];

    // Iterate over the summarized changes to fill out status changes
    changes.forEach((c) => {
        c.statusChanges.forEach((sc) => {
            statusChanges.push(sc);
        });
    });

    // Sort the status changes
    statusChanges.sort((a, b) => dateSortOldestFirst(a.date, b.date));

    // Return
    return statusChanges;
}

function groupByStatusChange(
    activityItems: ActivityItem[],
    timeline: Timeline,
): {
    subgroups: {
        label: string;
        items: { item: ActivityItem; fromStatus: SummarizedStatusChange; toStatus: SummarizedStatusChange }[];
    }[];
    noTime: string[];
} {
    const itemIdsWithNoTime = new Set<string>();
    const completionTimeBuckets = new Map<
        string,
        {
            items: { item: ActivityItem; fromStatus: SummarizedStatusChange; toStatus: SummarizedStatusChange }[];
            order: number;
        }
    >();

    // Iterate over the activity items to build the time buckets
    for (const item of activityItems) {
        // Get summarized changes
        const summarizedChanges = timeline.changes.find((c) => c.itemUuid === item.id);
        if (!summarizedChanges) {
            itemIdsWithNoTime.add(item.id);
            continue;
        }

        // Get status changes
        const statusChanges = getStatusChanges(summarizedChanges.changes);
        if (statusChanges.length === 0) {
            itemIdsWithNoTime.add(item.id);
            continue;
        }

        // Get from status and to status
        const fromStatus = statusChanges[0];
        const toStatus = statusChanges.length > 0 ? statusChanges[statusChanges.length - 1] : statusChanges[0];
        if (fromStatus.fromValue === toStatus.toValue || !fromStatus || !toStatus) {
            itemIdsWithNoTime.add(item.id);
            continue;
        }

        // Divide the status changes by time buckets
        const timeDiffDays = DateTime.fromJSDate(new Date(toStatus.date))
            .diff(DateTime.fromJSDate(new Date(fromStatus.date)))
            .as('days');
        let order = 1000;
        let key = '';
        if (timeDiffDays <= 1) {
            key = '< 1 day';
            order = 0;
        } else if (timeDiffDays <= 3) {
            key = '1-3 days';
            order = 1;
        } else if (timeDiffDays <= 5) {
            key = '3-5 days';
            order = 2;
        } else {
            key = '> 5 days';
            order = 3;
        }
        const found = completionTimeBuckets.get(key);
        if (found) {
            found.items.push({ item, fromStatus, toStatus });
        } else {
            completionTimeBuckets.set(key, { items: [{ item, fromStatus, toStatus }], order });
        }
    }

    // Order and map the time buckets
    const mapAsArray = Array.from(completionTimeBuckets.entries())
        .sort((a, b) => a[1].order - b[1].order)
        .map((e) => ({ label: e[0], items: e[1].items }));

    // Return
    return {
        subgroups: mapAsArray,
        noTime: Array.from(itemIdsWithNoTime),
    };
}

/**
 * Determines the ancestor object type to group items under for parent grouping,
 * based on the connector's declared parentGroupingRules and the active scopes.
 */
function getRelevantParentObjectTypeForGroup(
    runtime: EngineRuntime,
    itemConnector: ConnectorId,
    scopes: Scope[],
): string | undefined {
    const foundScopes = scopes.filter((s) => s.connector === itemConnector);
    if (foundScopes.length === 0) {
        return undefined;
    }
    const rules = runtime.connectorTraits.get(itemConnector).parentGroupingRules;
    const hierarchyTypes = new Set(scopes.map((s) => s.hierarchyType));
    for (const rule of rules) {
        if (rule.hierarchyTypes.some((h) => hierarchyTypes.has(h))) {
            return rule.parentObjectType;
        }
    }
    return undefined;
}

function recursivelyFindRelevantParentForGrouping(
    timelineItem: TimelineItem,
    timelineItems: Timeline['items'],
    releventParentObjectType: string,
    log: Logger,
): TimelineItem | undefined {
    const parents: TimelineItem[] = [];
    timelineItem.parents.forEach((p) => {
        const parent = timelineItems[p.uuid];
        if (!parent) {
            log.warn(
                `recursivelyFindRelevantParentForGrouping: Parent uuid ${p} not found for item ${timelineItem.itemUuid} in timeline`,
            );
            return;
        }
        parents.push(parent);
    });
    const relevantParent = parents.find(
        (p) => p.readableConnectorObjectType.toLowerCase() === releventParentObjectType.toLowerCase(),
    );
    if (relevantParent) {
        return relevantParent;
    }
    const parentIsTheSame = parents.find(
        (p) => p.readableConnectorObjectType === timelineItem.readableConnectorObjectType,
    );
    // If the parent is the same or there is only one parent, then do a recursive search
    // Bail if there are multiple parents: this is something we can support in the future if the use case arises
    if (parentIsTheSame || parents.length === 1) {
        return recursivelyFindRelevantParentForGrouping(
            parentIsTheSame || parents[0],
            timelineItems,
            releventParentObjectType,
            log,
        );
    }
    return undefined;
}

export function groupGraphByConnectorTypeAndStatus(
    runtime: EngineRuntime,
    graph: ActivityItemGraph,
    timeline: Timeline,
): {
    name: string;
    graph: ActivityItemGraph;
    metadata?: {
        color: string | undefined;
        connector: string | undefined;
        iconUrl: string | undefined;
    };
}[] {
    const log = runtime.log;
    // Declare a nested function that makes keys for the buckets maps
    function makeMapKey(connector: ConnectorId, type: string, status: string) {
        return `${connector}-${type}-${status}`;
    }
    return graph.groupBy((items) => {
        const itemBucketsByConnectorTypeAndStatus = new Map<
            string,
            {
                itemIds: string[];
                name: string;
                metadata: {
                    grouping: string;
                    statusValue: string | undefined;
                    statusCategory: ItemPropertyStatusCategory | undefined;
                    statusOrderIndex: number | undefined;
                    itemIconUrl: string | undefined;
                    itemColor: string | undefined;
                    connector: ConnectorId;
                    shouldPluralize: boolean;
                };
            }
        >();

        items.forEach((it) => {
            const timelineItem = timeline.items[it.id];
            if (!timelineItem) {
                log.error(`Timeline item ${it.id} not found in timeline`);
                return;
            }

            // Check if the item has at least a type, otherwise continue to the next item
            if (timelineItem.types.length === 0) {
                log.warn(`Item ${timelineItem.itemUuid} has no type, continuing to next item.`);
                return;
            }

            // Get the grouping and if it should be pluralize
            const objectType = getItemTypeProps(timelineItem);
            let shouldPluralize = true;
            let grouping = Capitalize(objectType.name);
            // Group under the parent's name when the connector declares it
            // (e.g. Notion pages grouped by their database's name)
            const groupTypeByParents = runtime.connectorTraits.get(timelineItem.connector).groupTypeByParentObjectTypes;
            if (
                groupTypeByParents.length > 0 &&
                it.parents.length > 0 &&
                groupTypeByParents.includes(it.parents[0].idFromConnectorObjectType)
            ) {
                grouping = it.parents[0].name;
                shouldPluralize = false;
            }

            // Get the status value and order index
            let statusValue: string | undefined;
            let statusOrderIndex: number | undefined;
            let statusCategory: ItemPropertyStatusCategory | undefined;
            const statusProp = timelineItem.properties.find((p) => p.details.type === ItemPropertyType.Status);
            if (statusProp && statusProp.details.type === ItemPropertyType.Status) {
                statusValue = statusProp.value;
                statusOrderIndex = statusProp.details.statusOrderIndex;
                statusCategory = statusProp.details.statusCategory;
            }

            // Create a key and then, if there no entry in the map for that key we
            // initialize it otherwise we just push the item into the items array
            const key = makeMapKey(timelineItem.connector, grouping, statusValue || 'no-status');
            const found = itemBucketsByConnectorTypeAndStatus.get(key);
            if (found) {
                found.itemIds.push(it.id);
            } else {
                itemBucketsByConnectorTypeAndStatus.set(key, {
                    itemIds: [it.id],
                    // Set the name at the end after the map has been created because the label depends on the final count of items
                    name: '',
                    metadata: {
                        grouping,
                        statusValue,
                        statusOrderIndex,
                        statusCategory,
                        itemIconUrl: objectType?.iconUrl || undefined,
                        itemColor: objectType?.color || undefined,
                        connector: timelineItem.connector,
                        shouldPluralize,
                    },
                });
            }
        });

        itemBucketsByConnectorTypeAndStatus.forEach((b) => {
            // create and set the name
            let name = `${
                b.metadata.shouldPluralize ? pluralizeWord(b.metadata.grouping, b.itemIds.length) : b.metadata.grouping
            }: ${b.itemIds.length}`;
            if (b.metadata.statusValue) {
                name += ` ${b.metadata.statusValue}`;
            }
            b.name = name;
        });

        const resMap = new Map<
            string,
            {
                name: string;
                itemIds: string[];
                metadata?: {
                    color: string | undefined;
                    connector: string | undefined;
                    iconUrl: string | undefined;
                    statusOrderIndex: number;
                };
            }
        >();
        itemBucketsByConnectorTypeAndStatus.forEach((v, k) => {
            resMap.set(k, {
                name: v.name,
                itemIds: v.itemIds,
                metadata: {
                    color: v.metadata.itemColor,
                    connector: v.metadata.connector,
                    iconUrl: v.metadata.itemIconUrl,
                    statusOrderIndex: v.metadata.statusOrderIndex || 0,
                },
            });
        });
        const res = Array.from(resMap.values());
        sortGroupedArrayInPlace(res, undefined, sortByStatusOrderIndex);
        return res;
    });
}

export function fuzzyNameMatch(name1: string, name2: string): boolean {
    const normalize = (str: string) => {
        const n = str.toLowerCase();
        // Remove email domain
        return n.includes('@') ? n.split('@')[0] : n;
    };

    const tokenize = (str: string) => new Set(str.split(/[\s@.]+/));
    const tokens1 = tokenize(normalize(name1));
    const tokens2 = tokenize(normalize(name2));

    // Check if tokens1 is a subset of tokens2 or vice versa
    const isSubset = (set1: Set<string>, set2: Set<string>) => {
        for (const token of set1) {
            if (!set2.has(token)) {
                return false;
            }
        }
        return true;
    };

    return isSubset(tokens1, tokens2) || isSubset(tokens2, tokens1);
}

function sortByStatusOrderIndex<T extends { name: string; metadata?: { statusOrderIndex: number | undefined } }>(
    a: T,
    b: T,
): number {
    const aIndex = a.metadata?.statusOrderIndex ?? 0;
    const bIndex = b.metadata?.statusOrderIndex ?? 0;

    if (aIndex === bIndex) {
        return a.name.localeCompare(b.name);
    }

    // descending order to ensure that "done" statuses are shown first
    return bIndex - aIndex;
}

function sortGroupedArrayInPlace<T>(
    array: ReturnType<ActivityItemGraphGroupFunc<T>>,
    subgroupOrdering: string[] | undefined | null,
    sortFunction: (
        a: ReturnType<ActivityItemGraphGroupFunc<T>>[number],
        b: ReturnType<ActivityItemGraphGroupFunc<T>>[number],
    ) => number = (a, b) => a.name.localeCompare(b.name),
) {
    if (subgroupOrdering) {
        // subgroupOrdering is an array of names in the correct sort order
        // we now sort `array` based on the order of names in subgroupOrdering, using the name field of each element
        // if a name in `array` is not in subgroupOrdering, it will be sorted to the end
        array.sort((a, b) => {
            const aIndex = subgroupOrdering.indexOf(a.name);
            const bIndex = subgroupOrdering.indexOf(b.name);
            if (aIndex === -1 && bIndex === -1) {
                return 0;
            }
            if (aIndex === -1) {
                return 1;
            }
            if (bIndex === -1) {
                return -1;
            }
            return aIndex - bIndex;
        });
    } else {
        // If no subgroupOrdering is provided, we sort the array by the name field
        // or a custom sort function if provided
        array.sort((a, b) => sortFunction(a, b));
    }
}

export async function getGroupedGraphs(
    runtime: EngineRuntime,
    principal: { userId: string; organizationId?: string },
    graph: ActivityItemGraph,
    timeline: Timeline,
    grouping: GroupSettings,
    scopes: Scope[],
): Promise<{ name: string; graph: ActivityItemGraph }[]> {
    const access = await runtime.accessControl.getAccessFilter(principal);
    const scopeItems = await runtime.repos.items.getByUuids(
        scopes.map((s) => s.uuid),
        access,
    );
    const scopeItemsMap = new Map(scopeItems.map((s) => [s.uuid, s]));
    const log = runtime.log;

    switch (grouping.groupType) {
        case ItemGroupPredefinedType.None:
            return [];
        case ItemGroupPredefinedType.Assignee: {
            return graph.groupBy((items) => {
                const you = 'you';
                const assigneeMap = new Map<string, { itemIds: string[]; namesFuzzyMatch: Set<string> }>();
                const unassignedIDs: Set<TimelineItem['itemUuid']> = new Set();
                items.forEach((i) => {
                    const timelineItem = timeline.items[i.id];
                    const assignees: { assignee: string; isUser: boolean }[] = [];
                    if (!timelineItem) {
                        log.error(`Expected to find timeline item ${i.id} for ${grouping.groupType} but did not`);
                        return;
                    }
                    const assigneeProp = timelineItem.properties.find(
                        (p) => p.details.type === ItemPropertyType.Assignee,
                    );
                    if (assigneeProp && assigneeProp.details.type === ItemPropertyType.Assignee) {
                        assignees.push({ assignee: assigneeProp.value, isUser: assigneeProp.details.isUser });
                    } else if (
                        timelineItem.types.includes(ItemType.Document) ||
                        timelineItem.types.includes(ItemType.PullRequest)
                    ) {
                        timelineItem.createdBy.forEach((c) => {
                            assignees.push({ assignee: c.displayName, isUser: c.isUser });
                        });
                        i.actors.names.forEach((a) => {
                            assignees.push({ assignee: a.name, isUser: a.isUser });
                        });
                    }
                    // Unassigned
                    else {
                        unassignedIDs.add(timelineItem.itemUuid);
                    }

                    assignees.forEach((a) => {
                        // Workaround: there are no uniform user IDs across tools, and some
                        // sources may record the acting user as "you" instead of a name, so
                        // assignees are merged by fuzzy name matching.
                        const assigneeName = a.assignee;
                        let found = assigneeMap.get(assigneeName);
                        let fuzzy: string | undefined;
                        if (!found) {
                            const fuzzyMatch = Array.from(assigneeMap.keys()).find((f) =>
                                fuzzyNameMatch(assigneeName, f),
                            );
                            if (fuzzyMatch) {
                                found = assigneeMap.get(fuzzyMatch);
                                fuzzy = assigneeName;
                            }
                        }

                        if (found) {
                            found.itemIds.push(i.id);
                            if (fuzzy) {
                                found.namesFuzzyMatch.add(fuzzy);
                            }
                        } else {
                            assigneeMap.set(assigneeName, {
                                itemIds: [i.id],
                                namesFuzzyMatch: new Set([assigneeName]),
                            });
                        }
                    });
                });

                const groupMap = new Map<string, { itemIds: string[]; name: string }>();
                assigneeMap.forEach((data, assignee) => {
                    const key =
                        data.namesFuzzyMatch.size > 1
                            ? Array.from(data.namesFuzzyMatch)
                                  .filter((n) => n.toLowerCase() !== you)
                                  .sort((a, b) => a.length - b.length)[0]
                            : assignee;
                    groupMap.set(key, { itemIds: Array.from(new Set(data.itemIds)), name: key });
                });

                if (unassignedIDs.size > 0) {
                    groupMap.set(UNASSIGNED_GROUP_NAME, {
                        itemIds: Array.from(unassignedIDs),
                        name: UNASSIGNED_GROUP_NAME,
                    });
                }

                const res = Array.from(groupMap.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);
                return res;
            });
        }
        case ItemGroupPredefinedType.People: {
            return graph.groupBy((items) => {
                const actorMap = new Map<string, { itemIds: string[]; name: string }>();
                items.forEach((i) => {
                    const changes = timeline.changes.find((ch) => ch.itemUuid === i.id);
                    // Prefer updated changes to other changes to avoid including people who have
                    // only created an item while others have updated it
                    const changesWithUpdates =
                        changes?.changes.filter((c) => c.actionType === ChangeActionType.Updated) || [];
                    const changesToScan = changesWithUpdates.length > 0 ? changesWithUpdates : changes?.changes;
                    const actorsSet = new Set<string>();
                    changesToScan?.forEach((c) => {
                        c.actorList.forEach((a) => {
                            if (a.displayName) {
                                actorsSet.add(a.displayName);
                            }
                        });
                    });
                    const actors = Array.from(actorsSet).sort();
                    const actorsStr = actors.length > 0 ? actors.join(', ') : '(unknown)';
                    const found = actorMap.get(actorsStr);
                    if (found) {
                        found.itemIds.push(i.id);
                    } else {
                        actorMap.set(actorsStr, { itemIds: [i.id], name: actorsStr });
                    }
                });
                const res = Array.from(actorMap.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);
                return res;
            });
        }
        case ItemGroupPredefinedType.Status: {
            return graph.groupBy((items) => {
                const statusBuckets = new Map<
                    string,
                    { itemIds: string[]; metadata: { statusOrderIndex: number; isDoneStatus?: boolean }; name: string }
                >();
                items.forEach((i) => {
                    const timelineItem = timeline.items[i.id];
                    if (!timelineItem) {
                        log.error(`Expected to find timeline item ${i.id} for ${grouping.groupType} but did not`);
                        return;
                    }
                    const prop = timelineItem.properties.find((p) => p.details.type === ItemPropertyType.Status);
                    if (prop && prop.details.type === ItemPropertyType.Status) {
                        const found = statusBuckets.get(prop.value);
                        if (found) {
                            found.itemIds.push(i.id);
                        } else {
                            statusBuckets.set(prop.value, {
                                metadata: {
                                    statusOrderIndex: prop.details.statusOrderIndex,
                                    isDoneStatus: prop.details.isDone || false,
                                },
                                itemIds: [i.id],
                                name: prop.value,
                            });
                        }
                    }
                });

                const res = Array.from(statusBuckets.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering, sortByStatusOrderIndex);
                return res;
            });
        }
        case ItemGroupPredefinedType.Parent: {
            return graph.groupBy((items) => {
                const itemUuidsScopeUuidMap = new Map<string, string>();
                Object.entries(timeline.scopesWithChildUuids).forEach(([scopeUuid, childUuids]) => {
                    childUuids.forEach((childUuid) => {
                        itemUuidsScopeUuidMap.set(childUuid, scopeUuid);
                    });
                });

                const parentBuckets = new Map<string, { name: string; itemIds: string[] }>();
                items.forEach((i) => {
                    const timelineItem = timeline.items[i.id];
                    if (!timelineItem) {
                        log.error(`Expected to find timeline item ${i.id} for ${grouping.groupType} but did not`);
                        return;
                    }
                    const releventParentObjectType = getRelevantParentObjectTypeForGroup(
                        runtime,
                        timelineItem.connector,
                        scopes,
                    );

                    let scope: WorkItem | undefined;
                    const scopeUuid = itemUuidsScopeUuidMap.get(i.id);
                    if (scopeUuid) {
                        scope = scopeItemsMap.get(scopeUuid);
                    } else {
                        const scopes = i.parents.map((p) => p.uuid);
                        const found = scopes.find((s) => scopeItemsMap.has(s));
                        if (found) {
                            scope = scopeItemsMap.get(found);
                        }
                    }
                    if (!scope) {
                        log.warn(`Expected to find scope for item ${i.id} but did not`);
                        return;
                    }

                    let parent: { title: string; uuid: string; isScope: boolean } = {
                        title: scope.title,
                        uuid: scope.uuid,
                        isScope: true,
                    };
                    if (releventParentObjectType) {
                        const relevantParent = recursivelyFindRelevantParentForGrouping(
                            timelineItem,
                            timeline.items,
                            releventParentObjectType,
                            log,
                        );
                        if (relevantParent) {
                            parent = { title: relevantParent.title, uuid: relevantParent.itemUuid, isScope: false };
                        }
                    }

                    const foundInBucket = parentBuckets.get(parent.uuid);
                    if (foundInBucket) {
                        foundInBucket.itemIds.push(i.id);
                    } else {
                        parentBuckets.set(parent.uuid, {
                            itemIds: [i.id],
                            name: parent.isScope ? parent.title : `${scope.title} → ${parent.title}`,
                        });
                    }
                });

                const res = Array.from(parentBuckets.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);
                return res;
            });
        }
        case ItemGroupPredefinedType.StatusLifecycle: {
            return graph.groupBy((items) => {
                const grouped = groupByStatusChange(items, timeline);
                const subgroups = grouped.subgroups.map((data) => {
                    const buckets: Map<
                        string,
                        { items: ActivityItem[]; label: string; connector: string; iconUrl?: string }
                    > = new Map();
                    data.items.forEach((i) => {
                        const label = `${i.fromStatus.fromValue || 'none'} → ${i.toStatus.toValue || 'none'}`;
                        const connector = i.item.connector;
                        const key = `${connector}-${label}`;
                        const found = buckets.get(key);
                        if (found) {
                            found.items.push(i.item);
                        } else {
                            buckets.set(key, {
                                items: [i.item],
                                label,
                                connector,
                                iconUrl: i.item.iconUrl || undefined,
                            });
                        }
                    });

                    return {
                        name: data.label,
                        itemIds: data.items.map((i) => i.item.id),
                        metadata: {
                            itemTypeGrouping: Array.from(buckets.values()).map((data) => {
                                return {
                                    label: data.label,
                                    ids: data.items.map((i) => i.id),
                                    connector: data.connector,
                                    iconUrl: data.iconUrl,
                                };
                            }),
                        },
                    };
                });
                if (grouped.noTime.length > 0) {
                    subgroups.push({
                        name: 'No time available',
                        itemIds: grouped.noTime,
                        metadata: { itemTypeGrouping: [] },
                    });
                }

                const res = Array.from(subgroups.values());
                // no further sorting applied because the buckets are correctly ordered
                return res;
            });
        }
        case ItemGroupPredefinedType.IndividualItem: {
            return graph.groupBy((items) => {
                const res = items.map((it) => ({ name: it.title, itemIds: [it.id] }));
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);
                return res;
            });
        }
        case ItemGroupPredefinedType.Property: {
            // Validation: ensure propertyName or propertyType is provided
            if (!grouping.property?.propertyName && !grouping.property?.propertyType) {
                log.error(`get-grouped-graphs: property name or type not provided for property grouping`);
                return [];
            }

            // Validation: ensure only one comparator is provided
            const comparators = grouping.property?.propertyValue;
            const comparatorCount = comparators
                ? Object.keys(comparators).filter((key) => comparators[key as keyof typeof comparators] != null).length
                : 0;
            if (comparatorCount > 1) {
                log.error(`get-grouped-graphs: multiple comparators provided for property grouping, only one allowed`);
                return [];
            }

            return graph.groupBy((items) => {
                const propertyBuckets = new Map<string, { itemIds: string[]; name: string }>();

                items.forEach((i) => {
                    const timelineItem = timeline.items[i.id];
                    if (!timelineItem) {
                        log.error(`Expected to find timeline item ${i.id} for ${grouping.groupType} but did not`);
                        return;
                    }

                    // Find the properties by name and optionally by type
                    const properties = timelineItem.properties.filter((p) => {
                        const nameMatches = grouping.property?.propertyName
                            ? p.name === grouping.property.propertyName
                            : true;
                        const typeMatches = grouping.property?.propertyType
                            ? p.details.type === grouping.property.propertyType
                            : true;
                        return nameMatches && typeMatches;
                    });

                    // If properties not found, ignore the item
                    if (properties.length === 0) {
                        return;
                    }

                    let selectedProperty: ItemProperty | undefined;

                    // regex: only include item + property matching the pattern
                    if (comparators?.regex != null) {
                        try {
                            const regexPattern = new RegExp(comparators.regex);
                            selectedProperty = properties.find((p) => {
                                const propertyValue = getTextFromItemProperty(p);
                                return regexPattern.test(propertyValue);
                            });
                            if (!selectedProperty) {
                                return; // No property matched the regex, skip this item
                            }
                        } catch (e) {
                            log.error(
                                `Invalid regex pattern in property grouping: ${
                                    comparators.regex
                                }, error: ${getExceptionMessage(e)}`,
                            );
                            return; // Skip this item on regex error
                        }
                    }

                    // If no regex or no property matched the regex, just take the first property
                    if (!selectedProperty) {
                        selectedProperty = properties[0];
                    }

                    // Extract the property value
                    const propertyValue = getTextFromItemProperty(selectedProperty);

                    // Apply filters if provided
                    if (comparators?.neq != null) {
                        // neq: not equal - exclude items with this value
                        if (propertyValue === comparators.neq) {
                            return; // Skip this item
                        }
                    }

                    // Create bucket name: "{propertyName}: {propertyValue}"
                    const propertyName = grouping.property?.propertyName || selectedProperty.name;
                    const bucketName = `${propertyName}: ${propertyValue}`;

                    // Add to bucket
                    const found = propertyBuckets.get(bucketName);
                    if (found) {
                        found.itemIds.push(i.id);
                    } else {
                        propertyBuckets.set(bucketName, {
                            itemIds: [i.id],
                            name: bucketName,
                        });
                    }
                });

                const res = Array.from(propertyBuckets.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);
                return res;
            });
        }
        // Custom group type
        default:
            return graph.groupBy((items) => {
                // Initialize the buckets
                const customTypeBuckets = new Map<string, { itemIds: string[]; name: string }>();
                const idsWithoutBucket: Set<TimelineItem['itemUuid']> = new Set();

                // Iterate over the items to build the buckets
                items.forEach((i) => {
                    // Get the timeline item
                    const timelineItem = timeline.items[i.id];
                    if (!timelineItem) {
                        log.error(`Expected to find timeline item ${i.id} for ${grouping.groupType} but did not`);
                        return;
                    }

                    // Get the property for the received group type
                    const property = timelineItem.properties.find((p) => p.name === grouping.groupType);

                    // If the property is found, add the item to the bucket
                    if (property) {
                        // Get the value from the property based on the property type
                        const propValue = getTextFromItemProperty(property);

                        // Add the property value to the buckets
                        const found = customTypeBuckets.get(propValue);
                        if (found) {
                            found.itemIds.push(timelineItem.itemUuid);
                        } else {
                            customTypeBuckets.set(propValue, { name: propValue, itemIds: [timelineItem.itemUuid] });
                        }
                    }
                    // Otherwise, add the item to the unassigned bucket
                    else {
                        idsWithoutBucket.add(timelineItem.itemUuid);
                    }
                });

                // Add items without a bucket to an unassigned group
                if (idsWithoutBucket.size > 0) {
                    customTypeBuckets.set(UNASSIGNED_GROUP_NAME, {
                        itemIds: Array.from(idsWithoutBucket),
                        name: UNASSIGNED_GROUP_NAME,
                    });
                }

                // Sort the buckets
                const res = Array.from(customTypeBuckets.values());
                sortGroupedArrayInPlace(res, grouping.subgroupOrdering);

                // Return the result
                return res;
            });
    }
}

export interface GroupedGraphs {
    groupedByItemType: false;
    graphs: { name?: string; graph: ActivityItemGraph }[];
    ungroupedGraph: ActivityItemGraph;
}

export interface GroupedGraphsByItemType {
    groupedByItemType: true;
    graphs: {
        name: string | undefined;
        graphs: {
            name: string;
            graph: ActivityItemGraph;
            metadata?: {
                color: string | undefined;
                connector: string | undefined;
                iconUrl: string | undefined;
            };
        }[];
    }[];
}

/**
 * Retrieves grouped activity item graphs based on the provided parameters.
 *
 * @param runtime - The engine runtime (logger, config, repositories, traits).
 * @param principal - The reader on whose behalf the graphs are built.
 * @param timeline - The timeline data used to generate the activity item graph.
 * @param scopes - The scopes that define the boundaries of the activity.
 * @param fromDate - The starting date from which the activity is considered.
 * @param userIanaZone - The IANA time zone identifier for the user.
 * @param actorColorMap - A map of actor IDs to their corresponding colors.
 * @param filters - Filters applied to the context items. If the filter array is empty, then all updated items are returned.
 * @param grouping - Settings that define how the items should be grouped.
 * @param alsoGroupByItemType - A boolean indicating whether to also group by item type.
 * @returns A promise that resolves to an object containing the grouped activity item graphs,
 *          or undefined if no graph is generated.
 *          If `alsoGroupByItemType` is true, the graphs are further grouped by item type.
 */
export async function getGroupedActivityItemGraphs(
    runtime: EngineRuntime,
    principal: { userId: string; organizationId?: string },
    timeline: Timeline,
    scopes: Scope[],
    fromDate: Date,
    userIanaZone: string,
    actorColorMap: Map<string, string>,
    filters: ContextItemsFiltersWithOperator,
    grouping: GroupSettings | undefined,
    alsoGroupByItemType: boolean,
): Promise<GroupedGraphs | GroupedGraphsByItemType | undefined> {
    const graph = await getActivityItemGraphFromTimeline(
        runtime,
        principal,
        fromDate,
        timeline,
        actorColorMap,
        userIanaZone,
        filters,
    );
    if (!graph) {
        return undefined;
    }

    const graphs =
        grouping && grouping.groupType !== ItemGroupPredefinedType.None
            ? await getGroupedGraphs(runtime, principal, graph, timeline, grouping, scopes)
            : [{ name: undefined, graph }];

    if (!alsoGroupByItemType) {
        return {
            groupedByItemType: false,
            graphs,
            ungroupedGraph: graph,
        };
    }

    const subgraphs = graphs.map((g) => ({
        name: g.name,
        graphs: groupGraphByConnectorTypeAndStatus(runtime, g.graph, timeline),
    }));
    return {
        groupedByItemType: true,
        graphs: subgraphs,
    };
}

export function getTimelineActivityFromGroupedGraphs(
    groupedGraphs: Awaited<ReturnType<typeof getGroupedActivityItemGraphs>>,
    grouping: GroupSettings | undefined,
    sort: ItemSort | undefined,
): Omit<TimelineActivity, 'id'> {
    const res: Omit<TimelineActivity, 'id'> = {
        groups: [],
        items: [],
    };

    if (!groupedGraphs) {
        return res;
    }

    if (groupedGraphs.groupedByItemType) {
        res.groups = [
            {
                type: grouping?.groupType || ItemGroupPredefinedType.None,
                subgroups: groupedGraphs.graphs.map((g) => {
                    const subgroup: ItemSubgroup = {
                        ids: g.graphs.map((v) => v.graph.getAllActivityItemsSortedByScore().map((n) => n.id)).flat(),
                        name: g.name,
                        itemTypeGrouping: g.graphs.map((v) => {
                            const gg: ItemTypeGrouping = {
                                connector: v.metadata?.connector || '',
                                iconUrl: v.metadata?.iconUrl,
                                color: v.metadata?.color,
                                label: v.name,
                                ids: sort
                                    ? v.graph
                                          .getAllActivityItemsSortedByFeature(sort.feature, sort.direction)
                                          .map((n) => n.id)
                                    : v.graph.getAllActivityItemsSortedByScore().map((n) => n.id),
                            };
                            return gg;
                        }),
                    };
                    return subgroup;
                }),
            },
        ];
        res.items = groupedGraphs.graphs
            .map((g) => g.graphs.map((gg) => gg.graph.getAllActivityItemsSortedByScore()))
            .flat()
            .flat();
    } else {
        res.groups = [
            {
                type: grouping?.groupType || ItemGroupPredefinedType.None,
                subgroups: groupedGraphs.graphs.map((g) => {
                    const subgroup: ItemSubgroup = {
                        ids: g.graph.getAllActivityItemsSortedByScore().map((n) => n.id),
                        name: g.name,
                        itemTypeGrouping: undefined,
                    };
                    return subgroup;
                }),
            },
        ];
        res.items = groupedGraphs.graphs.map((g) => g.graph.getAllActivityItemsSortedByScore()).flat();
    }

    res.groups.forEach((g) => {
        g.subgroups = g.subgroups.filter((s) => s.ids.length > 0);
    });
    res.groups = res.groups.filter((g) => g.subgroups.length > 0);
    return res;
}
