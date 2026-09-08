import { ConnectorItemId } from './connector-item-id.js';

export enum ItemMetaFilterType {
    PropertyId = 'property_id',
}

export enum ItemMetaFilterParseValueAs {
    String = 'string',
    Number = 'number',
    Date = 'date',
    DateFromNow = 'date_from_now',
}

export enum ItemMetaFilterPropertyComparisonOperator {
    EQ = 'eq',
    NEQ = 'neq',
    GT = 'gt',
    GTE = 'gte',
    LT = 'lt',
    LTE = 'lte',
}

export enum ItemMetaFilterPropertyOperator {
    And = 'and',
    Or = 'or',
}

export enum ItemMetaFilterPropertyDateInterval {
    MONTHS_BEFORE_NOW = 'month_before_now',
    MONTHS_AFTER_NOW = 'month_after_now',
}

export interface ItemMetaFilterPropertyMatchValueDefault {
    parseValueAs: Exclude<ItemMetaFilterParseValueAs, ItemMetaFilterParseValueAs.DateFromNow>;
    value: string;
    operator: ItemMetaFilterPropertyComparisonOperator;
}

export interface ItemMetaFilterPropertyMatchValueDateFromNow {
    parseValueAs: ItemMetaFilterParseValueAs.DateFromNow;
    value: string;
    interval: ItemMetaFilterPropertyDateInterval;
}

export interface ItemMetaFilter {
    targetItemId: ConnectorItemId;
    filters: {
        type: ItemMetaFilterType.PropertyId;
        match: {
            propertyId: string;
            valueId?: string;
            value?: ItemMetaFilterPropertyMatchValueDefault | ItemMetaFilterPropertyMatchValueDateFromNow;
        }[];
        operator: ItemMetaFilterPropertyOperator;
    }[];
}
