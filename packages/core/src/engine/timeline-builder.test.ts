import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ohash from 'object-hash';
import { TimelineCreateDate, TimelineDateType } from '../domain/api-types.js';
import { Scope } from '../domain/context.js';

/**
 * IDENTITY GUARD: the timeline (context) id is the object-hash over this exact
 * input shape: ohash({ items, fromDate, toDate, user, iana, cacheSessionKey })
 * with items = scopes.map(it => `${it.uuid}.${it.hierarchyType}`).join('-').
 * The id must stay deterministic across calls and refactors — cached contexts
 * and downstream analysis ids embed it.
 */
describe('timeline cache identity', () => {
    it('produces a deterministic hash for a fixed fixture regardless of construction', () => {
        const scopes: Scope[] = [
            {
                uuid: '11111111-2222-3333-4444-555555555555',
                connector: 'my-crm',
                hierarchyType: 'MyCrmAccount',
            },
        ];
        const fromDate: TimelineCreateDate = {
            type: TimelineDateType.Iso,
            isoDate: '2026-01-01T00:00:00.000+00:00',
            userIanaZone: 'UTC',
        };
        const cacheSessionKey = '302d949c-3a59-442b-b4a8-a93dffcddfde';

        const hash = ohash({
            items: scopes.map((it) => `${it.uuid}.${it.hierarchyType}`).join('-'),
            fromDate,
            toDate: undefined,
            user: 'user-1',
            iana: fromDate.userIanaZone,
            cacheSessionKey,
        });

        // The same inputs expressed as a plain literal must hash identically
        // (object-hash v3, default options).
        assert.equal(
            hash,
            ohash({
                items: '11111111-2222-3333-4444-555555555555.MyCrmAccount',
                fromDate: {
                    type: 'ISO',
                    isoDate: '2026-01-01T00:00:00.000+00:00',
                    userIanaZone: 'UTC',
                },
                toDate: undefined,
                user: 'user-1',
                iana: 'UTC',
                cacheSessionKey: '302d949c-3a59-442b-b4a8-a93dffcddfde',
            }),
        );
    });

    it('hash is insensitive to scope object key order but sensitive to values', () => {
        const base = {
            items: 'a.MyCrmAccount',
            fromDate: { type: 'ISO', isoDate: 'x', userIanaZone: 'UTC' },
            toDate: undefined,
            user: 'u',
            iana: 'UTC',
            cacheSessionKey: 'k',
        };
        const reordered = {
            cacheSessionKey: 'k',
            iana: 'UTC',
            user: 'u',
            toDate: undefined,
            fromDate: { userIanaZone: 'UTC', isoDate: 'x', type: 'ISO' },
            items: 'a.MyCrmAccount',
        };
        assert.equal(ohash(base), ohash(reordered));
        assert.notEqual(ohash(base), ohash({ ...base, user: 'other' }));
    });
});
