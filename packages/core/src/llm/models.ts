/**
 * Model specification. Chronicle does not hardcode a model list: any model on
 * a supported provider protocol can be described with a ModelSpec. Constants
 * for common models are provided below as convenient defaults.
 */
export interface ModelSpec {
    /** Stable identifier used in logs and cache keys (e.g. 'claude-sonnet-4-6'). */
    id: string;
    /**
     * Which provider protocol to use for this model. The built-in LlmClient
     * handles 'anthropic' and 'openai-compatible'; any other value requires a
     * custom LlmService implementation that recognizes it.
     */
    provider: string;
    /**
     * Provider-native model name:
     * - anthropic: model name (e.g. 'claude-sonnet-4-6')
     * - openai-compatible: model name sent in the request body (may be empty for
     *   endpoints that encode the model in the URL, e.g. Azure OpenAI deployments)
     */
    model: string;
    /**
     * openai-compatible only: which configured endpoint to use, when several
     * openai-compatible endpoints are configured (key into LlmProviders.openaiCompatible).
     */
    providerKey?: string;
    /** Context window size in tokens (used for input truncation). */
    contextWindowTokens: number;
    /** Provider-specific extra request fields (e.g. { anthropic_beta: [...] }). */
    additionalRequestFields?: Record<string, unknown>;
}

/** A model choice with fallbacks tried in order when the default fails. */
export interface ModelSelection {
    default: ModelSpec;
    fallback: ModelSpec[];
    /** Optional larger-context variant for oversized inputs. */
    extended?: ModelSpec;
}

// ============================================================================
// Convenience specs for common models (values current as of 2026-08)
// ============================================================================

export const AnthropicClaudeSonnet46: ModelSpec = {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    contextWindowTokens: 200_000,
};

export const AnthropicClaudeSonnet45: ModelSpec = {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    contextWindowTokens: 200_000,
};

/** Default selection: Anthropic Sonnet with no fallback. Override via EngineConfig.modelSelection. */
export const defaultModelSelection: ModelSelection = {
    default: AnthropicClaudeSonnet46,
    fallback: [AnthropicClaudeSonnet45],
};
