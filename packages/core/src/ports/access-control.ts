import { AccessRule } from '../domain/access.js';

/** Who is asking for data. */
export interface Principal {
    userId: string;
    organizationId?: string;
}

/**
 * Describes which items a principal may read. Storage adapters translate this
 * into queries; `domain/access.canAccessItem` is the in-memory reference for
 * the `rules` variant.
 */
export type AccessFilter = { kind: 'all' } | { kind: 'rules'; requesterUserId: string; rules: AccessRule[] };

/**
 * Access-control port. The default ({@link permissiveAccessControl}) allows
 * everything — appropriate for single-tenant deployments where the process
 * owns all the data. Multi-tenant hosts supply their own resolution
 * (e.g. per-connection sharing rules).
 */
export interface AccessControl {
    getAccessFilter(principal: Principal): Promise<AccessFilter>;
}

export const permissiveAccessControl: AccessControl = {
    getAccessFilter: async () => ({ kind: 'all' }),
};
