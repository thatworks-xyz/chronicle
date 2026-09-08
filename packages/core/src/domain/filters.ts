export enum ChangeType {
    Unclassified = 'unclassified',
    Item = 'item',
    Comment = 'comment',
    Assignee = 'assignee',
    Parent = 'parent',
    Children = 'children',
    Description = 'description',
    Attachment = 'attachment',
    LinkedItem = 'linked_item',
    Status = 'status',
    Sprint = 'sprint',
    Summary = 'summary',
    Suggestion = 'suggestion',
    StartDate = 'start_date',
    EndDate = 'end_date',
    StoryPoints = 'story_points',
    Priority = 'priority',
    Title = 'title',
    CustomField = 'custom_field',
    NewVersion = 'new_version',
    Tags = 'tags',
}

export enum ChangeActionType {
    CreatedOrAdded = 'created_added',
    Renamed = 'renamed',
    Updated = 'updated',
    DeletedOrRemoved = 'deleted_removed',
    Restored = 'restored',
    Archived = 'archived',
    Resolved = 'resolved',
    Reopened = 'reopened',
}

export enum UserMentionType {
    None = 'none',
    Assigned = 'assigned',
    Mentioned = 'mentioned',
}

export enum ScorerName {
    ActionRecency = 'action_recency',
    Priority = 'priority',
    NumOfComments = 'number_of_comments',
    Activity = 'activity',
    NumUniquePeople = 'num_unique_people',
}

export enum ItemType {
    Milestone = 'milestone',
    Task = 'task',
    Document = 'document',
    MilestoneWithRollupProgress = 'milestone_with_rollup_progress',
    MetricData = 'metric_data',
    CodeRepository = 'code_repository',
    CodeRepositoryBranch = 'code_repository_branch',
    PullRequest = 'pull_request',
    Commit = 'commit',
    ChatChannel = 'chat_channel',
    CrmEntry = 'crm_entry',
    Group = 'group',
    Email = 'email',
}

export enum ItemPropertyType {
    TypeOfObject = 'type_of_object',
    Status = 'status',
    Priority = 'priority',
    Assignee = 'assignee',
    StartDate = 'start_date',
    EndDate = 'end_date',
    StoryPoints = 'story_points',
    Progress = 'progress',
    Unclassified = 'unclassified',
    Description = 'description',
    Tag = 'tag',
    CompletionDate = 'completion_date',
    LinkedItem = 'linked_item',
    Text = 'text',
}

export enum ItemPropertyStatusCategory {
    ToDo = 'to_do',
    InProgress = 'in_progress',
    Done = 'done',
    Unknown = 'unknown',
}

export enum DeletionType {
    Deleted = 'deleted',
    Archived = 'archived',
}

export function getItemPropertyStatusCategoryAsString(category: ItemPropertyStatusCategory): string {
    switch (category) {
        case ItemPropertyStatusCategory.ToDo:
            return 'to do';
        case ItemPropertyStatusCategory.InProgress:
            return 'in progress';
        case ItemPropertyStatusCategory.Done:
            return 'done';
        case ItemPropertyStatusCategory.Unknown:
            return 'unknown';
    }
}

export enum QueryDateType {
    Iso = 'iso',
    /**
     * @deprecated Use {@link QueryDateType.RelativeDaysMinus} instead.
     */
    RelativeDays = 'relative_days',
    RelativeDaysMinus = 'relative_days_minus',
    RelativeDaysPlus = 'relative_days_plus',
    Today = 'today',
    StartOfWeek = 'start_of_week',
    EndOfWeek = 'end_of_week',
}

export enum QueryDateDayType {
    Day = 'day',
    Weekday = 'weekday',
}

export interface QueryDate {
    dateType: QueryDateType;
    isoDate?: string;
    relativeDays?: number;
    dayType?: QueryDateDayType;
    userIanaZone: string;
}

export interface PropertyFilterFieldValue {
    isUser?: boolean;
    statusCategory?: ItemPropertyStatusCategory;
    normalizedPriority?: number;
    /**
     * @deprecated Use {@link PropertyFilterFieldValue.queryDate} instead.
     */
    date?: Date;
    queryDate?: QueryDate;
    rawValue?: string;
}

export interface PropertyFieldFilter {
    property: ItemPropertyType;
    value: PropertyFilterFieldValue;
}

export interface PropertyFieldFilterRegex {
    property: ItemPropertyType;
    value: string;
}

export interface PropertyFieldFilterEmpty {
    property: ItemPropertyType;
    value: boolean;
}

export interface PropertyFieldComparatorFilter {
    in?: PropertyFieldFilter[];
    eq?: PropertyFieldFilter;
    neq?: PropertyFieldFilter;
    gt?: PropertyFieldFilter;
    gte?: PropertyFieldFilter;
    lt?: PropertyFieldFilter;
    lte?: PropertyFieldFilter;
    regex?: PropertyFieldFilterRegex;
    empty?: PropertyFieldFilterEmpty;
    from?: PropertyFieldFilterRegex;
}

export interface TitleComparatorFilter {
    in?: string[];
    eq?: string;
    neq?: string;
    regex?: string;
    inc?: string;
    exc?: string;
}

export interface CommentComparatorFilter {
    in?: string[];
    eq?: string;
    neq?: string;
    regex?: string;
    empty?: boolean;
    inc?: string;
    exc?: string;
}

export interface PropertyNameValueFilter {
    name: string;
    value: string;
}

export interface PropertyNameValueFilterEmpty {
    name: string;
    value: boolean;
}

export interface PropertyNameValueComparatorFilter {
    eq?: PropertyNameValueFilter;
    neq?: PropertyNameValueFilter;
    regex?: PropertyNameValueFilter;
    empty?: PropertyNameValueFilterEmpty;
    // TODO future: do we parse values as numbers? leave them as strings?
    // gt?: PropertyNameValueFilter;
    // gte?: PropertyNameValueFilter;
    // lt?: PropertyNameValueFilter;
    // lte?: PropertyNameValueFilter;
}

export interface FeatureFilter {
    feature: ScorerName;
    score: number;
}

export interface FeatureComparatorFilter {
    eq?: FeatureFilter;
    neq?: FeatureFilter;
    gt?: FeatureFilter;
    gte?: FeatureFilter;
    lt?: FeatureFilter;
    lte?: FeatureFilter;
}

export interface ContextItemsFilter {
    change?: {
        in?: ChangeType[];
        eq?: ChangeType;
        neq?: ChangeType;
        since?: {
            /**
             * @deprecated Use {@link ContextItemsFilter.change.since.queryDate} instead.
             */
            date?: Date;
            queryDate: QueryDate;
            changeCount?: { eq?: number; neq?: number };
        };
        before?: {
            queryDate: QueryDate;
        };
    };
    action?: { in?: ChangeActionType[] };
    userMention?: { in?: UserMentionType[]; eq?: UserMentionType };
    properties?: PropertyFieldComparatorFilter[];
    propertiesNameValue?: PropertyNameValueComparatorFilter[];
    connectorItemType?: { in?: string[]; eq?: string; neq?: string; regex?: string };
    type?: { in?: ItemType[] };
    actors?: { in?: string[] };
    itemUuids?: { neq?: string[]; eq?: string[] };
    feature?: {
        in?: ScorerName[];
    } & FeatureComparatorFilter;
    title?: TitleComparatorFilter;
    comment?: CommentComparatorFilter;
}

export enum ContextItemsFilterOperator {
    And = 'and',
    Or = 'or',
}

export enum GraphFilterType {
    Full = 'full',
    RootsOnly = 'roots_only',
    ChildrenOfRootsOnly = 'children_of_roots_only',
}

export interface ContextItemsFiltersWithOperator {
    graphFilterType: GraphFilterType;
    filters: ContextItemsFilter[];
    operator: ContextItemsFilterOperator;
    skipRootIfThereAreNoChildren?: boolean;
}
