import { ItemLink, resolveItemUrl } from '../ports/config.js';

/**
 * Token prefix used in LLM prompts for item links. The model emits markdown links
 * like [text](item-1756bc67-uuid/<uuid>) and the engine replaces the token with the
 * consumer's item URL endpoint after generation.
 */
export const PROMPT_URL_TOKEN_PREFIX = 'item-1756bc67-uuid';

// 36 for the UUID, 2 for parentheses, and 2 for potential extra characters
const MAX_URL_TOKEN_LENGTH = PROMPT_URL_TOKEN_PREFIX.length + 36 + 2 + 2;
const BUFFER_SIZE = MAX_URL_TOKEN_LENGTH + 10; // 10 = some extra buffer space
/**
 * Processes streaming text data to detect and replace URL tokens with a formatted endpoint.
 *
 * The `UrlStreamProcessor` class is designed to handle cases where URL tokens may be split across multiple
 * incoming string chunks, such as when processing streamed data. It buffers incomplete tokens and ensures
 * that only complete tokens are replaced, preventing malformed replacements.
 *
 * @remarks
 * - URL tokens are expected to be in the format: `(${PROMPT_URL_TOKEN_PREFIX}/<uuid>)`
 * - The processor uses a buffer to handle tokens that may be split across chunk boundaries.
 * - If the buffer grows too large or no potential token is found, the entire buffer is processed.
 *
 * @example
 * ```typescript
 * const processor = new UrlStreamProcessor('https://example.com/resource/');
 * const output = processor.processChunk('Some text with a token (URLTOKEN/123e4567-e89b-12d3-a456-426614174000)');
 * // output: ['Some text with a token (https://example.com/resource/123e4567-e89b-12d3-a456-426614174000)']
 * ```
 */
export class UrlStreamProcessor {
    private _buffer = '';
    private readonly _regexp: RegExp;
    private readonly _endpoint: string;
    private readonly _tokenPrefix: string;
    private readonly _maxBufferSize: number;

    constructor(endpoint: string, tokenPrefix = PROMPT_URL_TOKEN_PREFIX, maxBufferSize = BUFFER_SIZE) {
        this._endpoint = endpoint;
        this._tokenPrefix = tokenPrefix;
        this._maxBufferSize = maxBufferSize;
        this._regexp = new RegExp(
            `\\(${this._tokenPrefix}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\)`,
            'g',
        );
    }

    /**
     * Processes a chunk of string data, searching for URL tokens and replacing them with a formatted endpoint.
     * Handles incomplete tokens that may be split across multiple chunks by buffering data until a complete token is detected.
     * If the buffer grows too large or no potential token is found, processes the entire buffer.
     *
     * @param chunk - The incoming string chunk to process.
     * @returns An array of processed string segments, with URL tokens replaced as appropriate.
     */
    processChunk(chunk: string): string[] {
        const results: string[] = [];
        this._buffer += chunk;

        // Handle empty buffer
        if (!this._buffer) {
            return results;
        }

        // Find the last occurrence of '(' to check for incomplete URL tokens
        const lastOpenParen = this._buffer.lastIndexOf('(');

        if (lastOpenParen === -1) {
            // No open paren found - process everything
            const processedText = this._buffer.replace(this._regexp, `(${this._endpoint}$1)`);
            results.push(processedText);
            this._buffer = '';
        } else if (this._buffer.length - lastOpenParen > this._maxBufferSize) {
            // Buffer after the last '(' is too large - can't be a valid token
            // Process everything to prevent indefinite buffering
            const processedText = this._buffer.replace(this._regexp, `(${this._endpoint}$1)`);
            results.push(processedText);
            this._buffer = '';
        } else {
            // Check if we might have an incomplete URL token
            const afterOpenParen = this._buffer.slice(lastOpenParen + 1);

            // Check if this could be the start of our token
            // Check if the token prefix starts with what we have (handles partial prefix)
            const couldBePartialPrefix = this._tokenPrefix.startsWith(afterOpenParen) && afterOpenParen.length > 0;

            // Check if we have the full prefix and potential UUID chars after it
            const hasValidPrefix = afterOpenParen.startsWith(this._tokenPrefix + '/');
            const afterPrefix = hasValidPrefix ? afterOpenParen.slice(this._tokenPrefix.length + 1) : '';
            const couldBeValidUuid = hasValidPrefix && (afterPrefix === '' || /^[0-9a-f-]*$/.test(afterPrefix));

            // Empty after paren means we just have '(' which could be start of token
            const isEmptyAfterParen = afterOpenParen === '';

            // Only consider it an incomplete token if it could potentially be valid
            const couldBeIncompleteToken = isEmptyAfterParen || couldBePartialPrefix || couldBeValidUuid;

            // Check if the potential token part is within reasonable bounds
            // If it's too long, it can't be a valid token, so process everything
            if (couldBeIncompleteToken && afterOpenParen.length < MAX_URL_TOKEN_LENGTH) {
                // Potential incomplete token - yield everything before the last '('
                if (lastOpenParen > 0) {
                    const safeText = this._buffer
                        .slice(0, lastOpenParen)
                        .replace(this._regexp, `(${this._endpoint}$1)`);
                    results.push(safeText);
                    this._buffer = this._buffer.slice(lastOpenParen); // Keep the potential token part
                }
                // If lastOpenParen is 0, keep the entire buffer for next iteration
            } else {
                // Either not a URL token OR the potential token is too long - process everything
                const processedText = this._buffer.replace(this._regexp, `(${this._endpoint}$1)`);
                results.push(processedText);
                this._buffer = '';
            }
        }
        return results;
    }

    /**
     * Process any remaining buffer at the end of the stream.
     */
    flush(): string | undefined {
        if (this._buffer) {
            const finalText = this._buffer.replace(this._regexp, `(${this._endpoint}$1)`);
            this._buffer = '';
            return finalText;
        }
        return undefined;
    }

    static replaceUrlsInText(text: string, endpoint: string, tokenPrefix = PROMPT_URL_TOKEN_PREFIX): string {
        const regexp = new RegExp(
            `\\(${tokenPrefix}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\)`,
            'g',
        );
        return text.replace(regexp, `(${endpoint}$1)`);
    }

    /**
     * Removes item-link tokens entirely, converting markdown links back to plain
     * text. Used when no item URL endpoint is configured.
     */
    static stripUrlTokens(text: string, tokenPrefix = PROMPT_URL_TOKEN_PREFIX): string {
        const regexp = new RegExp(
            `\\[([^\\]]*)\\]\\(${tokenPrefix}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\)`,
            'g',
        );
        return text.replace(regexp, '$1');
    }
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Renders item-link tokens in generated text using the configured {@link ItemLink}.
 * Markdown links whose item resolves to no URL are reduced to their label;
 * resolvable ones get the real URL substituted.
 */
export function renderItemLinks(
    text: string,
    itemLink: ItemLink | undefined,
    tokenPrefix = PROMPT_URL_TOKEN_PREFIX,
): string {
    // Full markdown links first: [label](token/uuid)
    const mdRegexp = new RegExp(`\\[([^\\]]*)\\]\\(${tokenPrefix}/(${UUID_PATTERN})\\)`, 'g');
    let out = text.replace(mdRegexp, (_m, label: string, uuid: string) => {
        const url = resolveItemUrl(itemLink, uuid);
        return url ? `[${label}](${url})` : label;
    });
    // Then any bare (token/uuid) occurrences
    const bareRegexp = new RegExp(`\\(${tokenPrefix}/(${UUID_PATTERN})\\)`, 'g');
    out = out.replace(bareRegexp, (_m, uuid: string) => {
        const url = resolveItemUrl(itemLink, uuid);
        return url ? `(${url})` : '';
    });
    return out;
}
