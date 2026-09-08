import { DateTime } from 'luxon';

export enum DateQueryType {
    Iso = 'iso',
    /** @deprecated Use DateQueryType.RelativeDaysMinus instead. */
    RelativeDays = 'relative_days',
    RelativeDaysMinus = 'relative_days_minus',
    RelativeDaysPlus = 'relative_days_plus',
    Today = 'today',
    StartOfWeek = 'start_of_week',
    EndOfWeek = 'end_of_week',
}

export enum DateQueryDayType {
    Day = 'day',
    Weekday = 'weekday',
}

export interface DateQuery {
    dateType: DateQueryType;
    isoDate?: string;
    relativeDays?: number;
    dayType?: DateQueryDayType;
    userIanaZone?: string;
}

function getDateByRelativeDays(
    relativeTo: DateTime,
    relativeDays: number,
    dayType: DateQueryDayType | undefined,
    direction: 'minus' | 'plus',
): DateTime {
    const dateDayType = dayType ?? DateQueryDayType.Day;
    if (dateDayType === DateQueryDayType.Weekday) {
        let daysRemaining = relativeDays;
        let currentDate = relativeTo;
        while (daysRemaining > 0) {
            currentDate = direction === 'minus' ? currentDate.minus({ days: 1 }) : currentDate.plus({ days: 1 });
            if (!currentDate.isWeekend) {
                daysRemaining--;
            }
        }
        return currentDate;
    }
    return direction === 'minus' ? relativeTo.minus({ days: relativeDays }) : relativeTo.plus({ days: relativeDays });
}

function getDateTimeInUserZone(date: DateQuery, relativeTo: DateTime): DateTime {
    return date.userIanaZone ? relativeTo.setZone(date.userIanaZone) : relativeTo;
}

export function getDateFromDateQueryType(date: DateQuery, relativeTo = DateTime.now()): DateTime {
    switch (date.dateType) {
        case DateQueryType.Iso:
            if (!date.isoDate) {
                throw new Error(`Expected isoDate to be defined`);
            }
            return DateTime.fromISO(date.isoDate);
        case DateQueryType.RelativeDays:
        case DateQueryType.RelativeDaysMinus:
            if (date.relativeDays == null) {
                throw new Error(`Expected relativeDays to be defined`);
            }
            return getDateByRelativeDays(relativeTo, date.relativeDays, date.dayType, 'minus');
        case DateQueryType.RelativeDaysPlus:
            if (date.relativeDays == null) {
                throw new Error(`Expected relativeDays to be defined`);
            }
            return getDateByRelativeDays(relativeTo, date.relativeDays, date.dayType, 'plus');
        case DateQueryType.Today:
            return getDateTimeInUserZone(date, relativeTo).startOf('day');
        case DateQueryType.StartOfWeek:
            return getDateTimeInUserZone(date, relativeTo).startOf('week');
        case DateQueryType.EndOfWeek:
            return getDateTimeInUserZone(date, relativeTo).endOf('week');
    }
}

export function getReadableDateString(d: Date, now = new Date(), futurePrefix?: string) {
    const from = DateTime.fromJSDate(d);
    const to = DateTime.fromJSDate(now);
    const diff = to.diff(from);
    const days = diff.as('days');

    function getPrefix(): string {
        if (!futurePrefix) {
            return '';
        }
        if (days < 0) {
            return `${futurePrefix} `;
        }
        return '';
    }

    const absDays = Math.abs(days);
    if (absDays > 14) {
        return `${getPrefix()}${d.toLocaleDateString()}`;
    }

    if (absDays < 7) {
        const s = to.minus(diff).toRelativeCalendar({ unit: 'days', base: DateTime.fromJSDate(now) });
        if (s) {
            return s;
        }
    }

    if (absDays <= 14) {
        const s = to.minus(diff).toRelativeCalendar({ unit: 'weeks', base: DateTime.fromJSDate(now) });
        if (s) {
            return s;
        }
    }

    const str = to.minus(diff).toRelativeCalendar({ base: DateTime.fromJSDate(now) });
    if (str) {
        return str;
    }
    return `${getPrefix()}${d.toLocaleDateString()}`;
}

export function getReadableDateTimeString(d: Date) {
    return `${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ${getReadableDateString(d)}`;
}

export function getReadableDateTimeStringLuxon(d: DateTime, now?: DateTime) {
    return `${d.toLocaleString(DateTime.TIME_SIMPLE)} ${getReadableDateString(
        d.toJSDate(),
        now?.toJSDate() || undefined,
    )}`;
}

export function getReadableTimeString(d: Date) {
    return `${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function getDateMinusDays(numDays: number) {
    const d = new Date();
    d.setDate(d.getDate() - numDays);
    return d;
}

export function getHoursMinutesFromString(
    hourStr: string,
    minStr: string,
    amPm: string,
): { hour: number; minute: number } {
    let hour = Number(hourStr);
    const minute = Number(minStr);

    if (hour < 0 || hour > 12 || hour === undefined) {
        throw new Error(`Hour value is outside the accepted range of 1 to 12: ${hourStr}`);
    }
    if (minute < 0 || minute > 59 || hour === undefined) {
        throw new Error(`Minute value is outside the accepted range of 0 to 59: ${minStr}`);
    }

    const ampmLower = amPm.toLowerCase();
    if (ampmLower !== 'am' && ampmLower !== 'pm') {
        throw new Error(`am/pm string is invalid: ${amPm}`);
    }

    if (amPm.toLowerCase() === 'am' && hour === 12) {
        hour = 0;
    } else if (amPm.toLowerCase() === 'pm') {
        hour += 12;
    }
    return {
        hour,
        minute,
    };
}

export function getStringsFromHoursMinutes(
    hour: number,
    minute: number,
): { hour: string; minute: string; amPm: 'am' | 'pm' } {
    if (hour < 0 || hour > 23 || hour === undefined) {
        throw new Error(`Hour value is outside the accepted range of 1 to 12: ${hour}`);
    }
    if (minute < 0 || minute > 59 || hour === undefined) {
        throw new Error(`Minute value is outside the accepted range of 0 to 59: ${minute}`);
    }

    let amPm: 'am' | 'pm' = 'am';

    if (hour === 0) {
        hour = 12;
    } else if (hour > 12) {
        hour -= 12;
        amPm = 'pm';
    }

    return {
        hour: String(hour).padStart(2),
        minute: String(minute).padStart(2),
        amPm,
    };
}

export function getAmPmStringFromHoursMinutes(hour: number, minute: number): string {
    if (hour < 0 || hour > 23) {
        throw new Error(`Hour value is outside the accepted range of 0 to 23: ${hour}`);
    }
    if (minute < 0 || minute > 59) {
        throw new Error(`Hour value is outside the accepted range of 0 to 59: ${minute}`);
    }

    const minuteString = String(minute).padStart(2, '0');
    if (hour === 0) {
        return `${12}:${minuteString}am`;
    }
    if (hour > 12) {
        return `${hour - 12}:${minuteString}pm`;
    }
    return `${hour}:${minuteString}am`;
}

/**
 * Formats a delta period into a human-readable comparison text.
 * Used for delta period comparisons (e.g., "Now vs yesterday", "Now vs last week").
 * @param fromDate - Start date of the delta period
 * @param toDate - End date of the delta period
 * @param prefix - Optional prefix (default: "Now vs")
 * @returns Formatted string like "Now vs yesterday", "Now vs last week", "Now vs last month", or "Now vs past X days/months"
 */
export function formatDeltaPeriodComparisonText(fromDate: Date, toDate: Date, prefix = 'Now vs'): string {
    const from = DateTime.fromJSDate(fromDate);
    const to = DateTime.fromJSDate(toDate);
    const deltaPeriodDays = Math.round(to.diff(from, 'days').days);

    if (deltaPeriodDays === 1) {
        return `${prefix} yesterday`;
    }
    if (deltaPeriodDays === 7) {
        return `${prefix} last week`;
    }
    if (deltaPeriodDays === 14) {
        return `${prefix} past 2 weeks`;
    }

    // Handle months (multiples of 30 days)
    if (deltaPeriodDays % 30 === 0) {
        const months = deltaPeriodDays / 30;
        if (months === 1) {
            return `${prefix} last month`;
        }
        return `${prefix} past ${months} months`;
    }

    return `${prefix} past ${deltaPeriodDays} days`;
}
