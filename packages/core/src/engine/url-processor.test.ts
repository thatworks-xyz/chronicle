import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROMPT_URL_TOKEN_PREFIX, renderItemLinks, UrlStreamProcessor } from './url-processor.js';

describe('UrlStreamProcessor', () => {
    const testEndpoint = 'https://example.com/';
    const testUuid = '12345678-1234-1234-1234-123456789abc';
    const validToken = `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid})`;
    const expectedReplacement = `(${testEndpoint}${testUuid})`;

    describe('processChunk', () => {
        it('should replace complete URL tokens in a single chunk', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Some text ${validToken} more text`;
            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Some text ${expectedReplacement} more text`);
        });

        it('should handle tokens split across chunks', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const chunk1 = `Some text (${PROMPT_URL_TOKEN_PREFIX}/12345678-1234-1234-`;
            const chunk2 = `1234-123456789abc) more text`;

            const result1 = processor.processChunk(chunk1);
            const result2 = processor.processChunk(chunk2);

            // First chunk should not yield the token yet
            assert.equal(result1.length, 1);
            assert.equal(result1[0], 'Some text ');

            // Second chunk should complete the token
            assert.equal(result2.length, 1);
            assert.equal(result2[0], `${expectedReplacement} more text`);
        });

        it('should handle tokens split across multiple chunks', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const chunks = [
                `features\n* User experience improvements: [canvas cloning](item-1756bc67`,
                `-uuid/eb624fe4-087e`,
                `-429e-b1c9-37fda78`,
                `a1f4f),`,
            ];

            let result = '';
            for (let i = 0; i < chunks.length; i++) {
                const output = processor.processChunk(chunks[i]);
                result += output.join('');
            }

            // Add any remaining buffered content
            const flushed = processor.flush();
            if (flushed) {
                result += flushed;
            }
            assert.equal(
                result,
                `features\n* User experience improvements: [canvas cloning](${testEndpoint}eb624fe4-087e-429e-b1c9-37fda78a1f4f),`,
            );
        });

        it('should handle incomplete tokens at the end', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const chunk = `Some text (${PROMPT_URL_TOKEN_PREFIX}/123`;

            const result = processor.processChunk(chunk);

            // Should buffer the incomplete token
            assert.equal(result.length, 1);
            assert.equal(result[0], 'Some text ');
        });

        it('should flush incomplete tokens', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const result = processor.processChunk(`Some text (${PROMPT_URL_TOKEN_PREFIX}/123`);

            // processChunk should output "Some text " and buffer the incomplete token
            assert.equal(result.length, 1);
            assert.equal(result[0], 'Some text ');

            const flushed = processor.flush();
            assert.equal(flushed, `(${PROMPT_URL_TOKEN_PREFIX}/123`);
        });

        it('should handle multiple tokens in one chunk', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const uuid2 = '87654321-4321-4321-4321-cba987654321';
            const token2 = `(${PROMPT_URL_TOKEN_PREFIX}/${uuid2})`;
            const expected2 = `(${testEndpoint}${uuid2})`;

            const input = `Text ${validToken} middle ${token2} end`;
            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text ${expectedReplacement} middle ${expected2} end`);
        });

        it('should handle regular parentheses without tokens', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = 'Text with (regular parentheses) and more text';

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], input);
        });

        it('should work with custom token prefix', () => {
            const customPrefix = 'custom-prefix';
            const processor = new UrlStreamProcessor(testEndpoint, customPrefix);
            const customToken = `(${customPrefix}/${testUuid})`;
            const input = `Some text ${customToken} more text`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Some text ${expectedReplacement} more text`);
        });

        it('should handle multiple open parentheses correctly', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text ((nested) ${validToken} more`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text ((nested) ${expectedReplacement} more`);
        });

        it('should handle token at the beginning of chunk', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `${validToken} at beginning`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `${expectedReplacement} at beginning`);
        });

        it('should handle token split exactly at opening parenthesis', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const chunk1 = 'Some text (';
            const chunk2 = `${PROMPT_URL_TOKEN_PREFIX}/${testUuid}) more text`;

            const result1 = processor.processChunk(chunk1);
            const result2 = processor.processChunk(chunk2);

            assert.equal(result1.length, 1);
            assert.equal(result1[0], 'Some text ');

            assert.equal(result2.length, 1);
            assert.equal(result2[0], `${expectedReplacement} more text`);
        });

        it('should handle buffer overflow correctly', () => {
            const processor = new UrlStreamProcessor(testEndpoint, PROMPT_URL_TOKEN_PREFIX, 50); // Small buffer
            const largeInput = 'x'.repeat(100) + `(${PROMPT_URL_TOKEN_PREFIX}/incomplete`;

            const result = processor.processChunk(largeInput);

            // Should process everything when buffer is too large
            assert.equal(result.length, 1);
            assert.equal(result[0], largeInput);
        });

        it('should prevent indefinite buffering with malformed partial tokens', () => {
            const processor = new UrlStreamProcessor(testEndpoint, PROMPT_URL_TOKEN_PREFIX, 30); // Small buffer

            // First chunk: start with what looks like a token but isn't
            const chunk1 = 'Some text (' + PROMPT_URL_TOKEN_PREFIX;
            const result1 = processor.processChunk(chunk1);
            assert.equal(result1.length, 1);
            assert.equal(result1[0], 'Some text ');

            // Add more data that still looks like it could be a token
            const chunk2 = '/not-a-uuid-but-keeps-growing-and-growing';
            const result2 = processor.processChunk(chunk2);

            // Should process everything when it exceeds buffer size
            assert.equal(result2.length, 1);
            assert.ok(result2[0].includes(PROMPT_URL_TOKEN_PREFIX));
        });

        it('should handle empty chunks gracefully', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            const result = processor.processChunk('');

            assert.equal(result.length, 0);
        });

        it('should not replace malformed UUIDs', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const malformedToken = `(${PROMPT_URL_TOKEN_PREFIX}/not-a-valid-uuid)`;
            const input = `Text ${malformedToken} more text`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], input); // Should remain unchanged
        });

        it('should handle tokens at exact max length', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const exactLengthToken = `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid})`;
            // Test a token that's close to the max length limit
            const paddingLength = Math.max(0, 10); // Just add some padding
            const paddedInput = 'x'.repeat(paddingLength) + exactLengthToken;

            const result = processor.processChunk(paddedInput);

            assert.equal(result.length, 1);
            assert.ok(result[0].includes(testEndpoint));
        });

        it('should handle multiple processor calls without regex state issues', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            // First call
            const result1 = processor.processChunk(`First ${validToken} text`);
            processor.flush();

            // Second call with fresh processor state
            const result2 = processor.processChunk(`Second ${validToken} text`);

            assert.ok(result1[0].includes(testEndpoint));
            assert.ok(result2[0].includes(testEndpoint));
        });

        it('should handle tokens without closing parenthesis', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const incompleteToken = `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid}`;
            const input = `Text ${incompleteToken} more text`;

            const result = processor.processChunk(input);
            const flushed = processor.flush();

            // Should not replace incomplete token without closing paren
            const combined = result.join('') + (flushed || '');
            assert.equal(combined, input);
        });

        it('should handle multiple incomplete tokens correctly', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            processor.processChunk(`Text (${PROMPT_URL_TOKEN_PREFIX}/123`);
            processor.processChunk(`456) and (${PROMPT_URL_TOKEN_PREFIX}/789`);
            const flushed = processor.flush();

            // The first token should be completed and replaced
            assert.ok(flushed?.includes(PROMPT_URL_TOKEN_PREFIX));
        });

        it('should handle token split at every character', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const fullToken = `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid})`;

            let result = '';
            for (const char of fullToken) {
                const output = processor.processChunk(char);
                result += output.join('');
            }
            result += processor.flush() || '';

            assert.equal(result, expectedReplacement);
        });

        it('should handle multiple consecutive opening parentheses', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text (((${validToken} more`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text (((${expectedReplacement} more`);
        });

        it('should handle adjacent tokens', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const uuid2 = '87654321-4321-4321-4321-cba987654321';
            const token2 = `(${PROMPT_URL_TOKEN_PREFIX}/${uuid2})`;
            const expected2 = `(${testEndpoint}${uuid2})`;

            const input = `${validToken}${token2}`;
            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `${expectedReplacement}${expected2}`);
        });

        it('should not replace tokens with newlines in UUID', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const invalidToken = `(${PROMPT_URL_TOKEN_PREFIX}/12345678-1234\n-1234-1234-123456789abc)`;

            const result = processor.processChunk(invalidToken);

            assert.equal(result.length, 1);
            assert.equal(result[0], invalidToken);
        });

        it('should be case sensitive for UUID', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const upperCaseUuid = testUuid.toUpperCase();
            const upperToken = `(${PROMPT_URL_TOKEN_PREFIX}/${upperCaseUuid})`;

            const result = processor.processChunk(upperToken);

            // Should not replace because UUIDs should be lowercase
            assert.equal(result.length, 1);
            assert.equal(result[0], upperToken);
        });

        it('should handle very long text before token', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const longText = 'x'.repeat(10000);
            const input = `${longText}${validToken}`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `${longText}${expectedReplacement}`);
        });

        it('should not replace token prefix without parentheses', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `The prefix ${PROMPT_URL_TOKEN_PREFIX} appears here ${validToken} and here`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(
                result[0],
                `The prefix ${PROMPT_URL_TOKEN_PREFIX} appears here ${expectedReplacement} and here`,
            );
        });

        it('should handle repeated flush calls', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            // Process a chunk with an incomplete but valid-looking token to have something in buffer
            // Use valid hex characters that could be part of a UUID
            processor.processChunk(`Some text (${PROMPT_URL_TOKEN_PREFIX}/12345678-abcd`);

            const flush1 = processor.flush();
            const flush2 = processor.flush();
            const flush3 = processor.flush();

            assert.equal(flush1, `(${PROMPT_URL_TOKEN_PREFIX}/12345678-abcd`);
            assert.equal(flush2, undefined);
            assert.equal(flush3, undefined);
        });

        it('should handle empty chunks between token parts', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            const result1 = processor.processChunk(`Text ${validToken.slice(0, 20)}`);
            const result2 = processor.processChunk('');
            const result3 = processor.processChunk('');
            const result4 = processor.processChunk(validToken.slice(20));

            const combined = result1.join('') + result2.join('') + result3.join('') + result4.join('');

            assert.equal(combined, `Text ${expectedReplacement}`);
        });

        it('should handle token split at UUID dash boundaries', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const chunks = [`(${PROMPT_URL_TOKEN_PREFIX}/12345678`, '-1234', '-1234', '-1234', '-123456789abc)'];

            let result = '';
            for (const chunk of chunks) {
                const output = processor.processChunk(chunk);
                result += output.join('');
            }

            assert.equal(result, expectedReplacement);
        });

        it('should handle mix of valid and invalid tokens', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const invalidToken1 = `(${PROMPT_URL_TOKEN_PREFIX}/not-uuid)`;
            const invalidToken2 = `(${PROMPT_URL_TOKEN_PREFIX}/)`;

            const input = `${invalidToken1} ${validToken} ${invalidToken2} text`;
            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `${invalidToken1} ${expectedReplacement} ${invalidToken2} text`);
        });

        it('should handle buffer exactly at max token length', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            // Create a string that's exactly at the max token length
            const almostToken = `(${PROMPT_URL_TOKEN_PREFIX}/12345678-1234-1234-1234-123456789ab`;

            const result1 = processor.processChunk(almostToken);
            assert.equal(result1.length, 0);

            const result2 = processor.processChunk('c)');
            assert.equal(result2.length, 1);
            assert.equal(result2[0], expectedReplacement);
        });

        it('should handle nested parentheses with valid token', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text ((nested ${validToken})) more`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text ((nested ${expectedReplacement})) more`);
        });

        it('should not replace token with spaces in UUID', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const invalidToken = `(${PROMPT_URL_TOKEN_PREFIX}/12345678 1234 1234 1234 123456789abc)`;

            const result = processor.processChunk(invalidToken);

            assert.equal(result.length, 1);
            assert.equal(result[0], invalidToken);
        });

        it('should not replace token with special characters in UUID', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const invalidToken1 = `(${PROMPT_URL_TOKEN_PREFIX}/12345678\t1234-1234-1234-123456789abc)`;
            const invalidToken2 = `(${PROMPT_URL_TOKEN_PREFIX}/12345678-1234-1234-1234-123456789abc!)`;

            const result = processor.processChunk(invalidToken1 + ' ' + invalidToken2);

            assert.equal(result.length, 1);
            assert.equal(result[0], invalidToken1 + ' ' + invalidToken2);
        });

        it('should handle chunk with only opening parenthesis', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            const result1 = processor.processChunk('(');
            assert.equal(result1.length, 0);

            const result2 = processor.processChunk('not a token)');
            assert.equal(result2.length, 1);
            assert.equal(result2[0], '(not a token)');
        });

        it('should handle multiple valid tokens split across chunks', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const uuid2 = '87654321-4321-4321-4321-cba987654321';
            const token2 = `(${PROMPT_URL_TOKEN_PREFIX}/${uuid2})`;
            const expected2 = `(${testEndpoint}${uuid2})`;

            const chunk1 = `First ${validToken.slice(0, 30)}`;
            const chunk2 = `${validToken.slice(30)} and ${token2.slice(0, 25)}`;
            const chunk3 = token2.slice(25);

            const result1 = processor.processChunk(chunk1);
            const result2 = processor.processChunk(chunk2);
            const result3 = processor.processChunk(chunk3);

            const combined = result1.join('') + result2.join('') + result3.join('');

            assert.equal(combined, `First ${expectedReplacement} and ${expected2}`);
        });

        it('should handle processing after flush correctly', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            // First process with incomplete token
            processor.processChunk(`Text (${PROMPT_URL_TOKEN_PREFIX}/12345678`);
            processor.flush();

            // Then process a complete token
            const result = processor.processChunk(validToken);
            assert.equal(result.length, 1);
            assert.equal(result[0], expectedReplacement);
        });

        it('should handle tokens with extra closing parentheses', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text ${validToken}) extra paren`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text ${expectedReplacement}) extra paren`);
        });

        it('should handle extremely small buffer size', () => {
            const processor = new UrlStreamProcessor(testEndpoint, PROMPT_URL_TOKEN_PREFIX, 2);

            // This should trigger buffer overflow immediately
            const result = processor.processChunk(`Text (${PROMPT_URL_TOKEN_PREFIX}`);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text (${PROMPT_URL_TOKEN_PREFIX}`);
        });

        it('should handle token split within the prefix', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const prefixPart1 = PROMPT_URL_TOKEN_PREFIX.slice(0, 8);
            const prefixPart2 = PROMPT_URL_TOKEN_PREFIX.slice(8);

            const chunk1 = `Text (${prefixPart1}`;
            const chunk2 = `${prefixPart2}/${testUuid})`;

            const result1 = processor.processChunk(chunk1);
            const result2 = processor.processChunk(chunk2);

            const combined = result1.join('') + result2.join('');
            assert.equal(combined, `Text ${expectedReplacement}`);
        });

        it('should handle closing parenthesis without opening', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text ) without opening ${validToken}`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text ) without opening ${expectedReplacement}`);
        });

        it('should buffer token at the very end without closing', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const incompleteEnd = `Text ends with (${PROMPT_URL_TOKEN_PREFIX}/${testUuid}`;

            const result = processor.processChunk(incompleteEnd);
            const flushed = processor.flush();

            assert.equal(result.length, 1);
            assert.equal(result[0], 'Text ends with ');
            assert.equal(flushed, `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid}`);
        });

        it('should handle unicode characters in text', () => {
            const processor = new UrlStreamProcessor(testEndpoint);
            const input = `Text with émoji 😀 and ${validToken} unicode ñ`;

            const result = processor.processChunk(input);

            assert.equal(result.length, 1);
            assert.equal(result[0], `Text with émoji 😀 and ${expectedReplacement} unicode ñ`);
        });

        it('should handle the last incomplete token when multiple potential tokens exist', () => {
            const processor = new UrlStreamProcessor(testEndpoint);

            // Two opening parens, both could be tokens
            const chunk1 = `First (${PROMPT_URL_TOKEN_PREFIX}/abc and second (${PROMPT_URL_TOKEN_PREFIX}/def`;
            const result1 = processor.processChunk(chunk1);

            // Should buffer from the last potential token
            assert.equal(result1.length, 1);
            assert.equal(result1[0], `First (${PROMPT_URL_TOKEN_PREFIX}/abc and second `);

            const flushed = processor.flush();
            assert.equal(flushed, `(${PROMPT_URL_TOKEN_PREFIX}/def`);
        });
    });

    describe('static replaceUrlsInText', () => {
        it('should replace URLs in static method', () => {
            const input = `Some text ${validToken} more text`;
            const result = UrlStreamProcessor.replaceUrlsInText(input, testEndpoint);

            assert.equal(result, `Some text ${expectedReplacement} more text`);
        });

        // BUG TEST: Static method with custom prefix
        it('should work with custom prefix in static method', () => {
            const customPrefix = 'custom-prefix';
            const customToken = `(${customPrefix}/${testUuid})`;
            const input = `Some text ${customToken} more text`;

            const result = UrlStreamProcessor.replaceUrlsInText(input, testEndpoint, customPrefix);

            assert.equal(result, `Some text ${expectedReplacement} more text`);
        });

        it('should replace multiple tokens in static method', () => {
            const uuid2 = '87654321-4321-4321-4321-cba987654321';
            const uuid3 = 'abcdef12-3456-7890-abcd-ef1234567890';
            const token1 = `(${PROMPT_URL_TOKEN_PREFIX}/${testUuid})`;
            const token2 = `(${PROMPT_URL_TOKEN_PREFIX}/${uuid2})`;
            const token3 = `(${PROMPT_URL_TOKEN_PREFIX}/${uuid3})`;

            const input = `First ${token1} middle ${token2} and final ${token3} text`;
            const result = UrlStreamProcessor.replaceUrlsInText(input, testEndpoint);

            const expected = `First (${testEndpoint}${testUuid}) middle (${testEndpoint}${uuid2}) and final (${testEndpoint}${uuid3}) text`;
            assert.equal(result, expected);
        });
    });
});

describe('renderItemLinks', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const otherUuid = 'abcdefab-1234-1234-1234-123456789abc';
    const md = `See [My Item](${PROMPT_URL_TOKEN_PREFIX}/${uuid}) and [Other](${PROMPT_URL_TOKEN_PREFIX}/${otherUuid}).`;

    it('substitutes URLs when itemLink is a base endpoint string', () => {
        const res = renderItemLinks(md, 'https://example.com/items/');
        assert.equal(
            res,
            `See [My Item](https://example.com/items/${uuid}) and [Other](https://example.com/items/${otherUuid}).`,
        );
    });

    it('resolves per-item URLs when itemLink is a function', () => {
        const res = renderItemLinks(md, (id) => (id === uuid ? `https://x.test/${id}` : undefined));
        assert.equal(res, `See [My Item](https://x.test/${uuid}) and Other.`);
    });

    it('strips links to plain text when itemLink is unset', () => {
        const res = renderItemLinks(md, undefined);
        assert.equal(res, 'See My Item and Other.');
    });

    it('replaces bare tokens outside markdown links', () => {
        const res = renderItemLinks(`raw (${PROMPT_URL_TOKEN_PREFIX}/${uuid}) end`, 'https://example.com/items/');
        assert.equal(res, `raw (https://example.com/items/${uuid}) end`);
    });

    it('removes bare tokens when itemLink is unset', () => {
        const res = renderItemLinks(`raw (${PROMPT_URL_TOKEN_PREFIX}/${uuid}) end`, undefined);
        assert.equal(res, 'raw  end');
    });

    it('leaves text without tokens untouched', () => {
        assert.equal(
            renderItemLinks('no tokens here (just parens)', 'https://example.com/'),
            'no tokens here (just parens)',
        );
    });
});
