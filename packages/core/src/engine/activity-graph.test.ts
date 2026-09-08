/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActivityItemGraph } from './activity-graph.js';
import { fuzzyNameMatch } from './grouped-graphs.js';

describe('fuzzy name match', () => {
    it('should match exact names', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John Doe'), true);
    });

    it('should match if only one first name is present', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John'), true);
    });

    it('should match if only one last name is present', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'Doe'), true);
    });

    it('should match names with different case', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'john doe'), true);
    });

    it('should match names with different spaces', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John  Doe'), true);
    });

    it('should match names with different dots', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John.Doe'), true);
    });

    it('should match names with different spaces, dots, and at signs', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John. Doe'), true);
    });

    it('should not match because last names are different', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'John Smith'), false);
    });

    it('should not match because first names are different', () => {
        assert.equal(fuzzyNameMatch('John Doe', 'Jane Doe'), false);
    });

    it('should match names with different emails', () => {
        assert.equal(fuzzyNameMatch('john@gmail.com', 'john.smith@gmail.com'), true);
    });

    it('should match names with different email domains', () => {
        assert.equal(fuzzyNameMatch('john@gmail.com', 'john.smith@hotmail.com'), true);
    });

    it('should not match names with same email domains', () => {
        assert.equal(fuzzyNameMatch('john.smith@gmail.com', 'jane.smith@gmail.com'), false);
    });
});

describe('ActivityItemGraph truncation methods', () => {
    describe('_truncateAtWordBoundary', () => {
        it('should return original text if shorter than limit', () => {
            const text = 'Short text';
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 100);
            assert.equal(result, 'Short text');
        });

        it('should return original text if exactly at limit', () => {
            const text = 'Exactly fifty characters in this string here now';
            const result = ActivityItemGraph._truncateAtWordBoundary(text, text.length);
            assert.equal(result, text);
        });

        it('should truncate at word boundary when conditions are met', () => {
            const text = 'This is a test string that needs to be truncated at a reasonable word boundary';
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 50);
            // Should truncate at or near the limit
            assert.ok(result.length <= 50);
            assert.ok(result.length > 40); // Should preserve most content
        });

        it('should handle long words by cutting at character limit', () => {
            const longWord = 'a'.repeat(150);
            const text = `Short text ${longWord} more text`;
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 200);
            // Should cut at character limit because the word is >100 chars
            assert.ok(result.length <= 200);
            assert.ok(result.includes('Short text'));
        });

        it('should handle email quote markers by cutting at character limit', () => {
            const quotes = '>'.repeat(120);
            const text = `Important message content ${quotes}`;
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 50);
            // Should cut at character limit, not preserve the long sequence of >
            assert.equal(result.length, 50);
        });

        it('should handle text with no spaces by cutting at character limit', () => {
            const text = 'a'.repeat(200);
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 100);
            assert.equal(result.length, 100);
            assert.equal(result, 'a'.repeat(100));
        });

        it('should preserve word boundary for normal words close to limit', () => {
            const text = 'This is some important text that should be truncated properly';
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 45);
            // Should truncate reasonably close to the limit
            assert.ok(result.length <= 45);
            assert.ok(result.length > 35); // Should be close to limit
            assert.ok(result.includes('This is some important'));
        });

        it('should cut at character limit if word boundary would remove too much content', () => {
            const text = 'Short text followed-by-very-long-hyphenated-word-that-exceeds-threshold';
            const result = ActivityItemGraph._truncateAtWordBoundary(text, 50);
            // Should not cut at the space before the long hyphenated word
            assert.equal(result.length, 50);
        });
    });

    describe('_truncateDocumentContent', () => {
        it('should handle null and undefined values', () => {
            assert.equal(ActivityItemGraph._truncateDocumentContent(null as any, 15000), null);
            assert.equal(ActivityItemGraph._truncateDocumentContent(undefined as any, 15000), undefined);
        });

        it('should handle empty strings', () => {
            assert.equal(ActivityItemGraph._truncateDocumentContent('', 15000), '');
        });

        it('should handle non-string values', () => {
            assert.equal(ActivityItemGraph._truncateDocumentContent(123 as any, 15000), 123);
        });

        it('should use specified char limit for document content', () => {
            const longContent = 'Document content line.\n'.repeat(1000); // ~23000 chars
            const result = ActivityItemGraph._truncateDocumentContent(longContent, 15000);
            assert.ok(result.length <= 15000);
            assert.ok(result.length > 14000); // Should be close to limit
        });

        it('should not truncate short document content', () => {
            const shortContent = 'This is a short document.';
            const result = ActivityItemGraph._truncateDocumentContent(shortContent, 15000);
            assert.equal(result, shortContent);
        });

        it('should preserve beginning of document content', () => {
            const content = 'IMPORTANT HEADER\n\n' + 'Body content line.\n'.repeat(1000);
            const result = ActivityItemGraph._truncateDocumentContent(content, 15000);
            assert.ok(result.includes('IMPORTANT HEADER'));
            assert.ok(result.length <= 15000);
        });

        it('should handle documents with very long lines', () => {
            const longLine = 'a'.repeat(16000);
            const result = ActivityItemGraph._truncateDocumentContent(longLine, 15000);
            assert.equal(result.length, 15000);
        });
    });

    describe('edge cases and integration', () => {
        it('should handle text with unicode characters', () => {
            const unicodeText = 'Hello 👋 World 🌍 with émojis and açcénts '.repeat(100);
            const result = ActivityItemGraph._truncateAtWordBoundary(unicodeText, 200);
            assert.ok(result.length <= 200);
        });

        it('should handle whitespace-only strings', () => {
            const whitespace = '   \n\t  ';
            const result = ActivityItemGraph._truncateAtWordBoundary(whitespace, 100);
            assert.equal(result, whitespace);
        });

        it('should handle strings with only punctuation', () => {
            const punctuation = '!!!???...;;;:::'.repeat(50);
            const result = ActivityItemGraph._truncateAtWordBoundary(punctuation, 100);
            assert.equal(result.length, 100);
        });
    });
});
