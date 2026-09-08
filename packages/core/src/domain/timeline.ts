import { ActionTarget } from './change-event.js';
import { ConnectorId } from './connector.js';
import { ChangeActionType, ChangeType, ItemPropertyStatusCategory, ItemType, UserMentionType } from './filters.js';
import { ItemProperty } from './work-item.js';

export function getItemTypeAsHumanReadableText(type: ItemType): string {
    switch (type) {
        case ItemType.Milestone:
            return 'Milestone';
        case ItemType.Task:
            return 'Task';
        case ItemType.Document:
            return 'Document';
        case ItemType.MilestoneWithRollupProgress:
            return 'Milestone';
        case ItemType.MetricData:
            return 'Metric data';
        case ItemType.CodeRepository:
            return 'Code repository';
        case ItemType.CodeRepositoryBranch:
            return 'Code repository branch';
        case ItemType.PullRequest:
            return 'Pull request';
        case ItemType.Commit:
            return 'Commit';
        case ItemType.ChatChannel:
            return 'Chat channel';
        case ItemType.CrmEntry:
            return 'CRM entry';
        case ItemType.Group:
            return 'Group';
        case ItemType.Email:
            return 'Email';
    }
}

export const ItemPropertyStatusCategoryOrder = new Map([
    [ItemPropertyStatusCategory.Unknown, 0],
    [ItemPropertyStatusCategory.ToDo, 0],
    [ItemPropertyStatusCategory.InProgress, 1],
    [ItemPropertyStatusCategory.Done, 2],
]);

/** A work item as it appears in a built timeline: a flattened projection plus scoring. */
export interface TimelineItem {
    itemUuid: string;
    connector: ConnectorId;
    connectorUserId: string;
    readableConnectorObjectType: string;
    idFromConnectorObjectType: string;
    title: string;
    url?: string;
    properties: ItemProperty[];
    score: number;
    featureScores: { [name: string]: number };
    parents: { uuid: string; relationship?: string }[];
    types: ItemType[];
    createdBy: { displayName: string; isUser: boolean }[];
}

export interface SummarizedChangeDescription {
    value: string;
    decoration: 'text' | 'highlight' | 'date';
    color?: string;
}

export interface SummarizedComment {
    userDisplayName: string;
    date: Date;
    commentHtml: string;
    userMentionType: UserMentionType;
    commentId: string;
    threadId: string;
    actionType: ChangeActionType;
}

export interface SummarizedStatusChange {
    fromValue: string | undefined;
    toValue: string | undefined;
    fromStatusCategory: ItemPropertyStatusCategory | undefined;
    toStatusCategory: ItemPropertyStatusCategory | undefined;
    date: Date;
}

export interface SummarizedChanges {
    itemUuid: string;
    changes: {
        timeRange: { oldest: Date; newest: Date };
        description: SummarizedChangeDescription[];
        actors?: string;
        actorList: { displayName: string; isUser: boolean }[];
        changeType: ChangeType;
        actionType: ChangeActionType;
        target: ActionTarget;
        userMentionType: UserMentionType[];
        comments: SummarizedComment[];
        statusChanges: SummarizedStatusChange[];
    }[];
}

export enum AdditionalRelevantItemType {
    ListOfTasks = 'list_of_tasks',
}

/**
 * The central working object of the engine: everything known about a set of
 * scopes for a time window — items, condensed change summaries, doc diffs,
 * and the scope→children mapping.
 */
export interface Timeline {
    changes: SummarizedChanges[];
    additionalRelevantItems: { type: AdditionalRelevantItemType; uuids: string[] }[];
    items: { [id: string]: TimelineItem };
    scopesWithChildUuids: { [id: string]: string[] };
    docDiffs: { [id: string]: { diff: string } };
}

/** Rehydrates Date fields after JSON (de)serialization (e.g. from a cache). */
export function getTimelineFromJson(str: string | Timeline): Timeline {
    const o = typeof str === 'string' ? (JSON.parse(str) as Timeline) : str;
    o.changes.forEach((ch) => {
        ch.changes.forEach((c) => {
            c.comments.forEach((com) => {
                com.date = new Date(com.date);
            });
            c.timeRange.newest = new Date(c.timeRange.newest);
            c.timeRange.oldest = new Date(c.timeRange.oldest);
        });
    });
    return o;
}
