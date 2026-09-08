import ohash from 'object-hash';
import { KeyValueCache } from '../ports/cache.js';
import { Logger } from '../ports/logger.js';
import { LlmService } from './client.js';
import { ChatCompletionResponse, ChatMessage } from './messages.js';
import { ModelSelection, ModelSpec } from './models.js';

type PromptResultTest = (res: string) => Promise<boolean>;

export const PROMPT_CACHE_TTL_HOURS = 24;
export const PROMPT_CACHE_TTL_IN_MILLISECONDS = PROMPT_CACHE_TTL_HOURS * 60 * 60 * 1000;

function getExceptionMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface PromptResult {
    /** Task identifier, used in logs. */
    id: string;
    messages: ChatMessage[];
}

export interface PromptProcessorTask {
    getPrompt: (body: string) => PromptResult;
    retry?: { shouldRetry: (body: string) => boolean; retryCount: number };
    shouldContinueToNext: PromptResultTest;
}

export interface PromptProcessorStat {
    model: string;
    taskIndex: number;
    retryCount: number;
    inputTokens: number;
    outputTokens: number;
}

interface PromptProcessorTaskResult {
    taskId: string;
    promptMessages: ChatMessage[];
    model: string;
    modelResponse: string;
    taskInformation: string;
}

export interface PromptProcessorLastRunResult {
    processorId: string;
    userId: string;
    result: PromptProcessorTaskResult[];
}

export interface PromptProcessorLastRunStats {
    processorId: string;
    stats: PromptProcessorStat[];
}

export interface PromptProcessorLogContext {
    userId: string;
    logger: Logger;
}

export type LogLastStats = (stats: PromptProcessorLastRunStats, context: PromptProcessorLogContext) => Promise<void>;
export type LogLastResults = (
    results: PromptProcessorLastRunResult,
    context: PromptProcessorLogContext,
) => Promise<void>;

export interface LogProps {
    context: PromptProcessorLogContext;
    logLastStats: LogLastStats;
    logLastResults: LogLastResults;
}

/**
 * Runs an ordered chain of prompt tasks against an {@link LlmService}, with
 * model fallback, per-task retries, input truncation to the model's context
 * window, and optional response caching via a {@link KeyValueCache}.
 */
export class PromptProcessor {
    private _stats: PromptProcessorStat[] = [];
    private _results: PromptProcessorTaskResult[] = [];

    constructor(
        private _id: string,
        private _tasks: PromptProcessorTask[],
        private _modelSelection: ModelSelection,
        private _llm: LlmService,
        private _opts?: {
            logProps?: LogProps;
            /** When set, identical (model, messages) requests are served from cache. */
            cache?: KeyValueCache;
            cacheTtlMs?: number;
            /** Cache key prefix (default 'chronicle:prompt'). */
            cacheKeyPrefix?: string;
        },
    ) {}

    private get statsFromLastRun(): PromptProcessorLastRunStats {
        return { processorId: this._id, stats: this._stats };
    }

    private get resultsFromLastRun(): PromptProcessorLastRunResult {
        return {
            userId: this._opts?.logProps?.context.userId || `(unknown)`,
            processorId: this._id,
            result: this._results,
        };
    }

    private async logStats() {
        const logProps = this._opts?.logProps;
        if (logProps) {
            try {
                await Promise.all([
                    logProps.logLastStats(this.statsFromLastRun, logProps.context),
                    logProps.logLastResults(this.resultsFromLastRun, logProps.context),
                ]);
            } catch (error) {
                logProps.context.logger.error(`Failed to log LLM stats: ${getExceptionMessage(error)}`);
            }
        }
    }

    private async processTasks(body: string, spec: ModelSpec): Promise<string> {
        // Initialize
        this._stats = [];
        this._results = [];
        let generated = body;
        let taskIndex = 0;

        // Iterate over each task
        for (const task of this._tasks) {
            // Truncate to fit context window size
            generated = this._truncateToMaxNumberOfTokens(
                generated,
                spec.contextWindowTokens,
                this._getAveragePromptInstructionTokenSize(),
            );

            // Generate the prompt
            const prompt = task.getPrompt(generated);

            const model = spec.id;
            // Store the task info for logging: model response will be updated later, so at least we can log some of this
            // info if the LLM fails
            this._results.push({
                taskId: prompt.id,
                promptMessages: prompt.messages,
                model,
                // model response will be updated later
                modelResponse: 'Not available',
                taskInformation: `Task ${taskIndex + 1} of ${this._tasks.length}`,
            });

            // Use the prompt messages to generate the result
            let promptRes = await this._genPrompt(prompt.messages, spec);
            generated = promptRes.content;

            // Check if it should retry
            let retryCount = 0;
            if (task.retry) {
                while (task.retry.shouldRetry(generated) && retryCount < task.retry.retryCount) {
                    promptRes = await this._genPrompt(prompt.messages, spec, { skipCache: true });
                    generated = promptRes.content;
                    retryCount++;
                }
            }

            // Add the stat
            this._stats.push({
                model,
                taskIndex,
                retryCount,
                inputTokens: promptRes.usage.inputTokens,
                outputTokens: promptRes.usage.outputTokens,
            });

            // Update the model response in the stored result
            this._results[this._results.length - 1].modelResponse = generated;

            // Update the task index
            taskIndex++;

            // Check if we should continue to the next task
            if (!(await task.shouldContinueToNext(generated))) {
                break;
            }
        }

        // Return the generated result
        return generated;
    }

    async _genPrompt(
        m: ChatMessage[],
        spec: ModelSpec,
        opts?: { skipCache?: boolean },
    ): Promise<{ content: string; usage: ChatCompletionResponse['usage'] }> {
        const logger = this._opts?.logProps?.context.logger;
        logger?.info(`[${this._id}] Generating prompt with model ${spec.id}`);

        // Response cache: identical (model, messages) requests are served from cache
        const cache = this._opts?.cache;
        const prefix = this._opts?.cacheKeyPrefix ?? 'chronicle:prompt';
        const cacheKey = cache ? `${prefix}:${ohash({ model: spec.id, messages: m })}` : undefined;
        if (cache && cacheKey && !opts?.skipCache) {
            const cached = await cache.get(cacheKey);
            if (cached) {
                logger?.info(`[${this._id}] Prompt served from cache with model ${spec.id}`);
                return JSON.parse(cached) as { content: string; usage: ChatCompletionResponse['usage'] };
            }
        }

        // This does NOT enforce a timeout. It only logs a warning if the LLM call
        // is still pending after a while, so we can spot potential hangs
        const HANG_LOG_TIMEOUT_MS = 4 * 60 * 1000;
        const hangWarningTimeoutId = setTimeout(() => {
            logger?.warn(
                `[${this._id}] LLM call still pending after ${HANG_LOG_TIMEOUT_MS / 1000}s (model: ${
                    spec.id
                }) — possible hang`,
            );
        }, HANG_LOG_TIMEOUT_MS);
        let res: ChatCompletionResponse;

        try {
            res = await this._llm.genChatCompletion(
                {
                    messages: m,
                    temperature: 0,
                    max_tokens: 2048,
                    frequency_penalty: 1,
                    presence_penalty: 1,
                },
                spec,
            );
        } finally {
            clearTimeout(hangWarningTimeoutId);
        }

        logger?.info(`[${this._id}] Prompt completed with model ${spec.id}`);

        if (res.content.length === 0) {
            throw new Error(`Language model: received 0 choices`);
        }
        if (!res.content[0]) {
            throw new Error(`Language model: recevied message is invalid`);
        }
        const result = {
            content: res.content.join('\n'),
            usage: res.usage,
        };

        if (cache && cacheKey) {
            const ttl = this._opts?.cacheTtlMs ?? PROMPT_CACHE_TTL_IN_MILLISECONDS;
            await cache.set(cacheKey, JSON.stringify(result), ttl).catch(() => undefined);
        }

        return result;
    }

    async process(body: string): Promise<string> {
        try {
            const res = await this.processTasks(body, this._modelSelection.default);
            return res;
        } catch (e) {
            this.logWarnIfAvailable(
                `Error using main model ${getExceptionMessage(e)}. Attempting to use fallback model.`,
            );

            for (let i = 0; i < this._modelSelection.fallback.length; i++) {
                const fallback = this._modelSelection.fallback[i];
                try {
                    const res = await this.processTasks(body, fallback);
                    return res;
                } catch (error) {
                    this.logWarnIfAvailable(
                        `Error using fallback model [${i}/${this._modelSelection.fallback.length}] ${
                            fallback.id
                        } instead of ${this._modelSelection.default.id}: ${getExceptionMessage(error)}`,
                    );

                    if (i === this._modelSelection.fallback.length - 1) {
                        throw error;
                    }
                }
            }

            this.logWarnIfAvailable(`Error using main model ${getExceptionMessage(e)}. No fallback models available.`);
            throw e;
        } finally {
            // keep async
            this.logStats();
        }
    }

    private logWarnIfAvailable(message: string) {
        this._opts?.logProps?.context.logger.warn(`[${this._id}] ${message}`);
    }

    _truncateToMaxNumberOfTokens(text: string, maxLlmTokens: number, bufferTokens: number): string {
        const numberOfCharsPerToken = 4; // average token length
        const maxChars = (maxLlmTokens - bufferTokens) * numberOfCharsPerToken;
        if (text.length > maxChars) {
            this.logWarnIfAvailable(`Truncating input to ${maxChars} characters`);
            return text.slice(0, maxChars);
        }
        return text;
    }

    _getAveragePromptInstructionTokenSize(): number {
        // calculated from the highlights prompt which is the longest,
        // and then doubled it.
        return 10000;
    }
}
