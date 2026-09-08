/**
 * A data point with a date and a numeric value.
 */
export interface DatedValue {
    date: Date;
    value: number;
}

/**
 * How to select value when multiple data points exist for the same day.
 * - 'latest': Use the most recent value (default)
 * - 'earliest': Use the earliest value
 * - 'sum': Sum all values for the day
 * - 'average': Average all values for the day
 * - 'max': Use the maximum value
 * - 'min': Use the minimum value
 */
export type DailyReducer = 'latest' | 'earliest' | 'sum' | 'average' | 'max' | 'min';

/**
 * Options for fillDateRange function.
 */
export interface FillDateRangeOptions {
    /**
     * Value to use for days with no data (when fillStrategy is 'zero')
     * or before the first data point (when fillStrategy is 'carry-forward').
     */
    defaultValue: number;

    /**
     * How to fill missing days in the output.
     * - 'zero': Use defaultValue for all missing days
     * - 'carry-forward': Carry forward the last known value (use defaultValue before first data point)
     */
    fillStrategy: 'zero' | 'carry-forward';
}

/**
 * Helper to get a date key (YYYY-MM-DD) from a Date object for grouping by day.
 */
function getDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Helper to create a Date at start of day (midnight UTC) from a date key.
 */
function dateFromKey(key: string): Date {
    return new Date(key + 'T00:00:00.000Z');
}

/**
 * Groups data points by day and applies a reducer to get a single value per day.
 * Only returns entries for days that have actual data.
 *
 * @param data - Array of data points with dates and numeric values
 * @param reducer - How to aggregate multiple values on the same day (defaults to 'latest')
 * @returns Map of date key (YYYY-MM-DD) to reduced value, only for days with data
 */
export function reduceByDay(data: DatedValue[], reducer: DailyReducer = 'latest'): Map<string, number> {
    // Group data by day
    const dailyData = new Map<string, { values: number[]; timestamps: number[] }>();

    for (const point of data) {
        const dateKey = getDateKey(point.date);
        const timestamp = point.date.getTime();

        let entry = dailyData.get(dateKey);
        if (!entry) {
            entry = { values: [], timestamps: [] };
            dailyData.set(dateKey, entry);
        }
        entry.values.push(point.value);
        entry.timestamps.push(timestamp);
    }

    // Apply reducer to get single value per day
    const reducedDaily = new Map<string, number>();
    for (const [dateKey, entry] of dailyData) {
        let reducedValue: number;

        switch (reducer) {
            case 'earliest': {
                const minIndex = entry.timestamps.indexOf(Math.min(...entry.timestamps));
                reducedValue = entry.values[minIndex];
                break;
            }
            case 'sum':
                reducedValue = entry.values.reduce((a, b) => a + b, 0);
                break;
            case 'average':
                reducedValue =
                    entry.values.length > 0 ? entry.values.reduce((a, b) => a + b, 0) / entry.values.length : 0;
                break;
            case 'max':
                reducedValue = Math.max(...entry.values);
                break;
            case 'min':
                reducedValue = Math.min(...entry.values);
                break;
            case 'latest':
            default: {
                const maxIndex = entry.timestamps.indexOf(Math.max(...entry.timestamps));
                reducedValue = entry.values[maxIndex];
                break;
            }
        }

        reducedDaily.set(dateKey, reducedValue);
    }

    return reducedDaily;
}

/**
 * Builds a continuous array of DatedValue from fromDate to toDate (inclusive),
 * using values from the reducedDaily map and filling gaps per the fill strategy.
 *
 * @param reducedDaily - Map of date key (YYYY-MM-DD) to value, typically from reduceByDay
 * @param fromDate - Start of the date range (inclusive)
 * @param toDate - End of the date range (inclusive)
 * @param options - Fill strategy and default value for missing days
 * @returns Array of DatedValue with exactly one entry per day in the range
 */
export function fillDateRange(
    reducedDaily: Map<string, number>,
    fromDate: Date,
    toDate: Date,
    options: FillDateRangeOptions,
): DatedValue[] {
    const { defaultValue, fillStrategy } = options;

    const result: DatedValue[] = [];
    const startKey = getDateKey(fromDate);
    const endKey = getDateKey(toDate);

    let lastKnownValue = defaultValue;
    const currentDate = dateFromKey(startKey);
    const endDate = dateFromKey(endKey);

    while (currentDate <= endDate) {
        const dateKey = getDateKey(currentDate);
        const dayValue = reducedDaily.get(dateKey);

        let valueToUse: number;
        if (dayValue !== undefined) {
            valueToUse = dayValue;
            lastKnownValue = dayValue;
        } else if (fillStrategy === 'carry-forward') {
            valueToUse = lastKnownValue;
        } else {
            valueToUse = defaultValue;
        }

        result.push({
            date: new Date(currentDate),
            value: valueToUse,
        });

        // Move to next day
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return result;
}
