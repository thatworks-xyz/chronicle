import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ContextItemsFilter,
    ContextItemsFilterOperator,
    ContextItemsFiltersWithOperator,
    GraphFilterType,
} from '../../domain/filters.js';
import { mergeFilters } from './executor.js';

describe('mergeFilters', () => {
    const createFilters = (
        filters: ContextItemsFilter[],
        operator: ContextItemsFilterOperator = ContextItemsFilterOperator.And,
    ): ContextItemsFiltersWithOperator => ({
        graphFilterType: GraphFilterType.Full,
        filters,
        operator,
    });

    describe('when no data source filters are provided', () => {
        it('should return insight filters as-is when dataSourceFilters is undefined', () => {
            const insightFilters = createFilters([{ title: { eq: 'test' } }]);

            const result = mergeFilters(insightFilters, undefined);

            assert.deepEqual(result, insightFilters);
        });

        it('should return insight filters as-is when dataSourceFilters has empty filters array', () => {
            const insightFilters = createFilters([{ title: { eq: 'test' } }]);
            const dataSourceFilters = createFilters([]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result, insightFilters);
        });

        it('should return insight filters as-is when dataSourceFilters.filters is undefined', () => {
            const insightFilters = createFilters([{ title: { eq: 'test' } }]);
            const dataSourceFilters: ContextItemsFiltersWithOperator = {
                graphFilterType: GraphFilterType.Full,
                filters: undefined as unknown as ContextItemsFilter[],
                operator: ContextItemsFilterOperator.And,
            };

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result, insightFilters);
        });
    });

    describe('when insight has no filters', () => {
        it('should use data source filters when insight filters array is empty', () => {
            const insightFilters = createFilters([]);
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }], ContextItemsFilterOperator.Or);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result.filters, dataSourceFilters.filters);
            assert.equal(result.operator, ContextItemsFilterOperator.Or);
            assert.equal(result.graphFilterType, insightFilters.graphFilterType);
        });

        it('should use data source filters when insight.filters is undefined', () => {
            const insightFilters: ContextItemsFiltersWithOperator = {
                graphFilterType: GraphFilterType.RootsOnly,
                filters: undefined as unknown as ContextItemsFilter[],
                operator: ContextItemsFilterOperator.And,
            };
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result.filters, dataSourceFilters.filters);
            assert.equal(result.graphFilterType, GraphFilterType.RootsOnly);
        });
    });

    describe('when insight uses And operator', () => {
        it('should append data source filters to insight filters', () => {
            const insightFilters = createFilters(
                [{ title: { eq: 'insight-title' } }, { comment: { eq: 'insight-comment' } }],
                ContextItemsFilterOperator.And,
            );
            const dataSourceFilters = createFilters(
                [{ actors: { in: ['user1'] } }, { type: { in: ['task' as never] } }],
                ContextItemsFilterOperator.And,
            );

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters.length, 4);
            assert.deepEqual(result.filters[0], { title: { eq: 'insight-title' } });
            assert.deepEqual(result.filters[1], { comment: { eq: 'insight-comment' } });
            assert.deepEqual(result.filters[2], { actors: { in: ['user1'] } });
            assert.deepEqual(result.filters[3], { type: { in: ['task'] } });
            assert.equal(result.operator, ContextItemsFilterOperator.And);
        });

        it('should preserve graphFilterType from insight filters', () => {
            const insightFilters: ContextItemsFiltersWithOperator = {
                graphFilterType: GraphFilterType.ChildrenOfRootsOnly,
                filters: [{ title: { eq: 'test' } }],
                operator: ContextItemsFilterOperator.And,
            };
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.graphFilterType, GraphFilterType.ChildrenOfRootsOnly);
        });
    });

    describe('when insight uses Or operator', () => {
        it('should distribute data source filters across insight filters (cartesian product)', () => {
            // Insight: A OR B, DataSource: C
            // Result: (A+C) OR (B+C)
            const insightFilters = createFilters(
                [{ title: { eq: 'A' } }, { title: { eq: 'B' } }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters.length, 2);
            assert.deepEqual(result.filters[0].title, { eq: 'A' });
            assert.deepEqual(result.filters[0].actors, { in: ['user1'] });
            assert.deepEqual(result.filters[1].title, { eq: 'B' });
            assert.deepEqual(result.filters[1].actors, { in: ['user1'] });
            assert.equal(result.operator, ContextItemsFilterOperator.Or);
        });

        it('should create cartesian product when multiple data source filters exist', () => {
            // Insight: [A, B] with Or, DataSource: [C, D]
            // Result: [(A+C), (A+D), (B+C), (B+D)] with Or
            const insightFilters = createFilters(
                [{ title: { eq: 'A' } }, { title: { eq: 'B' } }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }, { actors: { in: ['user2'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters.length, 4);
            assert.deepEqual(result.filters[0].title, { eq: 'A' });
            assert.deepEqual(result.filters[0].actors, { in: ['user1'] });
            assert.deepEqual(result.filters[1].title, { eq: 'A' });
            assert.deepEqual(result.filters[1].actors, { in: ['user2'] });
            assert.deepEqual(result.filters[2].title, { eq: 'B' });
            assert.deepEqual(result.filters[2].actors, { in: ['user1'] });
            assert.deepEqual(result.filters[3].title, { eq: 'B' });
            assert.deepEqual(result.filters[3].actors, { in: ['user2'] });
        });

        it('should preserve graphFilterType from insight filters', () => {
            const insightFilters: ContextItemsFiltersWithOperator = {
                graphFilterType: GraphFilterType.RootsOnly,
                filters: [{ title: { eq: 'A' } }],
                operator: ContextItemsFilterOperator.Or,
            };
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.graphFilterType, GraphFilterType.RootsOnly);
        });
    });

    describe('filter object merging', () => {
        it('should merge different fields from both filters', () => {
            const insightFilters = createFilters([{ title: { eq: 'test' } }], ContextItemsFilterOperator.Or);
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] }, comment: { eq: 'comment' } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result.filters[0].title, { eq: 'test' });
            assert.deepEqual(result.filters[0].actors, { in: ['user1'] });
            assert.deepEqual(result.filters[0].comment, { eq: 'comment' });
        });

        it('should prefer insight filter value when both have the same scalar field', () => {
            const insightFilters = createFilters([{ title: { eq: 'insight-title' } }], ContextItemsFilterOperator.Or);
            const dataSourceFilters = createFilters([{ title: { eq: 'ds-title' } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters[0].title?.eq, 'insight-title');
        });

        it('should intersect "in" arrays when both filters have the same field with "in"', () => {
            const insightFilters = createFilters(
                [{ actors: { in: ['user1', 'user2', 'user3'] } }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([{ actors: { in: ['user2', 'user3', 'user4'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result.filters[0].actors?.in, ['user2', 'user3']);
        });

        it('should return empty intersection when "in" arrays have no common elements', () => {
            const insightFilters = createFilters(
                [{ actors: { in: ['user1', 'user2'] } }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([{ actors: { in: ['user3', 'user4'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.deepEqual(result.filters[0].actors?.in, []);
        });

        it('should concatenate array fields like propertiesNameValue', () => {
            const insightFilters = createFilters(
                [{ propertiesNameValue: [{ eq: { name: 'Status', value: 'Done' } }] }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([
                { propertiesNameValue: [{ eq: { name: 'Priority', value: 'High' } }] },
            ]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters[0].propertiesNameValue?.length, 2);
            assert.deepEqual(result.filters[0].propertiesNameValue?.[0], {
                eq: { name: 'Status', value: 'Done' },
            });
            assert.deepEqual(result.filters[0].propertiesNameValue?.[1], {
                eq: { name: 'Priority', value: 'High' },
            });
        });

        it('should use data source value when insight filter field is undefined', () => {
            const insightFilters = createFilters([{ title: { eq: 'test' } }], ContextItemsFilterOperator.Or);
            const dataSourceFilters = createFilters([{ comment: { eq: 'ds-comment' } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters[0].comment?.eq, 'ds-comment');
        });

        it('should use insight value when data source filter field is undefined', () => {
            const insightFilters = createFilters(
                [{ title: { eq: 'insight-title' }, comment: { eq: 'insight-comment' } }],
                ContextItemsFilterOperator.Or,
            );
            const dataSourceFilters = createFilters([{ actors: { in: ['user1'] } }]);

            const result = mergeFilters(insightFilters, dataSourceFilters);

            assert.equal(result.filters[0].title?.eq, 'insight-title');
            assert.equal(result.filters[0].comment?.eq, 'insight-comment');
        });
    });
});
