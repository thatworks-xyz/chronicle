import { AccessFilter, AccessModes, AccessRule } from '@chronicle/core';
import mongoose from 'mongoose';

/** Matches nothing — used when an access filter yields no readable sources. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MATCH_NOTHING: mongoose.FilterQuery<any> = { _id: { $exists: false } };

/**
 * Builds the connection-audience clause (Phase 1) for a collection whose docs
 * carry (userId, connector, connectorUserId) at the given field paths.
 */
function buildAudienceQuery(
    rules: AccessRule[],
    paths: { userId: string; connector: string; connectorUserId: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): mongoose.FilterQuery<any> {
    if (rules.length === 0) {
        return MATCH_NOTHING;
    }
    return {
        $or: rules.map((r) =>
            r.kind === 'perCreator'
                ? { [paths.userId]: r.creatorUserId }
                : {
                      [paths.userId]: r.creatorUserId,
                      [paths.connector]: r.connector,
                      [paths.connectorUserId]: r.connectorUserId,
                  },
        ),
    };
}

/**
 * Access query for the work items collection: two-phase
 * (connection audience AND item ACL). `{}` when access is 'all'.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workItemAccessQuery(access: AccessFilter): mongoose.FilterQuery<any> {
    if (access.kind === 'all') {
        return {};
    }
    const audience = buildAudienceQuery(access.rules, {
        userId: 'userId',
        connector: 'connector',
        connectorUserId: 'idsFromConnector.connectorUserId',
    });
    const acl = {
        $or: [
            // Connection audience items (visible to all connection users)
            { 'accessPolicy.mode': AccessModes.ConnectionAudience },
            // Allow list items (user must be in allowUserIds AND mode is allowList)
            { 'accessPolicy.mode': AccessModes.AllowList, 'accessPolicy.allowUserIds': access.requesterUserId },
            // Legacy items without accessPolicy (treated as connectionAudience)
            { accessPolicy: { $exists: false } },
        ],
    };
    return { $and: [audience, acl] };
}

/** Access query for the change events (changelog) collection. `{}` when access is 'all'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function changeEventAccessQuery(access: AccessFilter): mongoose.FilterQuery<any> {
    if (access.kind === 'all') {
        return {};
    }
    return buildAudienceQuery(access.rules, {
        userId: 'meta.userId',
        connector: 'meta.connector',
        connectorUserId: 'meta.idsFromConnector.connectorUserId',
    });
}

/** Access query for the metric snapshots collection. `{}` when access is 'all'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function metricSnapshotAccessQuery(access: AccessFilter): mongoose.FilterQuery<any> {
    if (access.kind === 'all') {
        return {};
    }
    return buildAudienceQuery(access.rules, {
        userId: 'meta.userId',
        connector: 'meta.connector',
        connectorUserId: 'meta.connectorUserId',
    });
}

/** Access query for the plain text collection. `{}` when access is 'all'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function plainTextAccessQuery(access: AccessFilter): mongoose.FilterQuery<any> {
    if (access.kind === 'all') {
        return {};
    }
    return buildAudienceQuery(access.rules, {
        userId: 'userId',
        connector: 'connector',
        connectorUserId: 'connectorUserId',
    });
}

/** Access query for the plain text diff collection. `{}` when access is 'all'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function plainTextDiffAccessQuery(access: AccessFilter): mongoose.FilterQuery<any> {
    if (access.kind === 'all') {
        return {};
    }
    return buildAudienceQuery(access.rules, {
        userId: 'meta.userId',
        connector: 'meta.connector',
        connectorUserId: 'meta.connectorUserId',
    });
}
