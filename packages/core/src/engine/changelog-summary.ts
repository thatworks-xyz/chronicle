import { randomUUID } from 'node:crypto';
import {
    ChangeEvent,
    ChangeEventDescriptionDecoration,
    ChangeEventDescriptionType,
    ChangeEventRichDescription,
    getChangeEventActionIdForDeduplication,
} from '../domain/change-event.js';
import { ConnectorTraitsRegistry } from '../domain/connector.js';
import { ChangeActionType, ChangeType } from '../domain/filters.js';
import {
    SummarizedChangeDescription,
    SummarizedChanges,
    SummarizedComment,
    SummarizedStatusChange,
    TimelineItem,
} from '../domain/timeline.js';
import { WorkItem } from '../domain/work-item.js';
import { pluralizeWord } from '../vendor/string-utils.js';
import { dateSortOldestFirst } from './date-sort.js';
import { getItemTypeProps } from './get-item-type.js';

function dateSort(a: Date, b: Date): number {
    if (a > b) {
        return -1;
    }
    if (a < b) {
        return 1;
    }
    return 0;
}

function summarizeCollectComments(change: ChangeEvent, comments: SummarizedComment[], traits: ConnectorTraitsRegistry) {
    if (change.action.changeType === ChangeType.Comment) {
        comments.push({
            commentHtml: change.action.toValue ? traits.get(change.connector).commentParser(change.action.toValue) : '',
            date: change.timestamp,
            userDisplayName: change.action.actorDisplayName,
            userMentionType: change.action.userMentionType,
            commentId: change.action.entityId || randomUUID(),
            threadId: change.action.entityThreadId || randomUUID(),
            actionType: change.action.actionType,
        });
    }
}

function filterComments(comments: SummarizedComment[]): SummarizedComment[] {
    // Group comments by commentId: we can have multiple comments with the same commentId
    // for edits, deletions, etc
    const commentsById = new Map<string, SummarizedComment[]>();
    comments.forEach((comment) => {
        const found = commentsById.get(comment.commentId);
        if (found) {
            found.push(comment);
        } else {
            commentsById.set(comment.commentId, [comment]);
        }
    });
    commentsById.forEach((comments) => comments.sort((a, b) => dateSortOldestFirst(a.date, b.date)));

    const filteredComments: SummarizedComment[] = [];
    // Get the most recent version/edit of the comment
    commentsById.forEach((comments) => {
        const mostRecentComment = comments.length > 1 ? comments[comments.length - 1] : comments[0];
        if (mostRecentComment.actionType === ChangeActionType.DeletedOrRemoved) {
            return;
        }
        filteredComments.push(mostRecentComment);
    });

    // Group by threads
    const commentsByThreadId = new Map<string, SummarizedComment[]>();
    filteredComments.forEach((comment) => {
        const found = commentsByThreadId.get(comment.threadId);
        if (found) {
            found.push(comment);
        } else {
            commentsByThreadId.set(comment.threadId, [comment]);
        }
    });

    const res: SummarizedComment[] = [];
    // Remove resolved threads
    commentsByThreadId.forEach((comments) => {
        comments.sort((a, b) => dateSortOldestFirst(a.date, b.date));
        const mostRecentComment = comments.length > 1 ? comments[comments.length - 1] : comments[0];
        // ignore resolved threads
        if (mostRecentComment.actionType === ChangeActionType.Resolved) {
            return;
        }
        res.push(...comments);
    });
    return res.filter((c) => c.commentHtml.trim().length > 0);
}

export type ActorNameMap = Map<string, { name: string; isUser: boolean }>;

export function summarizeSetNamesInMap(change: ChangeEvent, names: ActorNameMap) {
    if (!names.has(change.action.actorDisplayName)) {
        names.set(change.action.actorDisplayName, {
            name: change.action.actorDisplayName,
            isUser: change.action.actorIsUser,
        });
    }
}

export function summarizeCondenseActorNames(names: ActorNameMap) {
    const getName = (n: { name: string; isUser: boolean }) => {
        return n.isUser ? 'you' : n.name;
    };

    const namesArray = Array.from(names.values());
    let actors: string | undefined;
    if (names.size === 1) {
        actors = getName(namesArray[0]);
    } else if (names.size === 2) {
        actors = `${getName(namesArray[0])} and ${getName(namesArray[1])}`;
    } else if (names.size > 2) {
        actors = `${getName(namesArray[0])}, ${getName(namesArray[1])}, and others`;
    }
    return actors;
}

function summarizeNonStatusAction(change: ChangeEvent, actionCount?: number): SummarizedChangeDescription[] {
    const res: SummarizedChangeDescription[] = [];
    if (change.action.description.simple) {
        res.push({ value: change.action.description.simple, decoration: 'text' });
    } else if (change.action.description.complex) {
        if (actionCount !== undefined) {
            res.push({
                value: `${actionCount}`,
                decoration: 'text',
            });
        }

        change.action.description.complex.forEach((word) => {
            res.push({
                value:
                    word.canPluralize && actionCount !== undefined ? pluralizeWord(word.word, actionCount) : word.word,
                decoration: word.type === ChangeEventDescriptionType.Date ? 'date' : 'text',
            });
        });
    }
    return res;
}

function summarizeStatusAction(fromValue: string | undefined, toValue: string | undefined) {
    const res: SummarizedChangeDescription[] = [];
    if (!fromValue || !toValue) {
        res.push({ value: 'Status updated', decoration: 'text' });
        return res;
    }

    res.push({ value: fromValue, decoration: 'highlight' });
    res.push({ value: '→', decoration: 'text' });
    res.push({ value: toValue, decoration: 'highlight' });
    return res;
}

function summarizeFromToDescription(
    label: string,
    from: ChangeEventRichDescription[] | undefined,
    to: ChangeEventRichDescription[],
) {
    const res: SummarizedChangeDescription[] = [{ decoration: 'text', value: label }];
    if (from) {
        from.forEach((v) => {
            res.push({
                value: v.value,
                decoration:
                    v.type === ChangeEventDescriptionType.Date
                        ? 'date'
                        : v.decoration.display === ChangeEventDescriptionDecoration.Highlight
                          ? 'highlight'
                          : 'text',
                color: v.decoration.color,
            });
        });
        res.push({ value: '→', decoration: 'text' });
    }

    to.forEach((v) => {
        res.push({
            value: v.value,
            decoration:
                v.type === ChangeEventDescriptionType.Date
                    ? 'date'
                    : v.decoration.display === ChangeEventDescriptionDecoration.Highlight
                      ? 'highlight'
                      : 'text',
            color: v.decoration.color,
        });
    });
    return res;
}

function summarise(itemUuid: string, changes: ChangeEvent[], traits: ConnectorTraitsRegistry): SummarizedChanges {
    const res: SummarizedChanges = {
        itemUuid,
        changes: [],
    };

    changes.sort((a, b) => dateSort(a.timestamp, b.timestamp));

    // Group same actions
    const changeMap = new Map<string, ChangeEvent[]>();
    changes.forEach((change) => {
        // We dont want to group by timestamp because multiple similar actions can happen at the same time
        // We also dont want to group by entityId because multiple similar actions can happen on different entities
        let id = getChangeEventActionIdForDeduplication(change, { includeTimestamp: false, includingEntityId: false });
        // Comments are special case because they need to be grouped together and filtered using filterComments()
        if (change.action.changeType === ChangeType.Comment) {
            id = `${change.action.changeType}`;
        }
        const mapData = changeMap.get(id);
        if (mapData) {
            mapData.push(change);
        } else {
            changeMap.set(id, [change]);
        }
    });

    for (const [, v] of changeMap) {
        // CHECKS
        if (v.length === 0) {
            continue;
        }

        // GET AND FILTER NAMES AND COMMENTS
        const comments: SummarizedChanges['changes'][number]['comments'] = [];
        const names: ActorNameMap = new Map();
        v.forEach((change) => {
            summarizeSetNamesInMap(change, names);
            summarizeCollectComments(change, comments, traits);
        });
        const actors = summarizeCondenseActorNames(names);

        const newest = v[0];
        const oldest = v[v.length - 1];

        // SUMMARIZED STATUS CHANGES
        const summarizedStatusChanges: SummarizedStatusChange[] = [];
        const statusChanges = v.filter((change) => change.action.changeType === ChangeType.Status);
        statusChanges
            .sort((a, b) => dateSortOldestFirst(a.timestamp, b.timestamp))
            .forEach((change) => {
                const s: SummarizedStatusChange = {
                    date: change.timestamp,
                    fromValue: undefined,
                    toValue: undefined,
                    fromStatusCategory: change.action.property?.from?.statusCategory,
                    toStatusCategory: change.action.property?.to?.statusCategory,
                };

                if (change.action.fromToDescription) {
                    if (change.action.fromToDescription.from && change.action.fromToDescription.from.length > 0) {
                        s.fromValue = change.action.fromToDescription.from[0].value;
                    }
                    if (change.action.fromToDescription.to && change.action.fromToDescription.to.length > 0) {
                        s.toValue = change.action.fromToDescription.to[0].value;
                    }
                }

                if (!s.fromValue && !s.toValue) {
                    if (change.action.fromValue) {
                        s.fromValue = change.action.fromValue;
                    }
                    if (change.action.toValue) {
                        s.toValue = change.action.toValue;
                    }
                }

                if (s.fromValue || s.toValue) {
                    summarizedStatusChanges.push(s);
                }
            });

        // MAKE SUMMARIZED DESCRIPTION
        const desc: SummarizedChangeDescription[] = [];
        if (
            oldest.action.fromToDescription &&
            newest.action.fromToDescription &&
            newest.action.fromToDescription.to.length > 0
        ) {
            const d = summarizeFromToDescription(
                newest.action.fromToDescription.label,
                oldest.action.fromToDescription.from,
                newest.action.fromToDescription.to,
            );
            d.forEach((v) => desc.push(v));
        } else if (newest.action.changeType === ChangeType.Status) {
            const d = summarizeStatusAction(oldest.action.fromValue, newest.action.toValue);
            d.forEach((v) => desc.push(v));
        } else {
            let actionCount: number | undefined;
            if (
                newest.action.changeType !== ChangeType.EndDate &&
                newest.action.changeType !== ChangeType.StartDate &&
                newest.action.changeType !== ChangeType.CustomField
            ) {
                actionCount = v.length;
            }
            const d = summarizeNonStatusAction(newest, actionCount);
            d.forEach((v) => desc.push(v));
        }
        res.changes.push({
            description: desc,
            actors: actors ? `by ${actors}` : undefined,
            timeRange: {
                oldest: oldest.timestamp,
                newest: newest.timestamp,
            },
            actorList: Array.from(names.values()).map((v) => {
                return { displayName: v.name, isUser: v.isUser };
            }),
            target: v[0].action.actionTarget,
            changeType: v[0].action.changeType,
            actionType: v[0].action.actionType,
            userMentionType: v.map((ac) => ac.action.userMentionType),
            comments: filterComments(comments),
            statusChanges: summarizedStatusChanges,
        });
    }

    res.changes.sort((a, b) => dateSort(a.timeRange.newest, b.timeRange.newest));
    return res;
}

export interface ItemWithChanges {
    item: WorkItem;
    changes: ChangeEvent[];
    docPlainText?: string;
    additionalData?: string;
}

export async function generateChangelogSummary(
    itemWithChanges: ItemWithChanges[],
    traits: ConnectorTraitsRegistry,
): Promise<SummarizedChanges[]> {
    const summary = itemWithChanges.map((v) => summarise(v.item.uuid, v.changes, traits));
    summary.sort((a, b) => {
        if (a.changes.length === 0 && b.changes.length === 0) {
            return 0;
        }

        if (a.changes.length === 0 && b.changes.length !== 0) {
            return 1;
        }

        if (a.changes.length !== 0 && b.changes.length === 0) {
            return -1;
        }
        return dateSort(a.changes[0].timeRange.newest, b.changes[0].timeRange.newest);
    });
    return summary;
}

export const MAX_CHANGELOG_PER_ITEM = 200;

/** Function to look up an item's parents by uuid (backed by the WorkItemRepository). */
export type GetParentsForItem = (uuid: string) => Promise<WorkItem['parents']>;

// Some parents are structural nodes not useful to show to the user (e.g. Notion blocks,
// declared via traits.hoistParentsThroughObjectTypes). This function walks up the chain
// until it finds the first non-structural parent.
async function getTimelineParents(
    item: WorkItem,
    traits: ConnectorTraitsRegistry,
    getParentForItem: GetParentsForItem,
): Promise<TimelineItem['parents']> {
    const hoistThrough = traits.get(item.connector).hoistParentsThroughObjectTypes;
    if (hoistThrough.length === 0) {
        return item.parents.map((v) => ({ uuid: v.itemUuid, relationship: v.relationship }));
    }

    const res = await Promise.all(
        item.parents.map(async (p) => {
            if (hoistThrough.includes(p.idsFromConnector.connectorObjectType)) {
                const validParents: TimelineItem['parents'] = [];
                let pId = p.itemUuid;
                while (validParents.length === 0) {
                    const parents = await getParentForItem(pId);
                    if (parents.length === 0) {
                        break;
                    }
                    parents.forEach((newParent) => {
                        if (!hoistThrough.includes(newParent.idsFromConnector.connectorObjectType)) {
                            validParents.push({ uuid: newParent.itemUuid, relationship: newParent.relationship });
                        }
                        pId = newParent.itemUuid;
                    });
                }
                return validParents;
            }
            return [{ uuid: p.itemUuid, relationship: p.relationship }];
        }),
    );
    return res.flat();
}

export async function mapItemToTimelineItem(
    item: WorkItem,
    score: number,
    featureScores: TimelineItem['featureScores'],
    traits: ConnectorTraitsRegistry,
    getParentForItem: GetParentsForItem,
): Promise<TimelineItem> {
    const objectTypeProps = getItemTypeProps(item);
    const parents = await getTimelineParents(item, traits, getParentForItem);

    return {
        itemUuid: item.uuid,
        connector: item.connector,
        connectorUserId: item.idsFromConnector.connectorUserId,
        readableConnectorObjectType: objectTypeProps.name,
        idFromConnectorObjectType: item.idsFromConnector.connectorObjectType,
        title: item.title,
        url: item.url,
        properties: item.properties,
        score,
        featureScores,
        parents,
        types: item.types,
        createdBy: item.createdBy,
    };
}
