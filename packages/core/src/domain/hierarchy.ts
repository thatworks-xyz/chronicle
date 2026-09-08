/**
 * Classifies what kind of scope a work item represents (e.g. a whole project,
 * a board, a single document). Chronicle does not ship a fixed list: any
 * unique string works, and connector packages export their own constants
 * (e.g. 'MyCrmAccount'). The value is persisted in scope definitions
 * and participates in timeline identity — changing it orphans cached data.
 */
export type HierarchyType = string;

/** Generic hierarchy types understood by the core engine. */
export const CoreHierarchyTypes = {
    /** A root item whose whole subtree is in scope. */
    Root: 'Root',
    /** A single specific item. */
    SpecificItem: 'SpecificItem',
    /** A connector's top-level container. */
    ConnectorTopLevel: 'ConnectorTopLevel',
    /** Everything in a connector (used with {@link EverythingInConnectorId}). */
    EverythingInConnector: 'ConnectorAll',
} as const;

/** Sentinel scope uuid meaning "everything in the connector". */
export const EverythingInConnectorId = 'everything_in_connector_id';

// Canonical id for a connector scope. Use everywhere a scope id is constructed
// so that selection-state lookups match across surfaces.
export function getConnectorScopeId(hierarchyType: string, itemUuid: string): string {
    return `${hierarchyType}-${itemUuid}`;
}
