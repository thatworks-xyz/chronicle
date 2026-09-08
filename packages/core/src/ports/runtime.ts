import { ConnectorTraitsRegistry } from '../domain/connector.js';
import { LlmService } from '../llm/client.js';
import { AccessControl } from './access-control.js';
import { KeyValueCache } from './cache.js';
import { EngineConfig } from './config.js';
import { EngineHooks } from './hooks.js';
import { Logger } from './logger.js';
import {
    ChangeEventRepository,
    DocDiffRepository,
    MetricSnapshotRepository,
    WatermarkStore,
    WorkItemRepository,
} from './repositories.js';

/**
 * The resolved dependency bundle threaded through the engine
 * (replaces the application-level "AppContext" plus module-global singletons).
 */
export interface EngineRuntime {
    log: Logger;
    cache: KeyValueCache;
    config: EngineConfig;
    llm: LlmService | undefined;
    repos: {
        items: WorkItemRepository;
        events: ChangeEventRepository;
        snapshots: MetricSnapshotRepository;
        docDiffs?: DocDiffRepository;
        watermarks?: WatermarkStore;
    };
    connectorTraits: ConnectorTraitsRegistry;
    accessControl: AccessControl;
    hooks: EngineHooks;
}
