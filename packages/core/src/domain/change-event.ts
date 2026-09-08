import { ConnectorItemId } from './connector-item-id.js';
import { ConnectorId } from './connector.js';
import {
    ChangeActionType,
    ChangeType,
    ItemPropertyStatusCategory,
    ItemPropertyType,
    UserMentionType,
} from './filters.js';

/** What kind of entity an action targeted. */
export enum ActionTarget {
    Document = 'document',
    Task = 'task',
    Comment = 'comment',
    Repository = 'repository',
    ChatChannel = 'chat_channel',
    CrmEntry = 'crm_entry',
    Email = 'email',
}

export enum ChangeEventDescriptionType {
    Date = 'date',
    String = 'string',
}

export enum ChangeEventDescriptionDecoration {
    Plain = 'plain',
    Highlight = 'highlight',
}

export interface ChangeEventComplexDescription {
    word: string;
    canPluralize: boolean;
    type?: ChangeEventDescriptionType;
}

export interface ChangeEventRichDescription {
    value: string;
    type: ChangeEventDescriptionType;
    decoration: { color?: string; display: ChangeEventDescriptionDecoration };
}

export interface ChangeEventFromToDescription {
    from?: ChangeEventRichDescription[];
    to: ChangeEventRichDescription[];
    label: string;
}

export type ChangeEventPropertyDetails = {
    property: ItemPropertyType.Status;
    statusCategory: ItemPropertyStatusCategory;
};

/** The action recorded by a change event. */
export interface ChangeAction {
    changeType: ChangeType;
    //! The id used by the connector to track the change
    //! This can be used to differentiate betweeen different custom fields
    changeTypeConnectorId?: string;
    actionType: ChangeActionType;
    userMentionType: UserMentionType;
    actionTarget: ActionTarget;
    actorDisplayName: string;
    actorIsUser: boolean;
    description: {
        complex?: ChangeEventComplexDescription[];
        simple?: string;
    };
    fromValue?: string;
    toValue?: string;
    fromToDescription?: ChangeEventFromToDescription;
    property?: {
        from?: ChangeEventPropertyDetails;
        to?: ChangeEventPropertyDetails;
    };
    //! E.g. comment ID within a task
    entityId?: string;
    //! E.g. thread ID for comments
    entityThreadId?: string;
    //! E.g. differentiate between different types of comments
    entityType?: string;
}

/**
 * One recorded change to a work item (formerly `ChangelogItem`).
 *
 * The shape is deliberately flat: the previous `{ time, meta, action }` envelope was
 * an artifact of the MongoDB time-series collection layout. Storage adapters that
 * use a time-series layout are responsible for mapping to/from their envelope.
 */
export interface ChangeEvent {
    /** When the change happened. */
    timestamp: Date;
    /** UUID of the work item this change belongs to. */
    itemUuid: string;
    /** Owner (creator) of the item's connection. */
    userId: string;
    connector: ConnectorId;
    idsFromConnector: ConnectorItemId;
    action: ChangeAction;
}

/**
 * Builds a stable identity for grouping/deduplicating similar change events.
 */
export function getChangeEventActionIdForDeduplication(
    change: ChangeEvent,
    props: { includeTimestamp: boolean; includingEntityId: boolean },
): string {
    const ids: string[] = [
        change.itemUuid,
        change.action.changeType,
        change.action.actionType,
        change.action.actionTarget,
        change.action.changeTypeConnectorId || '',
        change.action.entityType || '',
    ];
    if (props.includingEntityId) {
        ids.push(change.action.entityId || '');
    }
    if (props.includeTimestamp) {
        ids.push(change.timestamp.toISOString());
    }
    return ids.join('.');
}
