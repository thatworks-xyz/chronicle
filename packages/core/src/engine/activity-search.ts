import { DateTime } from 'luxon';
import {
    ActivityItem,
    ActivityItemComment,
    ActivityItemPropertyValueType,
    ActorPlaceholder,
} from '../domain/api-types.js';
import {
    ChangeType,
    CommentComparatorFilter,
    ContextItemsFilter,
    ContextItemsFilterOperator,
    ContextItemsFiltersWithOperator,
    FeatureComparatorFilter,
    GraphFilterType,
    ItemPropertyType,
    PropertyFieldComparatorFilter,
    PropertyFieldFilter,
    PropertyFieldFilterEmpty,
    PropertyFieldFilterRegex,
    PropertyFilterFieldValue,
    PropertyNameValueComparatorFilter,
    PropertyNameValueFilter,
    PropertyNameValueFilterEmpty,
    ScorerName,
    TitleComparatorFilter,
} from '../domain/filters.js';
import {
    AdditionalRelevantItemType,
    ItemPropertyStatusCategoryOrder,
    SummarizedChanges,
    Timeline,
    TimelineItem,
} from '../domain/timeline.js';
import { ItemProperty } from '../domain/work-item.js';
import { Logger } from '../ports/logger.js';
import { EngineRuntime } from '../ports/runtime.js';
import { ActivityItemGraph } from './activity-graph.js';
import { getActivityItemCommentsFromChangelog, getOrGenActorColor, sortByScore } from './activity-search-helpers.js';
import {
    getAndValidateQueryDate,
    toActivityPropertyType,
    toChangeDescriptionDecoration,
    toFeature,
} from './conversions.js';
import { getReadableDateTimeStringLuxon } from './date-helpers.js';
import { getItemTypeProps } from './get-item-type.js';
import { getBestStatusPropIfCategoryIsUnknown } from './status-category-match.js';

function getParents(
    parents: TimelineItem['parents'],
    items: Timeline['items'],
): { item: TimelineItem; relationship: string | undefined }[] {
    const res: { item: TimelineItem; relationship: string | undefined }[] = [];
    parents.forEach((p) => {
        const parent = items[p.uuid];
        if (parent === undefined) {
            return;
        }
        res.push({ item: parent, relationship: p.relationship });
    });
    return res;
}

function parseDateFromPropertyFilterFieldValue(v: PropertyFilterFieldValue) {
    if (v.date) {
        return new Date(v.date);
    } else if (v.queryDate) {
        return getAndValidateQueryDate(v.queryDate);
    }
    throw new Error(`Failed to parse date`);
}

function propertyFilterFieldValueHasValidDate(v: PropertyFilterFieldValue): boolean {
    return v.date != null || v.queryDate != null;
}

function propertyComparator(prop: ItemProperty, filter: PropertyFieldComparatorFilter): boolean {
    if (prop.details.type === ItemPropertyType.Status) {
        prop.details = getBestStatusPropIfCategoryIsUnknown(prop.value, prop.details);
    }

    if (filter.eq) {
        if (filter.eq.value.rawValue) {
            return prop.value === filter.eq.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.eq.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.eq.value);
            return new Date(prop.value).valueOf() === queryDate.valueOf();
        } else if (filter.eq.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return prop.details.statusCategory === filter.eq.value.statusCategory;
            } else {
                return true;
            }
        } else if (filter.eq.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser === filter.eq.value.isUser;
            } else {
                return true;
            }
        } else if (filter.eq.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm === filter.eq.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.neq) {
        if (filter.neq.value.rawValue) {
            return prop.value !== filter.neq.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.neq.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.neq.value);
            return new Date(prop.value).valueOf() !== queryDate.valueOf();
        } else if (filter.neq.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return prop.details.statusCategory !== filter.neq.value.statusCategory;
            } else {
                return true;
            }
        } else if (filter.neq.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser !== filter.neq.value.isUser;
            } else {
                return true;
            }
        } else if (filter.neq.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm !== filter.neq.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.gt) {
        if (filter.gt.value.rawValue) {
            return prop.value > filter.gt.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.gt.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.gt.value);
            return new Date(prop.value).valueOf() > queryDate.valueOf();
        } else if (filter.gt.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return (
                    (ItemPropertyStatusCategoryOrder.get(prop.details.statusCategory) || 0) >
                    (ItemPropertyStatusCategoryOrder.get(filter.gt.value.statusCategory) || 0)
                );
            } else {
                return true;
            }
        } else if (filter.gt.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser > filter.gt.value.isUser;
            } else {
                return true;
            }
        } else if (filter.gt.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm > filter.gt.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.gte) {
        if (filter.gte.value.rawValue) {
            return prop.value >= filter.gte.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.gte.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.gte.value);
            return new Date(prop.value).valueOf() >= queryDate.valueOf();
        } else if (filter.gte.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return (
                    (ItemPropertyStatusCategoryOrder.get(prop.details.statusCategory) || 0) >=
                    (ItemPropertyStatusCategoryOrder.get(filter.gte.value.statusCategory) || 0)
                );
            } else {
                return true;
            }
        } else if (filter.gte.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser >= filter.gte.value.isUser;
            } else {
                return true;
            }
        } else if (filter.gte.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm >= filter.gte.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.lt) {
        if (filter.lt.value.rawValue) {
            return prop.value < filter.lt.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.lt.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.lt.value);
            return new Date(prop.value).valueOf() < queryDate.valueOf();
        } else if (filter.lt.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return (
                    (ItemPropertyStatusCategoryOrder.get(prop.details.statusCategory) || 0) <
                    (ItemPropertyStatusCategoryOrder.get(filter.lt.value.statusCategory) || 0)
                );
            } else {
                return true;
            }
        } else if (filter.lt.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser < filter.lt.value.isUser;
            } else {
                return true;
            }
        } else if (filter.lt.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm < filter.lt.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.lte) {
        if (filter.lte.value.rawValue) {
            return prop.value <= filter.lte.value.rawValue;
        } else if (propertyFilterFieldValueHasValidDate(filter.lte.value)) {
            const queryDate = parseDateFromPropertyFilterFieldValue(filter.lte.value);
            return new Date(prop.value).valueOf() <= queryDate.valueOf();
        } else if (filter.lte.value.statusCategory !== undefined) {
            if (prop.details.type === ItemPropertyType.Status) {
                return (
                    (ItemPropertyStatusCategoryOrder.get(prop.details.statusCategory) || 0) <=
                    (ItemPropertyStatusCategoryOrder.get(filter.lte.value.statusCategory) || 0)
                );
            } else {
                return true;
            }
        } else if (filter.lte.value.isUser !== undefined) {
            if (prop.details.type === ItemPropertyType.Assignee) {
                return prop.details.isUser <= filter.lte.value.isUser;
            } else {
                return true;
            }
        } else if (filter.lte.value.normalizedPriority !== undefined) {
            if (prop.details.type === ItemPropertyType.Priority) {
                const norm = prop.details.priorityIndex / prop.details.totalNumPriorities;
                return norm <= filter.lte.value.normalizedPriority;
            } else {
                return true;
            }
        }
    } else if (filter.regex) {
        const regex = new RegExp(filter.regex.value, 'i');
        return regex.test(prop.value);
    } else if (filter.empty) {
        return !!prop.value === !filter.empty.value;
    }

    return true;
}

function propertyNameValueComparator(prop: ItemProperty, filter: PropertyNameValueComparatorFilter): boolean {
    if (filter.eq) {
        return prop.value.toLowerCase() === filter.eq.value.toLowerCase();
    } else if (filter.neq) {
        return prop.value.toLowerCase() !== filter.neq.value.toLowerCase();
    } else if (filter.regex) {
        const regex = new RegExp(filter.regex.value, 'i');
        return regex.test(prop.value);
    } else if (filter.empty) {
        return !!prop.value === !filter.empty.value;
    }
    return true;
}

function featureComparator(features: TimelineItem['featureScores'], filter: FeatureComparatorFilter): boolean {
    const featureMap = new Map(Object.entries(features).map(([f, s]) => [f as ScorerName, s]));
    if (filter.eq) {
        return featureMap.get(filter.eq.feature) !== undefined && featureMap.get(filter.eq.feature) === filter.eq.score;
    } else if (filter.neq) {
        return (
            featureMap.get(filter.neq.feature) !== undefined && featureMap.get(filter.neq.feature) !== filter.neq.score
        );
    } else if (filter.gt) {
        const score = featureMap.get(filter.gt.feature);
        return score !== undefined && score > filter.gt.score;
    } else if (filter.gte) {
        const score = featureMap.get(filter.gte.feature);
        return score !== undefined && score >= filter.gte.score;
    } else if (filter.lt) {
        const score = featureMap.get(filter.lt.feature);
        return score !== undefined && score < filter.lt.score;
    } else if (filter.lte) {
        const score = featureMap.get(filter.lte.feature);
        return score !== undefined && score <= filter.lte.score;
    }
    return true;
}

function titleComparator(title: TimelineItem['title'], filter: TitleComparatorFilter): boolean {
    if (filter.eq) {
        return title.toLowerCase() === filter.eq.toLowerCase();
    } else if (filter.neq) {
        return title.toLowerCase() !== filter.neq.toLowerCase();
    } else if (filter.regex) {
        const regex = new RegExp(filter.regex, 'i');
        return regex.test(title);
    } else if (filter.inc) {
        return title.toLowerCase().includes(filter.inc.toLowerCase());
    } else if (filter.exc) {
        return !title.toLowerCase().includes(filter.exc.toLowerCase());
    }
    return true;
}

function commentsComparator(comments: ActivityItemComment[], filter: CommentComparatorFilter): boolean {
    if (filter.eq) {
        return comments.some((c) => c.comment.toLowerCase() === filter.eq?.toLowerCase());
    } else if (filter.neq) {
        return !comments.some((c) => c.comment.toLowerCase() === filter.neq?.toLowerCase());
    } else if (filter.regex) {
        const regex = new RegExp(filter.regex, 'i');
        return comments.some((c) => regex.test(c.comment));
    } else if (filter.empty != null) {
        return filter.empty ? comments.length === 0 : comments.length > 0;
    } else if (filter.inc) {
        return comments.some((c) => (filter.inc ? c.comment.toLowerCase().includes(filter.inc.toLowerCase()) : false));
    } else if (filter.exc) {
        return !comments.some((c) => (filter.exc ? c.comment.toLowerCase().includes(filter.exc.toLowerCase()) : false));
    }
    return true;
}

function checkItemProperty(item: TimelineItem, property: PropertyFieldComparatorFilter): boolean {
    // Initialize
    let propertyOk = true;
    const filterProps = property as Record<
        string,
        PropertyFieldFilter | PropertyFieldFilterRegex | PropertyFieldFilterEmpty | undefined
    >;

    // Get the operator
    const key = Object.keys(filterProps).find((v) => filterProps[v] !== undefined);
    if (key) {
        const prop = filterProps[key];
        // Use filter instead of find because some properties can have multiple entries (e.g. Tags)
        const found = item.properties.filter((v) => v.details.type === prop?.property);
        if (found.length === 0) {
            if (!(key === 'empty' && (prop as PropertyFieldFilterEmpty).value === true)) {
                propertyOk = false;
            }
        } else {
            if (filterProps.neq) {
                propertyOk = found.every((v) => propertyComparator(v, filterProps));
            } else {
                propertyOk = found.some((v) => propertyComparator(v, filterProps));
            }
        }
    }

    // Return
    return propertyOk;
}

function checkFromProperty(property: PropertyFieldFilterRegex, ch: SummarizedChanges): boolean {
    // Initialize
    let propertiesOk = false;

    // Iterate over the changes
    for (const change of ch.changes) {
        // Validate if the change type is the same as the property type
        if (change.changeType.toString() !== property.property.toString()) {
            // Continue to the next iteration
            continue;
        }

        // Handle the changes based on its type
        switch (change.changeType) {
            // Status changes
            case ChangeType.Status:
                // Check if any status change matches the received value
                propertiesOk = change.statusChanges.some(
                    (statusChange) => statusChange.fromValue?.toLowerCase() === property.value.toLowerCase(),
                );
                if (propertiesOk) {
                    return true;
                }
                break;
        }
    }

    // Return
    return propertiesOk;
}

function checkItemProperties(item: TimelineItem, filter: ContextItemsFilter, ch?: SummarizedChanges): boolean {
    let propertiesOk = true;
    if (filter.properties) {
        for (const prop of filter.properties) {
            // Check the in operator
            if (prop.in && prop.in.length > 0) {
                propertiesOk = prop.in.some((p) => checkItemProperty(item, { eq: p }));
            }

            // Check the from operator
            else if (prop.from && ch) {
                propertiesOk = checkFromProperty(prop.from, ch);
            }

            // Check all the other operators
            else {
                propertiesOk = checkItemProperty(item, prop);
            }

            // If we already have the properties as false, no need to continue validating
            if (!propertiesOk) {
                break;
            }
        }
    }

    // Return
    return propertiesOk;
}

function checkItemPropertiesNameValue(item: TimelineItem, filter: ContextItemsFilter): boolean {
    let propertiesOk = true;
    if (filter.propertiesNameValue) {
        for (const prop of filter.propertiesNameValue) {
            const filterProps = prop as Record<
                string,
                PropertyNameValueFilter | PropertyNameValueFilterEmpty | undefined
            >;
            const key = Object.keys(filterProps).find((v) => filterProps[v] !== undefined);
            if (key) {
                const prop = filterProps[key];
                // Use filter instead of find because some tools can have multiple properties with the same name
                const found = item.properties.filter((v) => v.name.toLowerCase() === prop?.name.toLowerCase());
                if (found.length === 0) {
                    if (!(key === 'empty' && (prop as PropertyNameValueFilterEmpty).value === true)) {
                        propertiesOk = false;
                    }
                } else {
                    propertiesOk = found.some((v) => propertyNameValueComparator(v, filterProps));
                }
            }

            if (!propertiesOk) {
                break;
            }
        }
    }
    return propertiesOk;
}

function checkItemType(item: TimelineItem, filter: ContextItemsFilter): boolean {
    let typeOfItemOk = true;
    if (filter.type && filter.type.in && filter.type.in.length > 0) {
        // Old db entries might have this field undefined
        if (!item.types) {
            typeOfItemOk = false;
        } else {
            typeOfItemOk = item.types.some((t) => filter.type?.in?.includes(t));
        }
    }
    return typeOfItemOk;
}

function checkConnectorItemType(item: TimelineItem, filter: ContextItemsFilter): boolean {
    let typeOfItemOk = true;
    const itemType = getItemTypeProps(item).name;
    if (filter.connectorItemType && filter.connectorItemType.in && filter.connectorItemType.in.length > 0) {
        typeOfItemOk = filter.connectorItemType.in.some((type) => type.toLowerCase() === itemType.toLowerCase());
    } else if (filter.connectorItemType && filter.connectorItemType.eq) {
        typeOfItemOk = filter.connectorItemType.eq.toLowerCase() === itemType.toLowerCase();
    } else if (filter.connectorItemType && filter.connectorItemType.neq) {
        typeOfItemOk = filter.connectorItemType.neq.toLowerCase() !== itemType.toLowerCase();
    } else if (filter.connectorItemType && filter.connectorItemType.regex) {
        const regex = new RegExp(filter.connectorItemType.regex, 'i');
        typeOfItemOk = regex.test(itemType);
    }
    return typeOfItemOk;
}

function checkItemFeature(item: TimelineItem, filter: ContextItemsFilter): boolean {
    let featureOk = true;
    if (filter.feature) {
        if (filter.feature.in && filter.feature.in.length > 0) {
            const features = Object.keys(item.featureScores);
            featureOk = features.some((f) => filter?.feature?.in?.includes(f as ScorerName));
        } else {
            featureOk = featureComparator(item.featureScores, filter.feature);
        }
    }
    return featureOk;
}

function checkItemTitle(item: TimelineItem, filter: ContextItemsFilter): boolean {
    let titleOk = true;
    if (filter.title) {
        if (filter.title.in && filter.title.in.length > 0) {
            titleOk = filter.title.in.includes(item.title);
        } else {
            titleOk = titleComparator(item.title, filter.title);
        }
    }
    return titleOk;
}

function checkItemComments(changes: SummarizedChanges, filter: ContextItemsFilter): boolean {
    let commentsOk = true;

    // Get comments
    const comments = getActivityItemCommentsFromChangelog(changes.changes, 'recent_first');

    // Check comments
    if (filter.comment) {
        if (filter.comment.in && filter.comment.in.length > 0) {
            commentsOk = comments.some((c) => filter.comment?.in?.includes(c.comment));
        } else {
            commentsOk = commentsComparator(comments, filter.comment);
        }
    }
    return commentsOk;
}

function filterChanges(ch: SummarizedChanges, filter: ContextItemsFilter) {
    return ch.changes.filter((v) => {
        // Filter by change type
        let includesChange = true;
        if (filter.change?.in && filter.change.in.length > 0) {
            includesChange = filter.change.in.includes(v.changeType);
        } else if (filter.change && filter.change.eq) {
            includesChange = v.changeType === filter.change.eq;
        } else if (filter.change && filter.change.neq) {
            includesChange = v.changeType !== filter.change.neq;
        }

        // Filter by action type
        let includesChangeAction = true;
        if (filter.action?.in && filter.action.in.length > 0) {
            includesChangeAction = filter.action.in.includes(v.actionType);
        }

        // Filter by user mention
        let includesMention = true;
        if (filter.userMention?.in && filter.userMention.in.length > 0) {
            includesMention = v.userMentionType.some((r) => filter?.userMention?.in?.includes(r));
        } else if (filter.userMention && filter.userMention.eq) {
            includesMention = v.userMentionType.includes(filter.userMention.eq);
        }

        // Filter by actors
        let includesActors = true;
        if (filter.actors?.in && filter.actors.in.length > 0) {
            includesActors = v.actorList.some((a) => {
                // Everyone
                if (
                    (filter.actors?.in?.includes(ActorPlaceholder.TwOthers) &&
                        filter.actors?.in?.includes(ActorPlaceholder.TwUser)) ||
                    filter.actors?.in?.includes(ActorPlaceholder.TwEveryone)
                ) {
                    return true;
                }

                // Is the user
                if (filter.actors?.in?.includes(ActorPlaceholder.TwUser as string) && a.isUser) {
                    return true;
                }

                // Is not the user (Others)
                if (filter.actors?.in?.includes(ActorPlaceholder.TwOthers as string) && !a.isUser) {
                    return true;
                }

                // Is the display name in the filters
                if (
                    filter.actors?.in?.find((n) =>
                        typeof n === 'string' ? n.toLowerCase() === a.displayName.toLowerCase() : false,
                    )
                ) {
                    return true;
                }

                // Return
                return false;
            });
        }
        return includesChange && includesMention && includesActors && includesChangeAction;
    });
}

function filterItemByChanges(changes: SummarizedChanges['changes'], filter: ContextItemsFilter['change']): boolean {
    let sinceDateOk = true;
    if (filter?.since) {
        let queryDate = filter.since.date;
        if (!queryDate) {
            queryDate = getAndValidateQueryDate(filter.since.queryDate);
        }
        const filteredChanges = changes.filter((v) => v.timeRange.newest.valueOf() >= (queryDate?.valueOf() || 0));
        if (filter.since.changeCount?.eq !== undefined) {
            sinceDateOk = filteredChanges.length === filter.since.changeCount.eq;
        } else if (filter.since.changeCount?.neq !== undefined) {
            sinceDateOk = filteredChanges.length !== filter.since.changeCount.neq;
        } else if (filter.since.changeCount && filter.since.changeCount.neq !== undefined) {
            sinceDateOk = filteredChanges.length !== filter.since.changeCount.neq;
        } else {
            sinceDateOk = filteredChanges.length > 0;
        }
    }

    if (filter?.before) {
        const queryDate = getAndValidateQueryDate(filter.before.queryDate);
        const filteredChanges = changes.filter((v) => v.timeRange.newest.valueOf() < (queryDate?.valueOf() || 0));
        sinceDateOk = filteredChanges.length > 0;
    }

    return sinceDateOk;
}

function filterItemById(itemUuid: string, filter: ContextItemsFilter): boolean {
    if (
        filter.itemUuids &&
        filter.itemUuids.neq &&
        filter.itemUuids.neq.length > 0 &&
        filter.itemUuids.neq.includes(itemUuid)
    ) {
        return false;
    }

    if (
        filter.itemUuids &&
        filter.itemUuids.eq &&
        filter.itemUuids.eq.length > 0 &&
        !filter.itemUuids.eq.includes(itemUuid)
    ) {
        return false;
    }

    return true;
}

function getActivityItemFromTimelineItem(
    timeline: Timeline,
    item: {
        changes: SummarizedChanges['changes'];
        item: TimelineItem;
        filterMatches: number;
    },
    actorColorMap: Map<string, string>,
    ianaZone: string,
): ActivityItem {
    const nowInUsersZone = DateTime.now().setZone(ianaZone);

    const actorsCount: Map<string, { count: number }> = new Map();
    let changeOldest: Date | undefined;
    let changeNewest: Date | undefined;
    item.changes.forEach((v) => {
        if (!changeOldest || changeOldest > new Date(v.timeRange.oldest)) {
            changeOldest = new Date(v.timeRange.oldest);
        }
        if (!changeNewest || changeNewest < new Date(v.timeRange.newest)) {
            changeNewest = new Date(v.timeRange.newest);
        }

        v.actorList.forEach((a) => {
            if (!a.displayName) {
                return;
            }
            const found = actorsCount.get(a.displayName);
            if (found) {
                found.count++;
            } else {
                actorsCount.set(a.displayName, { count: 1 });
            }
        });
    });

    const actors = Array.from(actorsCount.entries())
        .sort((a, b) => a[1].count - b[1].count)
        .map((a) => {
            return { name: a[0], color: getOrGenActorColor(a[0], actorColorMap), isUser: false };
        });

    let timeRange: string | undefined;
    const changeOldestStr = changeOldest
        ? getReadableDateTimeStringLuxon(DateTime.fromJSDate(changeOldest).setZone(ianaZone), nowInUsersZone)
        : undefined;
    const changeNewestStr = changeNewest
        ? getReadableDateTimeStringLuxon(DateTime.fromJSDate(changeNewest).setZone(ianaZone), nowInUsersZone)
        : undefined;
    if (changeOldestStr && changeNewestStr && changeOldestStr !== changeNewestStr) {
        timeRange = `${changeNewestStr} and ${changeOldestStr}`;
    } else {
        timeRange = changeNewestStr || changeOldestStr || undefined;
        if (timeRange) {
            timeRange = `At ${timeRange}`;
        }
    }

    const comments = getActivityItemCommentsFromChangelog(item.changes, 'recent_first');
    const parents = getParents(item.item.parents, timeline.items);

    const changeTypes: Set<ChangeType> = new Set();

    item.changes.forEach((change) => {
        changeTypes.add(change.changeType);
    });

    const typeOfItemProp = item.item.properties.find((p) => p.details.type === ItemPropertyType.TypeOfObject);
    let iconUrl: string | undefined;
    if (typeOfItemProp && typeOfItemProp.details.type === ItemPropertyType.TypeOfObject && typeOfItemProp.style) {
        iconUrl = typeOfItemProp.style.iconUrl;
    }

    const properties: ActivityItem['properties'] = [];
    const propsAllowed = [
        // ItemPropertyType.TypeOfObject,
        ItemPropertyType.Status,
        ItemPropertyType.Priority,
        ItemPropertyType.Assignee,
        // ItemPropertyType.StartDate,
        ItemPropertyType.EndDate,
        // ItemPropertyType.StoryPoints,
        // ItemPropertyType.Progress,
        // ItemPropertyType.Unclassified,
        ItemPropertyType.Description,
        ItemPropertyType.Text,
        ItemPropertyType.Tag,
    ];
    item.item.properties.forEach((p) => {
        if (!propsAllowed.includes(p.details.type)) {
            return;
        }

        if (p.value == null) {
            return;
        }

        properties.push({
            value: p.value,
            name: p.name,
            color: p.style?.color || undefined,
            iconUrl: p.style?.iconUrl || undefined,
            valueType:
                p.details.type === ItemPropertyType.EndDate || p.details.type === ItemPropertyType.StartDate
                    ? ActivityItemPropertyValueType.DateIso
                    : ActivityItemPropertyValueType.String,
            propertyType: toActivityPropertyType(p.details.type),
        });
    });

    const maxCommentsToReturn = 2;
    const r: ActivityItem = {
        title: item.item.title || '',
        id: item.item.itemUuid,
        iconUrl,
        connector: item.item.connector,
        readableConnectorObjectType: item.item.readableConnectorObjectType,
        idFromConnectorObjectType: item.item.idFromConnectorObjectType,
        url: item.item.url,
        parents: parents.map((p) => ({
            readableConnectorObjectType: p.item.readableConnectorObjectType,
            idFromConnectorObjectType: p.item.idFromConnectorObjectType,
            relationship: p.relationship,
            name: p.item.title,
            url: p.item.url,
            uuid: p.item.itemUuid,
        })),
        changeDescription: item.changes.map((ch) =>
            ch.description.map((d) => ({
                color: d.color,
                decoration: toChangeDescriptionDecoration(d.decoration),
                value: d.value,
            })),
        ),
        actors: {
            names: actors,
            hasMore: undefined,
        },
        comments:
            comments.length > 0
                ? {
                      comments: comments.slice(0, maxCommentsToReturn),
                      more: comments.length > maxCommentsToReturn ? comments.length - maxCommentsToReturn : undefined,
                      total: comments.length,
                  }
                : undefined,
        changeTypes: Array.from(changeTypes),
        timeRange:
            changeNewest && changeOldest
                ? {
                      newest: changeNewest,
                      oldest: changeOldest,
                  }
                : undefined,
        timeRangeReadable: timeRange,
        score: item.item.score,
        featureScores: Array.from(Object.entries(item.item.featureScores)).map(([feature, score]) => ({
            feature: toFeature(feature as ScorerName),
            score,
        })),
        properties,
    };
    return r;
}

async function processFilteredItems(
    timeline: Timeline,
    items: {
        changes: SummarizedChanges['changes'];
        item: TimelineItem;
        filterMatches: number;
    }[],
    actorColorMap: Map<string, string>,
    ianaZone: string,
): Promise<ActivityItem[]> {
    return items.map((it) => getActivityItemFromTimelineItem(timeline, it, actorColorMap, ianaZone));
}

function filterQualifiesForAdditionalRelevantItemScan(filter: ContextItemsFilter): boolean {
    // Are we looking for items with no changes?
    const hasChangeCountZeroQuery = filter.change?.since?.changeCount?.eq === 0;
    if (hasChangeCountZeroQuery) {
        return true;
    }

    // If not, check if we are filtering by start/end date or change date AND the filter has properties
    if (!filter.properties) {
        return false;
    }

    let res = false;
    for (const prop of filter.properties) {
        const p = prop.gt?.property || prop.gte?.property || prop.lt?.property || prop.lte?.property;

        const hasChangeQuery = filter.change?.since?.queryDate;
        if (!p && !hasChangeQuery) {
            continue;
        }
        res = p === ItemPropertyType.StartDate || p === ItemPropertyType.EndDate || hasChangeQuery !== undefined;
        if (res) {
            break;
        }
    }

    return res;
}

function filterAdditionalItem(
    type: AdditionalRelevantItemType,
    item: TimelineItem,
    filter: ContextItemsFilter,
): boolean {
    if (type !== AdditionalRelevantItemType.ListOfTasks) {
        return false;
    }

    const propOk = checkItemProperties(item, filter);
    const propertiesNameValueOk = checkItemPropertiesNameValue(item, filter);
    const typeOfItemOk = checkItemType(item, filter);
    const featureOk = checkItemFeature(item, filter);
    const connectorItemTypeOk = checkConnectorItemType(item, filter);
    const changeDateOk = filterItemByChanges([], filter.change);
    return propOk && typeOfItemOk && featureOk && changeDateOk && propertiesNameValueOk && connectorItemTypeOk;
}

function filterRequiresChangelog(filter: ContextItemsFilter): boolean {
    return (
        (filter.change !== undefined && Object.keys(filter.change).length > 0) ||
        (filter.action !== undefined && Object.keys(filter.action).length > 0) ||
        (filter.userMention !== undefined && Object.keys(filter.userMention).length > 0) ||
        (filter.actors !== undefined && Object.keys(filter.actors).length > 0) ||
        (filter.properties !== undefined && filter.properties.find((p) => p.from !== undefined) !== undefined)
    );
}

function filterItems(
    itemIds: string[],
    timelineChanges: Timeline['changes'],
    timelineItems: Timeline['items'],
    timelineAdditionalItems: Timeline['additionalRelevantItems'],
    filtersChecked: ContextItemsFilter[],
    operator: ContextItemsFilterOperator,
    opts: {
        /// If true, items with empty changelogs will be included in the results, provided they match the other filters
        allowEmptyChangelogs: boolean;
        /// If true, additional relevant items will be scanned even if the filters do not qualify for it
        forceScanAdditionalItems: boolean;
    },
    log: Logger,
) {
    const items: Map<
        string,
        {
            changes: SummarizedChanges['changes'];
            item: TimelineItem;
            filterMatches: number;
            ignoreChanges: boolean;
        }
    > = new Map();
    const scannedItems: Set<TimelineItem['itemUuid']> = new Set();
    itemIds.forEach((itemId) => {
        // Get all the timeline changes for the item
        const changes = timelineChanges.find((ch) => ch.itemUuid === itemId);

        // Iterate over the filters
        for (const filter of filtersChecked) {
            // Filter by Item ID
            const itemIdFilter = filterItemById(itemId, filter);
            if (!itemIdFilter) {
                return;
            }

            // Filter by changelog
            const filteredChanges = changes ? filterChanges(changes, filter) : [];

            // Try to get the item from the timeline
            const item = timelineItems[itemId];
            if (!item) {
                log.error(`Item ${itemId} not found in timeline when filtering items`);
                return;
            }

            // Check the properties of the item
            const propertiesOk = checkItemProperties(item, filter, changes);
            const propertiesNameValueOk = checkItemPropertiesNameValue(item, filter);

            // Check the type of the item
            const typeOfItemOk = checkItemType(item, filter);

            // Check the connector item type
            const connectorItemTypeOk = checkConnectorItemType(item, filter);

            // Check the feature of the item
            const featureOk = checkItemFeature(item, filter);

            // Check the changes count/date
            const changeFilterOk = changes ? filterItemByChanges(changes.changes, filter.change) : true;

            // Check the title of the item
            const titleOk = checkItemTitle(item, filter);

            // Check the comments of the item
            const commentsOk = changes ? checkItemComments(changes, filter) : true;

            if (
                propertiesOk &&
                typeOfItemOk &&
                featureOk &&
                changeFilterOk &&
                propertiesNameValueOk &&
                connectorItemTypeOk &&
                titleOk &&
                commentsOk
            ) {
                const foundItem = items.get(item.itemUuid);
                if (foundItem) {
                    foundItem.filterMatches += 1;
                } else {
                    items.set(item.itemUuid, {
                        changes: filteredChanges.slice(0, 8),
                        item,
                        filterMatches: 1,
                        ignoreChanges: false,
                    });
                }

                if (operator === ContextItemsFilterOperator.Or) {
                    break;
                }
            }

            // Add the item to the scanned items set
            scannedItems.add(item.itemUuid);
        }
    });

    const scanAdditional = filtersChecked.some((f) => filterQualifiesForAdditionalRelevantItemScan(f));
    if (scanAdditional || opts.forceScanAdditionalItems) {
        timelineAdditionalItems.forEach((relevant) => {
            relevant.uuids.forEach((itemUuid) => {
                const item = timelineItems[itemUuid];
                if (!item) {
                    log.error(`Item ${itemUuid} not found in timeline when scanning additional items`);
                    return;
                }

                // Skip items that have already been scanned above
                if (scannedItems.has(itemUuid)) {
                    return;
                }

                for (const filter of filtersChecked) {
                    const ok = filterAdditionalItem(relevant.type, item, filter);
                    if (ok) {
                        const foundItem = items.get(item.itemUuid);
                        if (foundItem) {
                            foundItem.filterMatches += 1;
                        } else {
                            items.set(item.itemUuid, {
                                changes: [],
                                item,
                                filterMatches: 1,
                                ignoreChanges: true,
                            });
                        }

                        if (operator === ContextItemsFilterOperator.Or) {
                            break;
                        }
                    }
                }

                // Add the item to the scanned items set
                scannedItems.add(itemUuid);
            });
        });
    }

    const filteredItems = Array.from(items.values()).filter(
        (v) =>
            (v.ignoreChanges || opts.allowEmptyChangelogs || v.changes.length > 0) &&
            (operator === ContextItemsFilterOperator.Or ||
                (operator === ContextItemsFilterOperator.And && v.filterMatches === filtersChecked.length)),
    );
    return filteredItems;
}

/**
 * Generates an activity item graph from a given timeline.
 *
 * @param runtime - The engine runtime (logger, config, repositories, traits).
 * @param principal - The reader on whose behalf the graph is built.
 * @param fromDate - The starting date from which the timeline is generated.
 * @param timeline - The timeline containing changes, items, and additional relevant items.
 * @param actorColorMap - A map of actor IDs to their corresponding colors.
 * @param ianaZone - The IANA time zone identifier.
 * @param filters - The filters and operator to apply when filtering context items. If the filter array is empty, all updated items will be included.
 * @returns A promise that resolves to an `ActivityItemGraph` or `undefined` if no relevant items are found.
 */
export async function getActivityItemGraphFromTimeline(
    runtime: EngineRuntime,
    principal: { userId: string; organizationId?: string },
    fromDate: Date,
    timeline: Timeline,
    actorColorMap: Map<string, string>,
    ianaZone: string,
    filters: ContextItemsFiltersWithOperator,
): Promise<ActivityItemGraph | undefined> {
    const log = runtime.log;
    let filtersChecked: ContextItemsFilter[] = [{}];
    let operator: ContextItemsFilterOperator = ContextItemsFilterOperator.Or;
    let graphFilterType: GraphFilterType = GraphFilterType.Full;
    if (filters.filters.length > 0) {
        filtersChecked = filters.filters;
        operator = filters.operator;
        graphFilterType = filters.graphFilterType;
    }

    // Run an empty filter to:
    // 1. get the items that have changes
    // 2. get additional relevant items, provided the filters qualify for it
    // Additional relevant items are typically items that do not have changes but are required
    // to be included in the graph (e.g. when the user queries "all to do items")
    const filteredItems = filterItems(
        timeline.changes.map((c) => c.itemUuid),
        timeline.changes,
        timeline.items,
        timeline.additionalRelevantItems,
        [{}],
        ContextItemsFilterOperator.Or,
        {
            // We only want items with changes
            allowEmptyChangelogs: false,
            // We force scan additional items here, provided the filters qualify for it
            forceScanAdditionalItems: filtersChecked.some((f) => filterQualifiesForAdditionalRelevantItemScan(f)),
        },
        log,
    );
    if (filteredItems.length === 0) {
        return undefined;
    }

    // Set of items for which we should ignore the changelog (e.g. "all to do" tasks)
    const itemsToIgnoreChangelog = new Set(filteredItems.filter((v) => v.ignoreChanges).map((v) => v.item.itemUuid));

    // score and get ActivityItem for each item
    filteredItems.sort((a, b) => sortByScore(a.item, b.item));
    const processedItems = await processFilteredItems(timeline, filteredItems, actorColorMap, ianaZone);

    // Create the graph
    const graph = new ActivityItemGraph(runtime.connectorTraits, processedItems, {
        // Additional items not included in the processedItems list,
        // such as item parents, might need to be fetched
        // when building the graph.
        getActivityItemFromTimeline: (id) => {
            const timelineItem = timeline.items[id];
            if (!timelineItem) {
                return undefined;
            }
            return getActivityItemFromTimelineItem(
                timeline,
                {
                    changes: [],
                    item: timelineItem,
                    filterMatches: 0,
                },
                actorColorMap,
                ianaZone,
            );
        },
        // Provided to ensure we only include items that roll up to the data scopes
        dataScopeUuids: Object.keys(timeline.scopesWithChildUuids),
        // The main filter function that determines if an item should be included in the graph
        applyItemFilter: (item) => {
            const changes = timeline.changes.find((ch) => ch.itemUuid === item.id)?.changes || [];
            const filtered = filterItems(
                [item.id],
                [{ itemUuid: item.id, changes }],
                timeline.items,
                [],
                filtersChecked,
                operator,
                {
                    // Some items will need to be included even if they don't have changes
                    allowEmptyChangelogs:
                        !filtersChecked.some((f) => filterRequiresChangelog(f)) || itemsToIgnoreChangelog.has(item.id),
                    // No forced scan here, as we've already done that above
                    forceScanAdditionalItems: false,
                },
                log,
            );
            return {
                // do we have a match?
                filterMatched: filtered.length > 0,
                // should we ignore the changelog for this item?
                ignoreEmptyChanges: itemsToIgnoreChangelog.has(item.id),
            };
        },
        filterType: graphFilterType,
        skipRootIfThereAreNoEdges: filters.skipRootIfThereAreNoChildren,
    });
    return graph;
}
