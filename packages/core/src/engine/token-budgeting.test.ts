import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    applyCombinedTextTokenBudgeting,
    calculateBlockTokenBudgets,
    estimateTokensFromString,
    truncateToTokenBudget,
} from './token-budgeting.js';

describe('Token Budget Management', () => {
    const DEFAULT_TOTAL_BUDGET = 120000;

    describe('estimateTokens', () => {
        it('should estimate tokens correctly', () => {
            assert.equal(estimateTokensFromString('Hello'), 2); // 5 chars / 4 = 1.25 -> 2
            assert.equal(estimateTokensFromString('Hello world'), 3); // 11 chars / 4 = 2.75 -> 3
            assert.equal(estimateTokensFromString(''), 0);
        });
    });

    describe('calculateBlockBudgets', () => {
        it('should handle zero blocks', () => {
            const result = calculateBlockTokenBudgets(0, DEFAULT_TOTAL_BUDGET);
            assert.deepEqual(result, []);
        });

        it('should give full budget to single block', () => {
            const result = calculateBlockTokenBudgets(1, DEFAULT_TOTAL_BUDGET);
            assert.deepEqual(result, [120000]); // totalBudget
        });

        it('should distribute budget equally for multiple blocks', () => {
            const result = calculateBlockTokenBudgets(3, DEFAULT_TOTAL_BUDGET);
            assert.deepEqual(result, [40000, 40000, 40000]); // 120k / 3
        });

        it('should keep all blocks even when budget is very limited', () => {
            const result = calculateBlockTokenBudgets(20, DEFAULT_TOTAL_BUDGET);
            const expectedBudgetPerBlock = 120000 / 20; // 6000 tokens per block
            assert.equal(result.length, 20); // All blocks kept
            assert.equal(
                result.every((budget) => budget === expectedBudgetPerBlock),
                true,
            );
        });

        it('should handle edge case with small budget', () => {
            const result = calculateBlockTokenBudgets(5, 5000);
            assert.equal(result.length, 5); // All blocks kept
            assert.deepEqual(result, [1000, 1000, 1000, 1000, 1000]);
        });
    });

    describe('truncateToTokenBudget', () => {
        it('should not truncate text within budget', () => {
            const text = 'Short text';
            const result = truncateToTokenBudget(text, 1000);
            assert.equal(result, text);
        });

        it('should truncate text exceeding budget', () => {
            const longText = 'A'.repeat(1000); // ~250 tokens
            const result = truncateToTokenBudget(longText, 100); // 100 token budget
            assert.ok(estimateTokensFromString(result) <= 100);
            assert.equal(result.length, 400); // 100 * 4 chars per token
        });

        it('should handle empty text', () => {
            const result = truncateToTokenBudget('', 1000);
            assert.equal(result, '');
        });
    });

    describe('Integration test: Budget allocation with redistribution', () => {
        it('should redistribute unused budget correctly', () => {
            const blocks = [
                'Short block', // Uses minimal budget
                'A'.repeat(2000), // Medium block
                'B'.repeat(4000), // Large block
            ];

            const budgets = calculateBlockTokenBudgets(blocks.length, DEFAULT_TOTAL_BUDGET);
            assert.equal(budgets.length, 3);
            assert.equal(
                budgets.every((b) => b === 40000),
                true,
            ); // Equal distribution initially

            // Simulate processing with redistribution
            const processedBlocks: string[] = [];
            let totalTokensUsed = 0;

            blocks.forEach((block, i) => {
                const processed = truncateToTokenBudget(block, budgets[i]);
                processedBlocks.push(processed);
                totalTokensUsed += estimateTokensFromString(processed);
            });

            assert.equal(processedBlocks.length, 3);
            assert.ok(totalTokensUsed < DEFAULT_TOTAL_BUDGET);

            // Verify first block is complete (short)
            assert.equal(processedBlocks[0], 'Short block');

            // Verify other blocks are processed correctly
            assert.ok(processedBlocks[1].length > 0);
            assert.ok(processedBlocks[2].length > 0);
        });
    });

    describe('applyCombinedTextTokenBudgeting', () => {
        it('should return empty string for empty input', () => {
            const result = applyCombinedTextTokenBudgeting([], DEFAULT_TOTAL_BUDGET);
            assert.equal(result, '');
        });

        it('should use custom separator when provided', () => {
            const texts = ['First block', 'Second block', 'Third block'];
            const customSeparator = '\n\n\n\n-----------------------\n\n\n\n';
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET, customSeparator);

            assert.ok(result.includes('First block'));
            assert.ok(result.includes('Second block'));
            assert.ok(result.includes('Third block'));
            assert.ok(result.includes(customSeparator));
            assert.ok(!result.includes('\n\n---\n\n')); // Should not contain default separator
        });

        it('should use default separator when none provided', () => {
            const texts = ['First block', 'Second block'];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.ok(result.includes('\n\n---\n\n')); // Should contain default separator
        });

        it('should handle single block without truncation', () => {
            const texts = ['Short block of text'];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.equal(result, 'Short block of text');
            assert.ok(estimateTokensFromString(result) < DEFAULT_TOTAL_BUDGET);
        });

        it('should handle single large block with truncation', () => {
            const longText = 'Long text content that exceeds token limit. '.repeat(25000); // ~1M+ characters (~250k+ tokens)
            const texts = [longText];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.ok(result.length < longText.length);
            assert.ok(estimateTokensFromString(result) <= DEFAULT_TOTAL_BUDGET);
            assert.ok(estimateTokensFromString(longText) > DEFAULT_TOTAL_BUDGET); // Ensure input actually exceeds limit
        });

        it('should combine multiple blocks with equal distribution', () => {
            const texts = ['First block content', 'Second block content', 'Third block content'];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.ok(result.includes('First block content'));
            assert.ok(result.includes('Second block content'));
            assert.ok(result.includes('Third block content'));
            assert.ok(result.includes('\n\n---\n\n'));
            assert.ok(estimateTokensFromString(result) <= DEFAULT_TOTAL_BUDGET);
        });

        it('should account for custom separator tokens in budget calculation', () => {
            const customSeparator = ' --- CUSTOM SEPARATOR --- '; // Uses ~7 tokens
            const texts = ['Block 1', 'Block 2', 'Block 3'];
            const budget = 50;

            const result = applyCombinedTextTokenBudgeting(texts, budget, customSeparator);

            // Should fit within budget accounting for separator tokens
            assert.ok(estimateTokensFromString(result) <= budget);
            assert.ok(result.includes(customSeparator));

            // Should contain all blocks
            const blocks = result.split(customSeparator);
            assert.equal(blocks.length, 3);
            assert.ok(blocks[0].trim().includes('Block 1'));
            assert.ok(blocks[1].trim().includes('Block 2'));
            assert.ok(blocks[2].trim().includes('Block 3'));
        });

        it('should handle mixed block sizes with budget redistribution', () => {
            const texts = [
                'Short', // Very small block
                'Medium sized block with more content here to test redistribution',
                'A'.repeat(2000), // Large block that needs budget
            ];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            const blocks = result.split('\n\n---\n\n');
            assert.equal(blocks.length, 3);
            assert.equal(blocks[0], 'Short'); // Small block unchanged
            assert.ok(blocks[1].includes('Medium sized block'));
            assert.ok(blocks[2].includes('A')); // Large block potentially truncated
            assert.ok(estimateTokensFromString(result) <= DEFAULT_TOTAL_BUDGET);
        });

        it('should keep all blocks even with insufficient budget', () => {
            const budget = 100; // Very limited budget

            const texts = [
                'A'.repeat(200), // ~50 tokens needed
                'B'.repeat(200), // ~50 tokens needed
                'C'.repeat(200), // ~50 tokens needed
                'D'.repeat(200), // ~50 tokens needed
            ]; // Total: ~200 tokens needed, but only 100 available

            const result = applyCombinedTextTokenBudgeting(texts, budget);
            const blocks = result.split('\n\n---\n\n');

            assert.equal(blocks.length, 4); // All blocks should be kept

            // All blocks should contain their respective characters (though truncated)
            assert.ok(blocks[0].includes('A'));
            assert.ok(blocks[1].includes('B'));
            assert.ok(blocks[2].includes('C'));
            assert.ok(blocks[3].includes('D'));

            // Each block should be truncated since total demand exceeds budget
            assert.ok(blocks[0].length < 200);
            assert.ok(blocks[1].length < 200);
            assert.ok(blocks[2].length < 200);
            assert.ok(blocks[3].length < 200);

            // Total should be within budget
            assert.ok(estimateTokensFromString(result) <= budget);
        });

        it('should handle blocks that exceed their individual budget', () => {
            const texts = [
                'A'.repeat(20000), // Large block
                'B'.repeat(20000), // Large block
                'C'.repeat(20000), // Large block
            ];

            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);
            const blocks = result.split('\n\n---\n\n');

            assert.equal(blocks.length, 3);
            assert.ok(blocks[0].includes('A'));
            assert.ok(blocks[1].includes('B'));
            assert.ok(blocks[2].includes('C'));

            // Each block should be truncated to fit its budget
            blocks.forEach((block) => {
                assert.ok(estimateTokensFromString(block) <= DEFAULT_TOTAL_BUDGET / 3 + 1000); // Allow some variance
            });

            assert.ok(estimateTokensFromString(result) <= DEFAULT_TOTAL_BUDGET);
        });

        it('should preserve block order', () => {
            const texts = ['FIRST BLOCK', 'SECOND BLOCK', 'THIRD BLOCK'];

            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);
            const firstIndex = result.indexOf('FIRST');
            const secondIndex = result.indexOf('SECOND');
            const thirdIndex = result.indexOf('THIRD');

            assert.ok(firstIndex < secondIndex);
            assert.ok(secondIndex < thirdIndex);
        });

        it('should handle empty and whitespace-only blocks', () => {
            const texts = [
                'Valid content',
                '', // Empty
                '   ', // Whitespace only
                'More valid content',
            ];

            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.ok(result.includes('Valid content'));
            assert.ok(result.includes('More valid content'));
            // Empty and whitespace blocks should still be processed
            assert.equal(result.split('\n\n---\n\n').length, 4);
        });

        it('should return reasonable output for typical usage', () => {
            const texts = ['Test block 1', 'Test block 2'];
            const result = applyCombinedTextTokenBudgeting(texts, DEFAULT_TOTAL_BUDGET);

            assert.ok(result.includes('Test block 1'));
            assert.ok(result.includes('Test block 2'));
            assert.ok(result.includes('\n\n---\n\n'));
            assert.ok(estimateTokensFromString(result) <= DEFAULT_TOTAL_BUDGET);
        });

        it('should be order-independent and allocate budget optimally', () => {
            const budget = 1000;

            // Large block needs ~500 tokens, small blocks need ~3 tokens each
            const largeBlock = 'A'.repeat(2000); // ~500 tokens
            const smallBlock1 = 'Small text 1'; // ~3 tokens
            const smallBlock2 = 'Small text 2'; // ~3 tokens

            // Test both orderings
            const order1 = [largeBlock, smallBlock1, smallBlock2];
            const order2 = [smallBlock1, smallBlock2, largeBlock];

            const result1 = applyCombinedTextTokenBudgeting(order1, budget);
            const result2 = applyCombinedTextTokenBudgeting(order2, budget);

            // Both should use similar amounts of budget (within small margin)
            const tokens1 = estimateTokensFromString(result1);
            const tokens2 = estimateTokensFromString(result2);

            assert.ok(Math.abs(tokens1 - tokens2) < 10); // Allow small variance
            assert.ok(tokens1 <= budget);
            assert.ok(tokens2 <= budget);

            // Both should contain all blocks
            assert.equal(result1.split('\n\n---\n\n').length, 3);
            assert.equal(result2.split('\n\n---\n\n').length, 3);

            // Small blocks should be preserved fully in both cases
            assert.ok(result1.includes('Small text 1'));
            assert.ok(result1.includes('Small text 2'));
            assert.ok(result2.includes('Small text 1'));
            assert.ok(result2.includes('Small text 2'));
        });

        it('should give blocks what they need when budget is sufficient', () => {
            const budget = 50000; // Large budget

            const texts = [
                'Short text', // ~3 tokens
                'Medium length text that is longer than short', // ~10 tokens
                'A'.repeat(100), // ~25 tokens
            ];

            const result = applyCombinedTextTokenBudgeting(texts, budget);
            const blocks = result.split('\n\n---\n\n');

            // All blocks should be preserved exactly as they are (no truncation)
            assert.equal(blocks[0], 'Short text');
            assert.equal(blocks[1], 'Medium length text that is longer than short');
            assert.equal(blocks[2], 'A'.repeat(100));

            // Should use much less than the total budget
            assert.ok(estimateTokensFromString(result) < 100);
        });
    });
});
