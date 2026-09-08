import { MetricSnapshot } from '../domain/metric-snapshot.js';
import { EngineRuntime } from '../ports/runtime.js';
import { ConnectorSource, IngestionServices } from './connector.js';

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface IngestOptions {
    /** The user (connection owner) to ingest as. */
    userId: string;
    /** Override the incremental window start (defaults to the stored watermark). */
    fromDateOverride?: Date;
    /** Optional window end (defaults to now). */
    toDate?: Date;
    /**
     * Lookback for the very first poll (or when no watermark exists).
     * Defaults to 30 days.
     */
    initialLookbackDays?: number;
    /** Skip metric snapshot computation. */
    skipMetrics?: boolean;
}

export interface IngestReport {
    fromDate: Date;
    toDate: Date;
    firstPoll: boolean;
    items: { inserted: number; updated: number; unchanged: number };
    eventsStored: number;
    snapshotsStored: number;
    errors: string[];
}

/**
 * Runs one incremental ingestion pass for a connector source:
 * fetch → map → store items (hash-guarded) → store change events →
 * compute + store metric snapshots → advance the watermark.
 */
export class IngestionRunner {
    constructor(private readonly _runtime: EngineRuntime) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ingest<C extends ConnectorSource<any, any, any>>(connector: C, opts: IngestOptions): Promise<IngestReport> {
        const runtime = this._runtime;
        const log = runtime.log;
        const watermarks = runtime.repos.watermarks;
        const errors: string[] = [];

        await connector.initializeState();

        // Resolve the incremental window
        const now = new Date();
        const toDate = opts.toDate ?? now;
        const watermark = watermarks
            ? await watermarks.getLastPollDate(opts.userId, connector.connectorId, connector.connectorUserId)
            : undefined;
        const lookbackDays = opts.initialLookbackDays ?? 30;
        const fromDate =
            opts.fromDateOverride ?? watermark ?? new Date(now.valueOf() - lookbackDays * 24 * 60 * 60 * 1000);
        const firstPoll = watermarks
            ? await watermarks.isFirstPoll(opts.userId, connector.connectorId, connector.connectorUserId)
            : watermark === undefined;

        const access = await runtime.accessControl.getAccessFilter({ userId: opts.userId });
        const services: IngestionServices = { items: runtime.repos.items, access, log };

        const report: IngestReport = {
            fromDate,
            toDate,
            firstPoll,
            items: { inserted: 0, updated: 0, unchanged: 0 },
            eventsStored: 0,
            snapshotsStored: 0,
            errors,
        };

        // Fetch + map
        const result = await connector.get(opts.userId, fromDate, opts.toDate, { firstPoll }, services);
        if (result) {
            // Store items (hash-guarded upsert)
            const upsert = await runtime.repos.items.upsertIfChanged(
                result.itemWithChanges.map((v) => ({ item: v.item })),
            );
            report.items = upsert;

            // Store change events
            const events = result.itemWithChanges.flatMap((v) => v.changes);
            const allEvents = result.deletionChangelogs ? [...events, ...result.deletionChangelogs] : events;
            if (allEvents.length > 0) {
                await runtime.repos.events.store(allEvents);
                report.eventsStored = allEvents.length;
            }
        }

        // First-poll/backfill hook
        if (connector.pollAdditionalItems) {
            try {
                const additional = await connector.pollAdditionalItems(opts.userId, fromDate, firstPoll, services);
                if (additional.additionalItems.length > 0) {
                    const upsert = await runtime.repos.items.upsertIfChanged(
                        additional.additionalItems.map((item) => ({ item })),
                    );
                    report.items.inserted += upsert.inserted;
                    report.items.updated += upsert.updated;
                    report.items.unchanged += upsert.unchanged;
                }
                if (additional.changelogs && additional.changelogs.length > 0) {
                    await runtime.repos.events.store(additional.changelogs);
                    report.eventsStored += additional.changelogs.length;
                }
            } catch (error) {
                const msg = `pollAdditionalItems failed: ${getExceptionMessage(error)}`;
                log.error(msg);
                errors.push(msg);
            }
        }

        // Metric snapshots
        if (!opts.skipMetrics) {
            report.snapshotsStored = await this.computeMetricSnapshots(connector, opts.userId, fromDate, errors);
        }

        // Advance the watermark
        if (watermarks) {
            await watermarks.setLastPollDate(opts.userId, connector.connectorId, connector.connectorUserId, toDate);
            if (firstPoll) {
                await watermarks.clearFirstPoll(opts.userId, connector.connectorId, connector.connectorUserId);
            }
        }

        return report;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async computeMetricSnapshots<C extends ConnectorSource<any, any, any>>(
        connector: C,
        userId: string,
        fromDate: Date,
        errors: string[],
    ): Promise<number> {
        const runtime = this._runtime;
        const configs = connector.metricSnapshotConfigs;
        if (configs.length === 0) {
            return 0;
        }

        const items = await connector.getItemsForMetrics(userId);
        if (items.length === 0) {
            return 0;
        }

        let stored = 0;
        for (const { item } of items) {
            for (const config of configs) {
                try {
                    const snapshots: MetricSnapshot[] = [];
                    if (config.type === 'single') {
                        const snapshot = await config.calculate(userId, connector, item, runtime.log, fromDate);
                        if (snapshot) {
                            snapshots.push(snapshot);
                        }
                    } else {
                        snapshots.push(...(await config.calculate(userId, connector, item, runtime.log, fromDate)));
                    }

                    if (snapshots.length === 0) {
                        continue;
                    }

                    if (config.type === 'single' && config.overwriteHistory) {
                        await runtime.repos.snapshots.replaceForItem(item.uuid, config.uuid, snapshots);
                        stored += snapshots.length;
                    } else {
                        stored += await runtime.repos.snapshots.storeIfChanged(snapshots);
                    }
                } catch (error) {
                    const msg = `metric snapshot ${config.name} (${config.uuid}) failed for item ${
                        item.uuid
                    }: ${getExceptionMessage(error)}`;
                    runtime.log.error(msg);
                    errors.push(msg);
                }
            }
        }
        return stored;
    }
}
