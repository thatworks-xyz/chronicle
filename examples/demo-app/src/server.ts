/**
 * Engine wiring + a minimal HTTP layer.
 *
 * This file shows the full consumer surface of Chronicle:
 *
 *   1. Pick storage           — any implementations of the repository ports.
 *                               In-memory ships with core; @chronicle/mongo is
 *                               the reference database adapter. Write your own
 *                               by implementing the interfaces in
 *                               @chronicle/core's ports/repositories.
 *   2. Pick an LLM            — an LlmService (see llm.ts).
 *   3. Construct the engine   — everything else (cache, access control,
 *                               logger, config) has defaults you can override.
 *   4. Register connector behaviors and insights.
 *   5. Call the three engine operations:
 *        createContext    — build/cache a timeline over scopes + time window,
 *                           addressed by a deterministic id
 *        generateSummary  — LLM summary of a context, driven by a
 *                           SummaryPreset (a summary defined as data)
 *        runInsight       — computed analytics visualization
 *   6. Ingest on a schedule  — engine.ingest(connector, { userId }).
 *
 * Chronicle is HTTP-agnostic: the node:http server below is just one way to
 * expose it. Bring your own framework, auth, and request validation.
 */
import http from 'node:http';
import {
    ChangesSummaryField,
    ChronicleEngine,
    CommentsSummarizationLength,
    ContextItemsFilterOperator,
    createInMemoryRepositories,
    GraphFilterType,
    ItemGroupPredefinedType,
    Principal,
    SummarizationSettingsFormat,
    SummaryFormat,
    SummaryPreset,
    TimelineDateType,
} from '@chronicle/core';
import { createMongoRepositories } from '@chronicle/mongo';
import { DEMO_CONNECTOR_ID, DEMO_SCOPES, DemoCrmConnector, DemoHierarchyTypes } from './connector.js';
import { OPEN_TASKS_INSIGHT_ID, OpenTasksInsight } from './insight.js';
import { createLlm } from './llm.js';

// The Principal identifies who is asking. With the default permissive access
// control (single-tenant), it mainly namespaces stored data; plug in your own
// AccessControl implementation for multi-tenant setups.
export const DEMO_PRINCIPAL: Principal = { userId: 'demo-user', organizationId: 'demo-org' };

// Where item links in summaries point. The LLM emits opaque link tokens; the
// engine rewrites them to `${ITEM_LINK_BASE}${itemUuid}` (or pass a function
// for custom URL schemes). Unset => links degrade to plain text.
export const ITEM_LINK_BASE = 'https://demo.example/items/';

/**
 * A SummaryPreset is a summary defined as data: which items (filters +
 * itemType), how to group them, and how to summarize. Presets can also carry
 * prompt guidance (few-shot examples, focus prompts, bullet ranges) via
 * `guidance` — see SummaryPreset in @chronicle/core.
 */
export const TASKS_PRESET: SummaryPreset = {
    id: 'demo:tasks',
    // The title receives the number of items of `itemType` that made it into
    // the summary (null when unknown).
    title: (count) => (count ? `${count} Tasks` : 'Tasks'),
    itemType: 'task',
    filters: {
        filters: [], // empty = everything in the context
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

export interface DemoApp {
    engine: ChronicleEngine;
    connector: DemoCrmConnector;
    server: http.Server;
    hermetic: boolean;
    /** Ingests the demo data (idempotent — hash-guarded upserts). */
    ingest: () => Promise<void>;
    close: () => Promise<void>;
}

/** Builds the engine (storage + LLM per env), registers the demo connector, and wires the HTTP server. */
export async function createDemoApp(): Promise<DemoApp> {
    // --- 1. Storage: swap the whole persistence layer with one line. ---
    const mongoUrl = process.env.MONGO_URL;
    let repos;
    let closeMongo: (() => Promise<void>) | undefined;
    if (mongoUrl) {
        const { default: mongoose } = await import('mongoose');
        await mongoose.connect(mongoUrl);
        // Creates models on this connection: items, changelog + metric
        // snapshots as time-series collections, watermarks. Fresh DB is fine.
        repos = createMongoRepositories(mongoose.connection);
        closeMongo = () => mongoose.disconnect();
    } else {
        repos = createInMemoryRepositories();
    }

    // --- 2 + 3. LLM and engine. Unspecified deps get defaults: in-memory
    // KeyValueCache, permissive AccessControl, console logger, default
    // EngineConfig (model selections, ranking weights, limits, TTLs). ---
    const { llm, hermetic } = createLlm();
    const engine = new ChronicleEngine({
        ...repos,
        llm,
        config: { itemLink: ITEM_LINK_BASE },
    });

    // --- 4. Per-connector behaviors ("traits") tune how the engine treats
    // this source: hierarchy depth, how object types map to hierarchy types,
    // prompt/grouping behaviors. Register once per connector id. ---
    engine.connectorTraits.register({
        id: DEMO_CONNECTOR_ID,
        deepHierarchy: true, // resolve grandchildren, not just direct children
        hierarchyTypeFromObjectType: (objectType) =>
            objectType === 'company' ? DemoHierarchyTypes.Company : 'SpecificItem',
    });
    engine.insights.register(OpenTasksInsight);

    const connector = new DemoCrmConnector(engine.runtime.repos.items);

    const server = http.createServer((req, res) => {
        handle(engine, req, res).catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        });
    });

    return {
        engine,
        connector,
        server,
        hermetic: hermetic && !mongoUrl,
        // --- 6. Ingestion. Run on whatever schedule suits your source; the
        // engine tracks watermarks so each run only fetches what's new. ---
        ingest: async () => {
            await engine.ingest(connector, { userId: DEMO_PRINCIPAL.userId });
        },
        close: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await closeMongo?.();
        },
    };
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// --- 5. The three engine operations, one endpoint each. ---
async function handle(engine: ChronicleEngine, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/') {
        json(res, 200, {
            endpoints: {
                'POST /context': { fromDateIso: 'ISO date', timeZone: 'IANA zone' },
                'POST /summary': { contextId: 'from /context' },
                'POST /insight': { fromDateIso: 'ISO date' },
            },
        });
        return;
    }

    if (req.method !== 'POST') {
        json(res, 404, { error: 'not found' });
        return;
    }
    const body = await readJsonBody(req);

    switch (req.url) {
        case '/context': {
            // Builds (or returns the cached) timeline for these scopes and
            // window. The id is deterministic: same scopes + same (quantized)
            // window + same user => same id, so clients can safely re-request.
            const ctx = await engine.createContext(DEMO_PRINCIPAL, {
                scopes: DEMO_SCOPES,
                fromDateIso: String(body.fromDateIso),
                timeZone: String(body.timeZone ?? 'UTC'),
            });
            json(res, 200, ctx);
            return;
        }
        case '/summary': {
            // Summarizes the context through the preset. Markdown output has
            // item links already resolved; SummaryFormat.Html renders to HTML.
            const result = await engine.generateSummary(
                DEMO_PRINCIPAL,
                String(body.contextId),
                TASKS_PRESET,
                SummaryFormat.Markdown,
            );
            json(res, 200, { presetId: result.presetId, summary: result.summary });
            return;
        }
        case '/insight': {
            // Runs a registered insight over the scopes. Returns undefined if
            // no scope matches the insight's applicability.
            const result = await engine.runInsight(DEMO_PRINCIPAL, OPEN_TASKS_INSIGHT_ID, DEMO_SCOPES, {
                fromDate: {
                    type: TimelineDateType.Iso,
                    isoDate: String(body.fromDateIso),
                    userIanaZone: 'UTC',
                },
            });
            json(res, 200, result ?? { error: 'insight not applicable' });
            return;
        }
        default:
            json(res, 404, { error: 'not found' });
    }
}
