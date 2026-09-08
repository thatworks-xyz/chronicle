import { convert } from 'html-to-text';
import { ActivityItemComment } from '../domain/api-types.js';
import { ChangeType } from '../domain/filters.js';
import { SummarizedChanges, TimelineItem } from '../domain/timeline.js';
import { PlainTextDiffEntry } from '../ports/repositories.js';
import { EngineRuntime } from '../ports/runtime.js';
import { Colors } from '../vendor/colors.js';
import { toUserMentionType } from './conversions.js';
import { dateSortOldestFirst, dateSortRecentFirst } from './date-sort.js';

export const DEFAULT_LABEL_BG_COLOR = '#F2F2F2';

export function sortByScore(a: TimelineItem, b: TimelineItem): number {
    if (a.score > b.score) {
        return -1;
    }
    if (a.score < b.score) {
        return 1;
    }
    return 0;
}

export function getWordCount(s: string): number {
    return s.split(' ').filter((v) => v !== '').length;
}

// Return type for processed doc diffs
export type DocDiffsForPrompt = {
    diffsForPrompt: string;
    addedText: string;
    removedText: string;
    addedWordCount: number | undefined;
    removedWordCount: number | undefined;
};

// Shared helper to process raw diffs into the prompt format
export function processRawDiffsForPrompt(diffs: PlainTextDiffEntry[]): DocDiffsForPrompt | undefined {
    if (diffs.length === 0) {
        return undefined;
    }
    const removed: string[] = [];
    const added: string[] = [];
    diffs.forEach((d) => {
        d.diff.forEach((v) => {
            if (v.diffType === -1) {
                removed.push(v.text);
            } else {
                added.push(v.text);
            }
        });
    });

    if (added.length === 0 && removed.length === 0) {
        return undefined;
    }

    const addedText = added.join('\n');
    const removedText = removed.join('\n');
    const addedWordCount = added.length > 0 ? getWordCount(addedText) : undefined;
    const removedWordCount = removed.length > 0 ? getWordCount(removedText) : undefined;

    const flat = diffs.map((v) => v.diff).flat();
    const diffsText: string[] = [];
    flat.forEach((d) => {
        if (flat.length > 1 && d.firstStorageDocStoredAsDiff !== undefined) {
            return;
        }

        // Skip empty diffs
        if (d.text.trim().length === 0) {
            return;
        }

        if (d.diffType === 1) {
            diffsText.push(`<added>${d.text}</added>`);
        } else if (d.diffType === -1) {
            diffsText.push(`<removed>${d.text}</removed>`);
        }
    });

    return {
        diffsForPrompt: diffsText.join('\n'),
        addedText,
        removedText,
        addedWordCount,
        removedWordCount,
    };
}

/**
 * Fetches and processes doc diffs for multiple items in a single query.
 * Returns a Map from itemUuid to its processed diffs (or undefined if no diffs).
 */
export async function getDocDiffsForPromptBatch(
    runtime: EngineRuntime,
    principal: { userId: string; organizationId?: string },
    itemUuids: string[],
    fromDate: Date,
    toDate?: Date,
): Promise<Map<string, DocDiffsForPrompt | undefined>> {
    const docDiffs = runtime.repos.docDiffs;
    if (!docDiffs || itemUuids.length === 0) {
        return new Map();
    }
    const access = await runtime.accessControl.getAccessFilter(principal);
    const diffsMap = await docDiffs.getDiffsForItems({ access, itemUuids, from: fromDate, to: toDate });

    const resultMap = new Map<string, DocDiffsForPrompt | undefined>();
    diffsMap.forEach((diffs, itemUuid) => {
        resultMap.set(itemUuid, processRawDiffsForPrompt(diffs));
    });

    return resultMap;
}

export function getOrGenActorColor(actorName: string, map: Map<string, string>) {
    const colorList = [
        Colors.accent_1,
        Colors.accent_2,
        Colors.accent_3,
        Colors.accent_4,
        Colors.neutral_1,
        Colors.neutral_2,
        Colors.neutral_3,
        Colors.neutral_4,
        Colors.light_1,
        Colors.light_2,
        Colors.light_3,
        Colors.light_4,
        Colors.light_5,
        Colors.light_6,
        Colors.dark_1,
        Colors.dark_2,
        Colors.dark_3,
        Colors.dark_4,
        Colors.dark_5,
        Colors.dark_6,
    ];

    let c = map.get(actorName);
    if (!c) {
        c = colorList[map.size % colorList.length];
        map.set(actorName, c);
    }
    return c;
}

export function calculateDeltaPercentage(oldValue: number, newValue: number): number {
    return ((newValue - oldValue) / oldValue) * 100;
}

export function getActivityItemCommentsFromChangelog(
    changes: SummarizedChanges['changes'],
    sort: 'oldest_first' | 'recent_first',
): ActivityItemComment[] {
    const comments = changes
        .filter((v) => v.changeType === ChangeType.Comment)
        .map((v) => v.comments)
        .flat()
        .sort((a, b) =>
            sort === 'oldest_first' ? dateSortOldestFirst(a.date, b.date) : dateSortRecentFirst(a.date, b.date),
        );

    return comments.map((c) => ({
        comment: convert(c.commentHtml, {
            selectors: [
                {
                    selector: 'img',
                    format: 'skip',
                },
                {
                    selector: 'a>font>span',
                    format: 'skip',
                },
                {
                    selector: 'a',
                    options: {
                        hideLinkHrefIfSameAsText: true,
                        linkBrackets: false,
                    },
                },
            ],
        }),
        authorDisplayName: c.userDisplayName,
        date: c.date,
        userMention: toUserMentionType(c.userMentionType),
        commentId: c.commentId,
        threadId: c.threadId,
    }));
}
