import { htmlToText } from 'html-to-text';
import { DateTime } from 'luxon';
import {
    ActivityFeature,
    ActivityItem,
    ItemGroup,
    ItemGroupPredefinedType,
    SortDirection,
} from '../domain/api-types.js';
import { ConnectorTraitsRegistry } from '../domain/connector.js';
import {
    ChangeType,
    getItemPropertyStatusCategoryAsString,
    GraphFilterType,
    ItemPropertyStatusCategory,
    ItemPropertyType,
    ItemType,
} from '../domain/filters.js';
import { Timeline } from '../domain/timeline.js';
import { getTextFromItemProperty } from '../domain/work-item.js';
import { TruncationConfig } from '../ports/config.js';
import { Graph } from '../vendor/graph.js';
import { Capitalize } from '../vendor/string-utils.js';
import { getActivityItemCommentsFromChangelog } from './activity-search-helpers.js';
import { getItemTypeProps } from './get-item-type.js';

const DEFAULT_PROPERTY_LIST = [
    ItemPropertyType.Status,
    ItemPropertyType.Priority,
    ItemPropertyType.Assignee,
    ItemPropertyType.StartDate,
    ItemPropertyType.EndDate,
    ItemPropertyType.Description,
    ItemPropertyType.Tag,
    ItemPropertyType.CompletionDate,
];

interface ItemAsTextDataInclusion {
    uuid: boolean;
    changelog: boolean;
    docDiffs: boolean;
    comments: boolean;
    children: boolean;
    description: boolean;
    documentContent: boolean;
    propertyNames: string[];
    changelogTimestamps: boolean;
    overridePropertiesAndIncludeDefaultList?: boolean;
    overrideAndIncludeAllChangeLogs?: boolean;
}

/** @see TruncationConfig in ports/config — same shape, kept as an alias for porting compatibility. */
export type ActivityGraphItemTruncationProperties = TruncationConfig;

export type ActivityItemGraphGroupFunc<T> = (
    items: ActivityItem[],
) => { name: string; itemIds: string[]; metadata?: T }[];

export const ALL_PROPERTY_NAMES_WILDCARD = '*';

/**
 * The `ActivityItemGraph` class represents a graph structure for managing and summarizing activity items.
 * It provides methods to build the graph, manipulate nodes, and generate textual representations of the graph.
 *
 * Per-connector behaviors (hierarchy support, container object types to prune,
 * prompt property defaults) come from the {@link ConnectorTraitsRegistry}.
 *
 * @class
 */
export class ActivityItemGraph {
    static MAX_WORD_LENGTH = 50;
    private _graph: Graph<ActivityItem> = new Graph<ActivityItem>();
    private _roots: ActivityItem[] = [];
    private _cylicNodes: {
        node: ActivityItem;
        parent: ActivityItem | undefined;
    }[] = [];

    public static readonly MIN_NUM_ITEMS_TO_HIGHLIGHT = 5;

    constructor(
        private _traits: ConnectorTraitsRegistry,
        items: ActivityItem[],
        timelineProps?: {
            /// Function to get an activity item from the timeline, specifically for
            /// when the item is not in the list of items to build the hierarchy.
            getActivityItemFromTimeline: (id: string) => ActivityItem | undefined;
            /// List of data scope to consider as roots
            dataScopeUuids: string[];
            /// Type of filtering to apply to the graph
            filterType: GraphFilterType;
            /// Function to apply filtering to an item
            applyItemFilter: (item: ActivityItem) => {
                /// Whether the item should be kept
                filterMatched: boolean;
                /// Whether to ignore empty changelog for this item
                ignoreEmptyChanges: boolean;
            };
            /// Skip the root node if there are no edges, even if the root node has changes.
            skipRootIfThereAreNoEdges?: boolean;
        },
    ) {
        // build a graph only with the items that support hierarchy. the rest will be added later on in this constructor
        const itemsToBuildHierarchy = items.filter((i) => this.itemSupportsDeepHierarchy(i));
        const map = itemsToBuildHierarchy.reduce<Map<string, ActivityItem>>((p, c) => p.set(c.id, c), new Map());

        // Since we've only got a list of filtered+changed items, find additional parents that might not be in the items list.
        // This is to ensure that we can correctly summarise children with their parents.
        if (timelineProps) {
            const getActivityItemFromTimeline = timelineProps.getActivityItemFromTimeline;
            itemsToBuildHierarchy.forEach((item) => {
                // If the parent is a data scope, we don't need to go any further
                if (timelineProps.dataScopeUuids.includes(item.id)) {
                    return;
                }

                item.parents.forEach((p) => {
                    ActivityItemGraph.getActivityItemAndParents(
                        p.uuid,
                        timelineProps.dataScopeUuids,
                        getActivityItemFromTimeline,
                        map,
                    );
                });
            });
        }

        // build the graph: add nodes
        map.forEach((v) => {
            this._graph.addNode(v);
        });

        // build the graph: add edges
        this._graph.getNodes().forEach((v) => {
            // If the node is a data scope, we don't need to go any further
            if (timelineProps?.dataScopeUuids && timelineProps.dataScopeUuids.includes(v.id)) {
                return;
            }

            v.parents.forEach((parent) => {
                const p = map.get(parent.uuid);
                if (p) {
                    this._graph.addEdge(p, v);
                }
            });
        });

        // Apply transitive reduction to remove redundant parent edges.
        // If a node has multiple parents and one parent is an ancestor of another,
        // we only keep the edge to the closest parent.
        //
        //   Before:                     After:
        //
        //   ┌────────┐                  ┌────────┐
        //   │  Root  │                  │  Root  │
        //   └────────┘                  └────────┘
        //        │                           │
        //        ├───────────┐               │
        //        │           │               │
        //        ▼           │               ▼
        //   ┌────────┐       │          ┌────────┐
        //   │ Node A │       │          │ Node A │
        //   └────────┘       │          └────────┘
        //        │           │               │
        //        ▼           │               ▼
        //   ┌────────┐       │          ┌────────┐
        //   │ Node B │◄──────┘          │ Node B │
        //   └────────┘                  └────────┘
        //
        // Applied only to connectors that declare it via traits (sources with
        // messy multi-parent hierarchies, e.g. Notion).
        this._graph.transitiveReduction(
            (a, b) => a.id === b.id,
            (node) => this._traits.get(node.connector).applyTransitiveReduction,
        );

        // Fix any cycles.
        // While we don't explicitly support cyclic graphs and most tools don't,
        // flexible parent linking in some tools can let users accidentally create cycles.
        this._cylicNodes = this._graph.fixAllCycles();

        // Now that we have a full graph, we can have roots that are irrelevant for the summary
        // because the items we want to summarize can have multiple parents.
        // We need to trim the graph to only the items we want to summarize.
        if (timelineProps?.dataScopeUuids) {
            // Remove nodes that are not in the hierarchy of *any* of the data scopes
            let roots = this._graph.getGraphRoots();
            const rootsThatAreDataScopes = roots.filter((r) => timelineProps.dataScopeUuids.includes(r.id));
            if (rootsThatAreDataScopes.length > 0) {
                this._graph.removeNodesWithoutSharedAncestryTo(rootsThatAreDataScopes);
            }

            // Remove the data scopes themselves
            rootsThatAreDataScopes.forEach((r) => {
                this._graph.removeNode(r);
            });

            // Pre-scan all nodes with applyItemFilter to determine filter results upfront.
            // This allows us to check ignoreEmptyChanges before removing items with no changes.
            const filterResultsMap = new Map<string, { filterMatched: boolean; ignoreEmptyChanges: boolean }>();
            const itemsToIgnoreEmptyChanges = new Set<string>();
            this._graph.getNodes().forEach((n) => {
                const result = timelineProps.applyItemFilter(n);
                filterResultsMap.set(n.id, result);
                if (result.ignoreEmptyChanges) {
                    itemsToIgnoreEmptyChanges.add(n.id);
                }
            });

            // Remove nodes:
            // 1. That are not useful to show to the user (structural containers,
            //    declared per connector via traits.hierarchyNoiseObjectTypes)
            // 2. That have no changes (except root nodes and nodes marked as ignoreEmptyChanges)
            // But we dont want to break the graph so we need to transfer the children to a valid parent
            roots = this._graph.getGraphRoots();
            let rootIds = new Set(roots.map((r) => r.id));
            roots.forEach((root) => {
                this._graph.removeNodesAndTransferChildrenToParentBfs(root, (n) => {
                    const connectorList = this._traits.get(n.connector).hierarchyNoiseObjectTypes;
                    const isRoot = rootIds.has(n.id);
                    const shouldIgnoreEmptyChanges = itemsToIgnoreEmptyChanges.has(n.id);
                    return (
                        connectorList.includes(n.idFromConnectorObjectType) ||
                        (n.changeDescription.length === 0 && !isRoot && !shouldIgnoreEmptyChanges)
                    );
                });
            });

            // Apply graph filtering to children
            roots = this._graph.getGraphRoots();
            rootIds = new Set(roots.map((r) => r.id));
            roots.forEach((root) => {
                this._graph.removeNodesAndTransferChildrenToParentBfs(root, (n) => {
                    const isRoot = rootIds.has(n.id);
                    const shouldApplyGraphFilter =
                        timelineProps.filterType === GraphFilterType.Full ||
                        (!isRoot && timelineProps.filterType === GraphFilterType.ChildrenOfRootsOnly);
                    let keepItem = true;
                    if (shouldApplyGraphFilter) {
                        const filterResult = filterResultsMap.get(n.id);
                        keepItem = filterResult?.filterMatched ?? false;
                    }
                    return !keepItem;
                });
            });

            // Apply graph filtering to roots
            roots = this._graph.getGraphRoots();
            rootIds = new Set(roots.map((r) => r.id));
            roots.forEach((root) => {
                const shouldApplyGraphFilter = timelineProps.filterType === GraphFilterType.RootsOnly;
                let keepItem = true;
                if (shouldApplyGraphFilter) {
                    const filterResult = filterResultsMap.get(root.id);
                    keepItem = filterResult?.filterMatched ?? false;
                }
                if (!keepItem) {
                    this._graph.removeNodeAndChildrenDfsOnly(root, (a, b) => a.id === b.id);
                }
            });

            // Remove empty root nodes that dont have any changes
            this._graph.getGraphRoots().forEach((root) => {
                const edges = this._graph.getEdges(root);
                // If the root has no children and no changes, we can remove it
                // unless it's in the list of items to ignore
                if (
                    (edges.length === 0 &&
                        root.changeDescription.length === 0 &&
                        !itemsToIgnoreEmptyChanges.has(root.id)) ||
                    (edges.length === 0 && timelineProps?.skipRootIfThereAreNoEdges)
                ) {
                    this._graph.removeNode(root);
                }
            });
        }

        // Now add the rest of the nodes that don't support hierarchy
        const itemsNotSupportingHierarchy = items.filter((i) => !this.itemSupportsDeepHierarchy(i));
        itemsNotSupportingHierarchy.forEach((i) => {
            let shouldAdd = true;
            if (timelineProps) {
                const { filterMatched } = timelineProps.applyItemFilter(i);
                shouldAdd = filterMatched;
            }
            if (shouldAdd) {
                this._graph.addNode(i);
            }
        });

        // give the roots a score based on the average of their children
        this._roots = this._graph.getGraphRoots();
        this._roots.forEach((r) => {
            let numScoredItems = 1;
            this._graph.dfs(r, (n) => {
                r.score += n.score;
                numScoredItems++;
                return true;
            });
            r.score = r.score / numScoredItems;
        });
    }

    static getActivityItemAndParents(
        id: string,
        dataScopeUuids: string[],
        getActivityItemFromTimeline: (id: string) => ActivityItem | undefined,
        existingItemMap: Map<string, ActivityItem>,
    ): void {
        if (existingItemMap.has(id)) {
            return;
        }

        const item = getActivityItemFromTimeline(id);
        if (!item) {
            return;
        }
        existingItemMap.set(item.id, item);
        item.parents.forEach((p) => {
            // If the parent is a data scope, we don't need to go any further
            if (dataScopeUuids.includes(p.uuid)) {
                return;
            }

            ActivityItemGraph.getActivityItemAndParents(
                p.uuid,
                dataScopeUuids,
                getActivityItemFromTimeline,
                existingItemMap,
            );
        });
    }

    get roots() {
        return this._roots;
    }

    get cyclicNodes() {
        return this._cylicNodes;
    }

    get traits(): ConnectorTraitsRegistry {
        return this._traits;
    }

    /**
     * Returns the direct children of a node in the graph.
     * @param node The parent node to get children for
     * @returns Array of child ActivityItem nodes
     */
    getChildren(node: ActivityItem): ActivityItem[] {
        return this._graph.getEdges(node);
    }

    /**
     * Creates a copy of the current graph, including only the nodes with the specified root IDs.
     *
     * @param idsToCopy - An array of root node IDs to be included in the copied graph.
     * @returns A new graph instance containing only the specified root nodes and their descendants.
     */
    copyWithRootIds(idsToCopy: string[]) {
        const copy = this.copy();
        const roots = copy.roots;
        roots.forEach((r) => {
            if (!idsToCopy.includes(r.id)) {
                copy._graph.removeNodeAndChildrenDfsOnly(r, (a, b) => a.id === b.id);
            }
        });
        copy.updateRoots();
        return copy;
    }

    /**
     * Prune the graph to the top percentage of nodes by score.
     * @param percentage Between 0 and 1
     * @returns The number of items kept and the total number of items
     */
    pruneTopNByPercentage(percentage: number, maxNumItems = 500) {
        // clamp to 0-1
        const percentageClamped = Math.min(1, Math.max(0, percentage));

        const sortedRoots = ActivityItemGraph.sortItemsByScore(this._roots);
        const numItems = percentageClamped * sortedRoots.length;
        // always keep at least 5 items
        const topN = Math.round(Math.max(numItems, ActivityItemGraph.MIN_NUM_ITEMS_TO_HIGHLIGHT));

        // Ensure the number of items to keep does not exceed the maximum number of items
        const clampedTopN = Math.min(topN, maxNumItems);
        for (let i = clampedTopN; i < sortedRoots.length; i++) {
            this._graph.removeNodeAndChildrenDfsOnly(sortedRoots[i], (a, b) => a.id === b.id);
        }
        this.updateRoots();
        return { topN: Math.min(clampedTopN, sortedRoots.length), total: sortedRoots.length };
    }

    /**
     * Prune the graph to the top N items by score.
     * @param maxNumItems The maximum number of items to keep
     * @returns The number of items kept and the total number of items
     */
    pruneByMaxNumItems(maxNumItems: number) {
        // Ensure maxNumItems is at least 1
        const clampedMaxNumItems = Math.max(1, maxNumItems);
        const sortedRoots = ActivityItemGraph.sortItemsByScore(this._roots);
        // If the number of items is less than or equal to maxNumItems, do nothing
        if (sortedRoots.length <= clampedMaxNumItems) {
            return { topN: sortedRoots.length, total: sortedRoots.length };
        }
        // Otherwise, remove the lowest scoring items
        for (let i = clampedMaxNumItems; i < sortedRoots.length; i++) {
            this._graph.removeNodeAndChildrenDfsOnly(sortedRoots[i], (a, b) => a.id === b.id);
        }
        this.updateRoots();
        return { topN: clampedMaxNumItems, total: sortedRoots.length };
    }

    /**
     * Make a deep copy of the graph. Optionally filter out specific nodes.
     * @returns a deep copy of the graph
     */
    copy(filterNodes?: (node: ActivityItem) => boolean) {
        let nodes = this._graph.getNodes();
        if (filterNodes) {
            nodes = nodes.filter(filterNodes);
        }

        // Copy the nodes and edges rather than going through
        // the graph constructor because the graph might be already
        // pruned/filtered and we don't want to lose that.
        const g = new ActivityItemGraph(this._traits, []);
        nodes.forEach((n) => {
            g._graph.addNode(n);
        });
        nodes.forEach((n) => {
            g._graph.setEdges(n, this._graph.getEdges(n));
        });
        g.updateRoots();

        return g;
    }

    /**
     * Generates a formatted text representation of items for a given timeline and grouping criteria.
     *
     * @param timeline - The timeline object containing the items to be processed.
     * @param plainTextDocs - A map of plain text for the docs that have been changed.
     * @param groupType - The type of grouping to be applied to the items.
     * @param alsoGroupByItemType - A boolean indicating whether to also group items by their type.
     * @param ianaZone - The IANA time zone identifier to be used for date and time formatting.
     * @param toInclude - Specifies which data to include in the text representation.
     * @param formatting - An optional object specifying the formatting for titles and sections.
     * @returns A string containing the formatted text representation of the items.
     */
    getItemsAsTextForPrompt(
        timeline: Timeline,
        plainTextDocs: Map<string, string>,
        groupType: ItemGroup['type'],
        alsoGroupByItemType: boolean,
        ianaZone: string,
        toInclude: ItemAsTextDataInclusion,
        formatting: { title: string; section: string } = { title: '#', section: '##' },
        truncationProperties: ActivityGraphItemTruncationProperties | undefined,
    ) {
        const roots = this._roots;
        const rootsAsText: string[] = [];
        roots.forEach((root) => {
            const children: ActivityItem[] = [];
            this._graph.dfs(root, (n) => {
                children.push(n);
                return true;
            });

            // Group children by relationship
            const bucketByRelationship = new Map<string, { items: ActivityItem[]; label: string }>();
            children.forEach((child) => {
                const relationship = child.parents.find((p) => p.uuid === root.id)?.relationship || 'Child';
                const label = `${Capitalize(relationship)} items`;
                const found = bucketByRelationship.get(label);
                if (found) {
                    found.items.push(child);
                } else {
                    bucketByRelationship.set(label, { items: [child], label });
                }
            });

            const text = this.itemToText(
                root,
                Array.from(bucketByRelationship.values()),
                timeline,
                plainTextDocs,
                groupType,
                alsoGroupByItemType,
                ianaZone,
                toInclude,
                formatting,
                truncationProperties,
            );
            if (text) {
                // Sanitize the text to remove any unwanted content
                const sanitized = ActivityItemGraph._sanitizeText(text);
                rootsAsText.push(sanitized);
            }
        });
        return rootsAsText.join('\n\n');
    }

    /**
     * Creates a group of graphs based on the provided grouping function.
     *
     * @param getGroups - A function that takes the root activity items and returns a map of groups.
     * @returns An array of objects, each containing the name of the group, the grouped graph, and optional metadata.
     */
    groupBy<T>(getGroups: ActivityItemGraphGroupFunc<T>): { name: string; graph: ActivityItemGraph; metadata?: T }[] {
        const groups = getGroups(this._roots);
        return Array.from(groups.values()).map((v) => {
            return {
                graph: this.copyWithRootIds(v.itemIds),
                name: v.name,
                metadata: v.metadata,
            };
        });
    }

    getAllActivityItemsSortedByScore() {
        return ActivityItemGraph.sortItemsByScore(this._graph.getNodes());
    }

    getAllActivityItemsUnsorted() {
        return this._graph.getNodes();
    }

    getAllActivityItemsSortedByFeature(feature: ActivityFeature, direction: SortDirection) {
        return this._graph.getNodes().sort((a, b) => {
            const aFeature = a.featureScores.find((f) => f.feature === feature);
            const bFeature = b.featureScores.find((f) => f.feature === feature);

            if (!aFeature || !bFeature) {
                return 0;
            }

            if (direction === SortDirection.Ascending) {
                return aFeature.score - bFeature.score;
            } else {
                return bFeature.score - aFeature.score;
            }
        });
    }

    private itemSupportsDeepHierarchy(item: ActivityItem) {
        return this._traits.get(item.connector).deepHierarchy;
    }

    private updateRoots() {
        this._roots = this._graph.getGraphRoots();
    }

    private itemToText(
        item: ActivityItem,
        children: { label: string; items: ActivityItem[] }[],
        timeline: Timeline,
        plainTextDocs: Map<string, string>,
        groupType: ItemGroup['type'],
        alsoGroupByItemType: boolean,
        ianaZone: string,
        toInclude: ItemAsTextDataInclusion,
        formatting: { title: string; section: string } = { title: '#', section: '##' },
        truncationProperties: ActivityGraphItemTruncationProperties | undefined,
    ): string | undefined {
        const timelineItem = timeline.items[item.id];
        if (!timelineItem) {
            return undefined;
        }
        const changesFromTimeline = timeline.changes.find((c) => c.itemUuid === item.id)?.changes || [];

        const properties: string[] = [];
        // Add item type
        const itemTypeFromApp = getItemTypeProps(timelineItem).name;
        properties.push(`item_type: ${itemTypeFromApp}`);

        if (toInclude.uuid) {
            properties.push(`uuid: ${item.id}`);
        }

        const { includeStatus, includeStatusCategory, allowedProps, includeAllChanges } = this.getPropsForItemToText(
            item.connector,
            toInclude,
            groupType,
            alsoGroupByItemType,
            toInclude.overridePropertiesAndIncludeDefaultList,
            toInclude.overrideAndIncludeAllChangeLogs,
        );
        const itemProps = timelineItem.properties.filter(
            (p) =>
                allowedProps.includes(p.details.type) ||
                toInclude.propertyNames.includes(p.name) ||
                toInclude.propertyNames.includes(ALL_PROPERTY_NAMES_WILDCARD),
        );
        itemProps.forEach((p) => {
            if (p.details.type === ItemPropertyType.Status) {
                if (p.name && p.value && includeStatus) {
                    properties.push(`${p.name}: ${p.value}`);
                }
                const statusCategory = p.details.statusCategory;
                if (includeStatusCategory && statusCategory && statusCategory !== ItemPropertyStatusCategory.Unknown) {
                    // "Status Category" has been specifically called out in the system prompt
                    // Special case for canceled status otherwise they will be summarized as "done".
                    // E.g. canceled is a default option in Linear even though it is a done status.
                    const category =
                        statusCategory === ItemPropertyStatusCategory.Done && p.value.toLowerCase() === 'canceled'
                            ? 'Canceled'
                            : getItemPropertyStatusCategoryAsString(statusCategory);

                    properties.push(`Status Category: ${category}`);
                }
            } else if (p.details.type === ItemPropertyType.Text) {
                const text = getTextFromItemProperty(p);
                const truncatedText = truncationProperties
                    ? ActivityItemGraph._truncateAtWordBoundary(text, truncationProperties.textPropertyMaxChars)
                    : text;
                properties.push(`${p.name}: ${truncatedText}`);
            } else if (p.details.type === ItemPropertyType.EndDate || p.details.type === ItemPropertyType.StartDate) {
                const dt = DateTime.fromISO(p.value);
                const absolute = dt.toFormat('dd MMM yy');
                const relative = dt.toRelativeCalendar();
                properties.push(`${p.name}: ${relative} (${absolute})`);
            } else {
                const value = truncationProperties
                    ? ActivityItemGraph._truncateAtWordBoundary(p.value, truncationProperties.defaultPropertyMaxChars)
                    : p.value;
                properties.push(`${p.name}: ${value}`);
            }
        });

        // Add status changes, if needed
        const changes: string[] = [];
        if (toInclude.changelog) {
            changesFromTimeline.forEach((c) => {
                if (c.changeType === ChangeType.Comment && !includeAllChanges) {
                    return;
                }

                if (
                    c.changeType !== ChangeType.Status &&
                    !timelineItem.types.includes(ItemType.Document) &&
                    !includeAllChanges
                ) {
                    return;
                }

                if (c.changeType === ChangeType.Status && !includeStatus && !includeAllChanges) {
                    return;
                }

                const description = c.description
                    .map((d) =>
                        d.decoration === 'date'
                            ? DateTime.fromISO(d.value).setZone(ianaZone).toLocaleString(DateTime.DATETIME_FULL)
                            : d.value,
                    )
                    .join(' ');

                const descriptionStr =
                    c.actorList.length > 0
                        ? `${c.actorList.map((a) => a.displayName).join(', ')}: ${description}`
                        : description;
                if (toInclude.changelogTimestamps && c.timeRange?.newest) {
                    const newestDateIso =
                        typeof c.timeRange.newest === 'string' ? c.timeRange.newest : c.timeRange.newest.toISOString();
                    const dt = DateTime.fromISO(newestDateIso).setZone(ianaZone);
                    changes.push(
                        `[When: ${dt.toRelativeCalendar()}, Date: ${dt.toLocaleString(
                            DateTime.DATE_FULL,
                        )}, Time: ${dt.toLocaleString(DateTime.TIME_SIMPLE)}] ${descriptionStr}`,
                    );
                } else {
                    changes.push(descriptionStr);
                }
            });
        }

        // Document content
        const includeDocContent = toInclude.documentContent && plainTextDocs.has(item.id);

        // Doc diffs
        const edits = toInclude.docDiffs && !includeDocContent ? timeline.docDiffs[item.id]?.diff : undefined;

        // Comments
        let comments: undefined | string;
        if (toInclude.comments) {
            const commentsFromChanges = getActivityItemCommentsFromChangelog(changesFromTimeline, 'oldest_first');
            if (commentsFromChanges.length > 0) {
                comments = commentsFromChanges
                    .map((c) => {
                        const commentStr = `${c.authorDisplayName}: ${htmlToText(c.comment, {
                            wordwrap: false,
                        })}`;
                        if (toInclude.changelogTimestamps) {
                            const dateIso = typeof c.date === 'string' ? c.date : c.date.toISOString();
                            const dt = DateTime.fromISO(dateIso).setZone(ianaZone);
                            return `[Date ${dt.toRelativeCalendar()}, Time: ${dt.toLocaleString(
                                DateTime.TIME_SIMPLE,
                            )}] ${commentStr}`;
                        }
                        return commentStr;
                    })
                    .join('\n\n');
            }
        }

        // Child tasks
        const childrenSections: string[] = [];
        if (toInclude.children && children.length > 0) {
            children.forEach((childSection) => {
                const sectionAsText: string[] = [];
                childSection.items.forEach((child) => {
                    const childText = this.itemToText(
                        child,
                        [],
                        timeline,
                        plainTextDocs,
                        ItemGroupPredefinedType.None,
                        false,
                        ianaZone,
                        toInclude,
                        {
                            title: '###',
                            section: '####',
                        },
                        truncationProperties,
                    );
                    if (childText) {
                        sectionAsText.push(childText);
                    }
                });
                childrenSections.push(`${formatting.section} ${childSection.label}\n\n${sectionAsText.join('\n\n')}`);
            });
        }

        // Combine into markdown
        const sections = [`${formatting.title} Title\n${item.title}`];

        if (properties.length > 0) {
            sections.push(`${formatting.section} Properties\n${properties.join('\n')}`);
        }

        if (changes.length > 0) {
            sections.push(`${formatting.section} Recent Changes\n${changes.join('\n')}`);
        }

        if (comments) {
            sections.push(`${formatting.section} Recent Comments\n${comments}`);
        }

        if (edits) {
            const editContent = truncationProperties
                ? ActivityItemGraph._truncateAtWordBoundary(edits, truncationProperties.docDiffMaxChars)
                : edits;
            sections.push(`${formatting.section} Document Edits\n${editContent}`);
        }

        if (includeDocContent) {
            const docContent = plainTextDocs.get(item.id);
            if (docContent) {
                const content = truncationProperties
                    ? ActivityItemGraph._truncateDocumentContent(docContent, truncationProperties.documentMaxChars)
                    : docContent;
                sections.push(`${formatting.section} Document Content\n${content}`);
            }
        }

        if (childrenSections.length > 0) {
            childrenSections.forEach((c) => sections.push(c));
        }

        return sections.join('\n\n');
    }

    private getPropsForItemToText(
        connector: string,
        toInclude: ItemAsTextDataInclusion,
        group: ItemGroup['type'],
        alsoGroupByItemType: boolean,
        overridePropertiesAndIncludeDefaultList: boolean | undefined,
        overrideAndIncludeAllChangeLogs: boolean | undefined,
    ): {
        allowedProps: ItemPropertyType[];
        includeStatus: boolean;
        includeStatusCategory: boolean;
        includeAllChanges: boolean;
    } {
        const traits = this._traits.get(connector);
        let includeStatus = true;
        const allowedProps = new Set<ItemPropertyType>([ItemPropertyType.Status]);

        // Since the UI already shows the status changes, we don't need to show them in the summary
        if (
            group === ItemGroupPredefinedType.Status ||
            group === ItemGroupPredefinedType.StatusLifecycle ||
            alsoGroupByItemType
        ) {
            includeStatus = false;
        }

        if (toInclude.description) {
            allowedProps.add(ItemPropertyType.Description);
        }

        let includeStatusCategory = traits.promptIncludeStatusCategory;
        const includeAllChanges = traits.promptIncludeAllChanges;

        traits.promptDefaultProperties.forEach((p) => allowedProps.add(p));

        // If the user has requested to override the properties, we include the default list
        if (overridePropertiesAndIncludeDefaultList) {
            DEFAULT_PROPERTY_LIST.forEach((p) => allowedProps.add(p));
            includeStatus = true;
            includeStatusCategory = true;
        }

        return {
            allowedProps: Array.from(allowedProps),
            includeStatus,
            includeStatusCategory,
            includeAllChanges: overrideAndIncludeAllChangeLogs || includeAllChanges,
        };
    }

    static sortItemsByScore(items: ActivityItem[]): ActivityItem[] {
        return items.sort((a, b) => {
            return b.score - a.score;
        });
    }

    static _sanitizeText(text: string): string {
        let sanitized = text;

        // Remove markdown image syntax and their contents
        sanitized = sanitized.replace(/!\[.*?\]\(.*?\)/g, '');

        // Remove URLs in angle brackets like: <https://d14ka.na1.hs-sales Banner >
        sanitized = sanitized.replace(/<[^>]+>/g, '');

        // Remove URLS in brackets like: [https://d14ka.na1.hs-sales Banner]
        sanitized = sanitized.replace(/\[https?:\/\/[^\s]+\]/g, '');

        // Remove base64 encoded strings
        sanitized = sanitized.replace(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,[a-zA-Z0-9+/=]+/g, '');

        // Catch all: truncate long words that can break LLM tokenization
        // Ensure the length is greater than 36 so UUIDs aren't truncated
        sanitized = this._truncateLongWords(sanitized, this.MAX_WORD_LENGTH);

        return sanitized;
    }

    static _truncateLongWords(text: string, maxChars: number): string {
        const words = text.split(' ');
        const truncatedWords = words.map((word) => {
            if (word.length > maxChars) {
                return word.slice(0, maxChars);
            }
            return word;
        });
        return truncatedWords.join(' ');
    }

    public static _truncateAtWordBoundary(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }

        const truncated = text.slice(0, maxLength);
        const lastSpaceIndex = truncated.lastIndexOf(' ');

        // If no space found or the "word" is too long (>100 chars), just cut at character limit
        // This handles cases like email quote markers ">>>>>>>>>" or very long URLs
        const wordLength = maxLength - lastSpaceIndex - 1;
        if (lastSpaceIndex === -1 || wordLength > 100) {
            return truncated;
        }

        // Only use word boundary if we're close to the limit and not cutting too much content
        if (lastSpaceIndex > maxLength - 50 && lastSpaceIndex > maxLength * 0.9) {
            return truncated.slice(0, lastSpaceIndex);
        }

        // Otherwise, just cut at the character limit
        return truncated;
    }

    public static _truncateDocumentContent(content: string, maxLength: number): string {
        if (!content || typeof content !== 'string' || content.length === 0) {
            return content;
        }

        return this._truncateAtWordBoundary(content, maxLength);
    }
}
