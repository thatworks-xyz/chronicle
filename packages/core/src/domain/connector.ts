import { ItemPropertyType } from './filters.js';
import { CoreHierarchyTypes, HierarchyType } from './hierarchy.js';

/**
 * Identifies a connected source system (e.g. 'my-crm', 'my-tracker').
 * Chronicle does not ship a fixed list of connectors: any unique string works.
 * The id is persisted in stored data (work items, change events, metric
 * snapshots) — changing it orphans existing data.
 */
export type ConnectorId = string;

/**
 * Behavioral traits of a connector, consulted by the engine instead of
 * hardcoding per-vendor logic. Connector packages register their traits
 * once at startup via {@link ConnectorTraitsRegistry}.
 */
export interface ConnectorTraits {
    /** The connector this describes. */
    id: ConnectorId;
    /**
     * Whether items from this connector form parent/child hierarchies that the
     * activity graph should traverse deeply (task-management style tools).
     * Default: false.
     */
    deepHierarchy?: boolean;
    /**
     * Whether items from this connector are primarily documents.
     * Default: false.
     */
    documentStore?: boolean;
    /**
     * Apply transitive reduction to this connector's hierarchy when building the
     * activity graph (for sources with messy multi-parent graphs). Default: false.
     */
    applyTransitiveReduction?: boolean;
    /**
     * Object types (connectorObjectType values) that act as structural containers
     * and should be removed from the activity graph, transferring their children
     * to the nearest kept ancestor (e.g. boards, folders, workspaces). Default: none.
     */
    hierarchyNoiseObjectTypes?: string[];
    /**
     * Property types to include by default when rendering this connector's items
     * into an LLM prompt body. Default: none beyond the engine-wide defaults.
     */
    promptDefaultProperties?: ItemPropertyType[];
    /**
     * Include the status *category* line in prompt bodies for this connector's items.
     * Default: true.
     */
    promptIncludeStatusCategory?: boolean;
    /**
     * Include every change-log entry (not just status/document changes) in prompt
     * bodies for this connector's items. Default: false.
     */
    promptIncludeAllChanges?: boolean;
    /**
     * Property types to ignore when grouping items by property. Default: none.
     */
    groupingIgnoredPropertyTypes?: ItemPropertyType[];
    /**
     * Parses a raw comment payload from this connector into HTML.
     * Default: identity (payload is already HTML/plain text).
     */
    commentParser?: (raw: string) => string;
    /**
     * Object types of structural parents to skip when resolving an item's display
     * parents — the engine walks up until it finds a parent whose object type is
     * not in this list (e.g. Notion 'block' parents). Default: none.
     */
    hoistParentsThroughObjectTypes?: string[];
    /**
     * Rules for parent-based grouping: when a scope of this connector has one of
     * `hierarchyTypes`, items are grouped under their nearest ancestor of
     * `parentObjectType` (e.g. group tasks under their epic/milestone when scoped to a board).
     * Rules are evaluated in order; the first whose hierarchyTypes match wins.
     * Default: none (items group under their scope).
     */
    parentGroupingRules?: { hierarchyTypes: HierarchyType[]; parentObjectType: string }[];
    /**
     * When an item's first parent has one of these object types, use the parent's
     * name as the item-type grouping label (e.g. Notion pages grouped by their
     * database's name). Default: none.
     */
    groupTypeByParentObjectTypes?: string[];
    /**
     * When true, items whose only changes are comments are excluded from work
     * summaries (they surface in discussion summaries instead — chat sources
     * like Slack). Default: false.
     */
    commentOnlyItemsAreDiscussions?: boolean;
    /**
     * Maps a connector object type to a hierarchy type for scope classification.
     * Default: everything maps to CoreHierarchyTypes.SpecificItem.
     */
    hierarchyTypeFromObjectType?: (objectType: string, itemTypeName: string) => HierarchyType;
    /**
     * When set, scope resolution also returns items that have NOT changed in the
     * window (e.g. backlog to-do tasks) as "additional relevant items", so queries
     * like "all to do items" can see them. When `forHierarchyTypes` is set, only
     * scopes of those hierarchy types include them. Default: disabled.
     */
    includeItemsBeyondFromDate?: { forHierarchyTypes?: HierarchyType[] } | false;
    /**
     * Hierarchy types whose root item itself carries the changes and must be part
     * of the activity graph (e.g. chat channels, standalone documents). Default: none.
     */
    rootItemInGraphHierarchyTypes?: HierarchyType[];
    /**
     * When an item changes, remove its parents of these object types from the
     * changed set (e.g. a database container that only "changed" because a child
     * did). Default: none.
     */
    suppressParentWhenChildChangedObjectTypes?: string[];
    /**
     * Changed items of these object types are dropped from timelines entirely
     * (e.g. folder containers). Default: none.
     */
    suppressChangedObjectTypes?: string[];
}

const DEFAULT_TRAITS: Omit<Required<ConnectorTraits>, 'id'> = {
    deepHierarchy: false,
    documentStore: false,
    applyTransitiveReduction: false,
    hierarchyNoiseObjectTypes: [],
    promptDefaultProperties: [],
    promptIncludeStatusCategory: true,
    promptIncludeAllChanges: false,
    groupingIgnoredPropertyTypes: [],
    commentParser: (raw: string) => raw,
    hoistParentsThroughObjectTypes: [],
    parentGroupingRules: [],
    groupTypeByParentObjectTypes: [],
    commentOnlyItemsAreDiscussions: false,
    hierarchyTypeFromObjectType: () => CoreHierarchyTypes.SpecificItem,
    includeItemsBeyondFromDate: false,
    rootItemInGraphHierarchyTypes: [],
    suppressParentWhenChildChangedObjectTypes: [],
    suppressChangedObjectTypes: [],
};

/**
 * Registry of connector traits. An engine instance owns one of these;
 * connector packages register into it during setup.
 */
export class ConnectorTraitsRegistry {
    private readonly _traits = new Map<ConnectorId, ConnectorTraits>();

    register(traits: ConnectorTraits): void {
        this._traits.set(traits.id, traits);
    }

    /** Returns the traits for a connector, with defaults filled in for unset fields. */
    get(id: ConnectorId): Omit<Required<ConnectorTraits>, 'id'> & { id: ConnectorId } {
        const t = this._traits.get(id);
        return { ...DEFAULT_TRAITS, ...t, id };
    }

    has(id: ConnectorId): boolean {
        return this._traits.has(id);
    }
}
