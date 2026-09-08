/**
 * Hand-written engine API types.
 *
 * These replace types that were previously generated from a GraphQL schema.
 * Enum VALUES are preserved verbatim from the original schema — they flow
 * through engine logic and serialized payloads.
 */
import { ConnectorId } from './connector.js';

// ============================================================================
// Dates
// ============================================================================

export enum TimelineDateType {
    EndOfWeek = 'END_OF_WEEK',
    Iso = 'ISO',
    RelativeDaysMinus = 'RELATIVE_DAYS_MINUS',
    RelativeDaysPlus = 'RELATIVE_DAYS_PLUS',
    StartOfWeek = 'START_OF_WEEK',
    Today = 'TODAY',
}

export enum TimelineDateDayType {
    Day = 'DAY',
    Weekday = 'WEEKDAY',
}

/** A concrete or relative date used to create timelines. */
export interface TimelineCreateDate {
    type: TimelineDateType;
    isoDate?: string;
    relativeDays?: number;
    dayType?: TimelineDateDayType;
    userIanaZone: string;
}

export interface TimeRange {
    oldest: Date;
    newest?: Date;
}

// ============================================================================
// Activity items (graph nodes)
// ============================================================================

export enum ActivityFeature {
    ActionRecency = 'ACTION_RECENCY',
    Activity = 'ACTIVITY',
    NumOfComments = 'NUM_OF_COMMENTS',
    NumUniquePeople = 'NUM_UNIQUE_PEOPLE',
    Priority = 'PRIORITY',
}

export enum SortDirection {
    Ascending = 'ASCENDING',
    Descending = 'DESCENDING',
}

export interface ItemSort {
    direction: SortDirection;
    feature: ActivityFeature;
}

export enum UserMention {
    Assigned = 'ASSIGNED',
    Mentioned = 'MENTIONED',
    None = 'NONE',
}

/** Special actor values usable in actor filters. */
export enum ActorPlaceholder {
    TwEveryone = 'TW_EVERYONE',
    TwOthers = 'TW_OTHERS',
    TwUser = 'TW_USER',
}

export interface Actor {
    color: string;
    isUser: boolean;
    name: string;
}

export interface Actors {
    hasMore?: number;
    names: Actor[];
}

export enum ChangeDescriptionDecoration {
    Date = 'DATE',
    Highlight = 'HIGHLIGHT',
    Text = 'TEXT',
}

export interface ChangeDescription {
    color?: string;
    decoration: ChangeDescriptionDecoration;
    value: string;
}

export interface ActivityItemComment {
    authorDisplayName: string;
    comment: string;
    commentId?: string;
    date: Date;
    threadId?: string;
    userMention: UserMention;
}

export interface ActivityItemComments {
    comments: ActivityItemComment[];
    more?: number;
    total: number;
}

export interface FeatureScore {
    feature: ActivityFeature;
    score: number;
}

export interface ActivityItemParent {
    idFromConnectorObjectType: string;
    name: string;
    readableConnectorObjectType: string;
    relationship?: string;
    url?: string;
    uuid: string;
}

export enum ActivityItemPropertyType {
    Assignee = 'ASSIGNEE',
    CompletionDate = 'COMPLETION_DATE',
    Description = 'DESCRIPTION',
    EndDate = 'END_DATE',
    LinkedItem = 'LINKED_ITEM',
    Priority = 'PRIORITY',
    Progress = 'PROGRESS',
    StartDate = 'START_DATE',
    Status = 'STATUS',
    StoryPoints = 'STORY_POINTS',
    Tag = 'TAG',
    Text = 'TEXT',
    TypeOfObject = 'TYPE_OF_OBJECT',
    Unclassified = 'UNCLASSIFIED',
}

export enum ActivityItemPropertyValueType {
    DateIso = 'DATE_ISO',
    String = 'STRING',
}

export interface ActivityItemProperty {
    color?: string;
    iconUrl?: string;
    name: string;
    propertyType: ActivityItemPropertyType;
    value: string;
    valueType: ActivityItemPropertyValueType;
}

/** A work item as a node in the activity graph, enriched for display/summarization. */
export interface ActivityItem {
    actors: Actors;
    changeDescription: ChangeDescription[][];
    changeTypes: string[];
    comments?: ActivityItemComments;
    connector: ConnectorId;
    featureScores: FeatureScore[];
    iconUrl?: string;
    id: string;
    idFromConnectorObjectType: string;
    parents: ActivityItemParent[];
    properties: ActivityItemProperty[];
    readableConnectorObjectType: string;
    score: number;
    timeRange?: TimeRange;
    timeRangeReadable?: string;
    title: string;
    url?: string;
}

// ============================================================================
// Grouping
// ============================================================================

export enum ItemGroupPredefinedType {
    Assignee = 'ASSIGNEE',
    IndividualItem = 'INDIVIDUAL_ITEM',
    None = 'NONE',
    Parent = 'PARENT',
    People = 'PEOPLE',
    Property = 'PROPERTY',
    Status = 'STATUS',
    StatusLifecycle = 'STATUS_LIFECYCLE',
}

export interface GroupSettingsPropertyValue {
    neq?: string;
    regex?: string;
}

export interface GroupSettingsProperty {
    propertyName?: string;
    propertyType?: string;
    propertyValue?: GroupSettingsPropertyValue;
}

/** How to group timeline items (formerly `GroupSettingsInput`). */
export interface GroupSettings {
    groupType: string;
    property?: GroupSettingsProperty;
    subgroupOrdering?: string[];
}

export interface ItemSubgroupTaskStatus {
    isDoneStatus: boolean;
    sortOrder: number;
    status: string;
}

export interface ItemTypeGrouping {
    color?: string;
    connector: ConnectorId;
    grouping?: string;
    iconUrl?: string;
    ids: string[];
    label: string;
}

export interface SummarySectionPill {
    color?: string;
    connector?: ConnectorId;
    iconUrl?: string;
    itemUuids: string[];
    value: string;
}

export interface SummarySection {
    markdown: string;
    newRowForPills?: boolean;
    pills?: SummarySectionPill[];
}

export interface SummaryPage {
    sections: SummarySection[][];
}

export interface SummarizedActivity {
    summary: SummaryPage;
}

export interface ItemSubgroup {
    ids: string[];
    itemTypeGrouping?: ItemTypeGrouping[];
    name?: string;
    props?: ItemSubgroupTaskStatus;
    summary?: SummarizedActivity;
}

export interface ItemGroup {
    subgroups: ItemSubgroup[];
    type: string;
}

/** The grouped, filtered, optionally summarized view over a timeline. */
export interface TimelineActivity {
    groups: ItemGroup[];
    id: string;
    items: ActivityItem[];
    title?: string;
}

// ============================================================================
// Summarization settings
// ============================================================================

export enum ChangesSummaryField {
    Changes = 'CHANGES',
    Comments = 'COMMENTS',
    Description = 'DESCRIPTION',
    DocumentContent = 'DOCUMENT_CONTENT',
}

export enum SummarizationSettingsFormat {
    DetailedList = 'DETAILED_LIST',
    Highlights = 'HIGHLIGHTS',
}

export enum CommentsSummarizationLength {
    Long = 'LONG',
    Short = 'SHORT',
}

/** Controls what goes into the LLM summary (formerly `SummarizationSettingsInput`). */
export interface SummarizationSettings {
    changesAlsoGroupByItemType: boolean;
    changesIncludeTimeStamps?: boolean;
    /** 0..1 — fraction of top-scored items to include. */
    changesLevelOfDetail: number;
    changesSummaryEnabled: boolean;
    changesSummaryFields: ChangesSummaryField[];
    changesSummaryFormat: SummarizationSettingsFormat;
    commentsSummaryEnabled: boolean;
    commentsSummaryLength: CommentsSummarizationLength;
    customFormattingPrompt?: string;
    hidePills?: boolean;
    propertyNamesToSummarize: string[];
}

export interface TimelineActivitySummarization {
    settings: SummarizationSettings;
    summarize: boolean;
}
