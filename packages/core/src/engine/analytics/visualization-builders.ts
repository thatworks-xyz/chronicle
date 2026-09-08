import { Colors } from '../../vendor/colors.js';
import type { AnalysisResultWithDeltas } from './types.js';
import type {
    BarChart,
    ChartDataset,
    ChartDisplayOptions,
    DeltaAnnotation,
    MetricCard,
    MetricCardSparkline,
    MetricCardTrend,
    RAGIndicator,
    TableColumn,
    TableRow,
    TableVisualization,
    TimeSeriesChart,
    VisualizationGroup,
    VisualizationResult,
} from './visualization.js';

/**
 * Default color palette for chart datasets.
 * Colors cycle through this array if not explicitly provided.
 */
const DEFAULT_CHART_COLORS = [
    Colors.neutral_1,
    Colors.neutral_2,
    Colors.dark_2,
    Colors.accent_3,
    Colors.dark_6,
    Colors.status_error,
    Colors.status_warning,
];

/**
 * Default value used to represent empty/missing cell content in tables.
 */
export const EMPTY_CELL_VALUE = '-';

/**
 * Checks if a cell value string is considered empty.
 */
function isEmptyCell(value: string): boolean {
    return value === '' || value === EMPTY_CELL_VALUE;
}

/**
 * Builds a bar chart visualization.
 *
 * @example
 * const chart = buildBarChart({
 *   labels: ['Positive', 'Neutral', 'Negative'],
 *   datasets: [{
 *     label: 'Customer Sentiment',
 *     data: [45, 30, 25]
 *   }],
 *   yAxisFormat: 'percentage',
 *   title: 'Sentiment Distribution'
 * });
 */
export function buildBarChart(params: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color?: string; itemUuids?: string[] }>;
    title?: string;
    subtitle?: string;
    yAxisFormat?: 'number' | 'percentage' | 'duration';
    yAxisTitle?: string;
    yAxisGrace?: string;
    xAxisTitle?: string;
    showLegend?: boolean;
}): BarChart {
    const options: ChartDisplayOptions = {
        xAxis: params.xAxisTitle ? { title: params.xAxisTitle } : undefined,
        yAxis: {
            format: params.yAxisFormat || 'number',
            title: params.yAxisTitle,
            grace: params.yAxisGrace,
        },
        legend: {
            show: params.showLegend !== false,
            position: 'top',
        },
    };

    return {
        type: 'bar-chart',
        title: params.title,
        subtitle: params.subtitle,
        labels: params.labels,
        datasets: params.datasets.map((ds, idx) => ({
            label: ds.label,
            data: ds.data,
            color: ds.color || DEFAULT_CHART_COLORS[idx % DEFAULT_CHART_COLORS.length],
            itemUuids: ds.itemUuids,
        })),
        options,
    };
}

/**
 * Builds a time series line chart visualization.
 *
 * @example
 * const chart = buildTimeSeries({
 *   labels: ['2024-01-01', '2024-01-02', '2024-01-03'],
 *   datasets: [{
 *     label: 'Tickets Closed',
 *     data: [10, 15, 12]
 *   }],
 *   xAxisFormat: 'date',
 *   yAxisFormat: 'number'
 * });
 */
export function buildTimeSeries(params: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color?: string; itemUuids?: string[] }>;
    title?: string;
    subtitle?: string;
    xAxisFormat?: 'string' | 'date' | 'epoch';
    xAxisTitle?: string;
    yAxisFormat?: 'number' | 'percentage' | 'duration';
    yAxisTitle?: string;
    yAxisGrace?: string;
    showLegend?: boolean;
}): TimeSeriesChart {
    const options: ChartDisplayOptions = {
        xAxis: {
            format: params.xAxisFormat || 'string',
            title: params.xAxisTitle,
        },
        yAxis: {
            format: params.yAxisFormat || 'number',
            title: params.yAxisTitle,
            grace: params.yAxisGrace,
        },
        legend: {
            show: params.showLegend !== false,
            position: 'top',
        },
    };

    return {
        type: 'time-series',
        title: params.title,
        subtitle: params.subtitle,
        labels: params.labels,
        datasets: params.datasets.map((ds, idx) => ({
            label: ds.label,
            data: ds.data,
            color: ds.color || DEFAULT_CHART_COLORS[idx % DEFAULT_CHART_COLORS.length],
            itemUuids: ds.itemUuids,
        })),
        options,
    };
}

/**
 * Adds delta annotations to a chart based on analysis deltas.
 * Modifies the chart in place by adding annotations array.
 *
 * @example
 * const chart = buildBarChart({...});
 * addDeltaAnnotations(chart, analysisWithDeltas.deltas, {
 *   metricKey: 'totalCount',
 *   format: 'combined',
 *   showOnDataIndex: -1  // Last data point
 * });
 */
export function addDeltaAnnotations(
    chart: BarChart | TimeSeriesChart,
    deltas: AnalysisResultWithDeltas['deltas'],
    options: {
        metricKey: string; // Which distribution key to show deltas for
        format?: 'percentage' | 'absolute' | 'combined'; // "12% +2" vs "+2%" vs "+2"
        showOnDataIndex?: number; // Which data point index (supports negative indexing)
        datasetIndex?: number; // Which dataset (default: 0)
    },
): void {
    if (!deltas || deltas.length === 0) {
        return;
    }

    const format = options.format || 'combined';
    const datasetIndex = options.datasetIndex || 0;
    const dataset = chart.datasets[datasetIndex];

    if (!dataset) {
        return;
    }

    // Handle negative indexing
    let dataIndex = options.showOnDataIndex ?? dataset.data.length - 1;
    if (dataIndex < 0) {
        dataIndex = dataset.data.length + dataIndex;
    }

    // Get the most recent delta (or could use first, depending on requirements)
    const delta = deltas[0];
    const currentValue = delta.analysis.distributions[options.metricKey];
    const percentageChange = delta.changes.percentage[options.metricKey];
    const absoluteChange = delta.changes.absolute[options.metricKey];

    if (currentValue === undefined || percentageChange === undefined) {
        return;
    }

    // Format the display value
    let displayValue: string;
    const sign = absoluteChange >= 0 ? '+' : '';

    switch (format) {
        case 'percentage':
            displayValue = `${sign}${percentageChange.toFixed(0)}%`;
            break;
        case 'absolute':
            displayValue = `${sign}${absoluteChange.toFixed(0)}`;
            break;
        case 'combined':
        default:
            displayValue = `${currentValue.toFixed(0)} (${sign}${percentageChange.toFixed(0)}%)`;
            break;
    }

    // Determine trend
    let trend: 'up' | 'down' | 'neutral';
    if (absoluteChange > 0) {
        trend = 'up';
    } else if (absoluteChange < 0) {
        trend = 'down';
    } else {
        trend = 'neutral';
    }

    // Add annotation
    const annotation: DeltaAnnotation = {
        datasetIndex,
        dataIndex,
        displayValue,
        trend,
    };

    if (!chart.annotations) {
        chart.annotations = [];
    }
    chart.annotations.push(annotation);
}

/**
 * Builds a RAG (Red/Amber/Green) status indicator visualization.
 *
 * @example
 * const rag = buildRAGIndicator({
 *   value: 85,
 *   thresholds: { red: 50, amber: 75, green: 90 },
 *   label: 'Customer Satisfaction',
 *   formatValue: (n) => `${n}%`
 * });
 */
export function buildRAGIndicator(params: {
    value: number;
    thresholds: { red: number; amber: number; green: number };
    label: string;
    description?: string;
    formatValue?: (n: number) => string;
    metadata?: Record<string, unknown>;
}): RAGIndicator {
    // Determine status based on thresholds
    let status: 'red' | 'amber' | 'green';
    if (params.value >= params.thresholds.green) {
        status = 'green';
    } else if (params.value >= params.thresholds.amber) {
        status = 'amber';
    } else {
        status = 'red';
    }

    // Format value
    const formattedValue = params.formatValue ? params.formatValue(params.value) : params.value.toString();

    return {
        type: 'rag-indicator',
        status,
        value: formattedValue,
        label: params.label,
        metadata: params.metadata,
    };
}

/**
 * Helper to create a simple distribution bar chart from a record of values.
 *
 * @example
 * const statusDistribution = { 'Open': 10, 'In Progress': 5, 'Closed': 15 };
 * const chart = buildDistributionBarChart({
 *   data: statusDistribution,
 *   title: 'Ticket Status',
 *   yAxisFormat: 'number'
 * });
 */
export function buildDistributionBarChart(params: {
    data: Record<string, number>;
    title?: string;
    subtitle?: string;
    datasetLabel?: string;
    yAxisFormat?: 'number' | 'percentage';
    yAxisTitle?: string;
    colors?: string[];
}): BarChart {
    const labels = Object.keys(params.data);
    const values = Object.values(params.data);

    // If custom colors provided, map them; otherwise use default palette
    const datasets: ChartDataset[] = params.colors
        ? labels.map((label, idx) => ({
              label,
              data: [values[idx]],
              color: params.colors?.[idx % params.colors.length],
          }))
        : [
              {
                  label: params.datasetLabel || 'Count',
                  data: values,
              },
          ];

    return buildBarChart({
        labels,
        datasets,
        title: params.title,
        subtitle: params.subtitle,
        yAxisFormat: params.yAxisFormat,
        yAxisTitle: params.yAxisTitle,
    });
}

/**
 * Builds a table visualization for displaying structured data rows.
 * Automatically filters out columns that have no meaningful data by default.
 * Set `filterEmptyColumns: false` to preserve all columns.
 */
export function buildTable(params: {
    title?: string;
    descriptionMarkdown?: string;
    columns: TableColumn[];
    rows: TableRow[];
    initialRowLimit?: number;
    filterEmptyColumns?: boolean;
    headerBackgroundColor?: string;
    headerBold?: boolean;
}): TableVisualization {
    const shouldFilterEmptyColumns = params.filterEmptyColumns ?? true;
    const columnsWithData = shouldFilterEmptyColumns
        ? params.columns.filter((column) => !isColumnEmpty(column, params.rows))
        : params.columns;

    return {
        type: 'table',
        title: params.title,
        descriptionMarkdown: params.descriptionMarkdown,
        columns: columnsWithData,
        rows: params.rows,
        initialRowLimit: params.initialRowLimit,
        headerBackgroundColor: params.headerBackgroundColor,
        headerBold: params.headerBold,
    };
}

/**
 * Builds a visualization group containing multiple visualizations displayed in a stacked layout.
 * Useful for insights that need to display multiple related charts or tables.
 *
 * @example
 * const group = buildVisualizationGroup({
 *   title: 'OKR Progress',
 *   visualizations: [table1, table2, table3],
 * });
 */
export function buildVisualizationGroup(params: {
    title?: string;
    visualizations: Exclude<VisualizationResult, VisualizationGroup>[];
}): VisualizationGroup {
    return {
        type: 'visualization-group',
        title: params.title,
        visualizations: params.visualizations,
    };
}

/**
 * Checks if a cell has meaningful data (not empty).
 */
function hasMeaningfulData(cell: TableRow['cells'][string]): boolean {
    if (!cell) {
        return false;
    }

    if (cell.plainText) {
        return !isEmptyCell(cell.plainText.trim());
    }

    return !!(cell.visualization || cell.markdown);
}

/**
 * Checks if a column has no meaningful data (all cells are empty).
 * Skips section header rows when checking for data.
 */
function isColumnEmpty(column: TableColumn, rows: TableRow[]): boolean {
    return rows.every((row) => {
        if (row.sectionHeader) {
            // Skip section headers - they don't count as data
            return true;
        }

        const cell = row.cells[column.key];
        return !hasMeaningfulData(cell);
    });
}

/**
 * Builds a metric card (KPI card) visualization for displaying a single key metric
 * with optional trend indicator and sparkline chart.
 *
 * @example
 * const card = buildMetricCard({
 *   title: 'TICKET REOPEN RATE',
 *   primaryValue: '7.8%',
 *   supportingText: '42 tickets reopened',
 *   trend: {
 *     displayValue: '2%',
 *     direction: 'down',
 *     sentiment: 'positive',  // Down is good for a reopen rate
 *   },
 *   sparkline: {
 *     data: [8.2, 7.9, 8.1, 7.5, 7.8],
 *     chartType: 'bar',
 *   },
 * });
 */
export function buildMetricCard(params: {
    title: string;
    primaryValue: string;
    supportingText?: string;
    trend?: MetricCardTrend;
    sparkline?: MetricCardSparkline;
}): MetricCard {
    const sparkline: MetricCardSparkline | undefined = params.sparkline
        ? {
              data: params.sparkline.data,
              labels: params.sparkline.labels,
              chartType: params.sparkline.chartType,
              color: params.sparkline.color || DEFAULT_CHART_COLORS[0],
              startLabel: params.sparkline.startLabel,
              endLabel: params.sparkline.endLabel,
          }
        : undefined;

    return {
        type: 'metric-card',
        title: params.title,
        primaryValue: params.primaryValue,
        supportingText: params.supportingText,
        trend: params.trend,
        sparkline,
    };
}
