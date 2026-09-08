import { ItemGroup, TimelineCreateDate } from '../../domain/api-types.js';
import { Scope } from '../../domain/context.js';
import {
    ContextItemsFilter,
    ContextItemsFilterOperator,
    ContextItemsFiltersWithOperator,
} from '../../domain/filters.js';
import { Timeline } from '../../domain/timeline.js';
import { EngineRuntime } from '../../ports/runtime.js';
import { ActivityItemGraph } from '../activity-graph.js';
import { getAndValidateTimelineDate } from '../conversions.js';
import { getGroupedActivityItemGraphs, getGroupedGraphs } from '../grouped-graphs.js';
import { getCombinedTextFromGraphs } from '../summarize.js';
import { getCachedTimelineFromScopes } from '../timeline-builder.js';
import {
    DEFAULT_INSIGHT_CONTEXT_CACHE_TTL_MS,
    generateAnalysisId,
    setAnalysisContext,
} from './insight-context-cache.js';
import {
    AnalysedGraphs,
    AnalysisContext,
    AnalysisParams,
    AnalysisResult,
    AnalysisResultWithDeltas,
    DeltaPeriod,
    InsightConfig,
    InsightLlmContext,
    resolveInsightParameters,
} from './types.js';
import { VisualizationResult } from './visualization.js';

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Renders graphs as text for LLM context.
 */
async function getGraphsAsText(
    runtime: EngineRuntime,
    principal: { userId: string; organizationId?: string },
    graphs: { graphs: { name?: string; graph: ActivityItemGraph }[]; groupedByItemType: boolean },
    timeline: Timeline,
    groupType: ItemGroup['type'],
): Promise<string | undefined> {
    if (graphs.groupedByItemType) {
        throw new Error('getGraphsAsText: grouping by item type is not supported');
    }
    return getCombinedTextFromGraphs(
        runtime,
        principal,
        undefined,
        timeline,
        groupType,
        'UTC',
        { graphs: graphs.graphs, groupedByItemType: false },
        {},
        undefined, // token budget handled by downstream consumers instead
    );
}

/**
 * Merge data source filters with insight-specific filters.
 *
 * When data source filters are provided, they are combined with the insight's
 * own filters to ensure the insight only analyzes data matching both sets of criteria.
 *
 * The merging strategy preserves the operator semantics of the insight filters:
 * - If insight uses And: simply append data source filters (all must match)
 * - If insight uses Or: merge each insight filter with data source filters to create
 *   combined filters that preserve the Or relationship between insight conditions
 *   while requiring data source conditions on each branch.
 *
 * Example: Insight [A, B] with Or + DataSource [C] → [(A+C), (B+C)] with Or
 * This ensures: (A AND C) OR (B AND C), which is equivalent to (A OR B) AND C
 *
 * @param insightFilters - Filters defined by the insight config (from getFilters())
 * @param dataSourceFilters - Optional filters from data sources
 * @returns Merged filter set, or the insight filters if no data source filters provided
 */
export function mergeFilters(
    insightFilters: ContextItemsFiltersWithOperator,
    dataSourceFilters?: ContextItemsFiltersWithOperator,
): ContextItemsFiltersWithOperator {
    // If no data source filters, return insight filters as-is
    if (!dataSourceFilters || !dataSourceFilters.filters || dataSourceFilters.filters.length === 0) {
        return insightFilters;
    }

    // If insight has no filters, use data source filters
    if (!insightFilters.filters || insightFilters.filters.length === 0) {
        return {
            ...insightFilters, // Preserve graphFilterType
            filters: dataSourceFilters.filters,
            operator: dataSourceFilters.operator,
        };
    }

    // If insight uses And operator, we can simply append data source filters
    // All filters must match anyway, so order and grouping don't matter
    if (insightFilters.operator === ContextItemsFilterOperator.And) {
        return {
            ...insightFilters,
            filters: [...insightFilters.filters, ...dataSourceFilters.filters],
            operator: ContextItemsFilterOperator.And,
        };
    }

    // Insight uses Or operator - we need to distribute data source filters across insight filters
    // to preserve the Or semantics: (A OR B) AND C → (A AND C) OR (B AND C)
    //
    // We merge each insight filter object with each data source filter object.
    // Since ContextItemsFilter has optional fields, merging creates a filter that
    // requires both conditions to match.
    const mergedFilters: ContextItemsFilter[] = [];
    for (const insightFilter of insightFilters.filters) {
        for (const dsFilter of dataSourceFilters.filters) {
            mergedFilters.push(mergeFilterObjects(insightFilter, dsFilter));
        }
    }

    return {
        ...insightFilters,
        filters: mergedFilters,
        operator: ContextItemsFilterOperator.Or, // Preserve insight's Or operator
    };
}

/**
 * Merge two ContextItemsFilter objects into one.
 * The resulting filter requires both conditions to match (AND semantics).
 */
function mergeFilterObjects(a: ContextItemsFilter, b: ContextItemsFilter): ContextItemsFilter {
    return {
        // For each field, prefer the more specific one, or merge if both exist
        change: a.change ?? b.change,
        action: mergeInArrays(a.action, b.action),
        userMention: a.userMention ?? b.userMention,
        properties: mergeArrayFields(a.properties, b.properties),
        propertiesNameValue: mergeArrayFields(a.propertiesNameValue, b.propertiesNameValue),
        connectorItemType: a.connectorItemType ?? b.connectorItemType,
        type: mergeInArrays(a.type, b.type),
        actors: mergeInArrays(a.actors, b.actors),
        itemUuids: a.itemUuids ?? b.itemUuids,
        feature: a.feature ?? b.feature,
        title: a.title ?? b.title,
        comment: a.comment ?? b.comment,
    };
}

/**
 * Merge two objects that have an 'in' array field.
 */
function mergeInArrays<T extends { in?: unknown[] }>(a: T | undefined, b: T | undefined): T | undefined {
    if (!a) return b;
    if (!b) return a;
    // If both have 'in' arrays, intersect them (both conditions must match)
    if (a.in && b.in) {
        const intersection = a.in.filter((v) => b.in?.includes(v));
        return { ...a, ...b, in: intersection } as T;
    }
    // Otherwise merge the objects
    return { ...a, ...b };
}

/**
 * Merge two array fields by concatenating them.
 */
function mergeArrayFields<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
    if (!a) return b;
    if (!b) return a;
    return [...a, ...b];
}

/**
 * Execute an insight configuration with optional delta analysis and caching
 */
export async function executeInsight(
    config: InsightConfig,
    params: AnalysisParams,
): Promise<{ visualization: VisualizationResult; analysisId: string } | undefined> {
    const runtime = params.runtime;
    // Generate deterministic analysis ID
    const analysisId = generateAnalysisId(config, params);

    const currentFromDate = params.fromDate;
    const currentPeriodData = await runAnalysisForPeriod(config, {
        ...params,
        fromDate: currentFromDate,
        toDate: params.toDate,
        isDeltaAnalysis: false,
        dataSourceFilters: params.dataSourceFilters,
    });

    if (!currentPeriodData) {
        // No data for current period, return empty visualization
        const visualization = config.formatResult(undefined, {
            userId: params.userId,
            organizationId: params.organizationId,
            fromDate: currentFromDate,
            toDate: params.toDate,
            userIanaZone: params.userIanaZone,
            scopes: params.scopes,
            timeline: params.timeline,
            timelineMetadata: params.timelineMetadata,
            runtime,
            cacheSessionKey: params.cacheSessionKey,
            insightParameters: params.insightParameters,
            isDeltaAnalysis: false,
        });
        return {
            analysisId,
            visualization,
        };
    }

    const {
        result: currentResult,
        graphs: currentGraphs,
        grouping: currentGrouping,
        analysisContext: currentContext,
    } = currentPeriodData;

    const analysisWithDeltas: AnalysisResultWithDeltas = {
        analysisId,
        current: currentResult,
        deltas: undefined,
    };

    // Calculate deltas if requested
    const deltaPeriods = params.deltaPeriods;
    const shouldCalculateDeltas = !config.disableDeltaAnalysis && deltaPeriods && deltaPeriods.length > 0;
    if (shouldCalculateDeltas) {
        const deltas: AnalysisResultWithDeltas['deltas'] = [];
        for (const deltaPeriod of deltaPeriods) {
            // Run analysis for previous period using the explicit date range
            const previousPeriodData = await runAnalysisForPeriod(config, {
                ...params,
                fromDate: deltaPeriod.fromDate,
                toDate: deltaPeriod.toDate,
                isDeltaAnalysis: true,
                dataSourceFilters: params.dataSourceFilters,
            });

            if (previousPeriodData) {
                const changes = calculateDistributionChanges(
                    currentResult.distributions,
                    previousPeriodData.result.distributions,
                );

                deltas.push({
                    period: deltaPeriod,
                    analysis: previousPeriodData.result,
                    changes,
                });
            }
        }

        if (deltas.length > 0) {
            analysisWithDeltas.deltas = deltas;
        }
    }

    // Cache analysis context if enabled
    if (params.cache) {
        const cacheTTL = params.cache.ttl || DEFAULT_INSIGHT_CONTEXT_CACHE_TTL_MS;

        try {
            // Generate analyzed data as text
            const analysesText = await config.getAnalyzedDataAsText(analysisWithDeltas, currentContext);

            // Generate graph representations as text
            const graphTexts: InsightLlmContext['graphTexts'] = [];
            const secondaryGrouping = currentGrouping.secondary;

            // If secondary grouping exists, get text for each sub-graph
            // Also include the name of the main graph so subsquent functions can identify them
            const principal = { userId: params.userId, organizationId: params.organizationId };
            if (secondaryGrouping) {
                await Promise.all(
                    currentGraphs.map(async (g) => {
                        const text = await getGraphsAsText(
                            runtime,
                            principal,
                            { graphs: g.subGraphs, groupedByItemType: false },
                            params.timeline,
                            secondaryGrouping.groupType,
                        );
                        if (text) {
                            graphTexts.push({
                                name: g.mainGraph.name,
                                text,
                            });
                        }
                    }),
                );
            } else {
                // No secondary grouping, get text for main graphs.
                // Name is undefined in this case
                const text = await getGraphsAsText(
                    runtime,
                    principal,
                    { graphs: currentGraphs.map((g) => g.mainGraph), groupedByItemType: false },
                    params.timeline,
                    currentGrouping.primary.groupType,
                );
                if (text) {
                    graphTexts.push({
                        name: undefined,
                        text,
                    });
                }
            }

            // Build cached context object and store
            const cachedContext: InsightLlmContext = {
                id: analysisId,
                organizationId: params.organizationId,
                analysesText,
                graphTexts,
                permissions: params.cache.permissions,
            };
            await setAnalysisContext(
                cachedContext,
                cacheTTL,
                runtime.cache,
                runtime.log,
                runtime.config.cacheKeyPrefixes.insightContext,
            );
        } catch (error) {
            runtime.log.error(`insights: failed to cache context for ${analysisId}: ${getExceptionMessage(error)}`);
        }
    }

    // Format result
    const visualization = config.formatResult(analysisWithDeltas, {
        userId: params.userId,
        organizationId: params.organizationId,
        fromDate: currentFromDate,
        toDate: undefined,
        userIanaZone: params.userIanaZone,
        scopes: params.scopes,
        timeline: params.timeline,
        runtime,
        cacheSessionKey: params.cacheSessionKey,
        insightParameters: params.insightParameters,
        isDeltaAnalysis: false,
    });
    return {
        analysisId,
        visualization,
    };
}

/**
 * Run analysis for a specific period
 */
async function runAnalysisForPeriod(
    config: InsightConfig,
    params: {
        userId: string;
        organizationId: string;
        timeline: Timeline;
        timelineMetadata?: Record<string, unknown>;
        scopes: Scope[];
        fromDate: Date;
        toDate?: Date; // Optional end date for the analysis period
        isDeltaAnalysis: boolean;
        userIanaZone: string;
        runtime: EngineRuntime;
        deltaPeriods?: DeltaPeriod[];
        dataSourceFilters?: ContextItemsFiltersWithOperator;
        cacheSessionKey: string;
        insightParameters: AnalysisParams['insightParameters'];
    },
): Promise<
    | {
          result: AnalysisResult;
          graphs: AnalysedGraphs[];
          grouping: ReturnType<typeof config.getGrouping>;
          analysisContext: AnalysisContext;
      }
    | undefined
> {
    // Return early if no applicable scopes
    if (params.scopes.length === 0) {
        return undefined;
    }

    // Build analysis context
    const analysisContext: AnalysisContext = {
        userId: params.userId,
        organizationId: params.organizationId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        userIanaZone: params.userIanaZone,
        scopes: params.scopes,
        timeline: params.timeline,
        runtime: params.runtime,
        deltaPeriods: params.deltaPeriods,
        dataSourceFilters: params.dataSourceFilters,
        timelineMetadata: params.timelineMetadata,
        cacheSessionKey: params.cacheSessionKey,
        insightParameters: params.insightParameters,
        isDeltaAnalysis: params.isDeltaAnalysis,
    };

    // Get grouping and filters from config (can be dynamic based on context)
    const grouping = config.getGrouping(analysisContext);
    const insightFilters = config.getFilters(analysisContext);

    // Merge data source filters with insight's own filters
    const filters = mergeFilters(insightFilters, params.dataSourceFilters);

    const principal = { userId: params.userId, organizationId: params.organizationId };

    // Get grouped graphs for this period
    const primaryGraphs = await getGroupedActivityItemGraphs(
        params.runtime,
        principal,
        params.timeline, // Full timeline, filtering handled by config's filters
        params.scopes,
        params.fromDate,
        params.userIanaZone,
        new Map(), // actorColorMap
        filters,
        grouping.primary,
        false, // secondaryGroupByItemType
    );

    if (!primaryGraphs) {
        return undefined;
    }

    // Validate no grouping by item type
    if (primaryGraphs.groupedByItemType) {
        params.runtime.log.error(`insight-executor: grouping by item type not supported (config ${config.id})`);
        return undefined;
    }

    // For each primary graph, get sub-graphs if secondary grouping is defined
    const graphs = await Promise.all(
        primaryGraphs.graphs.map(async (mainGraph, gIndex) => {
            // No secondary grouping, return main graph only
            if (!grouping.secondary) {
                return {
                    mainGraph,
                    subGraphs: [],
                    index: gIndex,
                };
            }

            // Get sub-graphs for this main graph
            const subGraphs = await getGroupedGraphs(
                params.runtime,
                principal,
                mainGraph.graph,
                params.timeline,
                grouping.secondary,
                params.scopes,
            );
            return {
                mainGraph,
                subGraphs,
                index: gIndex,
            };
        }),
    );

    // Sort graphs by index to ensure consistent order
    graphs.sort((a, b) => a.index - b.index);

    // Run the config's analyze function
    const result = await config.analyze(graphs, analysisContext);

    return {
        result,
        graphs,
        grouping,
        analysisContext,
    };
}

/**
 * Calculate changes between two distribution records
 */
function calculateDistributionChanges(
    current: Record<string, number>,
    previous: Record<string, number>,
): { absolute: Record<string, number>; percentage: Record<string, number> } {
    const absolute: Record<string, number> = {};
    const percentage: Record<string, number> = {};

    const allKeys = new Set([...Object.keys(current), ...Object.keys(previous)]);

    allKeys.forEach((key) => {
        const currentVal = current[key] || 0;
        const previousVal = previous[key] || 0;

        absolute[key] = currentVal - previousVal;

        if (previousVal === 0) {
            percentage[key] = currentVal > 0 ? 100 : 0;
        } else {
            percentage[key] = ((currentVal - previousVal) / previousVal) * 100;
        }
    });

    return { absolute, percentage };
}

/**
 * Execute an insight for a config and scopes, handling timeline retrieval
 * and validation
 */
export async function executeInsightForConfigAndScopes(
    config: InsightConfig,
    params: Omit<
        AnalysisParams,
        'timeline' | 'timelineId' | 'fromDate' | 'toDate' | 'userIanaZone' | 'insightParameters'
    > & {
        fromDate: TimelineCreateDate;
        toDate?: TimelineCreateDate;
        dataSourceFilters?: ContextItemsFiltersWithOperator;
        /** Raw user-configured parameter values (will be resolved against config declarations) */
        insightParameters?: Record<string, unknown>;
    },
) {
    const runtime = params.runtime;
    let timelineData: { timeline: Timeline; timelineId: string } | undefined;
    let validatedFromDate: Date;
    let timelineMetadata: Record<string, unknown> | undefined;

    // Filter scopes based on config applicability
    const filteredScopes = params.scopes.filter((scope) => {
        const connectorMatches =
            !config.applicability.connectors || config.applicability.connectors.includes(scope.connector);
        const hierarchyMatches =
            !config.applicability.hierarchyTypes || config.applicability.hierarchyTypes.includes(scope.hierarchyType);
        return connectorMatches && hierarchyMatches;
    });

    if (filteredScopes.length === 0) {
        // No applicable scopes after filtering, return undefined to indicate no data
        return undefined;
    }

    // Resolve insight parameters (merge user values with defaults from declarations)
    const resolvedInsightParameters = resolveInsightParameters(config.parameters, params.insightParameters);

    // Check if config provides custom timeline fetching
    if (config.fetchTimeline) {
        const customResult = await config.fetchTimeline({
            userId: params.userId,
            organizationId: params.organizationId,
            scopes: filteredScopes,
            fromDate: params.fromDate,
            toDate: params.toDate,
            userIanaZone: params.fromDate.userIanaZone,
            cacheSessionKey: params.cacheSessionKey,
            runtime,
            insightParameters: resolvedInsightParameters,
        });

        if (!customResult) {
            return undefined;
        }

        timelineData = {
            timeline: customResult.timeline,
            timelineId: customResult.timelineId,
        };
        validatedFromDate = customResult.fromDate;
        timelineMetadata = customResult.metadata;
    } else {
        // Default behavior - use the engine's cached timeline builder
        const ttlMin = runtime.config.timelineCacheTtlMinutes;

        // Generate or fetch cached timeline
        const cachedTimeline = await getCachedTimelineFromScopes(
            runtime,
            { userId: params.userId, organizationId: params.organizationId },
            filteredScopes,
            params.fromDate,
            params.cacheSessionKey,
            ttlMin,
            !config.allowEmptyTimeline, // return null on no changes
            params.toDate,
        );

        if (!cachedTimeline) {
            return undefined;
        }

        timelineData = {
            timeline: cachedTimeline.cached.timeline,
            timelineId: cachedTimeline.timelineId,
        };
        validatedFromDate = getAndValidateTimelineDate(params.fromDate);
    }

    return executeInsight(config, {
        ...params,
        scopes: filteredScopes,
        timeline: timelineData.timeline,
        timelineId: timelineData.timelineId,
        userIanaZone: params.fromDate.userIanaZone,
        fromDate: validatedFromDate,
        toDate: params.toDate ? getAndValidateTimelineDate(params.toDate) : undefined,
        dataSourceFilters: params.dataSourceFilters,
        timelineMetadata,
        insightParameters: resolvedInsightParameters,
    });
}
