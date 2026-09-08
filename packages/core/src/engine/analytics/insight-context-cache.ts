import objectHash from 'object-hash';
import { KeyValueCache } from '../../ports/cache.js';
import { Logger } from '../../ports/logger.js';
import { AnalysisParams, InsightConfig, InsightLlmContext } from './types.js';

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Default TTL for insight context cache: 30 minutes
 */
export const DEFAULT_INSIGHT_CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000;

/** Default cache key prefix for stored insight LLM contexts. */
export const INSIGHT_CONTEXT_CACHE_PREFIX = 'chronicle:insight-context';

/**
 * Generate deterministic analysis ID
 * Format: {configId}:{userId}:{timelineId}:{dataSourceFiltersHash}
 */
export function generateAnalysisId(config: InsightConfig, params: AnalysisParams): string {
    const dataSourceFiltersHash = objectHash({
        dataSourceFilters: params.dataSourceFilters,
    });
    return `${config.id}:${params.userId}:${params.timelineId}:${dataSourceFiltersHash}`;
}

/**
 * Extract config ID from analysis ID
 *
 * @param analysisId - Analysis ID in format {configId}:{userId}:{timelineId} or {configId}:{userId}:{timelineId}:{filterHash}
 * @returns Config id or undefined if invalid format
 */
export function getConfigIdFromAnalysisId(analysisId: string): string | undefined {
    const parts = analysisId.split(':');
    return parts.length >= 3 ? parts[0] : undefined;
}

function getCacheKey(analysisId: string, prefix: string): string {
    return `${prefix}:${analysisId}`;
}

/**
 * Retrieve a cached insight LLM context by analysis ID, enforcing its permissions.
 */
export async function getAnalysisContextById(
    userId: string,
    organizationId: string | undefined,
    analysisId: string,
    cache: KeyValueCache,
    log: Logger,
    prefix: string = INSIGHT_CONTEXT_CACHE_PREFIX,
): Promise<InsightLlmContext | null> {
    try {
        const cacheKey = getCacheKey(analysisId, prefix);
        const cached = await cache.get(cacheKey);
        const parsed = cached ? (JSON.parse(cached) as InsightLlmContext) : null;

        // Access control check
        // 1. User-level 'view' permission
        // 2. Org-level 'view' permission and matching organizationId
        if (
            !parsed?.permissions?.viewUserIds?.includes(userId) &&
            (!parsed?.permissions?.orgView || !organizationId || parsed.organizationId !== organizationId)
        ) {
            return null;
        }

        return parsed;
    } catch (error) {
        log.error(`insights: cache read error for ${analysisId}: ${getExceptionMessage(error)}`);
        return null;
    }
}

/**
 * Store an insight LLM context in the cache. Errors are logged, never propagated.
 */
export async function setAnalysisContext(
    context: InsightLlmContext,
    ttl: number,
    cache: KeyValueCache,
    log: Logger,
    prefix: string = INSIGHT_CONTEXT_CACHE_PREFIX,
): Promise<void> {
    try {
        const cacheKey = getCacheKey(context.id, prefix);
        await cache.set(cacheKey, JSON.stringify(context), ttl);
    } catch (error) {
        log.error(`insights: cache write error for ${context.id}: ${getExceptionMessage(error)}`);
    }
}
