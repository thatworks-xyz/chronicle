import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ChangesSummaryField,
    CommentsSummarizationLength,
    ItemGroupPredefinedType,
    SummarizationSettingsFormat,
    TimelineDateType,
} from './domain/api-types.js';
import { ActionTarget, ChangeEvent } from './domain/change-event.js';
import { Scope } from './domain/context.js';
import {
    ChangeActionType,
    ChangeType,
    ContextItemsFilterOperator,
    GraphFilterType,
    ItemType,
    UserMentionType,
} from './domain/filters.js';
import { getHash, MetricSnapshotTypes } from './domain/metric-snapshot.js';
import { WorkItem } from './domain/work-item.js';
import { ChronicleEngine, SummaryFormat, SummaryPreset } from './engine.js';
import { computeMetricFromSnapshots, sumValue } from './engine/analytics/snapshot-math.js';
import { InsightConfig } from './engine/analytics/types.js';
import { MetricCard } from './engine/analytics/visualization.js';
import { mapItemToTimelineItem } from './engine/changelog-summary.js';
import { getAndValidateTimelineDate } from './engine/conversions.js';
import { PROMPT_URL_TOKEN_PREFIX } from './engine/url-processor.js';
import { ConnectorSource } from './ingestion/connector.js';
import { ItemWithParentData, ItemWithParentDataChangelog } from './ingestion/mapper.js';
import { LlmClient } from './llm/client.js';
import { ChatCompletionRequest, flattenMessageText } from './llm/messages.js';
import { noopLogger } from './ports/logger.js';
import { createInMemoryRepositories } from './testing/in-memory-repos.js';

const CONNECTOR = 'testcrm';
const USER = 'user-1';
const ACCOUNT = 'acct-1';
const COMPANY_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TASK_UUID = 'aaaaaaaa-0000-0000-0000-000000000002';
const SNAPSHOT_CONFIG_UUID = 'bbbbbbbb-0000-0000-0000-000000000001';

function makeItem(overrides: Partial<WorkItem> & { uuid: string }): WorkItem {
    return {
        userId: USER,
        connector: CONNECTOR,
        idsFromConnector: {
            idFromConnector: overrides.uuid,
            connectorObjectType: 'task',
            connectorUserId: ACCOUNT,
        },
        title: `Item ${overrides.uuid}`,
        createdBy: [],
        createdDate: new Date('2026-01-01T00:00:00Z'),
        properties: [],
        parents: [],
        types: [],
        lastUpdate: new Date('2026-02-05T00:00:00Z'),
        ...overrides,
    };
}

function makeEvent(itemUuid: string, timestamp: Date, simple = 'Updated'): ChangeEvent {
    return {
        timestamp,
        itemUuid,
        userId: USER,
        connector: CONNECTOR,
        idsFromConnector: { idFromConnector: itemUuid, connectorObjectType: 'task', connectorUserId: ACCOUNT },
        action: {
            changeType: ChangeType.Item,
            actionType: ChangeActionType.Updated,
            userMentionType: UserMentionType.None,
            actionTarget: ActionTarget.Task,
            actorDisplayName: 'Alex',
            actorIsUser: false,
            description: { simple },
        },
    };
}

/** LLM stub: records prompts and returns canned markdown with an item-link token. */
function makeFakeLlm(captured: string[]): LlmClient {
    return {
        genChatCompletion: async (req: ChatCompletionRequest) => {
            captured.push(req.messages.map((m) => flattenMessageText(m.content)).join('\n---\n'));
            return {
                content: [`* Work happened on [Item](${PROMPT_URL_TOKEN_PREFIX}/${TASK_UUID}).`],
                usage: { inputTokens: 1, outputTokens: 1 },
            };
        },
    } as unknown as LlmClient;
}

const TEST_PRESET: SummaryPreset = {
    id: 'testcrm:tasks',
    title: (count) => (count ? `${count} Tasks` : 'Tasks'),
    itemType: 'task',
    filters: {
        filters: [],
        operator: ContextItemsFilterOperator.Or,
        graphFilterType: GraphFilterType.Full,
    },
    grouping: { groupType: ItemGroupPredefinedType.None },
    alsoGroupByItemType: false,
    summarize: {
        changesSummaryEnabled: true,
        changesLevelOfDetail: 1,
        changesSummaryFormat: SummarizationSettingsFormat.Highlights,
        changesSummaryFields: [ChangesSummaryField.Changes, ChangesSummaryField.Description],
        changesAlsoGroupByItemType: false,
        propertyNamesToSummarize: [],
        commentsSummaryEnabled: false,
        commentsSummaryLength: CommentsSummarizationLength.Short,
    },
};

function makeEngine(prompts: string[] = []) {
    const repos = createInMemoryRepositories();
    const engine = new ChronicleEngine({
        ...repos,
        llm: makeFakeLlm(prompts),
        logger: noopLogger,
        config: {
            itemLink: 'https://example.test/items/',
        },
    });
    engine.connectorTraits.register({
        id: CONNECTOR,
        deepHierarchy: true,
        hierarchyTypeFromObjectType: (objectType) => (objectType === 'company' ? 'TestCompany' : 'SpecificItem'),
    });

    // Seed: a company scope item with one changed task under it
    repos.items.seed([
        makeItem({
            uuid: COMPANY_UUID,
            idsFromConnector: { idFromConnector: 'c-1', connectorObjectType: 'company', connectorUserId: ACCOUNT },
            title: 'The Company',
        }),
        makeItem({
            uuid: TASK_UUID,
            title: 'Fix the widget',
            types: [ItemType.Task],
            parents: [
                {
                    itemUuid: COMPANY_UUID,
                    idsFromConnector: {
                        idFromConnector: 'c-1',
                        connectorObjectType: 'company',
                        connectorUserId: ACCOUNT,
                    },
                },
            ],
        }),
    ]);
    repos.events.seed([makeEvent(TASK_UUID, new Date('2026-02-05T10:00:00Z'))]);

    return { engine, repos };
}

const SCOPES: Scope[] = [{ uuid: COMPANY_UUID, connector: CONNECTOR, hierarchyType: 'TestCompany' }];
const PRINCIPAL = { userId: USER, organizationId: 'org-1' };

describe('ChronicleEngine end-to-end (in-memory repositories, fake LLM)', () => {
    describe('createContext', () => {
        it('creates a context and returns the same id for repeated calls in the same window', async () => {
            const { engine } = makeEngine();
            const input = {
                scopes: SCOPES,
                fromDateIso: '2026-02-01T00:00:00.000Z',
                timeZone: 'UTC',
            };
            const first = await engine.createContext(PRINCIPAL, input);
            const second = await engine.createContext(PRINCIPAL, input);

            assert.ok(typeof first.id === 'string' && first.id.length > 10);
            assert.equal(second.id, first.id);

            const ctx = await engine.getContext(PRINCIPAL, first.id);
            assert.ok(Object.keys(ctx.timeline.items).includes(TASK_UUID));
            assert.equal(
                ctx.timeline.changes.some((c) => c.itemUuid === TASK_UUID),
                true,
            );
        });

        it('rejects invalid dates and time zones', async () => {
            const { engine } = makeEngine();
            await assert.rejects(
                engine.createContext(PRINCIPAL, { scopes: SCOPES, fromDateIso: 'nonsense', timeZone: 'UTC' }),
                /not a valid ISO date/,
            );
            await assert.rejects(
                engine.createContext(PRINCIPAL, {
                    scopes: SCOPES,
                    fromDateIso: '2026-02-01T00:00:00.000Z',
                    timeZone: 'Not/AZone',
                }),
                /Invalid time zone/,
            );
        });

        it('denies access to a context created by another user', async () => {
            const { engine } = makeEngine();
            const ctx = await engine.createContext(PRINCIPAL, {
                scopes: SCOPES,
                fromDateIso: '2026-02-01T00:00:00.000Z',
                timeZone: 'UTC',
            });
            await assert.rejects(engine.getContext({ userId: 'someone-else' }, ctx.id), /not found/);
        });
    });

    describe('generateSummary', () => {
        it('generates a titled summary with resolved item links', async () => {
            const prompts: string[] = [];
            const { engine } = makeEngine(prompts);
            const ctx = await engine.createContext(PRINCIPAL, {
                scopes: SCOPES,
                fromDateIso: '2026-02-01T00:00:00.000Z',
                timeZone: 'UTC',
            });

            const result = await engine.generateSummary(PRINCIPAL, ctx.id, TEST_PRESET, SummaryFormat.Markdown);

            assert.equal(result.presetId, TEST_PRESET.id);
            assert.ok(typeof result.summary === 'string');
            // Title from the preset with the counted item type
            assert.ok(result.summary.includes('## 1 Tasks'));
            // The LLM's token link resolved through config.itemLink
            assert.ok(result.summary.includes(`[Item](https://example.test/items/${TASK_UUID})`));
            // The prompt body contained the item's title
            assert.ok(prompts.join('\n').includes('Fix the widget'));
        });

        it('renders HTML when requested', async () => {
            const { engine } = makeEngine();
            const ctx = await engine.createContext(PRINCIPAL, {
                scopes: SCOPES,
                fromDateIso: '2026-02-01T00:00:00.000Z',
                timeZone: 'UTC',
            });

            const result = await engine.generateSummary(PRINCIPAL, ctx.id, TEST_PRESET, SummaryFormat.Html);
            assert.ok(result.summary?.includes('<h2'));
            assert.ok(result.summary?.includes('<a href='));
        });
    });

    describe('runInsight', () => {
        const TEST_INSIGHT: InsightConfig = {
            id: 'testcrm_widget_count',
            name: 'Widget Count',
            applicability: { connectors: [CONNECTOR], hierarchyTypes: ['TestCompany'] },
            getGrouping: () => ({ primary: { groupType: ItemGroupPredefinedType.None } }),
            getFilters: () => ({
                filters: [],
                operator: ContextItemsFilterOperator.Or,
                graphFilterType: GraphFilterType.Full,
            }),
            // Metric-snapshot-only insight: fabricate a minimal timeline holding the
            // scope item with one synthetic change (the pattern metric-snapshot-only insights use).
            fetchTimeline: async (params) => {
                const access = await params.runtime.accessControl.getAccessFilter({ userId: params.userId });
                const [company] = await params.runtime.repos.items.getByUuids([COMPANY_UUID], access);
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
                                        timeRange: {
                                            newest: new Date('2026-02-05T00:00:00Z'),
                                            oldest: new Date('2026-02-05T00:00:00Z'),
                                        },
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
                    timelineId: 'fixed-timeline-id',
                    fromDate: getAndValidateTimelineDate(params.fromDate),
                    metadata: undefined,
                };
            },
            analyze: async (_graphs, context) => {
                const access = await context.runtime.accessControl.getAccessFilter({ userId: context.userId });
                const snapshots = await context.runtime.repos.snapshots.getForDateRange({
                    userId: context.userId,
                    access,
                    itemUuid: COMPANY_UUID,
                    snapshotConfigUuid: SNAPSHOT_CONFIG_UUID,
                    from: context.fromDate,
                    to: context.toDate ?? new Date('2026-02-11T00:00:00Z'),
                });
                const metric = computeMetricFromSnapshots(
                    snapshots,
                    COMPANY_UUID,
                    context.fromDate,
                    context.toDate ?? new Date('2026-02-11T00:00:00Z'),
                    (s) =>
                        s.measurement[0]?.data.type === MetricSnapshotTypes.GenericMetric
                            ? s.measurement[0].data.payload.generic?.value
                            : undefined,
                    'sum',
                    sumValue(),
                );
                return {
                    period: { fromDate: context.fromDate, toDate: context.toDate },
                    aggregations: new Map([['widgets', metric]]),
                    distributions: { widgets: metric.value },
                };
            },
            formatResult: (analysis) => ({
                type: 'metric-card',
                title: 'WIDGETS',
                primaryValue: analysis
                    ? String((analysis.current.aggregations.get('widgets') as { value: number }).value)
                    : '-',
            }),
            getAnalyzedDataAsText: () => 'widgets',
        };

        function seedSnapshots(repos: ReturnType<typeof createInMemoryRepositories>) {
            const mk = (timestamp: Date, value: number) => {
                const measurement = [
                    {
                        data: {
                            type: MetricSnapshotTypes.GenericMetric as const,
                            payload: { generic: { value, valueFormatted: String(value) } },
                        },
                    },
                ];
                return {
                    timestamp,
                    itemUuid: COMPANY_UUID,
                    connector: CONNECTOR,
                    connectorUserId: ACCOUNT,
                    userId: USER,
                    snapshotConfigUuid: SNAPSHOT_CONFIG_UUID,
                    measurement,
                    measurementHash: `${getHash(measurement)}:${timestamp.valueOf()}`,
                };
            };
            repos.snapshots.seed([
                mk(new Date('2026-01-25T00:00:00Z'), 2), // previous (delta) period
                mk(new Date('2026-02-05T00:00:00Z'), 3),
                mk(new Date('2026-02-06T00:00:00Z'), 4),
            ]);
        }

        it('runs an insight over seeded snapshots and computes deltas', async () => {
            const { engine, repos } = makeEngine();
            seedSnapshots(repos);
            engine.insights.register(TEST_INSIGHT);

            const result = await engine.runInsight(PRINCIPAL, 'testcrm_widget_count', SCOPES, {
                fromDate: {
                    type: TimelineDateType.Iso,
                    isoDate: '2026-02-01T00:00:00.000Z',
                    userIanaZone: 'UTC',
                },
            });

            assert.notEqual(result, undefined);
            assert.ok(result?.analysisId.includes('testcrm_widget_count:'));
            const card = result?.visualization as MetricCard;
            assert.equal(card.type, 'metric-card');
            assert.equal(card.primaryValue, '7'); // 3 + 4 within the window
        });

        it('returns undefined when no scope matches the insight applicability', async () => {
            const { engine } = makeEngine();
            engine.insights.register(TEST_INSIGHT);
            const result = await engine.runInsight(
                PRINCIPAL,
                'testcrm_widget_count',
                [{ uuid: COMPANY_UUID, connector: 'other-connector', hierarchyType: 'TestCompany' }],
                {
                    fromDate: {
                        type: TimelineDateType.Iso,
                        isoDate: '2026-02-01T00:00:00.000Z',
                        userIanaZone: 'UTC',
                    },
                },
            );
            assert.equal(result, undefined);
        });

        it('throws for an unknown insight id', async () => {
            const { engine } = makeEngine();
            await assert.rejects(
                engine.runInsight(PRINCIPAL, 'nope', SCOPES, {
                    fromDate: {
                        type: TimelineDateType.Iso,
                        isoDate: '2026-02-01T00:00:00.000Z',
                        userIanaZone: 'UTC',
                    },
                }),
                /Insight nope not found/,
            );
        });
    });

    describe('ingest', () => {
        const INGESTED_UUID = 'cccccccc-0000-0000-0000-000000000001';

        class FakeConnector extends ConnectorSource<{ n: number }, undefined, unknown> {
            polls: { fromDate: Date; firstPoll: boolean }[] = [];

            get connectorId() {
                return CONNECTOR;
            }
            get connectorUserId() {
                return ACCOUNT;
            }
            async initializeState() {
                // no-op
            }
            getState() {
                return undefined;
            }
            async getChanges(fromDate: Date, _toDate: Date | undefined, poll: { firstPoll: boolean }) {
                this.polls.push({ fromDate, firstPoll: poll.firstPoll });
                return { changes: [{ n: 1 }] };
            }
            async getItemForId() {
                return undefined;
            }
            async map(userId: string, objs: { n: number }[]) {
                const item = makeItem({
                    uuid: INGESTED_UUID,
                    title: `Task v${objs[0].n}`,
                }) as ItemWithParentData<unknown>;
                const res: ItemWithParentDataChangelog<unknown>[] = [
                    {
                        item,
                        // "now" so the change falls inside every poll window
                        changelog: [makeEvent(INGESTED_UUID, new Date())],
                    },
                ];
                return { itemsWithChanges: res };
            }
        }

        it('stores items and events, advances the watermark, and clears firstPoll', async () => {
            const { engine, repos } = makeEngine();
            const connector = new FakeConnector();

            const report1 = await engine.ingest(connector, { userId: USER });
            assert.equal(report1.firstPoll, true);
            assert.equal(report1.items.inserted, 1);
            assert.equal(report1.eventsStored, 1);
            assert.equal(repos.items.items.has(INGESTED_UUID), true);

            const report2 = await engine.ingest(connector, { userId: USER });
            assert.equal(report2.firstPoll, false);
            // identical item content → hash-guarded upsert reports unchanged
            assert.equal(report2.items.unchanged, 1);
            // the second poll's window starts at the first poll's end
            assert.equal(connector.polls[1].fromDate.valueOf(), report1.toDate.valueOf());
        });
    });
});
