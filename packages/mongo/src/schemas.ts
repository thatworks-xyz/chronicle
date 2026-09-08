import {
    AccessModes,
    ActionTarget,
    ChangeActionType,
    ChangeEventDescriptionDecoration,
    ChangeEventDescriptionType,
    ChangeType,
    ConnectorItemId,
    DeletionType,
    HashedWorkItem,
    IAccessPolicy,
    ItemMetaFilter,
    ItemMetaFilterParseValueAs,
    ItemMetaFilterPropertyComparisonOperator,
    ItemMetaFilterPropertyDateInterval,
    ItemMetaFilterPropertyMatchValueDateFromNow,
    ItemMetaFilterPropertyMatchValueDefault,
    ItemMetaFilterPropertyOperator,
    ItemMetaFilterType,
    ItemPropertyStatusCategory,
    ItemPropertyType,
    ItemType,
    MetricSnapshotDataTableCellDataTypes,
    MetricSnapshotTypes,
    UserMentionType,
} from '@chronicle/core';
import mongoose from 'mongoose';

// NOTE: unlike the original system, `connector` fields have no enum constraint —
// Chronicle treats connector ids as open strings.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongooseSchemaRecord<T> = Record<keyof T, mongoose.SchemaTypeOptions<any> | mongoose.Schema>;

// ============================================================================
// Shared sub-schemas
// ============================================================================

export function getConnectorItemIdSchema(required: boolean) {
    const s: MongooseSchemaRecord<ConnectorItemId> = {
        idFromConnector: { type: String, required },
        additionalIdFromConnector: String,
        connectorObjectType: { type: String, required },
        connectorUserId: { type: String, required },
        idIsUnique: String,
    };
    return s;
}

export const ConnectorItemIdSchema: MongooseSchemaRecord<ConnectorItemId> = getConnectorItemIdSchema(true);

const MetaFilterMatchValue: MongooseSchemaRecord<
    ItemMetaFilterPropertyMatchValueDefault & ItemMetaFilterPropertyMatchValueDateFromNow
> = {
    parseValueAs: { type: String, required: true, enum: Object.values(ItemMetaFilterParseValueAs) },
    value: { type: String, required: true },
    operator: { type: String, enum: Object.values(ItemMetaFilterPropertyComparisonOperator) },
    interval: { type: String, enum: Object.values(ItemMetaFilterPropertyDateInterval) },
};

const MetaFilterFilter: MongooseSchemaRecord<ItemMetaFilter['filters'][0]> = {
    type: { type: String, required: true, enum: Object.values(ItemMetaFilterType) },
    match: [
        {
            propertyId: { type: String, required: true },
            valueId: String,
            value: MetaFilterMatchValue,
        },
    ],
    operator: { type: String, required: true, enum: Object.values(ItemMetaFilterPropertyOperator) },
};

const MetaFilter: MongooseSchemaRecord<ItemMetaFilter> = {
    targetItemId: ConnectorItemIdSchema,
    filters: [MetaFilterFilter],
};

export const AccessPolicySchema: MongooseSchemaRecord<IAccessPolicy> = {
    mode: { type: String, required: true, enum: Object.values(AccessModes) },
    // `default: undefined` stops Mongoose from auto-initializing this array to `[]`.
    // Without it, casting a `{ mode: 'connectionAudience' }` subdocument injects
    // `allowUserIds: []`, which is invalid for connectionAudience and makes
    // `AccessPolicy.from()` throw on read (fail closed).
    allowUserIds: { type: [String], default: undefined },
};

// ============================================================================
// Work items (collection: items)
// ============================================================================

const WorkItemSchema: MongooseSchemaRecord<HashedWorkItem> = {
    uuid: { type: String, required: true },
    userId: { type: String, required: true },
    connector: { type: String, required: true },
    idsFromConnector: ConnectorItemIdSchema,
    title: { type: String, required: true },
    url: String,
    createdBy: [{ displayName: { type: String, required: true }, isUser: { type: Boolean, required: true } }],
    createdDate: { type: Date },
    properties: [
        {
            name: { type: String, required: true },
            value: { type: String, required: true },
            details: {
                type: { type: String, required: true, enum: Object.values(ItemPropertyType) },
                priorityIndex: { type: Number, required: false },
                totalNumPriorities: { type: Number, required: false },
                isUser: { type: Boolean, required: false },
                statusOrderIndex: Number,
                statusId: String,
                isDone: { type: Boolean, required: false },
                statusCategory: { type: String, required: false, enum: Object.values(ItemPropertyStatusCategory) },
                linkDescription: String,
                itemName: String,
                idsFromConnector: ConnectorItemIdSchema,
                textFormat: String,
            },
            style: { color: String, iconUrl: String },
            connectorPropertyId: String,
            connectorValueId: String,
            connectorPropertyType: String,
        },
    ],
    parents: [
        {
            itemUuid: { type: String, required: true },
            idsFromConnector: ConnectorItemIdSchema,
            relationship: String,
        },
    ],
    lastUpdate: { type: Date },
    hash: { type: String, required: true },
    types: [{ type: String, required: true, enum: Object.values(ItemType) }],
    deleted: { type: String, required: false, enum: Object.values(DeletionType) },
    metaFilter: MetaFilter,
    // Access policy is optional - items without this field are treated as mode: 'connectionAudience'
    accessPolicy: { type: new mongoose.Schema(AccessPolicySchema, { _id: false }), required: false },
};

export function makeWorkItemModel(conn: mongoose.Connection, collectionName = 'items') {
    const schema = new mongoose.Schema<HashedWorkItem>(WorkItemSchema, { collection: collectionName });
    schema.index({ connector: 1, userId: 1, uuid: 1 }, { name: 'connector_userId_uuid', background: true });
    schema.index({ uuid: 1 }, { name: 'uuid_idx', background: true });
    schema.index(
        { 'parents.itemUuid': 1, userId: 1, lastUpdate: 1 },
        { name: 'parents_user_lastUpdate', background: true },
    );
    schema.index(
        { userId: 1, connector: 1, 'idsFromConnector.connectorObjectType': 1 },
        { name: 'user_connector_objtype', background: true },
    );
    return conn.models[collectionName] ?? conn.model<HashedWorkItem>(collectionName, schema);
}

// ============================================================================
// Change events (collection: changelog — MongoDB time-series)
// ============================================================================

/** The stored (time-series) envelope for a change event. */
export interface ChangeEventDoc {
    time: Date;
    meta: {
        itemUuid: string;
        userId: string;
        connector: string;
        idsFromConnector: ConnectorItemId;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: any;
}

const ChangeEventRichDescriptionSchema = {
    value: { type: String },
    type: { type: String, enum: Object.values(ChangeEventDescriptionType) },
    decoration: {
        color: { type: String },
        display: { type: String, enum: Object.values(ChangeEventDescriptionDecoration) },
    },
};

const ChangeEventPropertyDetailsSchema = {
    property: { type: String, enum: Object.values(ItemPropertyType) },
    statusCategory: { type: String, enum: Object.values(ItemPropertyStatusCategory) },
};

const ChangeEventActionSchema = {
    changeType: { type: String, required: true, enum: Object.values(ChangeType) },
    changeTypeConnectorId: String,
    actionType: { type: String, required: true, enum: Object.values(ChangeActionType) },
    userMentionType: { type: String, required: true, enum: Object.values(UserMentionType) },
    actionTarget: { type: String, required: true, enum: Object.values(ActionTarget) },
    // actorDisplayName not compulsory because some sources may not have the name for some actions
    actorDisplayName: { type: String, required: false },
    actorIsUser: { type: Boolean, required: true },
    description: {
        complex: [
            {
                word: String,
                canPluralize: Boolean,
                type: { type: String, required: false, enum: Object.values(ChangeEventDescriptionType) },
                decoration: { color: String, display: String },
            },
        ],
        simple: String,
    },
    fromValue: { type: String, required: false },
    toValue: { type: String, required: false },
    fromToDescription: {
        from: [ChangeEventRichDescriptionSchema],
        to: [ChangeEventRichDescriptionSchema],
        label: String,
    },
    property: { from: ChangeEventPropertyDetailsSchema, to: ChangeEventPropertyDetailsSchema },
    entityId: { type: String },
    entityThreadId: { type: String },
    entityType: { type: String },
};

export function makeChangeEventModel(conn: mongoose.Connection, collectionName = 'changelog') {
    const schema = new mongoose.Schema<ChangeEventDoc>(
        {
            time: { type: Date, required: true },
            meta: {
                itemUuid: { type: String, required: true },
                userId: { type: String, required: true },
                connector: { type: String, required: true },
                idsFromConnector: ConnectorItemIdSchema,
            },
            action: { type: new mongoose.Schema(ChangeEventActionSchema, { _id: false }), required: true },
        },
        {
            collection: collectionName,
            timeseries: {
                timeField: 'time',
                metaField: 'meta',
                granularity: 'minutes',
            },
        },
    );
    schema.index(
        { 'meta.userId': 1, 'meta.itemUuid': 1, time: -1 },
        { name: 'changelog_user_item_time_idx', background: true },
    );
    schema.index({ 'meta.itemUuid': 1, time: -1 }, { name: 'changelog_item_time_idx', background: true });
    return conn.models[collectionName] ?? conn.model<ChangeEventDoc>(collectionName, schema);
}

// ============================================================================
// Metric snapshots (collection: metric_snapshots — MongoDB time-series)
// ============================================================================

/** The stored (time-series) envelope for a metric snapshot. */
export interface MetricSnapshotDoc {
    time: Date;
    meta: {
        itemUuid: string;
        connectorUserId: string;
        connector: string;
        userId: string;
        snapshotConfigUuid: string;
    };
    snapshot: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measurement: any[];
        measurementHash: string;
    };
}

const MetricSnapshotMeasurementTableCellSchema = {
    data: String,
    propertyType: { type: String, enum: Object.values(ItemPropertyType) },
    color: String,
    icon: {
        typeOfIcon: String,
        value: String,
    },
    url: String,
    itemId: {
        typeOfId: String,
        connectorItemId: getConnectorItemIdSchema(false),
        connector: String,
        parentTitle: String,
    },
};

const MetricSnapshotMeasurementSchema = {
    data: {
        type: { type: String, required: true, enum: Object.values(MetricSnapshotTypes) },
        payload: {
            labels: [
                {
                    label: String,
                    count: Number,
                    totalPoints: Number,
                    style: {
                        color: String,
                        iconUrl: String,
                    },
                },
            ],
            ratio: {
                numerator: Number,
                denominator: Number,
            },
            percentageList: { label: String, list: [{ name: String, value: Number }] },
            table: {
                label: String,
                titleColumnIndex: Number,
                columns: [String],
                rows: [[MetricSnapshotMeasurementTableCellSchema]],
            },
            dataTable: {
                label: String,
                columns: [
                    {
                        label: String,
                        unit: String,
                        dataType: { type: String, enum: Object.values(MetricSnapshotDataTableCellDataTypes) },
                    },
                ],
                rows: [[String]],
            },
            generic: { value: Number, valueFormatted: String },
            unit: String,
        },
    },
    identifier: { type: String, required: false },
};

export function makeMetricSnapshotModel(conn: mongoose.Connection, collectionName = 'metric_snapshots') {
    const schema = new mongoose.Schema<MetricSnapshotDoc>(
        {
            time: { type: Date, required: true },
            meta: {
                itemUuid: { type: String, required: true },
                userId: { type: String, required: true },
                connector: { type: String, required: true },
                connectorUserId: { type: String, required: true },
                snapshotConfigUuid: { type: String, required: true },
            },
            snapshot: {
                measurement: [MetricSnapshotMeasurementSchema],
                measurementHash: { type: String, required: true },
            },
        },
        {
            collection: collectionName,
            timeseries: {
                timeField: 'time',
                metaField: 'meta',
                granularity: 'minutes',
            },
        },
    );
    schema.index(
        { 'meta.itemUuid': 1, 'meta.snapshotConfigUuid': 1, time: -1 },
        { name: 'snapshot_item_config_time_idx', background: true },
    );
    return conn.models[collectionName] ?? conn.model<MetricSnapshotDoc>(collectionName, schema);
}

// ============================================================================
// Plain text + diffs (collections: item_plain_text, item_plain_text_diff)
// ============================================================================

export interface ItemPlainTextDoc {
    userId: string;
    itemUuid: string;
    connector: string;
    connectorUserId: string;
    text: string;
    additionalData?: string;
    updated: Date;
}

export function makeItemPlainTextModel(conn: mongoose.Connection, collectionName = 'item_plain_text') {
    const schema = new mongoose.Schema<ItemPlainTextDoc>(
        {
            userId: { type: String, required: true },
            itemUuid: { type: String, required: true },
            connector: { type: String, required: true },
            connectorUserId: { type: String, required: true },
            text: { type: String, required: true },
            additionalData: { type: String },
            updated: { type: Date, required: true },
        },
        { collection: collectionName },
    );
    schema.index({ itemUuid: 1, userId: 1 }, { background: true });
    return conn.models[collectionName] ?? conn.model<ItemPlainTextDoc>(collectionName, schema);
}

export interface ItemPlainTextDiffDoc {
    meta: {
        userId: string;
        itemUuid: string;
        connector: string;
        connectorUserId: string;
    };
    diff: {
        diff: {
            diffType: number;
            text: string;
            firstStorageDocStoredAsDiff?: {
                storedWordCount: number;
                originalWordCount: number;
            };
        }[];
    };
    time: Date;
}

export function makeItemPlainTextDiffModel(conn: mongoose.Connection, collectionName = 'item_plain_text_diff') {
    const schema = new mongoose.Schema<ItemPlainTextDiffDoc>(
        {
            meta: {
                userId: { type: String, required: true },
                itemUuid: { type: String, required: true },
                connector: { type: String, required: true },
                connectorUserId: { type: String, required: true },
            },
            diff: {
                diff: [
                    {
                        diffType: { type: Number, required: true },
                        text: { type: String, required: true },
                        firstStorageDocStoredAsDiff: {
                            type: { storedWordCount: Number, originalWordCount: Number },
                            required: false,
                        },
                    },
                ],
            },
            time: { type: Date, required: true },
        },
        {
            collection: collectionName,
            timeseries: {
                timeField: 'time',
                metaField: 'meta',
                granularity: 'minutes',
            },
        },
    );
    return conn.models[collectionName] ?? conn.model<ItemPlainTextDiffDoc>(collectionName, schema);
}

// ============================================================================
// Ingestion watermarks (collection: chronicle_watermarks)
// ============================================================================

export interface WatermarkDoc {
    userId: string;
    connector: string;
    connectorUserId: string;
    lastPollDate: Date;
    firstPollCompleted: boolean;
}

export function makeWatermarkModel(conn: mongoose.Connection, collectionName = 'chronicle_watermarks') {
    const schema = new mongoose.Schema<WatermarkDoc>(
        {
            userId: { type: String, required: true },
            connector: { type: String, required: true },
            connectorUserId: { type: String, required: true },
            lastPollDate: { type: Date, required: true },
            firstPollCompleted: { type: Boolean, required: true },
        },
        { collection: collectionName },
    );
    schema.index({ userId: 1, connector: 1, connectorUserId: 1 }, { unique: true, background: true });
    return conn.models[collectionName] ?? conn.model<WatermarkDoc>(collectionName, schema);
}
