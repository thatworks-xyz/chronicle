import { DateTime } from 'luxon';
import {
    ActivityFeature,
    ActivityItemPropertyType,
    ChangeDescriptionDecoration,
    TimelineCreateDate,
    TimelineDateDayType,
    TimelineDateType,
    UserMention,
} from '../domain/api-types.js';
import {
    ItemPropertyType,
    QueryDate,
    QueryDateDayType,
    QueryDateType,
    ScorerName,
    UserMentionType,
} from '../domain/filters.js';
import { SummarizedChangeDescription } from '../domain/timeline.js';
import { DateQuery, DateQueryDayType, DateQueryType, getDateFromDateQueryType } from './date-helpers.js';

export function toChangeDescriptionDecoration(
    c: SummarizedChangeDescription['decoration'],
): ChangeDescriptionDecoration {
    switch (c) {
        case 'date':
            return ChangeDescriptionDecoration.Date;
        case 'highlight':
            return ChangeDescriptionDecoration.Highlight;
        case 'text':
            return ChangeDescriptionDecoration.Text;
    }
}

export function toUserMentionType(c: UserMentionType): UserMention {
    switch (c) {
        case UserMentionType.Assigned:
            return UserMention.Assigned;
        case UserMentionType.Mentioned:
            return UserMention.Mentioned;
        case UserMentionType.None:
            return UserMention.None;
    }
}

export function fromUserMentionType(c: UserMention): UserMentionType {
    switch (c) {
        case UserMention.Assigned:
            return UserMentionType.Assigned;
        case UserMention.Mentioned:
            return UserMentionType.Mentioned;
        case UserMention.None:
            return UserMentionType.None;
    }
}

export function toActivityPropertyType(t: ItemPropertyType): ActivityItemPropertyType {
    switch (t) {
        case ItemPropertyType.Assignee:
            return ActivityItemPropertyType.Assignee;
        case ItemPropertyType.Status:
            return ActivityItemPropertyType.Status;
        case ItemPropertyType.Priority:
            return ActivityItemPropertyType.Priority;
        case ItemPropertyType.EndDate:
            return ActivityItemPropertyType.EndDate;
        case ItemPropertyType.StartDate:
            return ActivityItemPropertyType.StartDate;
        case ItemPropertyType.Progress:
            return ActivityItemPropertyType.Progress;
        case ItemPropertyType.StoryPoints:
            return ActivityItemPropertyType.StoryPoints;
        case ItemPropertyType.TypeOfObject:
            return ActivityItemPropertyType.TypeOfObject;
        case ItemPropertyType.Unclassified:
            return ActivityItemPropertyType.Unclassified;
        case ItemPropertyType.Description:
            return ActivityItemPropertyType.Description;
        case ItemPropertyType.Tag:
            return ActivityItemPropertyType.Tag;
        case ItemPropertyType.CompletionDate:
            return ActivityItemPropertyType.CompletionDate;
        case ItemPropertyType.LinkedItem:
            return ActivityItemPropertyType.LinkedItem;
        case ItemPropertyType.Text:
            return ActivityItemPropertyType.Text;
    }
}

export function toItemPropertyType(t: ActivityItemPropertyType): ItemPropertyType {
    switch (t) {
        case ActivityItemPropertyType.Assignee:
            return ItemPropertyType.Assignee;
        case ActivityItemPropertyType.Status:
            return ItemPropertyType.Status;
        case ActivityItemPropertyType.Priority:
            return ItemPropertyType.Priority;
        case ActivityItemPropertyType.EndDate:
            return ItemPropertyType.EndDate;
        case ActivityItemPropertyType.StartDate:
            return ItemPropertyType.StartDate;
        case ActivityItemPropertyType.Progress:
            return ItemPropertyType.Progress;
        case ActivityItemPropertyType.StoryPoints:
            return ItemPropertyType.StoryPoints;
        case ActivityItemPropertyType.TypeOfObject:
            return ItemPropertyType.TypeOfObject;
        case ActivityItemPropertyType.Unclassified:
            return ItemPropertyType.Unclassified;
        case ActivityItemPropertyType.Description:
            return ItemPropertyType.Description;
        case ActivityItemPropertyType.Tag:
            return ItemPropertyType.Tag;
        case ActivityItemPropertyType.CompletionDate:
            return ItemPropertyType.CompletionDate;
        case ActivityItemPropertyType.LinkedItem:
            return ItemPropertyType.LinkedItem;
        case ActivityItemPropertyType.Text:
            return ItemPropertyType.Text;
    }
}

export function toFeature(t: ScorerName): ActivityFeature {
    switch (t) {
        case ScorerName.ActionRecency:
            return ActivityFeature.ActionRecency;
        case ScorerName.NumOfComments:
            return ActivityFeature.NumOfComments;
        case ScorerName.NumUniquePeople:
            return ActivityFeature.NumUniquePeople;
        case ScorerName.Activity:
            return ActivityFeature.Activity;
        case ScorerName.Priority:
            return ActivityFeature.Priority;
    }
}

export function toScorer(t: ActivityFeature): ScorerName {
    switch (t) {
        case ActivityFeature.ActionRecency:
            return ScorerName.ActionRecency;
        case ActivityFeature.NumOfComments:
            return ScorerName.NumOfComments;
        case ActivityFeature.NumUniquePeople:
            return ScorerName.NumUniquePeople;
        case ActivityFeature.Activity:
            return ScorerName.Activity;
        case ActivityFeature.Priority:
            return ScorerName.Priority;
    }
}

// ============================================================================
// Date conversions
// ============================================================================

function timelineDateTypeToQueryDateType(t: TimelineDateType): QueryDateType {
    switch (t) {
        case TimelineDateType.Iso:
            return QueryDateType.Iso;
        case TimelineDateType.RelativeDaysMinus:
            return QueryDateType.RelativeDaysMinus;
        case TimelineDateType.RelativeDaysPlus:
            return QueryDateType.RelativeDaysPlus;
        case TimelineDateType.Today:
            return QueryDateType.Today;
        case TimelineDateType.StartOfWeek:
            return QueryDateType.StartOfWeek;
        case TimelineDateType.EndOfWeek:
            return QueryDateType.EndOfWeek;
    }
}

export function qlToQueryDateDayType(dayType: TimelineDateDayType | undefined | null): QueryDateDayType {
    switch (dayType) {
        case TimelineDateDayType.Weekday:
            return QueryDateDayType.Weekday;
        case TimelineDateDayType.Day:
        default:
            return QueryDateDayType.Day;
    }
}

export function qlToQueryDate(date: TimelineCreateDate): QueryDate {
    return {
        dateType: timelineDateTypeToQueryDateType(date.type),
        isoDate: date.isoDate ?? undefined,
        relativeDays: date.relativeDays ?? undefined,
        dayType: date.dayType != null ? qlToQueryDateDayType(date.dayType) : undefined,
        userIanaZone: date.userIanaZone,
    };
}

function queryDateTypeToSharedDateQueryType(dateType: QueryDateType): DateQueryType {
    switch (dateType) {
        case QueryDateType.Iso:
            return DateQueryType.Iso;
        case QueryDateType.RelativeDays:
            return DateQueryType.RelativeDays;
        case QueryDateType.RelativeDaysMinus:
            return DateQueryType.RelativeDaysMinus;
        case QueryDateType.RelativeDaysPlus:
            return DateQueryType.RelativeDaysPlus;
        case QueryDateType.Today:
            return DateQueryType.Today;
        case QueryDateType.StartOfWeek:
            return DateQueryType.StartOfWeek;
        case QueryDateType.EndOfWeek:
            return DateQueryType.EndOfWeek;
    }
}

function queryDateDayTypeToSharedDateQueryDayType(dayType: QueryDateDayType | undefined): DateQueryDayType | undefined {
    if (!dayType) {
        return undefined;
    }
    switch (dayType) {
        case QueryDateDayType.Day:
            return DateQueryDayType.Day;
        case QueryDateDayType.Weekday:
            return DateQueryDayType.Weekday;
    }
}

function queryDateToSharedDateQuery(date: QueryDate): DateQuery {
    return {
        dateType: queryDateTypeToSharedDateQueryType(date.dateType),
        isoDate: date.isoDate,
        relativeDays: date.relativeDays,
        dayType: queryDateDayTypeToSharedDateQueryDayType(date.dayType),
        userIanaZone: date.userIanaZone,
    };
}

export function getDateFromQueryDateType(date: QueryDate, relativeTo = DateTime.now()): DateTime {
    return getDateFromDateQueryType(queryDateToSharedDateQuery(date), relativeTo);
}

export function getAndValidateQueryDate(date: QueryDate) {
    const dt = getDateFromQueryDateType(date);
    if (!dt.isValid) {
        throw new Error(`Date calculation failed`);
    }
    return dt.toJSDate();
}

export function getAndValidateTimelineDate(date: TimelineCreateDate) {
    const pt = qlToQueryDate(date);
    return getAndValidateQueryDate(pt);
}
