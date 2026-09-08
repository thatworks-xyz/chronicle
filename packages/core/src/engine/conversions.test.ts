import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DateTime } from 'luxon';
import { QueryDate, QueryDateDayType, QueryDateType } from '../domain/filters.js';
import { getDateFromQueryDateType } from './conversions.js';

describe('getDateFromQueryDateType', () => {
    const testDate = DateTime.fromISO('2025-01-13T12:00:00'); // Monday
    if (!testDate.isValid) {
        throw new Error('Test date is not valid');
    }

    const userIanaZone = 'America/New_York';

    describe('QueryDateType.Iso', () => {
        it('should parse ISO date correctly', () => {
            const date: QueryDate = {
                dateType: QueryDateType.Iso,
                isoDate: '2025-01-15T10:30:00',
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date);
            assert.equal(result.toISO(), '2025-01-15T10:30:00.000+00:00');
        });

        it('should throw error if isoDate is missing', () => {
            const date: QueryDate = {
                dateType: QueryDateType.Iso,
                userIanaZone,
            };

            assert.throws(() => getDateFromQueryDateType(date), /Expected isoDate to be defined/);
        });
    });

    describe('QueryDateType.RelativeDaysMinus', () => {
        it('should subtract regular days when dayType is Day', () => {
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysMinus,
                relativeDays: 3,
                dayType: QueryDateDayType.Day,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.minus({ days: 3 });
            assert.equal(result.toISO(), expected.toISO());
        });

        it('should default to Day when dayType is undefined', () => {
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysMinus,
                relativeDays: 2,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.minus({ days: 2 });
            assert.equal(result.toISO(), expected.toISO());
        });

        it('should subtract weekdays only when dayType is Weekday', () => {
            // Starting from Monday (2025-01-13), subtracting 1 weekday should give Friday (2025-01-10)
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysMinus,
                relativeDays: 1,
                dayType: QueryDateDayType.Weekday,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            assert.equal(result.toISO(), '2025-01-10T12:00:00.000+00:00'); // Friday
        });

        it('should skip weekends when subtracting weekdays', () => {
            // Starting from Monday (2025-01-13), subtracting 3 weekdays should give Wednesday (2025-01-08)
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysMinus,
                relativeDays: 3,
                dayType: QueryDateDayType.Weekday,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            assert.equal(result.toISO(), '2025-01-08T12:00:00.000+00:00'); // Wednesday
        });

        it('should throw error if relativeDays is missing', () => {
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysMinus,
                userIanaZone,
            };

            assert.throws(() => getDateFromQueryDateType(date), /Expected relativeDays to be defined/);
        });
    });

    describe('QueryDateType.RelativeDaysPlus', () => {
        it('should add regular days when dayType is Day', () => {
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysPlus,
                relativeDays: 3,
                dayType: QueryDateDayType.Day,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.plus({ days: 3 });
            assert.equal(result.toISO(), expected.toISO());
        });

        it('should default to Day when dayType is undefined', () => {
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysPlus,
                relativeDays: 2,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.plus({ days: 2 });
            assert.equal(result.toISO(), expected.toISO());
        });

        it('should add weekdays only when dayType is Weekday', () => {
            // Starting from Monday (2025-01-13), adding 1 weekday should give Tuesday (2025-01-14)
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysPlus,
                relativeDays: 1,
                dayType: QueryDateDayType.Weekday,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            assert.equal(result.toISO(), '2025-01-14T12:00:00.000+00:00'); // Tuesday
        });

        it('should skip weekends when adding weekdays', () => {
            // Starting from Monday (2025-01-13), adding 5 weekdays should give Monday (2025-01-20)
            const date: QueryDate = {
                dateType: QueryDateType.RelativeDaysPlus,
                relativeDays: 5,
                dayType: QueryDateDayType.Weekday,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            assert.equal(result.toISO(), '2025-01-20T12:00:00.000+00:00'); // Monday next week
        });
    });

    describe('QueryDateType.Today', () => {
        it('should return start of day in user timezone', () => {
            const date: QueryDate = {
                dateType: QueryDateType.Today,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.setZone(userIanaZone).startOf('day');
            assert.equal(result.toISO(), expected.toISO());
        });
    });

    describe('QueryDateType.StartOfWeek', () => {
        it('should return start of week in user timezone', () => {
            const date: QueryDate = {
                dateType: QueryDateType.StartOfWeek,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.setZone(userIanaZone).startOf('week');
            assert.equal(result.toISO(), expected.toISO());
        });
    });

    describe('QueryDateType.EndOfWeek', () => {
        it('should return end of week in user timezone', () => {
            const date: QueryDate = {
                dateType: QueryDateType.EndOfWeek,
                userIanaZone,
            };

            const result = getDateFromQueryDateType(date, testDate);
            const expected = testDate.setZone(userIanaZone).endOf('week');
            assert.equal(result.toISO(), expected.toISO());
        });
    });
});
