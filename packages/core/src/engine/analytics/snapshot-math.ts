import { MetricSnapshot } from '../../domain/metric-snapshot.js';
import { DatedValue, fillDateRange, reduceByDay } from './time-series-helpers.js';

/**
 * Common data structure for metrics with sparkline.
 * TValue is the type of the computed value - can be a simple number or a complex object
 * containing multiple values (e.g., rate + counts for a cancellation-rate metric).
 */
export interface MetricData<TValue = number> {
    itemUuid: string;
    value: TValue;
    sparklineData: { date: Date; value: number }[];
    /** Whether any actual snapshot data exists for this period */
    hasData: boolean;
}

/**
 * Extracts a numeric value from a single snapshot.
 * Returns the value to be used for sparkline.
 */
export type SnapshotValueExtractor = (snapshot: MetricSnapshot) => number | undefined;

/**
 * Computes the value from sparkline data and snapshots.
 * The value can be a simple number or a complex object with multiple fields.
 */
export type ComputeValue<TValue> = (
    sparklineData: { date: Date; value: number }[],
    snapshots: MetricSnapshot[],
) => TValue;

/**
 * Extracts the numeric value used for trend/delta calculations from the computed value.
 * For simple number values, this is just the identity function.
 * For complex values, this extracts the primary numeric field.
 */
export type ExtractDistributionValue<TValue> = (value: TValue) => number;

// ============================================================================
// Pre-built Value Computations
// ============================================================================

/**
 * Sum: value is the sum of all sparkline values.
 */
export function sumValue(): ComputeValue<number> {
    return (sparkline) => sparkline.reduce((sum, d) => sum + d.value, 0);
}

/**
 * Average: value is the average of all sparkline values.
 */
export function averageValue(): ComputeValue<number> {
    return (sparkline) => {
        return sparkline.length > 0 ? sparkline.reduce((sum, d) => sum + d.value, 0) / sparkline.length : 0;
    };
}

/**
 * Latest: value is the last sparkline value.
 */
export function latestValue(): ComputeValue<number> {
    return (sparkline) => (sparkline.length > 0 ? sparkline[sparkline.length - 1].value : 0);
}

/**
 * Identity extractor for simple number values.
 */
export function identityDistribution(): ExtractDistributionValue<number> {
    return (value) => value;
}

/**
 * Value type for ratio-based metrics (e.g., cancellation rate)
 */
export interface RatioValue {
    /** The ratio as a percentage */
    rate: number;
    /** Sum of numerator values across all snapshots */
    numeratorTotal: number;
    /** Sum of denominator values across all snapshots */
    denominatorTotal: number;
}

/**
 * Ratio: value contains rate (percentage) and totals from two extractors.
 * Useful for metrics like cancellation rate = (cancelled / total) * 100.
 */
export function ratioValue(
    numeratorExtractor: SnapshotValueExtractor,
    denominatorExtractor: SnapshotValueExtractor,
): ComputeValue<RatioValue> {
    return (_sparkline, snapshots) => {
        let numerator = 0;
        let denominator = 0;
        for (const snapshot of snapshots) {
            const num = numeratorExtractor(snapshot);
            const denom = denominatorExtractor(snapshot);
            if (num !== undefined) numerator += num;
            if (denom !== undefined) denominator += denom;
        }
        return {
            rate: denominator > 0 ? (numerator / denominator) * 100 : 0,
            numeratorTotal: numerator,
            denominatorTotal: denominator,
        };
    };
}

/**
 * Extracts the rate from a RatioValue for trend calculations.
 */
export function ratioDistribution(): ExtractDistributionValue<RatioValue> {
    return (value) => value.rate;
}

// ============================================================================
// Metric Data Computation
// ============================================================================

/**
 * Computes metric data from snapshots.
 *
 * @param snapshots - Array of metric snapshots
 * @param itemUuid - UUID of the item these snapshots belong to
 * @param fromDate - Start of the date range for sparkline quantization
 * @param toDate - End of the date range for sparkline quantization
 * @param sparklineExtractor - Function to extract the sparkline value from each snapshot
 * @param dailyReducer - How to aggregate multiple snapshots on the same day
 * @param computeValue - Function to compute the final value
 */
export function computeMetricFromSnapshots<TValue>(
    snapshots: MetricSnapshot[],
    itemUuid: string,
    fromDate: Date,
    toDate: Date,
    sparklineExtractor: SnapshotValueExtractor,
    dailyReducer: 'sum' | 'average' | 'latest',
    computeValue: ComputeValue<TValue>,
): MetricData<TValue> {
    const rawSparklineData: DatedValue[] = [];

    for (const snapshot of snapshots) {
        const value = sparklineExtractor(snapshot);
        if (value !== undefined) {
            rawSparklineData.push({ date: snapshot.timestamp, value });
        }
    }

    // Reduce by day: group multiple same-day snapshots and apply the reducer.
    // This only contains days that have actual data.
    const reducedByDay = reduceByDay(rawSparklineData, dailyReducer);

    // Build data-only sparkline (for computation) — excludes days with no data
    const dataOnlySparkline = Array.from(reducedByDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => ({ date: new Date(key + 'T00:00:00.000Z'), value: val }));

    // Compute value from data-only sparkline (avoids 0-fill skewing calculations)
    const value = computeValue(dataOnlySparkline, snapshots);

    // Build UI sparkline by filling the full date range with 0 for missing days
    const sparklineData = fillDateRange(reducedByDay, fromDate, toDate, {
        defaultValue: 0,
        fillStrategy: 'zero',
    }).map((d) => ({ date: d.date, value: d.value }));

    return {
        itemUuid,
        value,
        sparklineData,
        hasData: dataOnlySparkline.length > 0,
    };
}
