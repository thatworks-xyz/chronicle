/* eslint-disable @typescript-eslint/no-duplicate-enum-values -- palette aliases share hex values */
/**
 * Default chart/visualization palette.
 * Consumers can override chart colors per-visualization; these are the fallbacks
 * used by the visualization builders.
 */
export enum Colors {
    brand = '#250F2E',
    accent_1 = '#1AE21A',
    accent_2 = '#FFD900',
    accent_3 = '#1B38E0',
    accent_4 = '#E8EBFC',
    neutral_1 = '#9CBEFE',
    neutral_2 = '#B098BA',
    neutral_3 = '#E8FCE8',
    neutral_4 = '#E4E0E6',
    status_critical = '#FD6330',
    status_error = '#FD6330',
    status_warning = '#FFC43F',
    status_ok = '#1AE21A',
    status_unknown = '#9CBEFE',
    status_disabled = '#BCBCBC',
    light_1 = '#ECEFF4',
    light_2 = '#E0DAD5',
    light_3 = '#D5DFF5',
    light_4 = '#D1D7E2',
    light_5 = '#CBCBCB',
    light_6 = '#F3EDE8',
    dark_1 = '#13021C',
    dark_2 = '#250F2E',
    dark_3 = '#414141',
    dark_4 = '#4C4107',
    dark_5 = '#786980',
    dark_6 = '#9885A2',
    background_back = '#FEFDFC',
    background_front = '#F3EEEB',
    black = '#250F2E',
    white = '#FEFDFC',
    border_light = '#EBE4E9',
    border_dark = '#CFCFCF',
}
