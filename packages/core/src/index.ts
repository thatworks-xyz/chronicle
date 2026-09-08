// ============================================================================
// @chronicle/core — public API
// ============================================================================

// Engine facade
export * from './engine.js';

// Domain model
export * from './domain/access.js';
export * from './domain/api-types.js';
export * from './domain/change-event.js';
export * from './domain/connector.js';
export * from './domain/connector-item-id.js';
export * from './domain/context.js';
export * from './domain/errors.js';
export * from './domain/filters.js';
export * from './domain/hierarchy.js';
export * from './domain/item-meta-filter.js';
export * from './domain/metric-snapshot.js';
export * from './domain/timeline.js';
export * from './domain/work-item.js';

// Ports
export * from './ports/access-control.js';
export * from './ports/cache.js';
export * from './ports/config.js';
export * from './ports/hooks.js';
export * from './ports/logger.js';
export * from './ports/repositories.js';
export * from './ports/runtime.js';

// LLM layer
export * from './llm/client.js';
export * from './llm/messages.js';
export * from './llm/models.js';
export * from './llm/prompt-processor.js';

// Engine building blocks (advanced usage)
export * from './engine/activity.js';
export * from './engine/activity-graph.js';
export * from './engine/activity-search.js';
export * from './engine/activity-search-helpers.js';
export * from './engine/changelog-summary.js';
export * from './engine/conversions.js';
export * from './engine/date-helpers.js';
export * from './engine/date-sort.js';
export * from './engine/get-item-type.js';
export * from './engine/grouped-graphs.js';
export * from './engine/prompt-examples.js';
export * from './engine/prompts.js';
export * from './engine/scope-resolution.js';
export * from './engine/scoring/scoring.js';
export * from './engine/status-category-match.js';
export * from './engine/summarize.js';
export * from './engine/timeline-builder.js';
export * from './engine/token-budgeting.js';
export * from './engine/url-processor.js';

// Analytics / insights
export * from './engine/analytics/executor.js';
export * from './engine/analytics/insight-context-cache.js';
export * from './engine/analytics/registry.js';
export * from './engine/analytics/snapshot-math.js';
export * from './engine/analytics/time-series-helpers.js';
export * from './engine/analytics/types.js';
export * from './engine/analytics/visualization.js';
export * from './engine/analytics/visualization-builders.js';

// Ingestion framework
export * from './ingestion/connector.js';
export * from './ingestion/connector-item-id-map.js';
export * from './ingestion/mapper.js';
export * from './ingestion/runner.js';

// In-memory storage adapters — useful for tests, prototypes, and single-process setups
export * from './testing/in-memory-repos.js';

// Vendored utilities
export { Graph } from './vendor/graph.js';
export type { GraphAsJson } from './vendor/graph.js';
export { Colors } from './vendor/colors.js';
export { Capitalize, pluralizeWord } from './vendor/string-utils.js';
