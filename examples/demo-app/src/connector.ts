/**
 * A complete example connector — the piece you write to feed YOUR tool's data
 * into Chronicle.
 *
 * Chronicle's data model has three record types, all produced by connectors:
 *
 * - WorkItem       — one unit of work (task, ticket, booking, document, deal...).
 *                    Items form a hierarchy via `parents`; a "scope" (the thing
 *                    users ask questions about) is just an item whose subtree is
 *                    of interest — here, a company with tasks under it.
 * - ChangeEvent    — one recorded change to an item at a point in time
 *                    (created, status change, comment...). Timelines and
 *                    summaries are built from these.
 * - MetricSnapshot — a point-in-time measurement attached to an item (counts,
 *                    fill rates...). Only change-points are stored; insights
 *                    read the series back.
 *
 * A connector is a ConnectorSource subclass. The engine's ingestion runner
 * drives it: fetch changes since the last watermark -> map them to
 * items/events -> hash-guarded upserts -> store events -> compute metric
 * snapshots -> advance the watermark. You implement the fetch/map parts; the
 * orchestration, dedup, and bookkeeping are the engine's job.
 *
 * This "demo-crm" connector fakes the fetch step with deterministic data so
 * the example runs with no external service. A real connector calls your API
 * in getChanges() and translates its payloads in map() — see also the
 * mapItem/mapChangelog field-mapper helpers in @chronicle/core for a more
 * declarative mapping style.
 */
import {
    ActionTarget,
    ChangeActionType,
    ChangeEvent,
    ChangeType,
    ConnectorSource,
    getHash,
    IngestionServices,
    ItemPropertyStatusCategory,
    ItemPropertyType,
    ItemType,
    ItemWithHierarchyType,
    ItemWithParentData,
    ItemWithParentDataChangelog,
    MetricSnapshot,
    MetricSnapshotConfig,
    MetricSnapshotTypes,
    Scope,
    UserMentionType,
    WorkItem,
    WorkItemRepository,
} from '@chronicle/core';

// Connector ids are open strings — Chronicle ships no fixed vendor list.
// The id is persisted on every stored record, so pick it once and keep it.
export const DEMO_CONNECTOR_ID = 'demo-crm';

// Identifies WHICH account/connection of this source the data came from
// (a real connector would use its API account id). Together with the
// connector id this scopes access rules and ingestion watermarks.
export const DEMO_ACCOUNT = 'demo-account';

// Hierarchy types classify what kind of scope an item can be (a project, a
// board, a company...). Also open strings; insights declare which hierarchy
// types they apply to.
export const DemoHierarchyTypes = { Company: 'DemoCompany' } as const;

// Each metric series is identified by a config uuid; it is persisted with
// every snapshot, so treat it like a schema constant.
export const OPEN_TASKS_SNAPSHOT_CONFIG_UUID = 'cccccccc-0000-0000-0000-000000000001';

/**
 * Stable uuids so summaries/insights are deterministic across runs. A real
 * connector generates a uuid the first time it sees an object
 * (crypto.randomUUID) and finds it again on later polls via the repository's
 * connector-id lookup (getByConnectorIds).
 */
export const DEMO_UUIDS = {
    company: 'aaaaaaaa-0000-0000-0000-000000000001',
    taskHomepage: 'aaaaaaaa-0000-0000-0000-000000000002',
    taskPricing: 'aaaaaaaa-0000-0000-0000-000000000003',
    taskLaunch: 'aaaaaaaa-0000-0000-0000-000000000004',
} as const;

// A Scope names a root item to build timelines over: "everything under Acme
// Corp". Real consumers let users pick scopes; the demo hardcodes one.
export const DEMO_SCOPES: Scope[] = [
    { uuid: DEMO_UUIDS.company, connector: DEMO_CONNECTOR_ID, hierarchyType: DemoHierarchyTypes.Company },
];

/**
 * The raw shape your source API returns — anything you like. The engine only
 * ever sees it through your map() implementation.
 */
interface DemoTaskSeed {
    uuid: string;
    title: string;
    status: 'Done' | 'In Progress';
    /** Change timestamp, as hours before "now" (so it always lands in the poll window). */
    changedHoursAgo: number;
}

const TASK_SEEDS: DemoTaskSeed[] = [
    { uuid: DEMO_UUIDS.taskHomepage, title: 'Design the homepage', status: 'Done', changedHoursAgo: 30 },
    { uuid: DEMO_UUIDS.taskPricing, title: 'Draft pricing page copy', status: 'In Progress', changedHoursAgo: 20 },
    { uuid: DEMO_UUIDS.taskLaunch, title: 'Prepare launch checklist', status: 'In Progress', changedHoursAgo: 4 },
];

/**
 * Item properties are typed name/value pairs. The `details.type` drives engine
 * behavior: Status properties feed status grouping and done-ness, Start/End
 * dates feed date handling, Description properties feed summaries, and so on.
 */
function statusProperty(status: DemoTaskSeed['status']) {
    return {
        name: 'Status',
        value: status,
        details: {
            type: ItemPropertyType.Status as const,
            isDone: status === 'Done',
            statusCategory: status === 'Done' ? ItemPropertyStatusCategory.Done : ItemPropertyStatusCategory.InProgress,
            statusId: status,
            statusOrderIndex: status === 'Done' ? 1 : 0,
        },
        style: {},
    };
}

function makeCompany(userId: string): WorkItem {
    return {
        uuid: DEMO_UUIDS.company,
        userId, // the user this record belongs to (drives access control)
        connector: DEMO_CONNECTOR_ID,
        // The source system's own identity for this object. Used to find the
        // item again on later polls and to wire parent/child references.
        idsFromConnector: {
            idFromConnector: 'company-1',
            connectorObjectType: 'company',
            connectorUserId: DEMO_ACCOUNT,
        },
        title: 'Acme Corp',
        createdBy: [],
        createdDate: new Date('2026-01-01T00:00:00Z'),
        properties: [],
        parents: [], // scope roots have no parents
        types: [],
        lastUpdate: new Date(),
    };
}

function makeTask(userId: string, seed: DemoTaskSeed): WorkItem {
    return {
        uuid: seed.uuid,
        userId,
        connector: DEMO_CONNECTOR_ID,
        idsFromConnector: {
            idFromConnector: seed.uuid,
            connectorObjectType: 'task',
            connectorUserId: DEMO_ACCOUNT,
        },
        title: seed.title,
        createdBy: [],
        createdDate: new Date('2026-01-05T00:00:00Z'),
        properties: [statusProperty(seed.status)],
        // Parents link the item into the hierarchy, referencing the parent by
        // its connector-native ids (resolved to uuids at ingestion time).
        parents: [
            {
                itemUuid: DEMO_UUIDS.company,
                idsFromConnector: {
                    idFromConnector: 'company-1',
                    connectorObjectType: 'company',
                    connectorUserId: DEMO_ACCOUNT,
                },
            },
        ],
        // `types` classify the item for summary counting/grouping. Items with
        // an empty `types` array are skipped when building summary pills, so
        // set at least one type on items you want counted in summaries.
        types: [ItemType.Task],
        lastUpdate: new Date(),
    };
}

/**
 * One change event per task. The `action` describes what happened; summaries
 * condense many of these into readable bullets. `description.simple` is the
 * human phrasing; changeType/actionType/actionTarget are the structured view
 * used for filtering, grouping, and dedup.
 */
function makeChangeEvent(userId: string, seed: DemoTaskSeed): ChangeEvent {
    return {
        timestamp: new Date(Date.now() - seed.changedHoursAgo * 60 * 60 * 1000),
        itemUuid: seed.uuid,
        userId,
        connector: DEMO_CONNECTOR_ID,
        idsFromConnector: {
            idFromConnector: seed.uuid,
            connectorObjectType: 'task',
            connectorUserId: DEMO_ACCOUNT,
        },
        action: {
            changeType: ChangeType.Item,
            actionType: seed.status === 'Done' ? ChangeActionType.Resolved : ChangeActionType.Updated,
            userMentionType: UserMentionType.None,
            actionTarget: ActionTarget.Task,
            actorDisplayName: 'Dana Demo',
            actorIsUser: false,
            description: { simple: seed.status === 'Done' ? 'Completed' : 'Updated' },
        },
    };
}

/**
 * The connector itself. Type parameters: <RawChange, State, ParentData>.
 * State carries anything you resolve once per poll (auth tokens, instance
 * urls); ParentData lets map() attach extra info used when resolving parents.
 *
 * A real connector calls an external API in getChanges() and maps its
 * payloads in map(); everything else here works the same.
 */
export class DemoCrmConnector extends ConnectorSource<DemoTaskSeed, undefined, unknown> {
    // Connectors that need storage access (e.g. to look up previously stored
    // items) take the repositories they need in their constructor.
    constructor(private readonly _items: WorkItemRepository) {
        super();
    }

    get connectorId() {
        return DEMO_CONNECTOR_ID;
    }

    get connectorUserId() {
        return DEMO_ACCOUNT;
    }

    async initializeState() {
        // Called once per poll before getChanges — resolve auth/config here.
        // The synthetic source needs none.
    }

    getState() {
        return undefined;
    }

    /**
     * Fetch raw changes in [fromDate, toDate). The engine supplies the window
     * from the stored watermark; `poll.firstPoll` is true on the very first
     * run so you can do a deeper backfill.
     */
    async getChanges(_fromDate: Date, _toDate: Date | undefined, _poll: { firstPoll: boolean }) {
        return { changes: TASK_SEEDS };
    }

    async getItemForId() {
        // Fetches a single item on demand (e.g. resolving a parent the poll
        // didn't include). Optional for sources that return complete data.
        return undefined;
    }

    /**
     * Translate raw source objects into WorkItems + ChangeEvents. The engine
     * then upserts the items (skipping unchanged ones by content hash) and
     * stores the events (deduplicating identical actions).
     */
    async map(userId: string, objs: DemoTaskSeed[]) {
        const itemsWithChanges: ItemWithParentDataChangelog<unknown>[] = objs.map((seed) => ({
            item: makeTask(userId, seed) as ItemWithParentData<unknown>,
            changelog: [makeChangeEvent(userId, seed)],
        }));
        return { itemsWithChanges };
    }

    /**
     * Optional hook for items that aren't part of the change feed. The scope
     * root (the company) is upserted here so contexts can target it. Runs on
     * every poll; the hash-guarded upsert makes re-runs effectively free.
     */
    async pollAdditionalItems(userId: string, _fromDate: Date, _firstPoll: boolean, _services: IngestionServices) {
        return { additionalItems: [makeCompany(userId) as ItemWithParentData<unknown>] };
    }

    /** Which items get metric snapshots computed (paired with the configs below). */
    async getItemsForMetrics(userId: string): Promise<ItemWithHierarchyType[]> {
        const companies = await this._items.getByConnectorObjectTypes(userId, DEMO_CONNECTOR_ID, ['company']);
        return companies.map((item) => ({ item, hierarchyType: DemoHierarchyTypes.Company }));
    }

    /**
     * Metric snapshot configs run at the end of every ingest. Each `calculate`
     * returns the current measurement for one item; the engine stores it ONLY
     * when the value changed since the last snapshot (change-point storage),
     * so frequent polling costs nothing while nothing changes. Insights read
     * the series back with a latest-before-window fallback.
     */
    get metricSnapshotConfigs(): MetricSnapshotConfig<this>[] {
        return [
            {
                type: 'single',
                uuid: OPEN_TASKS_SNAPSHOT_CONFIG_UUID,
                name: 'Open tasks',
                connector: DEMO_CONNECTOR_ID,
                filterHierarchyType: DemoHierarchyTypes.Company,
                calculate: async (userId, _connector, item) => {
                    const tasks = await this._items.getByParent(
                        item.uuid,
                        { kind: 'all' }, // access filter; connectors run trusted
                        { connectorObjectType: 'task' },
                    );
                    const openCount = tasks.filter(
                        (t) => t.properties.find((p) => p.name === 'Status')?.value !== 'Done',
                    ).length;
                    const measurement = [
                        {
                            data: {
                                type: MetricSnapshotTypes.GenericMetric as const,
                                payload: { generic: { value: openCount, valueFormatted: String(openCount) } },
                            },
                        },
                    ];
                    const snapshot: MetricSnapshot = {
                        timestamp: new Date(),
                        itemUuid: item.uuid,
                        connector: DEMO_CONNECTOR_ID,
                        connectorUserId: DEMO_ACCOUNT,
                        userId,
                        snapshotConfigUuid: OPEN_TASKS_SNAPSHOT_CONFIG_UUID,
                        measurement,
                        // The hash is what "did the value change?" compares.
                        measurementHash: getHash(measurement),
                    };
                    return snapshot;
                },
            },
        ];
    }
}
