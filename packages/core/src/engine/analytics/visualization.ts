/**
 * Visualization types for graph analytics results.
 * These types are serializable and can be sent over GraphQL.
 */

/**
 * Discriminated union of all visualization types.
 * Extensible for future types like tables, key-value lists, etc.
 */
export type VisualizationResult =
    | TimeSeriesChart
    | BarChart
    | RAGIndicator
    | PillBadge
    | AnnotatedText
    | TableVisualization
    | VisualizationGroup
    | MetricCard;

/**
 * A group of visualizations displayed together.
 * Useful for insights that produce multiple related charts/tables.
 */
export interface VisualizationGroup {
    type: 'visualization-group';
    /** Optional title for the group */
    title?: string;
    /** The visualizations in this group (displayed in a stacked layout) */
    visualizations: Exclude<VisualizationResult, VisualizationGroup>[];
}

/**
 * Metric card (KPI card) visualization for displaying a single key metric
 * with optional trend indicator and sparkline chart.
 */
export interface MetricCard {
    type: 'metric-card';
    /** Card title (e.g., "OPEN TICKETS") */
    title: string;
    /** Primary metric value (e.g., "7.8%", "$1.2M", "42") */
    primaryValue: string;
    /** Optional supporting context text (e.g., "42 tickets awaiting reply") */
    supportingText?: string;
    /** Optional trend indicator showing change from previous period */
    trend?: MetricCardTrend;
    /** Optional sparkline for mini time-series visualization */
    sparkline?: MetricCardSparkline;
}

/**
 * Trend indicator for metric card.
 * Shows direction and magnitude of change.
 */
export interface MetricCardTrend {
    /** Display value (e.g., "2%", "+$50K", "-15") */
    displayValue: string;
    /** Direction of the trend (determines arrow direction) */
    direction: 'up' | 'down' | 'neutral';
    /**
     * Semantic meaning - determines color.
     * 'positive' = green (improvement), 'negative' = red (regression), 'neutral' = gray.
     * This is separate from direction because "down 2%" could be positive for cancellation rate.
     */
    sentiment: 'positive' | 'negative' | 'neutral';
    /** Optional comparison period label (e.g., "vs last week") */
    comparisonLabel?: string;
}

/**
 * Sparkline configuration for mini time-series in metric card.
 */
export interface MetricCardSparkline {
    /** Data points for the sparkline */
    data: number[];
    /** Optional labels for data points (used in tooltips) */
    labels?: string[];
    /** Chart type */
    chartType: 'line' | 'bar';
    /** Optional color for the sparkline */
    color?: string;
    /** Label shown at the start (left) of the sparkline (e.g., "25 Jan") */
    startLabel?: string;
    /** Label shown at the end (right) of the sparkline (e.g., "25 Feb") */
    endLabel?: string;
}

/**
 * Time series line chart visualization.
 */
export interface TimeSeriesChart {
    type: 'time-series';
    title?: string;
    subtitle?: string;
    datasets: ChartDataset[];
    labels: string[]; // X-axis labels (dates, epochs, or strings)
    annotations?: DeltaAnnotation[];
    options: ChartDisplayOptions;
}

/**
 * Bar chart visualization.
 */
export interface BarChart {
    type: 'bar-chart';
    title?: string;
    subtitle?: string;
    datasets: ChartDataset[];
    labels: string[]; // X-axis labels (categories)
    annotations?: DeltaAnnotation[];
    options: ChartDisplayOptions;
}

/**
 * Red/Amber/Green status indicator visualization.
 */
export interface RAGIndicator {
    type: 'rag-indicator';
    status: 'red' | 'amber' | 'green';
    value: string; // e.g., "85%", "12 items"
    label?: string; // e.g., "Customer Satisfaction", "On-time Delivery"
    metadata?: Record<string, unknown>;
}

/**
 * A single pill item with label and optional background color.
 */
export interface PillBadgeItem {
    label: string;
    /** Optional CSS color for the pill background (e.g., '#E8F5E9', 'rgba(255,0,0,0.1)') */
    color?: string;
}

/**
 * Pill/badge visualization for short labels rendered as rounded chips.
 * Supports one or more pills displayed inline.
 */
export interface PillBadge {
    type: 'pill-badge';
    pills: PillBadgeItem[];
}

/**
 * A card shown inside a tooltip — represents one item (e.g. an event)
 * with a title and key-value detail lines.
 */
export interface TooltipCard {
    /** Card title text */
    title: string;
    /** Optional URL to make the title a hyperlink */
    url?: string;
    /** Key-value detail lines shown below the title */
    details: { label: string; value: string }[];
}

/**
 * A named group of tooltip cards, rendered as a section with a header.
 */
export interface TooltipSection {
    /** Section header (e.g. "Upcoming Events", "Past Events") */
    title: string;
    cards: TooltipCard[];
}

/**
 * Text block with a primary markdown body and an optional muted subtitle.
 * Useful for table cells that need rich text with secondary context.
 */
export interface AnnotatedText {
    type: 'annotated-text';
    /** Primary content rendered as markdown */
    markdown: string;
    /** Optional secondary text rendered in muted style below the primary content */
    subtitle?: string;
    /** Optional tooltip shown via info icon at the start of the cell */
    tooltip?: TooltipSection[];
}

/**
 * Table visualization for displaying structured data rows.
 */
export interface TableVisualization {
    type: 'table';
    title?: string;
    /** Optional description rendered as markdown under the title */
    descriptionMarkdown?: string;
    columns: TableColumn[];
    rows: TableRow[];
    /** Hide the header row with column labels */
    hideHeader?: boolean;
    /** Background color for the header row (will be rendered as a tint) */
    headerBackgroundColor?: string;
    /** Use bold font weight for header text */
    headerBold?: boolean;
    /** Show only the first N rows initially, with a "Show more" button to reveal the rest */
    initialRowLimit?: number;
}

/**
 * Column definition for table visualization.
 */
export interface TableColumn {
    key: string;
    label: string;
    width?: string;
}

/**
 * Row in a table visualization.
 */
export interface TableRow {
    id: string; // For linking to source item (e.g., deal ID)
    cells: Record<string, TableCell>;
    /** If set, this row is rendered as a section header spanning all columns */
    sectionHeader?: string;
    /** Background color for section header (will be rendered as a tint) */
    sectionHeaderColor?: string;
    /** Background color for the row (will be rendered as a tint) */
    backgroundColor?: string;
    /** Optional drill-down configuration for this row */
    drillDownPrompt?: {
        /** Template string with placeholders like {variable_name} */
        template: string;
        /** Values to substitute into the template */
        variables?: Record<string, string>;
    };
}

/**
 * Cell in a table visualization.
 */
export interface TableCell {
    /** Plain text value */
    plainText?: string;
    /** Embedded visualization (chart, indicator, etc.) */
    visualization?: VisualizationResult;
    /** Rich text content as markdown */
    markdown?: string;
    /** Number of rows this cell should span */
    rowspan?: number;
    /** Truncate plain text to single line with tooltip showing full text on hover */
    truncatePlainText?: boolean;
    /** Optional URL to wrap the plain text value in a hyperlink */
    plainTextUrl?: string;
}

/**
 * A dataset for a chart (series of data points).
 */
export interface ChartDataset {
    label: string;
    data: number[];
    color?: string; // Hex or rgba string. Auto-assigned from palette if omitted.
    hidden?: boolean;
    itemUuids?: string[]; // Optional: for linking data points to activity items
}

/**
 * Delta annotation to display on chart (e.g., "[12% +2]" badge above bar).
 */
export interface DeltaAnnotation {
    datasetIndex: number; // Which dataset this annotation belongs to
    dataIndex: number; // Which data point in the dataset
    displayValue: string; // e.g., "12% +2", "+5%", "-3"
    trend?: 'up' | 'down' | 'neutral';
}

/**
 * Serializable display options for charts.
 * Frontend interprets these descriptors and applies appropriate Chart.js formatters.
 */
export interface ChartDisplayOptions {
    xAxis?: {
        format?: 'string' | 'date' | 'epoch'; // How to format x-axis labels
        title?: string;
    };
    yAxis?: {
        format?: 'number' | 'percentage' | 'duration'; // How to format y-axis labels
        title?: string;
        grace?: string; // e.g., "10%" - adds padding to y-axis range
    };
    legend?: {
        show?: boolean;
        position?: 'top' | 'bottom' | 'left' | 'right';
    };
}

/**
 * Converts a hex color to rgba with specified opacity for tinted backgrounds.
 * Handles both 3-character (#FFF) and 6-character (#FFFFFF) hex formats.
 * Returns the original color if not a valid hex format, or undefined for invalid colors.
 */
export function hexToTintedRgba(color: string | undefined, opacity = 0.08): string | undefined {
    if (!color) return undefined;
    if (color.startsWith('#')) {
        let hex = color.slice(1);

        // Expand 3-character hex to 6-character (e.g., 'FFF' → 'FFFFFF')
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        // Validate hex length
        if (hex.length !== 6) {
            return undefined;
        }

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        // Validate parsed values
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return undefined;
        }

        return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
    }
    return color;
}
