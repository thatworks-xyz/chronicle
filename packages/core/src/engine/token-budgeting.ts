import { ActivityItemGraph } from './activity-graph.js';

export interface BlockTokenBudget {
    totalBudget: number; // Total tokens available for combined text
    extendedTotalBudget: number; // Total tokens available to use if an extended context window model is available
}

/**
 * Estimates the number of tokens in a text string.
 * Uses a conservative estimate of ~4 characters per token for Claude.
 */
export function estimateTokensFromString(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Calculates budget allocation for each block based on the number of text blocks.
 * All blocks are kept and budget is distributed equally among them.
 */
export function calculateBlockTokenBudgets(numBlocks: number, totalBudget: number): number[] {
    if (numBlocks === 0) {
        return [];
    }

    if (numBlocks === 1) {
        return [totalBudget];
    }

    const budgetPerBlock = totalBudget / numBlocks;
    return Array(numBlocks).fill(budgetPerBlock);
}

/**
 * Truncates text to fit within a token budget while preserving readability.
 */
export function truncateToTokenBudget(text: string, tokenBudget: number): string {
    const estimatedTokens = estimateTokensFromString(text);

    if (estimatedTokens <= tokenBudget) {
        return text;
    }

    // Convert token budget back to approximate character count
    const targetChars = tokenBudget * 4;
    return ActivityItemGraph._truncateAtWordBoundary(text, targetChars);
}

/**
 * Applies token-aware budgeting to combine text blocks intelligently.
 * Uses a two-pass algorithm for optimal budget allocation:
 * Pass 1: Measure actual token needs for each block
 * Pass 2: Allocate budget proportionally based on actual needs
 *
 * @param rawTexts - Array of text blocks to combine
 * @param tokenBudget - Token budget configuration
 * @param separator - String used to separate blocks (default: '\n\n---\n\n')
 * @returns Combined text that fits within the token budget
 */
export function applyCombinedTextTokenBudgeting(
    rawTexts: string[],
    totalBudget: number,
    separator = '\n\n---\n\n',
): string {
    if (rawTexts.length === 0) {
        return '';
    }

    // Account for separator tokens between blocks
    const separatorTokens = rawTexts.length > 1 ? estimateTokensFromString(separator) * (rawTexts.length - 1) : 0;
    const availableBudgetForContent = totalBudget - separatorTokens;

    // Pass 1: Measure actual token needs for each block (without truncation)
    const actualNeeds = rawTexts.map((text) => estimateTokensFromString(text));
    const totalNeeded = actualNeeds.reduce((sum, need) => sum + need, 0);

    // Pass 2: Allocate budget based on actual needs
    let blockBudgets: number[];

    if (totalNeeded <= availableBudgetForContent) {
        // All blocks fit within budget - give each block what it actually needs
        blockBudgets = actualNeeds;
    } else {
        // Need to allocate proportionally based on actual needs
        blockBudgets = actualNeeds.map((need) => {
            const proportion = need / totalNeeded;
            return Math.floor(proportion * availableBudgetForContent);
        });

        // Handle rounding errors - distribute any remaining budget
        const allocatedTotal = blockBudgets.reduce((sum, budget) => sum + budget, 0);
        const remainingBudget = availableBudgetForContent - allocatedTotal;

        // Distribute remaining budget to blocks with highest actual needs first
        if (remainingBudget > 0) {
            const indexesByNeed = actualNeeds
                .map((need, index) => ({ need, index }))
                .sort((a, b) => b.need - a.need)
                .map((item) => item.index);

            for (let i = 0; i < remainingBudget && i < indexesByNeed.length; i++) {
                blockBudgets[indexesByNeed[i]]++;
            }
        }
    }

    // Process each block with its allocated budget
    const processedBlocks = rawTexts.map((text, index) => truncateToTokenBudget(text, blockBudgets[index]));
    return processedBlocks.join(separator);
}
