import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ActivityItemGraph } from '../engine/activity-graph.js';
import { LlmClient } from './client.js';
import { ModelSpec } from './models.js';
import { PromptProcessor } from './prompt-processor.js';

function testSpec(contextWindowTokens: number): ModelSpec {
    return {
        id: 'test-model',
        provider: 'anthropic',
        model: 'test-model',
        contextWindowTokens,
    };
}

// The LLM is never reached in these tests (either no tasks run or _genPrompt is stubbed)
const fakeLlm = {} as LlmClient;

describe('prompt-processor', () => {
    it('truncates text', () => {
        const input = 'Lorem ipsum odor amet, consectetuer adipiscing elit.';
        const maxTokens = 4;
        const padding = 2;
        const res = new PromptProcessor(
            'comments',
            [],
            {
                default: testSpec(maxTokens),
                fallback: [],
            },
            fakeLlm,
        )._truncateToMaxNumberOfTokens(input, maxTokens, padding);
        assert.equal(res.length, (maxTokens - padding) * 4);
        assert.equal(res, 'Lorem ip');
    });

    it('truncates text end to end', async () => {
        const maxChars = 100;
        const maxTokens = maxChars / 4;

        const p = new PromptProcessor(
            'comments',
            [
                {
                    getPrompt: (body) => {
                        // passthrough the body
                        return {
                            id: 'activity_highlights',
                            messages: [{ content: body, role: 'user' }],
                        };
                    },
                    shouldContinueToNext: async () => false,
                },
            ],
            {
                // context window equal to the char budget so truncation kicks in
                default: testSpec(maxTokens),
                fallback: [],
            },
            fakeLlm,
        );

        // stub the methods to return test values
        mock.method(p, '_getAveragePromptInstructionTokenSize', () => 0);
        mock.method(p, '_genPrompt', (m: { content: string | { text: string }[] }[]) => {
            return new Promise((resolve) =>
                // pass the content through
                resolve({
                    content: Array.isArray(m[0].content) ? m[0].content[0].text : m[0].content,
                    usage: { inputTokens: 0, outputTokens: 0 },
                }),
            );
        });

        // generate a random string of n characters
        const randomString = (length: number) => {
            const chars = 'abcdefghijklmnopqrstuvwxyz';
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        };

        const charsPerWord = 10;
        const numWords = Math.floor(maxChars / charsPerWord);
        const words: string[] = [];
        for (let i = 0; i < numWords; i++) {
            words.push(randomString(charsPerWord));
        }

        const input = words.join(' ');
        const res = await p.process(input);
        assert.equal(res.length, maxChars);
        assert.equal(res, input.slice(0, maxChars));
    });

    it('falls back to the next model when the default fails', async () => {
        const calls: string[] = [];
        const llm = {
            genChatCompletion: async (_req: unknown, spec: ModelSpec) => {
                calls.push(spec.id);
                if (spec.id === 'primary') {
                    throw new Error('primary model unavailable');
                }
                return { content: ['fallback response'], usage: { inputTokens: 1, outputTokens: 1 } };
            },
        } as unknown as LlmClient;

        const p = new PromptProcessor(
            'comments',
            [
                {
                    getPrompt: (body) => ({ id: 'task', messages: [{ role: 'user', content: body }] }),
                    shouldContinueToNext: async () => false,
                },
            ],
            {
                default: { ...testSpec(100000), id: 'primary' },
                fallback: [{ ...testSpec(100000), id: 'secondary' }],
            },
            llm,
        );

        const res = await p.process('hello');
        assert.equal(res, 'fallback response');
        assert.deepEqual(calls, ['primary', 'secondary']);
    });

    it('serves identical requests from the cache and skips the cache on retries', async () => {
        const store = new Map<string, string>();
        const cache = {
            get: async (k: string) => store.get(k),
            set: async (k: string, v: string) => {
                store.set(k, v);
            },
            del: async (k: string) => {
                store.delete(k);
            },
        };

        let llmCalls = 0;
        const llm = {
            genChatCompletion: async () => {
                llmCalls++;
                return { content: [`response-${llmCalls}`], usage: { inputTokens: 1, outputTokens: 1 } };
            },
        } as unknown as LlmClient;

        const makeProcessor = () =>
            new PromptProcessor(
                'comments',
                [
                    {
                        getPrompt: () => ({ id: 'task', messages: [{ role: 'user', content: 'same prompt' }] }),
                        shouldContinueToNext: async () => false,
                    },
                ],
                { default: testSpec(100000), fallback: [] },
                llm,
                { cache },
            );

        const first = await makeProcessor().process('');
        const second = await makeProcessor().process('');
        assert.equal(first, 'response-1');
        assert.equal(second, 'response-1'); // cached
        assert.equal(llmCalls, 1);
    });
});

describe('prompt body sanitization', () => {
    it('should remove markdown image syntax', () => {
        const input = 'Text with ![image](https://example.com/image.jpg) markdown image';
        const expected = 'Text with  markdown image';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should remove base64 encoded images', () => {
        const input = 'Text with data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY embedded';
        const expected = 'Text with  embedded';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should handle multiple images and base64 strings', () => {
        const input =
            'Multiple ![image1](image1.jpg) images and ![image2](image2.jpg) with data:image/jpeg;base64,/9j/4AAQSkZJRg content';
        const expected = 'Multiple  images and  with  content';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should handle text without any images or base64', () => {
        const input = 'Plain text without any images';
        assert.equal(ActivityItemGraph._sanitizeText(input), input);
    });

    it('should handle empty string', () => {
        assert.equal(ActivityItemGraph._sanitizeText(''), '');
    });

    it('should preserve newlines and spacing', () => {
        const input = `Line 1
        ![image](test.jpg)
        Line 2`;
        const expected = 'Line 1\n        \n        Line 2';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should remove URLs in angle brackets', () => {
        const input = 'Text with <https://example.com/page> in angle brackets';
        const expected = 'Text with  in angle brackets';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should remove URLs in square brackets', () => {
        const input = 'Text with [https://example.com/page] in square brackets';
        const expected = 'Text with  in square brackets';
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should truncate long words', () => {
        const longWord = 'ThisIsAReallyLongWordThatShouldBeTruncatedBecauseItExceedsTheMaximumCharacterLimit';
        const input = `Text with ${longWord} that should be truncated`;
        // The long word should be truncated to x characters
        const expected = `Text with ${longWord.substring(
            0,
            ActivityItemGraph.MAX_WORD_LENGTH,
        )} that should be truncated`;
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });

    it('should handle multiple URL formats and long words', () => {
        const longWord = 'SuperLongTokenThatExceedsTheMaximumAllowedCharacters';
        const input = `Text with <https://example.com> and [https://another-example.com] and ${longWord}`;
        const expected = `Text with  and  and ${longWord.substring(0, ActivityItemGraph.MAX_WORD_LENGTH)}`;
        assert.equal(ActivityItemGraph._sanitizeText(input), expected);
    });
});
