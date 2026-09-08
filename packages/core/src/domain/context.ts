import { ConnectorId } from './connector.js';
import { HierarchyType } from './hierarchy.js';
import { AdditionalRelevantItemType } from './timeline.js';
import { WorkItem } from './work-item.js';

/**
 * One data source in a context: a root work item (board, project, company, …)
 * whose descendants and changes the engine analyzes (formerly `CollectionItem`).
 */
export interface Scope {
    /** UUID of the root work item, or {@link EverythingInConnectorId} from ./hierarchy. */
    uuid: string;
    connector: ConnectorId;
    hierarchyType: HierarchyType;
}

export interface ItemWithHierarchyType {
    item: WorkItem;
    hierarchyType: HierarchyType;
}

export interface AdditionalRelevantItems {
    additionalRelevantItems: WorkItem[];
    type: AdditionalRelevantItemType;
}
