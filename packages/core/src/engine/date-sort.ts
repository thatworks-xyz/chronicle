export function dateSortRecentFirst(a: Date, b: Date): number {
    if (a > b) {
        return -1;
    }
    if (a < b) {
        return 1;
    }
    return 0;
}

export function dateSortOldestFirst(a: Date, b: Date): number {
    if (a > b) {
        return 1;
    }
    if (a < b) {
        return -1;
    }
    return 0;
}
