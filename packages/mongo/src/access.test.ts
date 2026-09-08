import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessFilter, AccessModes, AccessRule, IAccessPolicy } from '@chronicle/core';
import mongoose from 'mongoose';
import {
    changeEventAccessQuery,
    metricSnapshotAccessQuery,
    plainTextAccessQuery,
    plainTextDiffAccessQuery,
    workItemAccessQuery,
} from './access.js';
import { AccessPolicySchema } from './schemas.js';

const requesterUserId = 'Bob';

function rulesFilter(rules: AccessRule[]): AccessFilter {
    return { kind: 'rules', requesterUserId, rules };
}

const perConnectionRule: AccessRule = {
    kind: 'perConnection',
    creatorUserId: 'Alice',
    connector: 'my-crm',
    connectorUserId: 'acct-1',
};

const perCreatorRule: AccessRule = { kind: 'perCreator', creatorUserId: requesterUserId };

describe('workItemAccessQuery', () => {
    const expectedItemAclClause = {
        $or: [
            { 'accessPolicy.mode': AccessModes.ConnectionAudience },
            { 'accessPolicy.mode': AccessModes.AllowList, 'accessPolicy.allowUserIds': requesterUserId },
            { accessPolicy: { $exists: false } },
        ],
    };

    it('matches everything for the permissive filter', () => {
        assert.deepEqual(workItemAccessQuery({ kind: 'all' }), {});
    });

    it('emits a perConnection rule as a triple-keyed $or plus the item ACL clause', () => {
        const query = workItemAccessQuery(rulesFilter([perConnectionRule]));

        assert.deepEqual(query, {
            $and: [
                {
                    $or: [
                        {
                            userId: 'Alice',
                            connector: 'my-crm',
                            'idsFromConnector.connectorUserId': 'acct-1',
                        },
                    ],
                },
                expectedItemAclClause,
            ],
        });
    });

    it('emits a perCreator rule as userId-only $or', () => {
        const query = workItemAccessQuery(rulesFilter([perCreatorRule]));

        assert.deepEqual(query, {
            $and: [{ $or: [{ userId: requesterUserId }] }, expectedItemAclClause],
        });
    });

    it('emits a no-match clause when allowed rules are empty (fail closed)', () => {
        const query = workItemAccessQuery(rulesFilter([]));

        assert.deepEqual(query, {
            $and: [{ _id: { $exists: false } }, expectedItemAclClause],
        });
    });
});

describe('audience queries for the other collections', () => {
    it('changeEventAccessQuery keys off meta fields', () => {
        assert.deepEqual(changeEventAccessQuery(rulesFilter([perConnectionRule])), {
            $or: [
                {
                    'meta.userId': 'Alice',
                    'meta.connector': 'my-crm',
                    'meta.idsFromConnector.connectorUserId': 'acct-1',
                },
            ],
        });
        assert.deepEqual(changeEventAccessQuery({ kind: 'all' }), {});
    });

    it('metricSnapshotAccessQuery keys off meta.connectorUserId directly', () => {
        assert.deepEqual(metricSnapshotAccessQuery(rulesFilter([perConnectionRule])), {
            $or: [
                {
                    'meta.userId': 'Alice',
                    'meta.connector': 'my-crm',
                    'meta.connectorUserId': 'acct-1',
                },
            ],
        });
    });

    it('plainTextAccessQuery keys off top-level fields', () => {
        assert.deepEqual(plainTextAccessQuery(rulesFilter([perCreatorRule])), {
            $or: [{ userId: requesterUserId }],
        });
    });

    it('plainTextDiffAccessQuery fails closed on empty rules', () => {
        assert.deepEqual(plainTextDiffAccessQuery(rulesFilter([])), { _id: { $exists: false } });
    });
});

describe('AccessPolicySchema mongoose casting', () => {
    it('does not auto-inject allowUserIds: [] when casting a connectionAudience subdocument', () => {
        // `default: undefined` keeps the persisted shape `{ mode, _id }` rather than
        // `{ mode, allowUserIds: [], _id }` — the latter makes AccessPolicy.from throw
        // and read paths fail closed.
        const probeName = 'AccessPolicyDefaultProbe';
        const ProbeModel =
            mongoose.models[probeName] ||
            mongoose.model(probeName, new mongoose.Schema({ accessPolicy: new mongoose.Schema(AccessPolicySchema) }));
        const doc = new ProbeModel({ accessPolicy: { mode: AccessModes.ConnectionAudience } });
        const persisted = doc.toObject().accessPolicy as IAccessPolicy;

        assert.equal(persisted.mode, AccessModes.ConnectionAudience);
        assert.equal(persisted.allowUserIds, undefined);
    });
});
