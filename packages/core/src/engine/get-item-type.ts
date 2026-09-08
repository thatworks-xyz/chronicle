import { ItemPropertyType } from '../domain/filters.js';
import { TimelineItem } from '../domain/timeline.js';
import { WorkItem } from '../domain/work-item.js';

/**
 * Resolves the human-readable type of an item: the TypeOfObject property when
 * present (connectors set this in their mappers), otherwise the connector
 * object type.
 */
export function getItemTypeProps(item: WorkItem | TimelineItem): { name: string; color?: string; iconUrl?: string } {
    const typeProp = item.properties.find((p) => p.details.type === ItemPropertyType.TypeOfObject);

    const typeNameFromField =
        (item as WorkItem)?.idsFromConnector?.connectorObjectType ||
        (item as TimelineItem)?.readableConnectorObjectType ||
        '';
    return {
        name: typeProp?.value || typeNameFromField,
        color: typeProp?.style?.color,
        iconUrl: typeProp?.style?.iconUrl,
    };
}
