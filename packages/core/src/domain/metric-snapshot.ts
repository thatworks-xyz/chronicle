import ohash from 'object-hash';
import { Logger } from '../ports/logger.js';
import { ConnectorItemId } from './connector-item-id.js';
import { ConnectorId } from './connector.js';
import { ItemPropertyType } from './filters.js';
import { HierarchyType } from './hierarchy.js';
import { WorkItem } from './work-item.js';

export enum MetricSnapshotTypes {
    StatusCount = 'status_count',
    SprintPoints = 'sprint_points',
    ProgressRatio = 'progress_ratio',
    PercentageList = 'percentage_list',
    Table = 'table',
    DataTable = 'data_table',
    GenericMetric = 'generic_metric',
}

export interface MetricSnapshotTableCell {
    data: string;
    propertyType?: ItemPropertyType;
    color?: string;
    icon?: { typeOfIcon: 'connector' | 'url'; value: string };
    url?: string;
    itemId?: { typeOfId: 'item'; connectorItemId: ConnectorItemId; connector: ConnectorId; parentTitle?: string };
}

export interface MetricSnapshotTable {
    label: string;
    titleColumnIndex: number;
    columns: string[];
    rows: MetricSnapshotTableCell[][];
}

export enum MetricSnapshotDataTableCellDataTypes {
    String = 'string',
    Number = 'number',
}

export interface MetricSnapshotDataTable {
    label: string;
    columns: { label: string; unit?: string; dataType: MetricSnapshotDataTableCellDataTypes }[];
    rows: string[][];
}

export type MetricSnapshotMeasurement = {
    /** Custom identifier to differentiate measurements */
    identifier?: string;
    data:
        | {
              type: MetricSnapshotTypes.StatusCount;
              payload: {
                  labels: { label: string; count: number; style: { color?: string; iconUrl?: string } }[];
                  unit?: string;
              };
          }
        | {
              type: MetricSnapshotTypes.SprintPoints;
              payload: {
                  labels: { label: string; totalPoints: number; style: { color?: string; iconUrl?: string } }[];
              };
          }
        | {
              type: MetricSnapshotTypes.ProgressRatio;
              payload: { ratio: { numerator: number; denominator: number } };
          }
        | {
              type: MetricSnapshotTypes.PercentageList;
              payload: { percentageList: { label?: string; list: { name: string; value: number }[] } };
          }
        | {
              type: MetricSnapshotTypes.Table;
              payload: {
                  table: MetricSnapshotTable;
              };
          }
        | {
              type: MetricSnapshotTypes.DataTable;
              payload: {
                  dataTable: MetricSnapshotDataTable;
              };
          }
        | {
              type: MetricSnapshotTypes.GenericMetric;
              payload: { generic: { value: number; valueFormatted: string } };
          };
};

/**
 * A point-in-time measurement attached to a work item.
 *
 * The shape is flat (the previous `{ time, meta, snapshot }` envelope was a MongoDB
 * time-series artifact; adapters using time-series layouts map to/from it).
 *
 * Only change-points are stored: writers skip snapshots whose `measurementHash`
 * equals the latest stored one. Readers must account for this (see the
 * MetricSnapshotRepository contract).
 */
export interface MetricSnapshot {
    /** When the measurement was taken. */
    timestamp: Date;
    itemUuid: string;
    connectorUserId: string;
    connector: ConnectorId;
    userId: string;
    /** Which snapshot config produced this measurement. */
    snapshotConfigUuid: string;
    measurement: MetricSnapshotMeasurement[];
    measurementHash: string;
}

/**
 * A metric computed for one item from a connector's fetched changes.
 * `TChanges` is the connector-specific change payload (see the ingestion Connector interface).
 */
export interface MetricSnapshotConfig<TChanges = unknown> {
    type: 'single';
    uuid: string;
    name: string;
    connector: ConnectorId;
    filterHierarchyType: HierarchyType;
    additionalTitleForInsight?: string;
    /** When true, previous snapshots are deleted before storing new ones. */
    overwriteHistory?: boolean;
    calculate: (
        userId: string,
        changes: TChanges,
        item: WorkItem,
        log: Logger,
        fromDate: Date,
    ) => Promise<MetricSnapshot | undefined>;
}

/** Batch variant of {@link MetricSnapshotConfig}: one calculation produces many snapshots. */
export interface BatchMetricSnapshotConfig<TChanges = unknown> {
    type: 'batch';
    uuid: string;
    name: string;
    connector: ConnectorId;
    filterHierarchyType: HierarchyType;
    additionalTitleForInsight?: string;
    calculate: (
        userId: string,
        changes: TChanges,
        item: WorkItem,
        log: Logger,
        fromDate: Date,
    ) => Promise<MetricSnapshot[]>;
}

export function getHash(measurement: MetricSnapshot['measurement']): string {
    return ohash(measurement, {
        respectType: false,
    });
}
