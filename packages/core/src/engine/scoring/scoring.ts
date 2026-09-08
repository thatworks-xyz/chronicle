import { ChangeType, ItemPropertyType, ScorerName } from '../../domain/filters.js';
import { ScorerWeights } from '../../ports/config.js';
import { ItemWithChanges } from '../changelog-summary.js';

export interface Scores {
    featureScores: { name: ScorerName; value: number; denom: number }[];
    totalScore: number;
}

export interface ItemWithChangesScored extends ItemWithChanges {
    scores: Scores;
}

export function calcFeatureScore(value: number, denom: number) {
    return value === 0 && denom === 0 ? 0 : value / denom;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function scoreActionRecency(items: ItemWithChangesScored[], fromUtcMs: number, toUtcMs: number): void {
    items.forEach((item) => {
        if (item.changes.length === 0) {
            item.scores.featureScores.push({
                name: ScorerName.ActionRecency,
                value: 0,
                denom: 1,
            });
            return;
        }

        // Quickly ensure items are ordered
        if (item.changes.length > 1) {
            if (item.changes[0].timestamp < item.changes[item.changes.length - 1].timestamp) {
                throw new Error(`changes are not ordered correctly for ${ScorerName.ActionRecency}`);
            }
        }

        item.scores.featureScores.push({
            name: ScorerName.ActionRecency,
            value: item.changes[0].timestamp.valueOf() - fromUtcMs,
            denom: toUtcMs - fromUtcMs,
        });
    });
}

function scorePriority(items: ItemWithChangesScored[]): void {
    items.forEach((it) => {
        if (!it.item.properties) {
            return;
        }

        it.item.properties.forEach((prop) => {
            if (
                prop.details &&
                prop.details.type === ItemPropertyType.Priority &&
                prop.details.priorityIndex !== undefined &&
                prop.details.totalNumPriorities !== undefined
            ) {
                it.scores.featureScores.push({
                    name: ScorerName.Priority,
                    value: prop.details.priorityIndex,
                    denom: prop.details.totalNumPriorities,
                });
            }
        });
    });
}

function scoreNumComments(items: ItemWithChangesScored[]): void {
    let maxComments = 0;
    const numCommentsInItems: number[] = [];

    // first pass: find the max num comments
    items.forEach((it) => {
        let numCommentsInItem = 0;
        it.changes.forEach((change) => {
            if (change.action.changeType === ChangeType.Comment) {
                numCommentsInItem++;
            }
        });

        maxComments = Math.max(maxComments, numCommentsInItem);
        numCommentsInItems.push(numCommentsInItem);
    });

    if (maxComments === 0) {
        return;
    }

    // second pass: set the values
    items.forEach((it, i) => {
        it.scores.featureScores.push({
            name: ScorerName.NumOfComments,
            value: numCommentsInItems[i],
            denom: maxComments,
        });
    });
}

function scoreActivity(items: ItemWithChangesScored[]): void {
    let maxChanges = 0;
    const numChangesInItems: number[] = [];

    // first pass: find the max num changes
    items.forEach((it) => {
        const numChangesInItem = it.changes.length;
        maxChanges = Math.max(maxChanges, numChangesInItem);
        numChangesInItems.push(numChangesInItem);
    });

    if (maxChanges === 0) {
        return;
    }

    // second pass: set the values
    items.forEach((it, i) => {
        it.scores.featureScores.push({
            name: ScorerName.Activity,
            value: numChangesInItems[i],
            denom: maxChanges,
        });
    });
}

function scorePeople(items: ItemWithChangesScored[]): void {
    let maxNumPeople = 0;
    const numPeopleInItems: number[] = [];

    // first pass: find the max num unique actors
    items.forEach((it) => {
        const actors: Set<string> = new Set();
        it.changes.forEach((change) => {
            actors.add(change.action.actorDisplayName);
        });
        numPeopleInItems.push(actors.size);
        maxNumPeople = Math.max(maxNumPeople, actors.size);
    });

    if (maxNumPeople === 0) {
        return;
    }

    // second pass: set the values
    items.forEach((it, i) => {
        it.scores.featureScores.push({
            name: ScorerName.NumUniquePeople,
            value: numPeopleInItems[i],
            denom: maxNumPeople,
        });
    });
}

function scoreTotal(items: ItemWithChangesScored[], weights: ScorerWeights): void {
    items.forEach((o) => {
        if (o.scores.featureScores.length === 0) {
            return;
        }
        const score = o.scores.featureScores.reduce<number>((p, c) => {
            const weight = weights[c.name];
            const div = calcFeatureScore(c.value, c.denom);
            p += clamp(div * weight, 0, 1);
            return p;
        }, 0);
        o.scores.totalScore = score;
    });
}

/**
 * Scores items with the feature scorers (action recency, priority, comment count,
 * activity, unique people) and combines them into a weighted total score.
 */
export function scoreItems(
    itemsWithChanges: ItemWithChanges[],
    fromDate: Date,
    toDate: Date,
    weights: ScorerWeights,
): Map<string, Scores> {
    const itemsScored = itemsWithChanges.map((v) => {
        const s: ItemWithChangesScored = {
            item: v.item,
            changes: v.changes,
            scores: {
                featureScores: [],
                totalScore: 0,
            },
        };
        return s;
    });

    scoreActionRecency(itemsScored, fromDate.valueOf(), toDate.valueOf());
    scorePriority(itemsScored);
    scoreNumComments(itemsScored);
    scoreActivity(itemsScored);
    scorePeople(itemsScored);
    scoreTotal(itemsScored, weights);

    return new Map(itemsScored.map((v) => [v.item.uuid, v.scores]));
}
