import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatedValue, fillDateRange, reduceByDay } from './time-series-helpers.js';

// ============================================================================
// reduceByDay Tests
// ============================================================================

describe('reduceByDay', () => {
    it('should return empty map for empty data', () => {
        const result = reduceByDay([], 'sum');
        assert.equal(result.size, 0);
    });

    it('should group and sum multiple values on the same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-15T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-15T15:00:00Z'), value: 3 },
        ];

        const result = reduceByDay(data, 'sum');
        assert.equal(result.size, 1);
        assert.equal(result.get('2024-01-15'), 8);
    });

    it('should use latest value when multiple data points exist for same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-15T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-15T15:00:00Z'), value: 10 },
            { date: new Date('2024-01-15T12:00:00Z'), value: 7 },
        ];

        const result = reduceByDay(data, 'latest');
        assert.equal(result.get('2024-01-15'), 10); // 15:00 is latest
    });

    it('should use earliest value when multiple data points exist for same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-01T15:00:00Z'), value: 10 },
            { date: new Date('2024-01-01T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-01T12:00:00Z'), value: 7 },
        ];

        const result = reduceByDay(data, 'earliest');
        assert.equal(result.get('2024-01-01'), 5); // 09:00 is earliest
    });

    it('should average values on the same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-01T09:00:00Z'), value: 10 },
            { date: new Date('2024-01-01T12:00:00Z'), value: 20 },
            { date: new Date('2024-01-01T15:00:00Z'), value: 30 },
        ];

        const result = reduceByDay(data, 'average');
        assert.equal(result.get('2024-01-01'), 20); // (10 + 20 + 30) / 3 = 20
    });

    it('should handle single value for average', () => {
        const data: DatedValue[] = [{ date: new Date('2024-01-01T12:00:00Z'), value: 42 }];

        const result = reduceByDay(data, 'average');
        assert.equal(result.get('2024-01-01'), 42);
    });

    it('should use max value for the same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-01T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-01T12:00:00Z'), value: 15 },
            { date: new Date('2024-01-01T15:00:00Z'), value: 10 },
        ];

        const result = reduceByDay(data, 'max');
        assert.equal(result.get('2024-01-01'), 15);
    });

    it('should use min value for the same day', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-01T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-01T12:00:00Z'), value: 15 },
            { date: new Date('2024-01-01T15:00:00Z'), value: 10 },
        ];

        const result = reduceByDay(data, 'min');
        assert.equal(result.get('2024-01-01'), 5);
    });

    it('should only include days that have data', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-15T12:00:00Z'), value: 5 },
            { date: new Date('2024-01-17T12:00:00Z'), value: 7 },
        ];

        const result = reduceByDay(data, 'sum');
        assert.equal(result.size, 2);
        assert.equal(result.has('2024-01-15'), true);
        assert.equal(result.has('2024-01-16'), false); // No data for this day
        assert.equal(result.has('2024-01-17'), true);
    });

    it('should default to latest reducer', () => {
        const data: DatedValue[] = [
            { date: new Date('2024-01-01T09:00:00Z'), value: 5 },
            { date: new Date('2024-01-01T15:00:00Z'), value: 10 },
        ];

        const result = reduceByDay(data);
        assert.equal(result.get('2024-01-01'), 10); // Should use latest (15:00)
    });
});

// ============================================================================
// fillDateRange Tests
// ============================================================================

describe('fillDateRange', () => {
    describe('basic functionality', () => {
        it('should return one entry per day in the date range', () => {
            const reduced = reduceByDay([{ date: new Date('2024-01-15T12:00:00Z'), value: 10 }]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-31'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result.length, 31);
        });

        it('should include correct dates from start to end', () => {
            const result = fillDateRange(new Map(), new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result.length, 3);
            assert.equal(result[0].date.toISOString().split('T')[0], '2024-01-01');
            assert.equal(result[1].date.toISOString().split('T')[0], '2024-01-02');
            assert.equal(result[2].date.toISOString().split('T')[0], '2024-01-03');
        });
    });

    describe('fillStrategy: zero', () => {
        it('should use defaultValue for days with no data', () => {
            const reduced = new Map([['2024-01-02', 10]]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result[0].value, 0); // Jan 1 - no data
            assert.equal(result[1].value, 10); // Jan 2 - has data
            assert.equal(result[2].value, 0); // Jan 3 - no data
        });

        it('should use custom defaultValue for missing days', () => {
            const reduced = new Map([['2024-01-02', 10]]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: -1,
                fillStrategy: 'zero',
            });

            assert.equal(result[0].value, -1); // Jan 1 - uses defaultValue
            assert.equal(result[1].value, 10); // Jan 2 - has data
            assert.equal(result[2].value, -1); // Jan 3 - uses defaultValue
        });

        it('should return defaultValue (0) for days with no data using average reducer', () => {
            const reduced = reduceByDay([{ date: new Date('2024-01-02T12:00:00Z'), value: 50 }], 'average');

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result[0].value, 0); // Jan 1 - no data
            assert.equal(result[1].value, 50); // Jan 2 - has data
            assert.equal(result[2].value, 0); // Jan 3 - no data
        });
    });

    describe('fillStrategy: carry-forward', () => {
        it('should carry forward last known value for missing days', () => {
            const reduced = new Map([['2024-01-02', 10]]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-05'), {
                defaultValue: 0,
                fillStrategy: 'carry-forward',
            });

            assert.equal(result[0].value, 0); // Jan 1 - before first data, uses defaultValue
            assert.equal(result[1].value, 10); // Jan 2 - has data
            assert.equal(result[2].value, 10); // Jan 3 - carried forward
            assert.equal(result[3].value, 10); // Jan 4 - carried forward
            assert.equal(result[4].value, 10); // Jan 5 - carried forward
        });

        it('should use defaultValue before first data point', () => {
            const reduced = new Map([['2024-01-03', 5]]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-05'), {
                defaultValue: 99,
                fillStrategy: 'carry-forward',
            });

            assert.equal(result[0].value, 99); // Jan 1 - before first data
            assert.equal(result[1].value, 99); // Jan 2 - before first data
            assert.equal(result[2].value, 5); // Jan 3 - has data
            assert.equal(result[3].value, 5); // Jan 4 - carried forward
            assert.equal(result[4].value, 5); // Jan 5 - carried forward
        });

        it('should update carried value when new data appears', () => {
            const reduced = new Map([
                ['2024-01-01', 10],
                ['2024-01-03', 20],
            ]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-05'), {
                defaultValue: 0,
                fillStrategy: 'carry-forward',
            });

            assert.equal(result[0].value, 10); // Jan 1 - has data
            assert.equal(result[1].value, 10); // Jan 2 - carried forward from Jan 1
            assert.equal(result[2].value, 20); // Jan 3 - has new data
            assert.equal(result[3].value, 20); // Jan 4 - carried forward from Jan 3
            assert.equal(result[4].value, 20); // Jan 5 - carried forward from Jan 3
        });
    });

    describe('edge cases', () => {
        it('should handle empty reduced map', () => {
            const result = fillDateRange(new Map(), new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result.length, 3);
            assert.equal(
                result.every((d) => d.value === 0),
                true,
            );
        });

        it('should handle single day range', () => {
            const reduced = new Map([['2024-01-01', 42]]);

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-01'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result.length, 1);
            assert.equal(result[0].value, 42);
        });

        it('should ignore data outside the date range', () => {
            const reduced = reduceByDay(
                [
                    { date: new Date('2023-12-31T12:00:00Z'), value: 100 }, // Before range
                    { date: new Date('2024-01-02T12:00:00Z'), value: 50 }, // In range
                    { date: new Date('2024-02-01T12:00:00Z'), value: 200 }, // After range
                ],
                'latest',
            );

            const result = fillDateRange(reduced, new Date('2024-01-01'), new Date('2024-01-03'), {
                defaultValue: 0,
                fillStrategy: 'zero',
            });

            assert.equal(result.length, 3);
            assert.equal(result[0].value, 0); // Jan 1 - data was before range
            assert.equal(result[1].value, 50); // Jan 2 - has data
            assert.equal(result[2].value, 0); // Jan 3 - data was after range
        });
    });
});
