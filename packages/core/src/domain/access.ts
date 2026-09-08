import type { ConnectorId } from './connector.js';
import type { WorkItem } from './work-item.js';

/**
 * Access control mode for items.
 * - 'connectionAudience': Visible to all users with access to the connection (connection audience)
 * - 'allowList': Visible only to specific users (allow list)
 */
export type AccessMode = 'connectionAudience' | 'allowList';

export enum AccessModes {
    ConnectionAudience = 'connectionAudience',
    AllowList = 'allowList',
}

/**
 * Validation error for AccessPolicy
 */
export class AccessPolicyValidationError extends Error {
    constructor(message: string) {
        super(`AccessPolicy validation failed: ${message}`);
        this.name = 'AccessPolicyValidationError';
    }
}

export interface IAccessPolicy {
    mode: AccessMode;
    allowUserIds?: string[];
}

/**
 * Access control policy for items (Item ACL only).
 *
 * Represents item-level access permissions
 */
export class AccessPolicy implements IAccessPolicy {
    public readonly mode: AccessMode;
    public readonly allowUserIds?: string[];

    /**
     * Private constructor to enforce use of factory methods.
     * Validates the policy during construction.
     */
    private constructor(mode: AccessMode, allowUserIds?: string[]) {
        this.mode = mode;
        this.allowUserIds = allowUserIds ? [...allowUserIds] : undefined;
        this.validate();
    }

    /**
     * Factory method for connection audience policy (accessible to all users with connection access).
     * @returns AccessPolicy instance with mode 'connectionAudience'
     */
    static makeAccessibleToConnectionAudience(): AccessPolicy {
        return new AccessPolicy(AccessModes.ConnectionAudience);
    }

    /**
     * Factory method for allow list policy (accessible only to specified users in allowUserIds).
     * @param userIds Array of user IDs. May be explicitly empty to enforce the "deny by default" principle,
     * indicating that no users currently have access (e.g., when none are onboarded yet).
     * @throws {AccessPolicyValidationError} if userIds is null or undefined (but empty array is allowed)
     * @returns AccessPolicy instance with mode 'allowList'
     */
    static makeAccessibleToAllowedUsers(userIds: string[]): AccessPolicy {
        // Allow empty array for "deny by default" when user IDs cannot be resolved yet (i.e., no users have access yet)
        if (userIds === undefined || userIds === null) {
            throw new AccessPolicyValidationError(
                `'${AccessModes.AllowList}' access policy requires an array of user IDs (explicitly empty array is allowed when users not resolved yet).`,
            );
        }

        return new AccessPolicy(AccessModes.AllowList, userIds);
    }

    /**
     * Checks if a given userId is allowed by this access policy (Phase 2: Item ACL only).
     * @param userId The user ID to check
     * @returns true if this access policy allows the user (Phase 2 passed)
     * @see canAccessItem() below for the complete two-phase authorization check.
     */
    canAccess(userId: string): boolean {
        if (this.mode === AccessModes.ConnectionAudience) {
            return true;
        }

        return this.allowUserIds ? this.allowUserIds.includes(userId) : false;
    }

    /**
     * Checks whether the allowUserIds property is defined (i.e., not null or undefined).
     * Empty arrays are considered defined and represent the "deny by default" principle,
     * indicating that no users currently have access (e.g., none are onboarded yet).
     * @private
     * @returns true if allowUserIds is defined, false otherwise
     */
    private hasAllowUserIds(): boolean {
        return this.allowUserIds !== undefined && this.allowUserIds !== null;
    }

    /**
     * Validates this access policy.
     * @private
     * @throws {AccessPolicyValidationError} if invalid
     */
    private validate(): void {
        if (!this.mode) {
            throw new AccessPolicyValidationError('mode is required');
        }

        if (!Object.values<string>(AccessModes).includes(this.mode)) {
            throw new AccessPolicyValidationError(
                `Invalid access mode: ${this.mode}. Must be one of ${Object.values<string>(AccessModes).join(', ')}`,
            );
        }

        if (this.mode === AccessModes.AllowList) {
            // Allow empty array for "deny by default" until user IDs are resolved
            if (!this.hasAllowUserIds()) {
                throw new AccessPolicyValidationError(
                    `'${AccessModes.AllowList}' mode requires an allowUserIds array (empty array allowed for deny-by-default).`,
                );
            }
        } else {
            if (this.allowUserIds !== undefined) {
                throw new AccessPolicyValidationError(
                    `'allowUserIds' should only be present when access mode is '${AccessModes.AllowList}', but access mode is '${this.mode}'.`,
                );
            }
        }
    }

    /**
     * Deserializes a plain JS object into an AccessPolicy instance.
     * Useful for deserialization from database back to class instances or application-level checks (ACL checks).
     *
     * @example
     * ```typescript
     * // Usage in application code (ACL checks)
     * const item = await getItemFromUuid(userId, itemUuid, permissions);
     * if (item?.accessPolicy) {
     *     const itemAccessPolicy = AccessPolicy.from(item.accessPolicy);
     *     if (!itemAccessPolicy.canAccess(userId)) {
     *         throw new Error('Access denied');
     *     }
     * }
     * ```
     *
     * @param plainObject Plain object from database (IAccessPolicy)
     * @returns AccessPolicy instance with methods
     */
    static from(plainObject: IAccessPolicy): AccessPolicy {
        // Tolerate legacy/dirty persisted shapes at the deserialization boundary: a
        // non-allowList policy may carry a stray `allowUserIds` array — e.g. Mongoose
        // subdocument casting injecting the schema's default `[]` during a bulk `$set`
        // migration (see `updateItemsAccessPolicy` / `migrateAccessPolicyForBackwardCompatibility`).
        // Such a list is a no-op for connectionAudience, so drop it here instead of letting
        // `validate()` throw and making read paths (e.g. `canUserAccessItem`) fail closed.
        // Programmatic construction via the factory methods stays strict.
        if (plainObject.mode !== AccessModes.AllowList && plainObject.allowUserIds !== undefined) {
            return new AccessPolicy(plainObject.mode);
        }
        return new AccessPolicy(plainObject.mode, plainObject.allowUserIds);
    }

    /**
     * Checks if this access policy has the same allowUserIds as another policy.
     * Useful when you only care about the user list, not the mode.
     *
     * @param other - Another access policy to compare against
     * @returns true if the allowUserIds are the same (order-independent)
     */
    hasMatchingAllowUserIds(other: AccessPolicy | IAccessPolicy): boolean {
        const thisIds = new Set(this.allowUserIds || []);
        const otherIds = new Set(other.allowUserIds || []);

        if (thisIds.size !== otherIds.size) {
            return false;
        }

        // Check if all IDs in this policy exist in the other
        return Array.from(thisIds).every((id) => otherIds.has(id));
    }

    /**
     * Checks if this access policy is equivalent to another policy.
     * Two policies are equivalent if they have the same mode and the same allowUserIds (order-independent).
     *
     * @param other - Another access policy to compare against
     * @returns true if the policies are equivalent
     */
    equals(other: AccessPolicy | IAccessPolicy): boolean {
        if (this.mode !== other.mode) {
            return false;
        }

        if (this.mode === AccessModes.AllowList) {
            return this.hasMatchingAllowUserIds(other);
        }

        return true;
    }

    /**
     * Serializes an AccessPolicy object to a plain object (JSON).
     *
     * @example
     * ```typescript
     * const policy = AccessPolicy.makeAccessibleToConnectionAudience();
     * // policy.canAccess() works
     *
     * // Convert to plain object before saving
     * const plainObject = policy.toJSON(); // plainObject = { mode: 'connectionAudience' }
     * ```
     * @returns Plain object (JSON) representation (IAccessPolicy)
     */
    toJSON(): IAccessPolicy {
        return {
            mode: this.mode,
            // Always include allowUserIds if it's an array (even if empty) to distinguish
            // "deny by default" (empty array) from "not set" (undefined/null)
            ...(this.hasAllowUserIds() && {
                allowUserIds: this.allowUserIds as string[],
            }),
        };
    }
}

/**
 * Describes one source of items a reader is allowed to see.
 *
 * - `perConnection` — items whose (creatorUserId, connector, connectorUserId) triple
 *   matches a connection the requester may read. Identifies the source connection
 *   precisely, so two connections owned by the same creator do not leak into each other.
 * - `perCreator`    — items whose `userId` equals `creatorUserId`, regardless of connector.
 *   Used for the self-only case (no shared connections).
 */
export type AccessRule =
    | { kind: 'perCreator'; creatorUserId: string }
    | { kind: 'perConnection'; creatorUserId: string; connector: ConnectorId; connectorUserId: string };

function itemMatchesRule(item: Pick<WorkItem, 'userId' | 'connector' | 'idsFromConnector'>, rule: AccessRule): boolean {
    if (rule.kind === 'perCreator') {
        return item.userId === rule.creatorUserId;
    }
    return (
        item.userId === rule.creatorUserId &&
        item.connector === rule.connector &&
        item.idsFromConnector.connectorUserId === rule.connectorUserId
    );
}

/**
 * Checks if a reader can access an item using two-phase authorization (in-memory
 * reference semantics; storage adapters must implement the equivalent as queries).
 *
 * Two-phase authorization requires both conditions to pass:
 * 1. Connection audience (Phase 1): the item must come from a source the reader is
 *    allowed to read (one of `allowedRules`).
 * 2. Item ACL (Phase 2): the item's accessPolicy must allow the reader (if present).
 *    If no accessPolicy exists, the item is treated as connectionAudience.
 */
export function canAccessItem(
    reader: { requesterUserId: string; allowedRules: AccessRule[] },
    item: Pick<WorkItem, 'userId' | 'connector' | 'idsFromConnector' | 'accessPolicy'>,
): boolean {
    // Phase 1: Connection audience check
    if (!reader.allowedRules.some((r) => itemMatchesRule(item, r))) {
        return false;
    }

    // Phase 2: Item ACL check
    // Legacy: items without accessPolicy are treated as connectionAudience (backward compatibility)
    if (!item.accessPolicy) {
        return true;
    }

    // Fail closed: a malformed accessPolicy (e.g. mode 'allowList' without an allowUserIds array)
    // makes AccessPolicy.from throw. Deny access instead of propagating, so a single bad document
    // cannot break callers that check many items.
    try {
        const policy = AccessPolicy.from(item.accessPolicy);
        return policy.canAccess(reader.requesterUserId);
    } catch {
        return false;
    }
}
