import { ScorerName } from '../domain/filters.js';
import { defaultModelSelection, ModelSelection } from '../llm/models.js';

/** Character caps applied when rendering item data into LLM prompt bodies. */
export interface TruncationConfig {
    defaultPropertyMaxChars: number;
    textPropertyMaxChars: number;
    documentMaxChars: number;
    docDiffMaxChars: number;
}

/** Weights for the item-ranking feature scorers (keyed by ScorerName). */
export type ScorerWeights = { [name in ScorerName]: number };

/**
 * How to turn a work item uuid into a link in generated text: either a base URL
 * the uuid is appended to, or a resolver function (return undefined to render
 * the item as plain text). When unset, item links are stripped to plain text.
 */
export type ItemLink = string | ((itemUuid: string) => string | undefined);

/** Cache key prefixes, overridable when a host needs namespacing control. */
export interface CacheKeyPrefixes {
    /** Prefix for cached timelines (contexts). */
    timeline: string;
    /** Prefix for cached insight LLM contexts. */
    insightContext: string;
    /** Prefix for cached LLM prompt responses. */
    prompt: string;
}

/** Size/depth caps applied while resolving and rendering timelines. */
export interface EngineLimits {
    /** Maximum change events fetched per item when building a timeline. */
    maxChangeEventsPerItem: number;
    /** Maximum items kept in a graph when pruning for an LLM summary. */
    summaryGraphMaxItems: number;
    /** Maximum items rendered into an LLM context text. */
    llmContextMaxItems: number;
    /** How many parent levels to hydrate when building timeline hierarchies. */
    parentFetchDepth: number;
}

/**
 * Engine configuration. Every field has a sensible default
 * ({@link defaultEngineConfig}); hosts override what they need.
 */
export interface EngineConfig {
    /** Model selections per use, falling back to `models.default` when unset. */
    models: {
        default: ModelSelection;
        summaryHighlights?: ModelSelection;
        summaryComments?: ModelSelection;
        customFormatting?: ModelSelection;
        insights?: ModelSelection;
    };

    /** Ranking weights for timeline item scoring. */
    rankingWeights: ScorerWeights;

    graph: {
        /** Maximum number of children resolved per scope. */
        maxChildren: number;
        /** Maximum recursion depth when resolving scope descendants (undefined = adapter default). */
        maxDepth?: number;
    };

    /** Prompt-body truncation caps; undefined disables truncation. */
    truncation?: TruncationConfig;

    /** Token budgets for combining many text blocks into one prompt; undefined disables budgeting. */
    blockTokenBudget?: { totalBudget: number; extendedTotalBudget: number };

    /** How items are linked in generated summaries. Unset = links stripped to plain text. */
    itemLink?: ItemLink;

    /** Cache key prefixes. */
    cacheKeyPrefixes: CacheKeyPrefixes;

    /** How long built timelines stay valid in the cache. */
    timelineCacheTtlMinutes: number;

    /** How long contexts created via createContext stay valid. */
    contextTtlMinutes: number;

    /** How long identical LLM prompt responses are served from cache. */
    promptCacheTtlMs: number;

    /** Size/depth caps. */
    limits: EngineLimits;
}

export const defaultEngineConfig: EngineConfig = {
    models: {
        default: defaultModelSelection,
    },
    rankingWeights: {
        [ScorerName.ActionRecency]: 0.1,
        [ScorerName.Priority]: 0.2,
        [ScorerName.NumOfComments]: 0.2,
        [ScorerName.Activity]: 0.5,
        [ScorerName.NumUniquePeople]: 0,
    },
    graph: {
        maxChildren: 1000,
        maxDepth: undefined,
    },
    truncation: undefined,
    itemLink: undefined,
    cacheKeyPrefixes: {
        timeline: 'chronicle:timeline',
        insightContext: 'chronicle:insight-context',
        prompt: 'chronicle:prompt',
    },
    timelineCacheTtlMinutes: 30,
    contextTtlMinutes: 60,
    promptCacheTtlMs: 24 * 60 * 60 * 1000,
    limits: {
        maxChangeEventsPerItem: 200,
        summaryGraphMaxItems: 500,
        llmContextMaxItems: 100,
        parentFetchDepth: 3,
    },
};

/** Resolves an {@link ItemLink} for a specific item uuid. */
export function resolveItemUrl(itemLink: ItemLink | undefined, itemUuid: string): string | undefined {
    if (itemLink === undefined) {
        return undefined;
    }
    return typeof itemLink === 'string' ? `${itemLink}${itemUuid}` : itemLink(itemUuid);
}

/** Merge a partial override onto the defaults. */
export function resolveEngineConfig(overrides?: Partial<EngineConfig>): EngineConfig {
    return {
        ...defaultEngineConfig,
        ...overrides,
        models: { ...defaultEngineConfig.models, ...overrides?.models },
        rankingWeights: { ...defaultEngineConfig.rankingWeights, ...overrides?.rankingWeights },
        graph: { ...defaultEngineConfig.graph, ...overrides?.graph },
        cacheKeyPrefixes: { ...defaultEngineConfig.cacheKeyPrefixes, ...overrides?.cacheKeyPrefixes },
        limits: { ...defaultEngineConfig.limits, ...overrides?.limits },
    };
}
