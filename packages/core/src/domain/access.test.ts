import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessModes, AccessPolicy, AccessRule, canAccessItem, IAccessPolicy } from './access.js';
import { WorkItem } from './work-item.js';

function createPerConnectionRuleFixture(
    overrides: Partial<Extract<AccessRule, { kind: 'perConnection' }>> = {},
): AccessRule {
    return {
        kind: 'perConnection',
        creatorUserId: 'Alice',
        connector: 'linked#atlassian#jira',
        connectorUserId: 'jira-business',
        ...overrides,
    };
}

function createPerCreatorRuleFixture(creatorUserId = 'Bob'): AccessRule {
    return { kind: 'perCreator', creatorUserId };
}

function createMinimalItemFixture(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        uuid: 'item-uuid',
        userId: 'Alice',
        connector: 'linked#atlassian#jira',
        idsFromConnector: {
            connectorObjectType: 'task',
            idFromConnector: 'con-1',
            connectorUserId: 'jira-business',
        },
        title: 'Test',
        createdBy: [],
        createdDate: new Date('2025-01-01T00:00:00Z'),
        properties: [],
        parents: [],
        types: [],
        ...overrides,
    };
}

describe('WorkItem access control (canAccessItem)', () => {
    describe('shared connection access (requester is not the owner)', () => {
        describe('when the owner has two connections on the same connector but the requester only has access to one', () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [
                createPerConnectionRuleFixture({ creatorUserId: 'Alice', connectorUserId: 'jira-business' }),
            ];

            it('should allow items from the connection the requester may access', () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'linked#atlassian#jira',
                    idsFromConnector: {
                        connectorObjectType: 'task',
                        idFromConnector: 'con-1',
                        connectorUserId: 'jira-business',
                    },
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, true);
            });

            it("should deny items from the owner's other connection on the same connector", () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'linked#atlassian#jira',
                    idsFromConnector: {
                        connectorObjectType: 'task',
                        idFromConnector: 'con-2',
                        connectorUserId: 'jira-personal',
                    },
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });

        describe('when the owner has Jira and GitHub connections but the requester only has access to Jira', () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [
                createPerConnectionRuleFixture({
                    creatorUserId: 'Alice',
                    connector: 'linked#atlassian#jira',
                    connectorUserId: 'jira-business',
                }),
            ];

            it("should deny items from the owner's GitHub connection", () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'github',
                    idsFromConnector: {
                        connectorObjectType: 'pr',
                        idFromConnector: 'gh-1',
                        connectorUserId: 'jira-business',
                    },
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });

        describe('when the requester has no allowed connections', () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [];

            it('should deny every item via canAccessItem', () => {
                const item = createMinimalItemFixture();

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });

        describe('when the item uses a linked connector name but rules only include the parent AppConnection connector', () => {
            const requesterUserId = 'Bob';
            const googleAccountId = 'google-account@example.com';
            const allowedRules: AccessRule[] = [
                createPerConnectionRuleFixture({
                    creatorUserId: 'Alice',
                    connector: 'google',
                    connectorUserId: googleAccountId,
                }),
            ];

            it('should deny the item via canAccessItem', () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'linked#google#drive',
                    idsFromConnector: {
                        connectorObjectType: 'file',
                        idFromConnector: 'file-1',
                        connectorUserId: googleAccountId,
                    },
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });
    });

    describe('own items only (requester is the owner, perCreator rules)', () => {
        describe("when access rules only admit the requester's own items, on any integration", () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [createPerCreatorRuleFixture(requesterUserId)];

            it('should allow any item the requester created', () => {
                const githubItem = createMinimalItemFixture({
                    userId: requesterUserId,
                    connector: 'github',
                    idsFromConnector: {
                        connectorObjectType: 'pr',
                        idFromConnector: 'gh-1',
                        connectorUserId: 'gh-whatever',
                    },
                });
                const jiraItem = createMinimalItemFixture({
                    userId: requesterUserId,
                    connector: 'linked#atlassian#jira',
                    idsFromConnector: {
                        connectorObjectType: 'task',
                        idFromConnector: 'jira-1',
                        connectorUserId: 'jira-whatever',
                    },
                });

                assert.equal(canAccessItem({ requesterUserId, allowedRules }, githubItem), true);
                assert.equal(canAccessItem({ requesterUserId, allowedRules }, jiraItem), true);
            });

            it('should deny items created by other users', () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'linked#atlassian#jira',
                    idsFromConnector: {
                        connectorObjectType: 'task',
                        idFromConnector: 'con-1',
                        connectorUserId: 'jira-business',
                    },
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });
    });

    describe('item-level restrictions', () => {
        describe("when the owner shared a connection with the requester but the item's allow list excludes the requester", () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [
                createPerConnectionRuleFixture({ creatorUserId: 'Alice', connectorUserId: 'jira-business' }),
            ];
            const allowListExcludingRequester: IAccessPolicy = {
                mode: AccessModes.AllowList,
                allowUserIds: ['Carol'],
            };

            it('should deny the item via canAccessItem', () => {
                const item = createMinimalItemFixture({
                    userId: 'Alice',
                    connector: 'linked#atlassian#jira',
                    idsFromConnector: {
                        connectorObjectType: 'task',
                        idFromConnector: 'con-1',
                        connectorUserId: 'jira-business',
                    },
                    accessPolicy: allowListExcludingRequester,
                });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });

        describe('when the item accessPolicy is an allowList without resolved users', () => {
            const requesterUserId = 'Bob';
            const allowedRules: AccessRule[] = [
                createPerConnectionRuleFixture({ creatorUserId: 'Alice', connectorUserId: 'jira-business' }),
            ];

            it('should fail closed (deny, not throw) when allowUserIds is missing', () => {
                const malformedPolicy: IAccessPolicy = { mode: AccessModes.AllowList };
                const item = createMinimalItemFixture({ accessPolicy: malformedPolicy });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });

            it('should fail closed (deny, not throw) when allowUserIds is null', () => {
                const malformedPolicy = { mode: AccessModes.AllowList, allowUserIds: null } as unknown as IAccessPolicy;
                const item = createMinimalItemFixture({ accessPolicy: malformedPolicy });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });

            it('should deny by default when allowUserIds is an explicitly empty array', () => {
                const denyByDefaultPolicy: IAccessPolicy = { mode: AccessModes.AllowList, allowUserIds: [] };
                const item = createMinimalItemFixture({ accessPolicy: denyByDefaultPolicy });

                const result = canAccessItem({ requesterUserId, allowedRules }, item);

                assert.equal(result, false);
            });
        });
    });
});

describe('connectionAudience policies carrying a stray allowUserIds (migration / Mongoose-default artifact)', () => {
    // Regression for the staging incident: migrateAccessPolicyForBackwardCompatibility issued a
    // bulk `$set: { accessPolicy: { mode: 'connectionAudience' } }`, which Mongoose cast into a
    // subdocument whose array path defaulted to `allowUserIds: []`. That shape is invalid for
    // connectionAudience, so AccessPolicy.from threw and canAccessItem failed closed for every
    // retrieved item (the RAG chatbot reported "none of them are accessible").
    const requesterUserId = 'Bob';
    const allowedRules: AccessRule[] = [
        createPerConnectionRuleFixture({ creatorUserId: 'Alice', connectorUserId: 'jira-business' }),
    ];

    function connectionAudienceItem(accessPolicy: IAccessPolicy): WorkItem {
        return createMinimalItemFixture({
            userId: 'Alice',
            connector: 'linked#atlassian#jira',
            idsFromConnector: {
                connectorObjectType: 'task',
                idFromConnector: 'con-1',
                connectorUserId: 'jira-business',
            },
            accessPolicy,
        });
    }

    it('canAccessItem allows a connectionAudience item with an empty allowUserIds array', () => {
        const item = connectionAudienceItem({ mode: AccessModes.ConnectionAudience, allowUserIds: [] });

        assert.equal(canAccessItem({ requesterUserId, allowedRules }, item), true);
    });

    it('AccessPolicy.from tolerates (and drops) a stray allowUserIds on connectionAudience', () => {
        const fromEmpty = AccessPolicy.from({ mode: AccessModes.ConnectionAudience, allowUserIds: [] });
        assert.equal(fromEmpty.canAccess('anyone'), true);
        assert.equal(fromEmpty.allowUserIds, undefined);

        const fromNonEmpty = AccessPolicy.from({ mode: AccessModes.ConnectionAudience, allowUserIds: ['Carol'] });
        assert.equal(fromNonEmpty.canAccess('anyone'), true);
        assert.equal(fromNonEmpty.allowUserIds, undefined);
    });

    it('equals() treats a stray-allowUserIds connectionAudience policy as equal to a clean one', () => {
        // The tolerance in from() also normalizes equals(): the identity-mapping rewrite
        // (updateItemsAccessPoliciesFromIdentityMapping) deserializes the existing policy and
        // compares it against a target, so a dirty connectionAudience item must deserialize
        // without throwing and simply differ from an allowList target by mode.
        const dirty = AccessPolicy.from({ mode: AccessModes.ConnectionAudience, allowUserIds: [] });
        assert.equal(dirty.equals(AccessPolicy.makeAccessibleToConnectionAudience()), true);
        assert.equal(dirty.equals(AccessPolicy.makeAccessibleToAllowedUsers(['Carol'])), false);
    });

    it('still fails closed for a genuinely invalid mode (does not over-tolerate)', () => {
        const item = connectionAudienceItem({ mode: 'bogus', allowUserIds: [] } as unknown as IAccessPolicy);

        assert.equal(canAccessItem({ requesterUserId, allowedRules }, item), false);
    });
});
