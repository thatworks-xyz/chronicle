import { DateTime } from 'luxon';
import showdown from 'showdown';
import { GroupSettings, SummarizationSettings, TimelineCreateDate, TimelineDateType } from './domain/api-types.js';
import { ConnectorTraitsRegistry } from './domain/connector.js';
import { Scope } from './domain/context.js';
import { ChronicleError, ChronicleErrorCode } from './domain/errors.js';
import { ContextItemsFiltersWithOperator } from './domain/filters.js';
import { getActivityFromTimeline } from './engine/activity.js';
import { executeInsightForConfigAndScopes } from './engine/analytics/executor.js';
import { InsightRegistry } from './engine/analytics/registry.js';
import { InsightLlmContextPermissions } from './engine/analytics/types.js';
import { VisualizationResult } from './engine/analytics/visualization.js';
import { SummaryPromptGuidance } from './engine/summarize.js';
import {
    CachedTimeline,
    getCachedTimeline,
    getTimelineFromScopesAndRefreshIfRequired,
} from './engine/timeline-builder.js';
import { ConnectorSource } from './ingestion/connector.js';
import { IngestionRunner, IngestOptions, IngestReport } from './ingestion/runner.js';
import { LlmService } from './llm/client.js';
import { AccessControl, permissiveAccessControl, Principal } from './ports/access-control.js';
import { InMemoryCache, KeyValueCache } from './ports/cache.js';
import { EngineConfig, resolveEngineConfig } from './ports/config.js';
import { EngineHooks } from './ports/hooks.js';
import { consoleLogger, Logger } from './ports/logger.js';
import {
    ChangeEventRepository,
    DocDiffRepository,
    MetricSnapshotRepository,
    WatermarkStore,
    WorkItemRepository,
} from './ports/repositories.js';
import { EngineRuntime } from './ports/runtime.js';

/**
 * A summary preset: everything that defines one kind of summary as data —
 * filters, grouping, summarization settings, and optional prompt guidance.
 * Connector packages ship presets; consumers can define their own.
 */
export interface SummaryPreset {
    /** Stable preset id (used by consumers to select a preset). */
    id: string;
    /** Builds the display title; itemCount is null when unknown. */
    title: (itemCount: number | null) => string;
    /**
     * The readable item type this preset counts (matched against
     * readableConnectorObjectType / idFromConnectorObjectType).
     */
    itemType: string;
    filters: ContextItemsFiltersWithOperator;
    grouping: GroupSettings | undefined;
    alsoGroupByItemType: boolean;
    summarize: SummarizationSettings;
    /** Optional prompt guidance (few-shot examples, focus prompts, bullet range). */
    guidance?: SummaryPromptGuidance;
}

export enum SummaryFormat {
    Markdown = 'markdown',
    Html = 'html',
}

export interface SummaryResult {
    /** The generated summary (markdown or HTML per `format`), or null when there was nothing to summarize. */
    summary: string | null;
    format: SummaryFormat;
    presetId: string;
}

export interface CreateContextInput {
    scopes: Scope[];
    /** Start of the activity window (ISO date/datetime). */
    fromDateIso: string;
    /** Optional end of the window. */
    toDateIso?: string;
    /** IANA time zone for date resolution. */
    timeZone: string;
    /**
     * Optional session key for cache identity. When omitted, a fixed key plus
     * 30-minute date quantization make repeated calls share the same context.
     */
    cacheSessionKey?: string;
}

export interface EngineDeps {
    items: WorkItemRepository;
    events: ChangeEventRepository;
    snapshots: MetricSnapshotRepository;
    docDiffs?: DocDiffRepository;
    watermarks?: WatermarkStore;
    cache?: KeyValueCache;
    llm?: LlmService;
    config?: Partial<EngineConfig>;
    accessControl?: AccessControl;
    logger?: Logger;
    hooks?: EngineHooks;
}

/**
 * Quantize a DateTime to 30 minute intervals (e.g., 9:00, 9:30, 10:00, etc.)
 * This ensures we can reuse the same timeline for multiple requests within the same 30 minute window.
 * Seconds and milliseconds are set to 0.
 */
export function quantizeDateTo30MinuteInterval(dt: DateTime): DateTime {
    return dt.set({
        minute: Math.floor(dt.minute / 30) * 30,
        second: 0,
        millisecond: 0,
    });
}

// A fixed session cache key used when the caller does not manage sessions.
// Combined with date quantization it yields a stable context id per window.
const DEFAULT_SESSION_CACHE_KEY = '302d949c-3a59-442b-b4a8-a93dffcddfde';

/**
 * The Chronicle engine: builds timelines ("contexts") over stored work items and
 * change events, generates LLM summaries, and runs insights — all through
 * pluggable storage, cache, LLM, and access-control ports.
 */
export class ChronicleEngine {
    readonly insights = new InsightRegistry();
    readonly connectorTraits = new ConnectorTraitsRegistry();
    private readonly _runtime: EngineRuntime;
    private readonly _ingestion: IngestionRunner;

    constructor(deps: EngineDeps) {
        this._runtime = {
            log: deps.logger ?? consoleLogger,
            cache: deps.cache ?? new InMemoryCache(),
            config: resolveEngineConfig(deps.config),
            llm: deps.llm,
            repos: {
                items: deps.items,
                events: deps.events,
                snapshots: deps.snapshots,
                docDiffs: deps.docDiffs,
                watermarks: deps.watermarks,
            },
            connectorTraits: this.connectorTraits,
            accessControl: deps.accessControl ?? permissiveAccessControl,
            hooks: deps.hooks ?? {},
        };
        this._ingestion = new IngestionRunner(this._runtime);
    }

    /** The resolved runtime — for advanced/low-level usage of engine functions. */
    get runtime(): EngineRuntime {
        return this._runtime;
    }

    // ------------------------------------------------------------------
    // Contexts (timelines)
    // ------------------------------------------------------------------

    /**
     * Creates (or reuses) a context — a timeline over the given scopes and window.
     * The returned id addresses the context in generateSummary.
     */
    async createContext(
        principal: Principal,
        input: CreateContextInput,
    ): Promise<{ id: string; createdDateIso: string }> {
        // Validate dates
        const fromDatetime = DateTime.fromISO(input.fromDateIso);
        if (!fromDatetime.isValid) {
            throw new ChronicleError(`${input.fromDateIso} is not a valid ISO date`, ChronicleErrorCode.InvalidInput);
        }

        if (input.toDateIso) {
            const toDatetime = DateTime.fromISO(input.toDateIso);
            if (!toDatetime.isValid) {
                throw new ChronicleError(`${input.toDateIso} is not a valid ISO date`, ChronicleErrorCode.InvalidInput);
            }
            if (!(toDatetime > fromDatetime)) {
                throw new ChronicleError(`toDateIso must be greater than fromDateIso`, ChronicleErrorCode.InvalidInput);
            }
        }

        // Validate time zone
        if (!DateTime.now().setZone(input.timeZone).isValid) {
            throw new ChronicleError(`Invalid time zone: ${input.timeZone}`, ChronicleErrorCode.InvalidInput);
        }

        // Quantize ISO date to 30 minute intervals so repeated requests share a context
        const quantizedFromDate = quantizeDateTo30MinuteInterval(fromDatetime);
        if (!quantizedFromDate.isValid) {
            throw new ChronicleError(`Invalid date: ${quantizedFromDate.toISO()}`, ChronicleErrorCode.InvalidInput);
        }

        const fromDate: TimelineCreateDate = {
            type: TimelineDateType.Iso,
            isoDate: quantizedFromDate.toISO() ?? undefined,
            userIanaZone: input.timeZone,
        };

        const toDate: TimelineCreateDate | undefined = input.toDateIso
            ? {
                  type: TimelineDateType.Iso,
                  isoDate: input.toDateIso,
                  userIanaZone: input.timeZone,
              }
            : undefined;

        const timeline = await getTimelineFromScopesAndRefreshIfRequired(
            this._runtime,
            principal,
            input.scopes,
            fromDate,
            input.cacheSessionKey ?? DEFAULT_SESSION_CACHE_KEY,
            this._runtime.config.contextTtlMinutes,
            toDate,
        );

        return {
            id: timeline.timelineId,
            createdDateIso: timeline.creationDateIso,
        };
    }

    /** Fetches a previously created context (throws ChronicleError when expired). */
    async getContext(principal: Principal, contextId: string): Promise<CachedTimeline> {
        return getCachedTimeline(this._runtime, principal.userId, contextId);
    }

    // ------------------------------------------------------------------
    // Summaries
    // ------------------------------------------------------------------

    private static getItemCountForType(idsInSummary: string[], timeline: CachedTimeline, itemType: string): number {
        const items = new Set<string>();
        idsInSummary.forEach((id) => {
            if (
                timeline.timeline.items[id]?.readableConnectorObjectType === itemType ||
                timeline.timeline.items[id]?.idFromConnectorObjectType === itemType
            ) {
                items.add(id);
            }
        });
        return items.size;
    }

    /**
     * Generates the summary for a preset over a context.
     */
    async generateSummary(
        principal: Principal,
        context: string | CachedTimeline,
        preset: SummaryPreset,
        format: SummaryFormat = SummaryFormat.Markdown,
    ): Promise<SummaryResult> {
        const timeline = typeof context === 'string' ? await this.getContext(principal, context) : context;

        const activity = await getActivityFromTimeline(
            this._runtime,
            principal,
            timeline,
            preset.filters,
            preset.grouping,
            preset.alsoGroupByItemType,
            undefined,
            {
                summarize: true,
                settings: preset.summarize,
            },
            false,
            preset.guidance,
        );

        const summary = activity.groups[0]?.subgroups[0]?.summary;
        const summarySections: string[] = [];

        const summaryItemIds = new Set<string>();
        summary?.summary.sections.forEach((s) => {
            s.forEach((section) => {
                // Collect item UUIDs from the section
                // so they can be counted later
                section.pills?.forEach((pill) => {
                    pill.itemUuids.forEach((itemUuid) => {
                        summaryItemIds.add(itemUuid);
                    });
                });

                const trimmed = section.markdown.trim();
                if (trimmed.length === 0) {
                    return;
                }
                summarySections.push(section.markdown);
            });
        });

        // Generate the title for the summary
        const summaryTitle = preset.title(
            // Get the count of relevant items from the timeline
            ChronicleEngine.getItemCountForType(Array.from(summaryItemIds), timeline, preset.itemType),
        );
        let responseText: string | null = null;
        if (summarySections.length > 0) {
            const summaryWithTitleMarkdown = `## ${summaryTitle}\n\n` + summarySections.join('\n\n');
            responseText = summaryWithTitleMarkdown;
            if (format === SummaryFormat.Html) {
                const converter = new showdown.Converter({ tables: true });
                responseText = converter.makeHtml(summaryWithTitleMarkdown);
            }
        }

        return { summary: responseText, format, presetId: preset.id };
    }

    // ------------------------------------------------------------------
    // Insights (analytics)
    // ------------------------------------------------------------------

    /**
     * Runs an insight over scopes for a date window.
     * Returns undefined when no data / no applicable scopes.
     */
    async runInsight(
        principal: Principal,
        insightId: string,
        scopes: Scope[],
        window: { fromDate: TimelineCreateDate; toDate?: TimelineCreateDate },
        opts?: {
            /** Delta comparison periods (previous windows). */
            deltaPeriods?: { fromDate: Date; toDate: Date }[];
            /** Insight-specific parameter overrides. */
            insightParameters?: Record<string, unknown>;
            /** Cache the results as LLM context under these permissions. */
            cache?: { permissions: InsightLlmContextPermissions; ttl?: number };
            /** Session key for timeline cache identity (defaults to a random key). */
            cacheSessionKey?: string;
            dataSourceFilters?: ContextItemsFiltersWithOperator;
        },
    ): Promise<{ analysisId: string; visualization: VisualizationResult } | undefined> {
        const config = this.insights.get(insightId);
        if (!config) {
            throw new ChronicleError(`Insight ${insightId} not found`, ChronicleErrorCode.NotFound);
        }

        return executeInsightForConfigAndScopes(config, {
            userId: principal.userId,
            organizationId: principal.organizationId ?? '',
            runtime: this._runtime,
            cacheSessionKey: opts?.cacheSessionKey ?? `${Date.now()}-${Math.random()}`,
            scopes,
            fromDate: window.fromDate,
            toDate: window.toDate,
            deltaPeriods: opts?.deltaPeriods,
            insightParameters: opts?.insightParameters,
            cache: opts?.cache,
            dataSourceFilters: opts?.dataSourceFilters,
        });
    }

    // ------------------------------------------------------------------
    // Ingestion
    // ------------------------------------------------------------------

    /** Runs one incremental ingestion pass for a connector source. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ingest<C extends ConnectorSource<any, any, any>>(connector: C, opts: IngestOptions): Promise<IngestReport> {
        return this._ingestion.ingest(connector, opts);
    }
}
