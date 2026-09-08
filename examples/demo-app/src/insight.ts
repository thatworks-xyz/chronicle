/**
 * An example insight — Chronicle's unit of analytics.
 *
 * An InsightConfig describes one computed visualization (metric card, table,
 * chart...) over a set of scopes and a time window. You register it once
 * (`engine.insights.register(...)`) and run it by id
 * (`engine.runInsight(principal, id, scopes, { fromDate })`).
 *
 * The engine drives this pipeline:
 *
 *   fetchTimeline (optional) -> group items -> analyze() per period
 *   -> formatResult() -> VisualizationResult
 *
 * Insights that analyze item/change data let the engine build the timeline
 * itself (omit fetchTimeline). Insights that only read METRIC SNAPSHOTS —
 * like this one — fabricate a minimal timeline holding just the scope item
 * plus one synthetic change (the engine skips scopes with no activity), then
 * read the snapshot series in analyze().
 *
 * `applicability` matches the insight to scopes: it only runs for scopes on
 * this connector with these hierarchy types.
 */
import {
    ActionTarget,
    ChangeActionType,
    ChangeType,
    computeMetricFromSnapshots,
    ContextItemsFilterOperator,
    getAndValidateTimelineDate,
    GraphFilterType,
    InsightConfig,
    ItemGroupPredefinedType,
    latestValue,
    mapItemToTimelineItem,
    MetricSnapshotTypes,
} from '@chronicle/core';
import { DEMO_CONNECTOR_ID, DEMO_UUIDS, DemoHierarchyTypes, OPEN_TASKS_SNAPSHOT_CONFIG_UUID } from './connector.js';

export const OPEN_TASKS_INSIGHT_ID = 'demo_open_tasks';

export const OpenTasksInsight: InsightConfig = {
    id: OPEN_TASKS_INSIGHT_ID,
    name: 'Open Tasks',
    applicability: { connectors: [DEMO_CONNECTOR_ID], hierarchyTypes: [DemoHierarchyTypes.Company] },
    // No grouping/filtering needed for a snapshot-only metric card.
    getGrouping: () => ({ primary: { groupType: ItemGroupPredefinedType.None } }),
    getFilters: () => ({
        filters: [],
        operator: ContextItemsFilterOperator.Or,
        graphFilterType: GraphFilterType.Full,
    }),
    /**
     * The fabricated minimal timeline: the scope item plus one synthetic
     * change so the engine treats the scope as active. `params.runtime` gives
     * access to everything the engine has: repositories, access control,
     * cache, config, logger.
     */
    fetchTimeline: async (params) => {
        const access = await params.runtime.accessControl.getAccessFilter({ userId: params.userId });
        const [company] = await params.runtime.repos.items.getByUuids([DEMO_UUIDS.company], access);
        if (!company) {
            return undefined; // nothing ingested yet -> insight yields no result
        }
        return {
            timeline: {
                additionalRelevantItems: [],
                changes: [
                    {
                        itemUuid: company.uuid,
                        changes: [
                            {
                                actionType: ChangeActionType.Updated,
                                actorList: [],
                                changeType: ChangeType.Item,
                                comments: [],
                                description: [],
                                statusChanges: [],
                                target: ActionTarget.CrmEntry,
                                timeRange: { newest: new Date(), oldest: new Date() },
                                userMentionType: [],
                            },
                        ],
                    },
                ],
                docDiffs: {},
                items: {
                    [company.uuid]: await mapItemToTimelineItem(
                        company,
                        0,
                        {},
                        params.runtime.connectorTraits,
                        async () => [],
                    ),
                },
                scopesWithChildUuids: {},
            },
            timelineId: `demo-open-tasks:${params.cacheSessionKey}`,
            fromDate: getAndValidateTimelineDate(params.fromDate),
            metadata: undefined,
        };
    },
    /**
     * Called once for the current period (and once per delta period when the
     * caller requests comparisons). Reads the snapshot series and reduces it
     * to a metric: 'latest' answers "how many are open right now"; 'sum' /
     * 'average' suit rate-style metrics. getForDateRange falls back to the
     * newest snapshot BEFORE the window when the window itself is empty —
     * that's how change-point storage still yields a current value.
     */
    analyze: async (_graphs, context) => {
        const access = await context.runtime.accessControl.getAccessFilter({ userId: context.userId });
        const toDate = context.toDate ?? new Date();
        const snapshots = await context.runtime.repos.snapshots.getForDateRange({
            userId: context.userId,
            access,
            itemUuid: DEMO_UUIDS.company,
            snapshotConfigUuid: OPEN_TASKS_SNAPSHOT_CONFIG_UUID,
            from: context.fromDate,
            to: toDate,
        });
        const metric = computeMetricFromSnapshots(
            snapshots,
            DEMO_UUIDS.company,
            context.fromDate,
            toDate,
            // Extractor: pull the numeric value out of your snapshot shape.
            (s) =>
                s.measurement[0]?.data.type === MetricSnapshotTypes.GenericMetric
                    ? s.measurement[0].data.payload.generic?.value
                    : undefined,
            'latest',
            latestValue(),
        );
        return {
            period: { fromDate: context.fromDate, toDate: context.toDate },
            aggregations: new Map([['openTasks', metric]]),
            distributions: { openTasks: metric.value },
        };
    },
    /**
     * Turn the analysis into a visualization. `analysis.current` is this
     * period; delta periods (when requested) enable trend rendering. Other
     * shapes: buildTable(...) for tables, chart builders for time series.
     */
    formatResult: (analysis) => ({
        type: 'metric-card',
        title: 'OPEN TASKS',
        primaryValue: analysis
            ? String((analysis.current.aggregations.get('openTasks') as { value: number }).value)
            : '-',
    }),
    /** Plain-text rendering, used when an LLM consumes insight output. */
    getAnalyzedDataAsText: () => 'open tasks',
};
