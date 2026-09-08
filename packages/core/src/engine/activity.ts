import {
    GroupSettings,
    ItemGroupPredefinedType,
    ItemSort,
    SummarizationSettings,
    SummarizationSettingsFormat,
    SummarySection,
    SummarySectionPill,
    TimelineActivity,
    TimelineActivitySummarization,
} from '../domain/api-types.js';
import { ContextItemsFiltersWithOperator } from '../domain/filters.js';
import { Timeline } from '../domain/timeline.js';
import { PromptProcessor } from '../llm/prompt-processor.js';
import { Principal } from '../ports/access-control.js';
import { EngineRuntime } from '../ports/runtime.js';
import { ActivityItemGraph } from './activity-graph.js';
import { getActivityItemCommentsFromChangelog } from './activity-search-helpers.js';
import { getAndValidateTimelineDate } from './conversions.js';
import {
    getGroupedActivityItemGraphs,
    getTimelineActivityFromGroupedGraphs,
    groupGraphByConnectorTypeAndStatus,
} from './grouped-graphs.js';
import { getCustomFormattingPrompt } from './prompts.js';
import {
    ItemCommentsToSummarize,
    summarizeComments,
    summarizeTimelineItems,
    summarizeUsingCustomPrompt,
    SummaryPromptGuidance,
} from './summarize.js';
import { CachedTimeline, getCachedTimeline } from './timeline-builder.js';

/**
 * Applies user-provided formatting instructions to generated text with an extra LLM pass.
 */
export async function applyCustomFormattingIfAvailable(
    runtime: EngineRuntime,
    principal: Principal,
    customFormattingPrompt: string | undefined | null,
    text: string,
): Promise<string> {
    let generated = text.trim();
    if (runtime.llm && customFormattingPrompt && customFormattingPrompt.trim().length > 0 && generated.length > 0) {
        // limit the custom formatting prompt to 500 characters
        const prompt = customFormattingPrompt.substring(0, 500);
        const model = runtime.config.models.customFormatting ?? runtime.config.models.default;
        // Additional processing for custom formatting
        const customFormattingProcessor = new PromptProcessor(
            'custom_formatting',
            [
                {
                    getPrompt: (b) => getCustomFormattingPrompt(b),
                    shouldContinueToNext: async () => false,
                },
            ],
            model,
            runtime.llm,
            {
                cache: runtime.cache,
                logProps: {
                    context: { userId: principal.userId, logger: runtime.log },
                    logLastStats: async () => undefined,
                    logLastResults: async () => undefined,
                },
            },
        );
        generated = await customFormattingProcessor.process(
            `<text>
${generated}
</text>
<instruction>
For the above text in the <text> tags:
${prompt}

Additional instructions:
- Always use markdown and retain any existing markdown hyperlinks if available.
- Never provide an introductory statement repeating any instructions.
- Do not provide concluding statements.
</instruction>`,
        );
    }
    return generated;
}

function makeSummarySection(
    runtime: EngineRuntime,
    summarySettings: SummarizationSettings,
    summarizedComments: string | undefined,
    summarizedHighlightsMarkdown: string | undefined,
    pills: SummarySectionPill[],
    timeline: Timeline,
    showHeadings: boolean,
): SummarySection | undefined {
    const sections: string[] = [];
    const changesSectionTitle =
        summarySettings.changesSummaryFormat === SummarizationSettingsFormat.DetailedList || !showHeadings
            ? ''
            : '**✨ Highlights:**\n';
    if (summarizedHighlightsMarkdown) {
        sections.push(`${changesSectionTitle}${summarizedHighlightsMarkdown}`);
    }

    if (summarizedComments) {
        const commentsSectionTitle = showHeadings ? '**💬 Discussions:**\n' : '';
        sections.push(`${commentsSectionTitle}${summarizedComments}`);
    }

    pills.forEach((p) => {
        // Chat-channel sources show a message count instead of an item count
        if (p.connector && runtime.connectorTraits.get(p.connector).commentOnlyItemsAreDiscussions) {
            let commentCount = 0;
            p.itemUuids.forEach((itemUuid) => {
                const changes = timeline.changes.find((c) => c.itemUuid === itemUuid);
                if (changes) {
                    const comments = getActivityItemCommentsFromChangelog(changes.changes, 'oldest_first');
                    commentCount += comments.length;
                }
            });
            p.value = `Messages: ${commentCount}`;
        }
    });

    const markdown = sections.join('\n\n');
    return {
        markdown,
        pills: summarySettings.hidePills ? [] : pills,
        newRowForPills: summarySettings.changesSummaryFormat === SummarizationSettingsFormat.DetailedList,
    };
}

export function getCommentsFromActivityGraph(graph: ActivityItemGraph, timeline: Timeline): ItemCommentsToSummarize[] {
    const res: ItemCommentsToSummarize[] = [];
    graph.getAllActivityItemsUnsorted().forEach((node) => {
        const item = timeline.items[node.id];
        const changes = timeline.changes.find((c) => c.itemUuid === node.id)?.changes;
        if (!item || !changes) {
            return;
        }
        const comments = getActivityItemCommentsFromChangelog(changes, 'oldest_first');
        res.push({
            title: item.title,
            comments: comments.map((c) => ({
                author: c.authorDisplayName,
                commentText: c.comment,
            })),
        });
    });

    return res.filter((t) => t.comments.length > 0);
}

/**
 * Retrieves (and optionally summarizes) activity data from a timeline.
 *
 * @param runtime - The engine runtime.
 * @param principal - The reader on whose behalf the activity is retrieved.
 * @param timeline - A timeline id or the cached timeline itself.
 * @param filters - Filters to apply to the context items. If no filters are provided, all updated items are included.
 * @param grouping - Settings for grouping the activity items.
 * @param alsoGroupByItemType - Whether to also group by item type.
 * @param sort - Sorting settings for the activity items.
 * @param summarize - Settings for summarizing the timeline activity.
 * @param showSummaryHeadings - Whether summary sections carry headings.
 * @param guidance - Optional prompt guidance (few-shot examples, focus prompts) — typically from a SummaryPreset.
 * @returns A promise that resolves to the timeline activity data, excluding the 'id' field.
 */
export async function getActivityFromTimeline(
    runtime: EngineRuntime,
    principal: Principal,
    timeline: string | CachedTimeline,
    filters: ContextItemsFiltersWithOperator,
    grouping: GroupSettings | undefined,
    alsoGroupByItemType: boolean,
    sort: ItemSort | undefined,
    summarize: TimelineActivitySummarization | undefined,
    showSummaryHeadings: boolean,
    guidance: SummaryPromptGuidance | undefined,
): Promise<Omit<TimelineActivity, 'id'>> {
    const cachedTimeline =
        typeof timeline === 'string' ? await getCachedTimeline(runtime, principal.userId, timeline) : timeline;
    const fromDate = getAndValidateTimelineDate(cachedTimeline.fromDate);

    const customFormattingPrompt = summarize?.settings.customFormattingPrompt || null;
    const hasCustomFormattingPrompt = customFormattingPrompt != null && customFormattingPrompt.trim().length > 0;
    // alsoGroupByItemType is only applicable if the custom formatting prompt is not set
    const alsoGroupByItemTypeOverride = alsoGroupByItemType && !hasCustomFormattingPrompt;

    const actorColorMap = new Map<string, string>();
    const groupedGraphs = await getGroupedActivityItemGraphs(
        runtime,
        principal,
        cachedTimeline.timeline,
        cachedTimeline.scopes,
        fromDate,
        cachedTimeline.fromDate.userIanaZone,
        actorColorMap,
        filters,
        grouping,
        alsoGroupByItemTypeOverride,
    );
    if (!groupedGraphs) {
        return {
            groups: [],
            items: [],
        };
    }

    let res = getTimelineActivityFromGroupedGraphs(groupedGraphs, grouping, sort);
    if (summarize && summarize.summarize) {
        const summarizationSettings = summarize.settings;

        // --
        // - Custom formatting prompt
        // --
        if (hasCustomFormattingPrompt) {
            if (groupedGraphs.groupedByItemType) {
                // should not happen because of alsoGroupByItemTypeOverride check above
                throw new Error(`Custom formatting does not support grouping by item type`);
            }

            // Use the ungrouped graph for generating timeline items and the pills
            // This is because the custom formatting prompt combines information from all graphs
            const ungroupedGraph = groupedGraphs.ungroupedGraph;

            // Prepare result: use the ungrouped graph to get the timeline activity with no grouping
            res = getTimelineActivityFromGroupedGraphs(
                {
                    groupedByItemType: false,
                    graphs: [
                        {
                            graph: ungroupedGraph,
                        },
                    ],
                    ungroupedGraph,
                },
                {
                    groupType: ItemGroupPredefinedType.None,
                },
                sort,
            );

            // Generate the summary
            const summary = await summarizeUsingCustomPrompt(
                runtime,
                principal,
                customFormattingPrompt,
                undefined,
                cachedTimeline.timeline,
                grouping ? grouping.groupType : ItemGroupPredefinedType.None,
                cachedTimeline.fromDate.userIanaZone,
                groupedGraphs,
            );

            // Create the pills for the summary section
            const pills: SummarySectionPill[] = [];
            const groupedByItemType = groupGraphByConnectorTypeAndStatus(
                runtime,
                ungroupedGraph,
                cachedTimeline.timeline,
            );
            groupedByItemType.forEach((g) => {
                const pill: SummarySectionPill = {
                    itemUuids: g.graph.getAllActivityItemsSortedByScore().map((n) => n.id),
                    value: g.name,
                    color: g.metadata?.color,
                    connector: g.metadata?.connector,
                    iconUrl: g.metadata?.iconUrl,
                };
                pills.push(pill);
            });

            // Set the result
            if (summary && res.groups.length > 0) {
                res.groups[0].subgroups[0].summary = {
                    summary: {
                        sections: [
                            [
                                {
                                    markdown: summary,
                                    newRowForPills: true,
                                    pills,
                                },
                            ],
                        ],
                    },
                };
            }
        } else {
            // --
            // - Summarization without custom formatting prompt
            // --

            res = getTimelineActivityFromGroupedGraphs(groupedGraphs, grouping, sort);

            // -- If grouped by item type is true
            if (groupedGraphs.groupedByItemType) {
                await Promise.all(
                    groupedGraphs.graphs.map(async (groups, groupsIndex) => {
                        const sections: { section: SummarySection; index: number }[] = [];
                        await Promise.all(
                            groups.graphs.map(async (itemTypeGroup, itemGroupTypeIndex) => {
                                const comments = getCommentsFromActivityGraph(
                                    itemTypeGroup.graph,
                                    cachedTimeline.timeline,
                                );
                                // summarize the items
                                const [summarizedHighlights, summarizedComments] = await Promise.all([
                                    summarizeTimelineItems(
                                        runtime,
                                        principal,
                                        itemTypeGroup.graph,
                                        cachedTimeline.timeline,
                                        grouping ? grouping.groupType : ItemGroupPredefinedType.None,
                                        summarizationSettings,
                                        guidance,
                                        cachedTimeline.fromDate.userIanaZone,
                                    ),
                                    summarizeComments(runtime, principal, summarizationSettings, comments),
                                ]);
                                const section = makeSummarySection(
                                    runtime,
                                    summarizationSettings,
                                    summarizedComments,
                                    summarizedHighlights,
                                    [
                                        {
                                            itemUuids: itemTypeGroup.graph
                                                .getAllActivityItemsSortedByScore()
                                                .map((n) => n.id),
                                            value: itemTypeGroup.name,
                                            color: itemTypeGroup.metadata?.color,
                                            connector: itemTypeGroup.metadata?.connector,
                                            iconUrl: itemTypeGroup.metadata?.iconUrl,
                                        },
                                    ],
                                    cachedTimeline.timeline,
                                    showSummaryHeadings,
                                );
                                if (section) {
                                    sections.push({ section, index: itemGroupTypeIndex });
                                }
                            }),
                        );
                        if (sections.length > 0) {
                            res.groups[0].subgroups[groupsIndex].summary = {
                                summary: {
                                    sections: [sections.sort((a, b) => a.index - b.index).map((v) => v.section)],
                                },
                            };
                        }
                    }),
                );
            } else {
                // -- If grouped by item type is false

                await Promise.all(
                    groupedGraphs.graphs.map(async (group, groupIndex) => {
                        const comments = getCommentsFromActivityGraph(group.graph, cachedTimeline.timeline);
                        const [summarizedHighlights, summarizedComments] = await Promise.all([
                            summarizeTimelineItems(
                                runtime,
                                principal,
                                group.graph,
                                cachedTimeline.timeline,
                                grouping ? grouping.groupType : ItemGroupPredefinedType.None,
                                summarizationSettings,
                                guidance,
                                cachedTimeline.fromDate.userIanaZone,
                            ),
                            summarizeComments(runtime, principal, summarizationSettings, comments),
                        ]);

                        const pills: SummarySectionPill[] = [];
                        const groupedByItemType = groupGraphByConnectorTypeAndStatus(
                            runtime,
                            group.graph,
                            cachedTimeline.timeline,
                        );
                        groupedByItemType.forEach((g) => {
                            const pill: SummarySectionPill = {
                                itemUuids: g.graph.getAllActivityItemsSortedByScore().map((n) => n.id),
                                value: g.name,
                                color: g.metadata?.color,
                                connector: g.metadata?.connector,
                                iconUrl: g.metadata?.iconUrl,
                            };
                            pills.push(pill);
                        });
                        const section = makeSummarySection(
                            runtime,
                            summarizationSettings,
                            summarizedComments,
                            summarizedHighlights,
                            pills,
                            cachedTimeline.timeline,
                            showSummaryHeadings,
                        );
                        // res.groups can be an empty array if there is no activity
                        if (section && res.groups.length > 0) {
                            res.groups[0].subgroups[groupIndex].summary = {
                                summary: {
                                    sections: [[section]],
                                },
                            };
                        }
                    }),
                );
            }
        }
    }
    return res;
}
