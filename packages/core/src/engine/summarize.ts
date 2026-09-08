import {
    ChangesSummaryField,
    CommentsSummarizationLength,
    ItemGroup,
    SummarizationSettings,
    SummarizationSettingsFormat,
} from '../domain/api-types.js';
import { ChangeType } from '../domain/filters.js';
import { Timeline } from '../domain/timeline.js';
import { PromptExample } from '../llm/messages.js';
import { ModelSelection } from '../llm/models.js';
import { PromptProcessor } from '../llm/prompt-processor.js';
import { Principal } from '../ports/access-control.js';
import { EngineRuntime } from '../ports/runtime.js';
import { ActivityItemGraph } from './activity-graph.js';
import { getCustomPromptPrompt } from './custom-prompt.js';
import { GroupedGraphs } from './grouped-graphs.js';
import {
    BulletPoint,
    getCommentDiscussionSummaryPromptV4,
    getDefaultPromptV4,
    getReleaseNotesPromptV4,
} from './prompts.js';
import { applyCombinedTextTokenBudgeting } from './token-budgeting.js';
import { renderItemLinks } from './url-processor.js';

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Optional prompt guidance a summary preset can attach — replaces the
 * hardcoded per-preset branching of the original implementation.
 */
export interface SummaryPromptGuidance {
    /** Few-shot examples that override the default highlights examples. */
    fewShotExamples?: PromptExample[];
    /** Domain-specific data-handling instructions injected into the prompt. */
    focusPrompt?: BulletPoint;
    /** Bullet point range override. */
    bulletPoints?: { min: number; max: number };
}

/** Replaces item-link tokens in generated text with real links (or strips them). */
function resolveItemLinks(runtime: EngineRuntime, generated: string): string {
    return renderItemLinks(generated, runtime.config.itemLink);
}

async function getDocPlainTextMap(
    runtime: EngineRuntime,
    principal: Principal,
    timeline: Timeline,
    summarySettings: SummarizationSettings,
): Promise<Map<string, string>> {
    const docPlainTextMap: Map<string, string> = new Map();
    const docDiffIds = new Set(Object.keys(timeline.docDiffs));
    if (summarySettings.changesSummaryFields.includes(ChangesSummaryField.DocumentContent) && runtime.repos.docDiffs) {
        const access = await runtime.accessControl.getAccessFilter(principal);
        const plainTexts = await runtime.repos.docDiffs.getPlainTextForItems({
            access,
            itemUuids: Array.from(docDiffIds).slice(0, 100),
            limit: 100,
        });
        plainTexts.forEach((text, itemUuid) => {
            docPlainTextMap.set(itemUuid, text);
        });
    }
    return docPlainTextMap;
}

function makePromptProcessor(
    runtime: EngineRuntime,
    principal: Principal,
    id: string,
    model: ModelSelection,
    getPrompt: (body: string) => ReturnType<typeof getReleaseNotesPromptV4>,
): PromptProcessor {
    if (!runtime.llm) {
        throw new Error('Summarization requires an LlmService to be configured on the engine');
    }
    return new PromptProcessor(
        id,
        [
            {
                getPrompt,
                shouldContinueToNext: async () => false,
            },
        ],
        model,
        runtime.llm,
        {
            cache: runtime.cache,
            cacheKeyPrefix: runtime.config.cacheKeyPrefixes.prompt,
            cacheTtlMs: runtime.config.promptCacheTtlMs,
            logProps: {
                context: { userId: principal.userId, logger: runtime.log },
                logLastStats: async () => undefined,
                logLastResults: async () => undefined,
            },
        },
    );
}

/**
 * Summarizes the top-scored items of an activity graph with the LLM.
 * Returns markdown, or undefined when summarization is disabled/there is nothing to summarize.
 */
export async function summarizeTimelineItems(
    runtime: EngineRuntime,
    principal: Principal,
    graph: ActivityItemGraph,
    timeline: Timeline,
    groupType: ItemGroup['type'],
    summarySettings: SummarizationSettings,
    guidance: SummaryPromptGuidance | undefined,
    ianaZone: string,
): Promise<string | undefined> {
    if (!summarySettings.changesSummaryEnabled) {
        return undefined;
    }

    const graphCopy = graph.copy((n) => {
        // Edge case for chat-channel sources (e.g. Slack):
        // If all changes are comments and the connector declares comment-only items as
        // discussion-only, then we don't want to summarize this because it will be
        // summarized in the discussions section.
        const changes = timeline.changes.find((c) => c.itemUuid === n.id)?.changes || [];
        const commentChangeCount = changes.filter((c) => c.changeType === ChangeType.Comment).length;
        const traits = runtime.connectorTraits.get(n.connector);
        if (commentChangeCount === changes.length && traits.commentOnlyItemsAreDiscussions) {
            return false;
        }
        return true;
    });
    if (graphCopy.getAllActivityItemsUnsorted().length === 0) {
        return undefined;
    }

    const docPlainTextMap = await getDocPlainTextMap(runtime, principal, timeline, summarySettings);

    const prunedRes = graphCopy.pruneTopNByPercentage(
        summarySettings.changesLevelOfDetail,
        runtime.config.limits.summaryGraphMaxItems,
    );
    const truncationConfig = runtime.config.truncation;
    const promptBody = graphCopy.getItemsAsTextForPrompt(
        timeline,
        docPlainTextMap,
        groupType,
        summarySettings.changesAlsoGroupByItemType,
        ianaZone,
        {
            uuid: true,
            docDiffs: true,
            children: true,
            changelog: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Changes),
            comments: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Comments),
            description: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Description),
            documentContent: summarySettings.changesSummaryFields.includes(ChangesSummaryField.DocumentContent),
            propertyNames: summarySettings.propertyNamesToSummarize || [],
            changelogTimestamps: summarySettings.changesIncludeTimeStamps || false,
        },
        { title: '#', section: '##' },
        truncationConfig,
    );

    const model = runtime.config.models.summaryHighlights ?? runtime.config.models.default;
    const processor = makePromptProcessor(runtime, principal, 'timeline_items', model, (body) => {
        if (summarySettings.changesSummaryFormat === SummarizationSettingsFormat.Highlights) {
            return getDefaultPromptV4(body, {
                numHighlightedItems: prunedRes.topN,
                includesFullDocument: summarySettings.changesSummaryFields.includes(
                    ChangesSummaryField.DocumentContent,
                ),
                dataInstructions: guidance?.focusPrompt,
                examplesOverride: guidance?.fewShotExamples,
                bulletPoints: guidance?.bulletPoints,
            });
        }
        return getReleaseNotesPromptV4(body);
    });

    let generated = '';
    try {
        generated = await processor.process(promptBody);
    } catch (e) {
        runtime.log.error(`Error summarizing timeline items: ${getExceptionMessage(e)}`);
        throw e;
    }

    // Linkify the item uuids
    return resolveItemLinks(runtime, generated);
}

/**
 * Renders a graph into the full text representation used as LLM context
 * (all properties included, no summarization).
 */
export async function getGraphAsText(
    runtime: EngineRuntime,
    principal: Principal,
    graph: ActivityItemGraph,
    timeline: Timeline,
    groupType: ItemGroup['type'],
    summarySettings: SummarizationSettings,
    ianaZone: string,
): Promise<string | undefined> {
    const graphCopy = graph.copy();
    if (graphCopy.getAllActivityItemsUnsorted().length === 0) {
        return undefined;
    }

    const docPlainTextMap = await getDocPlainTextMap(runtime, principal, timeline, summarySettings);

    // Limit the number of items to summarize so we dont overwhelm the LLM
    graphCopy.pruneByMaxNumItems(runtime.config.limits.llmContextMaxItems);
    const truncationConfig = runtime.config.truncation;
    const promptBody = graphCopy.getItemsAsTextForPrompt(
        timeline,
        docPlainTextMap,
        groupType,
        summarySettings.changesAlsoGroupByItemType,
        ianaZone,
        {
            uuid: true,
            docDiffs: true,
            children: true,
            changelog: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Changes),
            comments: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Comments),
            description: summarySettings.changesSummaryFields.includes(ChangesSummaryField.Description),
            documentContent: summarySettings.changesSummaryFields.includes(ChangesSummaryField.DocumentContent),
            overridePropertiesAndIncludeDefaultList: true, // include all common properties so downstream LLMs have enough context
            propertyNames: summarySettings.propertyNamesToSummarize || [],
            changelogTimestamps: summarySettings.changesIncludeTimeStamps || false,
        },
        { title: '#', section: '##' },
        truncationConfig,
    );
    return promptBody;
}

/**
 * Generates a combined text from a set of grouped graphs.
 *
 * This function processes each graph in the provided `groupedGraphs`, generating a text for each
 * using {@link getGraphAsText} with fixed summarization settings. The texts are then combined
 * into a single string, optionally prefixed with a section name if `blockFilterName` is provided.
 */
export async function getCombinedTextFromGraphs(
    runtime: EngineRuntime,
    principal: Principal,
    blockFilterName: string | undefined,
    timeline: Timeline,
    groupType: ItemGroup['type'],
    userIanaZone: string,
    groupedGraphs: Pick<GroupedGraphs, 'graphs' | 'groupedByItemType'>,
    summarizationProps: { propertyNamesToSummarize?: string[] },
    tokenBudget: number | undefined,
): Promise<string | undefined> {
    if (!groupedGraphs || groupedGraphs.graphs.length === 0) {
        return undefined;
    }

    if (groupedGraphs.groupedByItemType) {
        throw new Error(`Grouping by item type is not supported in combined summaries`);
    }

    const texts = await Promise.all(
        groupedGraphs.graphs.map(async (g, gi) => {
            let text = await getGraphAsText(
                runtime,
                principal,
                g.graph,
                timeline,
                groupType,
                {
                    changesAlsoGroupByItemType: false,
                    changesLevelOfDetail: 1,
                    changesSummaryEnabled: true,
                    changesSummaryFields: [
                        ChangesSummaryField.Changes,
                        ChangesSummaryField.Description,
                        ChangesSummaryField.Comments,
                    ],
                    changesIncludeTimeStamps: true,
                    changesSummaryFormat: SummarizationSettingsFormat.Highlights,
                    commentsSummaryEnabled: true,
                    commentsSummaryLength: CommentsSummarizationLength.Short,
                    propertyNamesToSummarize: summarizationProps.propertyNamesToSummarize || [],
                    hidePills: true,
                },
                userIanaZone,
            );

            if (g.name && text) {
                text = `Grouped by ${groupType}: **${g.name}**\n\n${text}`;
            }

            return {
                text,
                index: gi,
            };
        }),
    );

    texts.sort((a, b) => a.index - b.index);
    const rawTexts = texts.map((t) => t.text).filter((text): text is string => text != null && text.trim().length > 0);

    if (rawTexts.length === 0) {
        return undefined;
    }

    let combined: string;
    if (tokenBudget) {
        combined = applyCombinedTextTokenBudgeting(rawTexts, tokenBudget);
    } else {
        combined = rawTexts.join('\n\n---\n\n');
    }

    if (blockFilterName) {
        return `**SECTION NAME:${blockFilterName}**\n\n${combined}`;
    }

    return combined;
}

/**
 * Generates a summary of timeline items using a custom (user-supplied) prompt.
 */
export async function summarizeUsingCustomPrompt(
    runtime: EngineRuntime,
    principal: Principal,
    customPrompt: string,
    blockFilterName: string | undefined,
    timeline: Timeline,
    groupType: ItemGroup['type'],
    userIanaZone: string,
    groupedGraphs: GroupedGraphs,
): Promise<string | undefined> {
    if (!groupedGraphs || groupedGraphs.graphs.length === 0) {
        return undefined;
    }

    if (groupedGraphs.groupedByItemType) {
        throw new Error(`Grouping by item type is not supported in combined summaries`);
    }

    const tokenBudget = runtime.config.blockTokenBudget;
    const promptBody = await getCombinedTextFromGraphs(
        runtime,
        principal,
        blockFilterName,
        timeline,
        groupType,
        userIanaZone,
        groupedGraphs,
        {},
        tokenBudget?.totalBudget,
    );
    if (!promptBody) {
        return undefined;
    }

    const model = runtime.config.models.customFormatting ?? runtime.config.models.default;
    const processor = makePromptProcessor(runtime, principal, 'timeline_items', model, (body) =>
        getCustomPromptPrompt(customPrompt, userIanaZone, body),
    );

    let generated = '';
    try {
        generated = await processor.process(promptBody);
    } catch (e) {
        runtime.log.error(`Error summarizing timeline items: ${getExceptionMessage(e)}`);
        throw e;
    }

    return resolveItemLinks(runtime, generated);
}

export interface ItemCommentsToSummarize {
    title: string;
    comments: { commentText: string; author: string }[];
}

/** Summarizes recent discussions (comments/chat) into bullet points. */
export async function summarizeComments(
    runtime: EngineRuntime,
    principal: Principal,
    settings: SummarizationSettings,
    items: ItemCommentsToSummarize[],
): Promise<string | undefined> {
    if (!settings.commentsSummaryEnabled) {
        return undefined;
    }

    if (items.length === 0) {
        return undefined;
    }
    const text = items
        .map((item) => {
            const commentsText = item.comments.map((c) => `${c.author}: ${c.commentText}`).join('\n\n');
            return `# Title: ${item.title}\n${commentsText}`;
        })
        .join('\n\n');

    const model = runtime.config.models.summaryComments ?? runtime.config.models.default;
    const processor = makePromptProcessor(runtime, principal, 'comments', model, (body) =>
        getCommentDiscussionSummaryPromptV4(
            body,
            settings.commentsSummaryLength === CommentsSummarizationLength.Short ? 3 : 10,
        ),
    );
    const generated = await processor.process(text);
    return generated;
}
