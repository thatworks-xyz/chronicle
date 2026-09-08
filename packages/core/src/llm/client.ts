import { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from './messages.js';
import { ModelSpec } from './models.js';

// Default timeout for the LLM requests to prevent hangs
const LLM_REQUEST_TIMEOUT_MS = 360_000; // 6 minutes

export const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * The LLM port: anything that can serve a chat completion for a ModelSpec.
 *
 * Implement this to plug in providers the built-in {@link LlmClient} does not
 * speak (private gateways, AWS Bedrock, provider SDKs, ...). Implementations
 * typically delegate to an inner LlmClient for the protocols it does support.
 */
export interface LlmService {
    genChatCompletion(props: ChatCompletionRequest, spec: ModelSpec): Promise<ChatCompletionResponse>;
}

/** Provider credentials/endpoints, supplied by the consumer. */
export interface LlmProviders {
    anthropic?: {
        apiKey: string;
        /** Defaults to the public Anthropic Messages API endpoint. */
        endpoint?: string;
    };
    /**
     * OpenAI-compatible chat-completions endpoints, keyed by a provider name that
     * ModelSpec.providerKey selects (e.g. 'fireworks', 'azure', 'local').
     */
    openaiCompatible?: Record<string, { endpoint: string; apiKey: string }>;
}

/**
 * POSTs JSON and returns the parsed JSON response. Throws on HTTP errors.
 * Injectable via the LlmClient constructor (e.g. for tests or custom transports).
 */
export type PostJson = (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;

const NETWORK_RETRIES = 3;

/**
 * Default transport: fetch with a request timeout. Network failures are retried
 * with exponential backoff; HTTP error statuses are not retried (requests are
 * POSTs and may not be idempotent) and throw instead.
 */
export const fetchPostJson: PostJson = async (url, body, headers) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
        }
        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            lastError = error;
            continue;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`LLM request failed: HTTP ${res.status} ${text.slice(0, 500)}`);
        }
        return res.json();
    }
    throw lastError;
};

interface AnthropicResponse {
    content: {
        text: string;
        type: 'text';
    }[];
    id: string;
    model: string;
    role: string;
    stop_reason: string;
    stop_sequence: string | null;
    type: 'message';
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

interface OpenAiChatResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        finish_reason: string;
        message: {
            role: string;
            content: string;
        };
    }[];
    usage: {
        prompt_tokens: number;
        total_tokens: number;
        completion_tokens: number;
    };
}

/**
 * Built-in chat-completion client. Speaks two protocols over plain HTTPS:
 * Anthropic Messages and OpenAI-compatible chat completions (Fireworks,
 * Azure OpenAI, local servers, ...). For any other provider, implement
 * {@link LlmService} and delegate the protocols this client handles to it.
 */
export class LlmClient implements LlmService {
    private readonly _postJson: PostJson;

    constructor(
        private readonly _providers: LlmProviders,
        postJson?: PostJson,
    ) {
        this._postJson = postJson ?? fetchPostJson;
    }

    async genChatCompletion(props: ChatCompletionRequest, spec: ModelSpec): Promise<ChatCompletionResponse> {
        switch (spec.provider) {
            case 'anthropic':
                return this.anthropicRequest(props, spec);
            case 'openai-compatible':
                return this.openAiCompatibleRequest(props, spec);
            default:
                throw new Error(
                    `LlmClient: unsupported provider '${spec.provider}' for model '${spec.id}'. ` +
                        `Provide a custom LlmService implementation to the engine for this provider.`,
                );
        }
    }

    private async anthropicRequest(props: ChatCompletionRequest, spec: ModelSpec): Promise<ChatCompletionResponse> {
        const cfg = this._providers.anthropic;
        if (!cfg) {
            throw new Error(`LlmClient: model '${spec.id}' requires the anthropic provider to be configured`);
        }

        // unlike other model APIs, anthropic requires the system message as a param
        const systemMessage = props.messages.find((m) => m.role === 'system');
        const nonSystemMessages = props.messages.filter((m) => m.role !== 'system');

        const data = (await this._postJson(
            cfg.endpoint ?? DEFAULT_ANTHROPIC_ENDPOINT,
            {
                messages: nonSystemMessages,
                max_tokens: props.max_tokens,
                temperature: props.temperature,
                top_p: props.top_p,
                system: systemMessage?.content,
                model: spec.model,
            },
            {
                'x-api-key': cfg.apiKey,
                'anthropic-version': '2023-06-01',
            },
        )) as AnthropicResponse;

        return {
            content: data.content.map((c) => c.text),
            usage: {
                inputTokens: data.usage?.input_tokens || 0,
                outputTokens: data.usage?.output_tokens || 0,
            },
        };
    }

    private async openAiCompatibleRequest(
        props: ChatCompletionRequest,
        spec: ModelSpec,
    ): Promise<ChatCompletionResponse> {
        const providerKey = spec.providerKey ?? 'default';
        const cfg = this._providers.openaiCompatible?.[providerKey];
        if (!cfg) {
            throw new Error(
                `LlmClient: model '${spec.id}' requires an openai-compatible provider named '${providerKey}' to be configured`,
            );
        }

        const body: {
            model?: string;
            messages: ChatMessage[];
            max_tokens: number;
            temperature?: number;
            presence_penalty?: number;
            top_p?: number;
            response_format?: {
                type: 'json_object' | 'text';
            };
        } = {
            messages: props.messages,
            max_tokens: props.max_tokens,
            temperature: props.temperature,
            presence_penalty: props.presence_penalty,
            top_p: props.top_p,
            response_format: props.response_format,
            model: spec.model || undefined,
        };

        const data = (await this._postJson(cfg.endpoint, body, {
            Authorization: `Bearer ${cfg.apiKey}`,
            'api-key': cfg.apiKey, // Azure OpenAI uses this header
        })) as OpenAiChatResponse;

        const content: string[] = [];
        data.choices.forEach((c) => {
            if (c.message.content) {
                content.push(c.message.content);
            }
        });
        return {
            content,
            usage: {
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0,
            },
        };
    }
}
