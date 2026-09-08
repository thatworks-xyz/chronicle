import { AccessPolicy, IAccessPolicy } from '../domain/access.js';
import { ChangeEvent } from '../domain/change-event.js';
import { ConnectorItemId } from '../domain/connector-item-id.js';
import { WorkItem } from '../domain/work-item.js';
import { Logger, noopLogger } from '../ports/logger.js';
import { ConnectorItemIdMap, ConnectorItemIdSet } from './connector-item-id-map.js';

export { ConnectorItemIdMap, ConnectorItemIdSet };

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type FieldMap<Type, Obj, State> = {
    [Property in keyof Type]: (obj: Obj, state: State) => Type[Property];
};

type FieldMapWithSkip<Type, Obj, State> = {
    [Property in keyof Type]: (obj: Obj, item: WorkItem, state: State, skipThisObject: () => void) => Type[Property];
};

/** A work item whose parents may carry connector-specific payloads until parent resolution completes. */
export interface ItemWithParentData<Type> extends WorkItem {
    parents: {
        itemUuid: string;
        idsFromConnector: ConnectorItemId;
        relationship?: string;
        data?: Type;
    }[];
}

export interface ItemWithParentDataChangelog<ParentType> {
    item: ItemWithParentData<ParentType>;
    changelog: ChangeEvent[];
    docPlainText?: string;
    additionalData?: string;
}

export type WorkItemMapper<Obj, State, ParentDataType> = FieldMap<ItemWithParentData<ParentDataType>, Obj, State>;
export type ChangeEventMapper<Obj, State> = FieldMapWithSkip<ChangeEvent, Obj, State>;

export function getDefaultAccessPolicy(): IAccessPolicy {
    return AccessPolicy.makeAccessibleToConnectionAudience().toJSON();
}

const defaultWorkItemValues: Partial<WorkItem> = {
    title: '',
    url: undefined,
    createdBy: [],
    createdDate: undefined,
    properties: [],
    parents: [],
    lastUpdate: undefined,
    types: [],
    deleted: undefined,
    metaFilter: undefined,

    // Default to connectionAudience for backward compatibility.
    // New mappers should explicitly set accessPolicy
    accessPolicy: getDefaultAccessPolicy(),
};

export function getDefaultWorkItemValues(key: keyof WorkItem, log: Logger = noopLogger) {
    // Check if the key exists in the default values
    if (!(key in defaultWorkItemValues)) {
        // If it does not exists it means that the key is required
        throw new Error(`WorkItem: Error parsing ${key}. No fallback available`);
    }

    // Return the default value
    log.warn(`WorkItem: Error parsing ${key}. Fallback to default value`);
    return defaultWorkItemValues[key];
}

/**
 * Maps a connector object into a WorkItem using a per-field mapper.
 * Field-level failures fall back to safe defaults where possible.
 */
export function mapItem<Obj, State, ParentDataType>(
    obj: Obj,
    state: State,
    mapper: WorkItemMapper<Obj, State, ParentDataType>,
    log: Logger = noopLogger,
): ItemWithParentData<ParentDataType> {
    const item: Partial<ItemWithParentData<ParentDataType>> = {};
    for (const k of Object.keys(mapper)) {
        let value;
        try {
            // Get the value from the mapper
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = (mapper as Record<string, any>)[k](obj, state);
        } catch (error) {
            log.error(`Error parsing ${k}, attempting fallback value if available. ${getExceptionMessage(error)}`);

            // Try to get the default value since the mapper failed
            value = getDefaultWorkItemValues(k as keyof WorkItem, log);
        }
        if (value) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (item as Record<string, any>)[k] = value;
        }
    }

    // Apply default accessPolicy if not set by mapper
    if (!item.accessPolicy) {
        item.accessPolicy = getDefaultAccessPolicy();
    }

    return item as ItemWithParentData<ParentDataType>;
}

/**
 * Maps a connector object into a ChangeEvent using a per-field mapper.
 * The mapper can call `skipThisObject()` to skip producing an event.
 */
export function mapChangelog<Obj, State>(
    obj: Obj,
    item: WorkItem,
    state: State,
    mapper: ChangeEventMapper<Obj, State>,
): ChangeEvent | undefined {
    const change: Partial<ChangeEvent> = {};
    let skip = false;
    for (const k of Object.keys(mapper)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (mapper as Record<string, any>)[k](obj, item, state, () => {
            skip = true;
        });

        if (skip) {
            break;
        }

        if (value) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (change as Record<string, any>)[k] = value;
        }
    }

    if (skip) {
        return undefined;
    }

    return change as ChangeEvent;
}

/** Human-readable label for a connector object type (e.g. 'course_template' → 'Course template'). */
export function getObjectTypeLabel(objectType: string): string {
    let label = objectType;

    // Capitalise the first letter
    label = label.charAt(0).toUpperCase() + label.slice(1);

    // Replace the "_" or "." to whitespace
    label = label.replace(/[_]|[.]/g, ' ');

    // Return
    return label;
}
