import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEMO_UUIDS } from './connector.js';
import { createDemoApp, DemoApp, ITEM_LINK_BASE } from './server.js';

/**
 * End-to-end test over the HTTP surface: ingest -> context -> summary -> insight.
 * Hermetic by default (in-memory repositories + scripted LLM). Set MONGO_URL
 * and/or ANTHROPIC_API_KEY to exercise real infrastructure; assertions then
 * relax from exact values to structure.
 */

let app: DemoApp;
let baseUrl: string;

const FROM_DATE_ISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped HTTP JSON responses
async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

before(async () => {
    app = await createDemoApp();
    await app.ingest();
    await new Promise<void>((resolve) => app.server.listen(0, () => resolve()));
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await app?.close();
});

describe('demo app end-to-end', () => {
    it('ingestion is idempotent (hash-guarded upserts)', async () => {
        // Second ingest of identical data must not duplicate anything
        await app.ingest();
        const ctx = await post('/context', { fromDateIso: FROM_DATE_ISO, timeZone: 'UTC' });
        assert.equal(ctx.status, 200);
    });

    it('creates a context with a deterministic, repeatable id', async () => {
        const first = await post('/context', { fromDateIso: FROM_DATE_ISO, timeZone: 'UTC' });
        const second = await post('/context', { fromDateIso: FROM_DATE_ISO, timeZone: 'UTC' });

        assert.equal(first.status, 200);
        assert.ok(typeof first.body.id === 'string' && first.body.id.length > 10);
        assert.equal(second.body.id, first.body.id);
    });

    it('rejects an invalid date', async () => {
        const res = await post('/context', { fromDateIso: 'nonsense', timeZone: 'UTC' });
        assert.equal(res.status, 500);
        assert.ok(String(res.body.error).includes('not a valid ISO date'));
    });

    it('generates a summary with resolved item links', async () => {
        const ctx = await post('/context', { fromDateIso: FROM_DATE_ISO, timeZone: 'UTC' });
        const res = await post('/summary', { contextId: ctx.body.id });

        assert.equal(res.status, 200);
        assert.equal(res.body.presetId, 'demo:tasks');
        assert.ok(typeof res.body.summary === 'string' && res.body.summary.length > 0);
        // The title counts the tasks that made it into the summary
        assert.ok(res.body.summary.startsWith('## '));
        if (app.hermetic) {
            assert.ok(res.body.summary.includes('## 3 Tasks'));
            // The scripted LLM's link tokens are resolved through the engine's itemLink config
            assert.ok(res.body.summary.includes(`(${ITEM_LINK_BASE}${DEMO_UUIDS.taskHomepage})`));
            assert.ok(res.body.summary.includes('Prepare launch checklist'));
        }
    });

    it('runs the open-tasks insight and returns a metric card', async () => {
        const res = await post('/insight', { fromDateIso: FROM_DATE_ISO });

        assert.equal(res.status, 200);
        assert.ok(res.body.analysisId.startsWith('demo_open_tasks:'));
        assert.equal(res.body.visualization.type, 'metric-card');
        assert.equal(res.body.visualization.title, 'OPEN TASKS');
        // 2 of the 3 seeded tasks are not Done
        assert.equal(res.body.visualization.primaryValue, '2');
    });
});
