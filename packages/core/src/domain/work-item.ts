import { htmlToText } from 'html-to-text';
import ohash from 'object-hash';
import { IAccessPolicy } from './access.js';
import { ConnectorItemId } from './connector-item-id.js';
import { ConnectorId } from './connector.js';
import { DeletionType, ItemPropertyStatusCategory, ItemPropertyType, ItemType } from './filters.js';
import { ItemMetaFilter } from './item-meta-filter.js';

export interface ItemPropertyStatus {
    type: ItemPropertyType.Status;
    statusOrderIndex: number;
    statusId: string;
    isDone: boolean;
    statusCategory: ItemPropertyStatusCategory;
}

export interface ItemProperty {
    name: string;
    value: string;
    details:
        | {
              type: ItemPropertyType.Priority;
              /// between 0 and n, where n is the highest priority possible
              priorityIndex: number;
              /// total number of priorities. E.g. "high","medium", "low" have a totalNumPriorities of 3
              totalNumPriorities: number;
          }
        | { type: ItemPropertyType.Assignee; isUser: boolean }
        | ItemPropertyStatus
        | {
              type: ItemPropertyType.LinkedItem;
              idsFromConnector: ConnectorItemId;
              linkDescription: string;
              itemName: string;
          }
        | {
              type: ItemPropertyType.Text;
              textFormat: 'html' | 'plaintext' | 'date';
          }
        | {
              type: Exclude<
                  Exclude<
                      Exclude<
                          Exclude<Exclude<ItemPropertyType, ItemPropertyType.Priority>, ItemPropertyType.Assignee>,
                          ItemPropertyType.LinkedItem
                      >,
                      ItemPropertyType.Status
                  >,
                  ItemPropertyType.Text
              >;
          };
    style: { color?: string; iconUrl?: string };
    /// Some apps (e.g. Notion) can have multiple values per property.
    /// We current store each value as a different property with the same name.
    /// This field can be used group them together if needed.
    connectorPropertyId?: string;
    // E.g. the assignee user id
    connectorValueId?: string;
    // E.g. 'status' or 'priority'
    connectorPropertyType?: string;
}

/**
 * A single unit of work tracked from a connected source: a task, document,
 * pull request, CRM entry, event, booking, etc. (formerly `ItemV2`).
 */
export interface WorkItem {
    uuid: string;
    userId: string;
    connector: ConnectorId;
    idsFromConnector: ConnectorItemId;
    title: string;
    url?: string;
    createdBy: { displayName: string; isUser: boolean }[];
    createdDate: Date | undefined;
    properties: ItemProperty[];
    parents: {
        itemUuid: string;
        idsFromConnector: ConnectorItemId;
        relationship?: string;
    }[];
    lastUpdate?: Date;
    types: ItemType[];
    deleted?: DeletionType;

    /**
     * Used for items that are used to filter other items.
     * For example, a representation of a view in a project management tool.
     */
    metaFilter?: ItemMetaFilter;

    /**
     * Access policy for this item.
     * Determines per-item visibility; interpretation is up to the configured AccessControl port.
     */
    accessPolicy?: IAccessPolicy;
}

export interface HashedWorkItem extends WorkItem {
    hash: string;
}

/**
 * Computes the change-detection hash for a work item. Storage adapters use this to
 * skip writes when nothing changed (`lastUpdate` is deliberately excluded).
 */
export function getHashedItem(item: WorkItem): HashedWorkItem {
    const keyToIgnore: keyof WorkItem = 'lastUpdate';
    const hash = ohash(item, {
        respectType: false,
        excludeKeys: (key) => key === keyToIgnore,
    });
    return {
        ...item,
        hash,
    };
}

/** Extracts plain text from a property value, converting HTML text properties to plain text. */
export function getTextFromItemProperty(itemProperty: ItemProperty): string {
    let text = itemProperty.value;
    if (itemProperty.details.type === ItemPropertyType.Text && itemProperty.details.textFormat === 'html') {
        text = htmlToText(itemProperty.value, {
            wordwrap: false,
            selectors: [
                { selector: 'blockquote', format: 'skip' },
                { selector: 'img', format: 'skip' },
                // Email quote selectors for various email clients
                { selector: '.gmail_quote', format: 'skip' },
                { selector: '.gmail_extra', format: 'skip' },
                { selector: '.gmail_attr', format: 'skip' },
                { selector: '[class*="quote"]', format: 'skip' },
            ],
        });
    }

    // Return the text
    return text;
}
