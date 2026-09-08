import { ItemPropertyStatusCategory } from '../domain/filters.js';
import { ItemPropertyStatus } from '../domain/work-item.js';

function getFuzzyStatusCategory(value: string): ItemPropertyStatusCategory {
    const doneFuzzy = ['done', 'complete', 'closed', 'completed', 'finish', 'finished', 'archive', 'archived'];
    const todoFuzzy = ['to do', 'open', 'incomplete', 'not started', 'todo', 'to-do'];
    const inProgressFuzzy = ['in progress', 'testing', 'in testing', 'review', 'in review', 'in-progress'];

    if (doneFuzzy.includes(value.toLowerCase())) {
        return ItemPropertyStatusCategory.Done;
    } else if (todoFuzzy.includes(value.toLowerCase())) {
        return ItemPropertyStatusCategory.ToDo;
    } else if (inProgressFuzzy.includes(value.toLowerCase())) {
        return ItemPropertyStatusCategory.InProgress;
    }
    return ItemPropertyStatusCategory.Unknown;
}

export function getBestStatusPropIfCategoryIsUnknown(
    value: string,
    propDetails: ItemPropertyStatus,
): ItemPropertyStatus {
    if (propDetails.statusCategory === ItemPropertyStatusCategory.Unknown || propDetails.statusCategory === undefined) {
        const fuzzyMatch = getFuzzyStatusCategory(value);
        return {
            ...propDetails,
            statusCategory: fuzzyMatch,
            isDone: fuzzyMatch === ItemPropertyStatusCategory.Done,
            statusId: fuzzyMatch,
            statusOrderIndex: fuzzyMatch === ItemPropertyStatusCategory.Done ? 0 : 1,
        };
    }
    return propDetails;
}
