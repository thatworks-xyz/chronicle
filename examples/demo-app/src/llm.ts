/**
 * The LLM port. Chronicle talks to language models through one interface:
 *
 *   interface LlmService {
 *       genChatCompletion(props, spec): Promise<ChatCompletionResponse>;
 *   }
 *
 * The built-in LlmClient implements it for Anthropic and OpenAI-compatible
 * APIs over plain fetch. For anything else (an internal gateway, a provider
 * SDK, AWS Bedrock...), implement LlmService yourself — usually delegating
 * the protocols LlmClient does support to an inner instance.
 *
 * Because it's one method, hermetic tests can script it — which is exactly
 * what ScriptedLlm does. One detail worth knowing: when the engine asks the
 * LLM to reference items, prompts carry opaque link tokens
 * ([title](PROMPT_URL_TOKEN_PREFIX/<uuid>)); the engine resolves them to real
 * URLs afterwards via the `itemLink` config. Scripted responses that include
 * those tokens exercise the same path a real model would.
 */
import {
    AnthropicClaudeSonnet46,
    ChatCompletionRequest,
    ChatCompletionResponse,
    LlmClient,
    LlmService,
    ModelSelection,
    PROMPT_URL_TOKEN_PREFIX,
} from '@chronicle/core';
import { DEMO_UUIDS } from './connector.js';

/**
 * Scripted LLM for hermetic runs: returns a canned summary containing
 * chronicle's item-link tokens, which the engine resolves to real URLs.
 */
export class ScriptedLlm implements LlmService {
    async genChatCompletion(_props: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        return {
            content: [
                [
                    `* Completed [Design the homepage](${PROMPT_URL_TOKEN_PREFIX}/${DEMO_UUIDS.taskHomepage}).`,
                    `* Progress on [Prepare launch checklist](${PROMPT_URL_TOKEN_PREFIX}/${DEMO_UUIDS.taskLaunch}) and pricing copy.`,
                ].join('\n'),
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
        };
    }
}

/** Real LLM when ANTHROPIC_API_KEY is set, scripted otherwise. */
export function createLlm(): { llm: LlmService; hermetic: boolean } {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
        return { llm: new LlmClient({ anthropic: { apiKey } }), hermetic: false };
    }
    return { llm: new ScriptedLlm(), hermetic: true };
}

/**
 * Which models to use, with a fallback chain tried in order when the default
 * fails. Model choices live in EngineConfig (config.models.*), one selection
 * per task kind (summaries, insights, ...); the engine ships sensible
 * Anthropic defaults, so the demo doesn't override them. Define your own
 * ModelSpec for other providers — `provider` is an open string matched by
 * your LlmService.
 */
export const DEMO_MODELS: ModelSelection = {
    default: AnthropicClaudeSonnet46,
    fallback: [],
};
