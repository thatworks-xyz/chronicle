import { DateTime } from 'luxon';
import ohash from 'object-hash';
import { TimelineCreateDate } from '../domain/api-types.js';
import { Scope } from '../domain/context.js';
import { ChronicleError, ChronicleErrorCode } from '../domain/errors.js';
import { getTimelineFromJson, Timeline, TimelineItem } from '../domain/timeline.js';
import { WorkItem } from '../domain/work-item.js';
import { Principal } from '../ports/access-control.js';
import { EngineRuntime } from '../ports/runtime.js';
import { getDocDiffsForPromptBatch } from './activity-search-helpers.js';
import { generateChangelogSummary, ItemWithChanges, mapItemToTimelineItem } from './changelog-summary.js';
import { getAndValidateTimelineDate } from './conversions.js';
import { AdditionalRelevantWorkItems, ScopesData } from './scope-resolution.js';
import { calcFeatureScore, scoreItems } from './scoring/scoring.js';

export enum CachedTimelineVersion {
    // Increment this if there are any breaking changes in the CachedTimeline object
    Version = 5,
}

/**
 * The cached, addressable timeline object. Its `hash` doubles as the timeline id
 * (and as the REST "context id"). The shape is preserved verbatim from the
 * original system (version 5) so that identity and caching semantics carry over.
 */
export interface CachedTimeline {
    scopes: Scope[];
    timeline: Timeline;
    userId: string;
    collectionUuid?: string;
    fromDate: TimelineCreateDate;
    toDate?: TimelineCreateDate;
    hash: string;
    version: CachedTimelineVersion.Version;
    creationDateIso: string | undefined;
}

/** Builds the cache key for a stored timeline (prefix from EngineConfig.cacheKeyPrefixes.timeline). */
export function getTimelineCacheKey(prefix: string, hash: string) {
    return `${prefix}:${hash}`;
}

/**
 * Removes container noise from the changed-items set, per connector traits:
 * - parents of changed items whose object type is declared as suppress-parent
 *   (e.g. a database container that only "changed" because a child did)
 * - changed items whose own object type is declared as suppressed (e.g. folders)
 */
function filterItemsIfNecessary(runtime: EngineRuntime, items: ItemWithChanges[]): ItemWithChanges[] {
    const toFilter = new Set<string>();
    items.forEach((v) => {
        const traits = runtime.connectorTraits.get(v.item.connector);
        if (traits.suppressParentWhenChildChangedObjectTypes.length > 0) {
            const parentContainer = v.item.parents.find((p) =>
                traits.suppressParentWhenChildChangedObjectTypes.includes(p.idsFromConnector.connectorObjectType),
            );
            if (parentContainer) {
                toFilter.add(parentContainer.itemUuid);
            }
        }
        if (traits.suppressChangedObjectTypes.includes(v.item.idsFromConnector.connectorObjectType)) {
            toFilter.add(v.item.uuid);
        }
    });
    return items.filter((v) => !toFilter.has(v.item.uuid));
}

export async function getTimelineForItems(
    runtime: EngineRuntime,
    principal: Principal,
    itemsWithChanges: ItemWithChanges[],
    additionalRelevantItems: AdditionalRelevantWorkItems[],
    scopesWithChildUuids: {
        scopeUuid: string;
        childItemUuids: string[];
    }[],
    fromDate: Date,
    toDate?: Date,
): Promise<Timeline> {
    // Some items might be recently updated but not have a changelog (e.g. new field of data added to the db)
    itemsWithChanges = itemsWithChanges.filter((v) => v.changes.length > 0);
    itemsWithChanges = filterItemsIfNecessary(runtime, itemsWithChanges);

    const itemsWithChangesMap = new Map<string, ItemWithChanges>();
    itemsWithChanges.forEach((v) => {
        if (!itemsWithChangesMap.has(v.item.uuid)) {
            itemsWithChangesMap.set(v.item.uuid, v);
        }
    });

    const additionalItemsMap = new Map<string, ItemWithChanges>();
    additionalRelevantItems.forEach((v) => {
        v.additionalRelevantItems.forEach((item) => {
            if (!additionalItemsMap.has(item.uuid) && !itemsWithChangesMap.has(item.uuid)) {
                additionalItemsMap.set(item.uuid, { changes: [], item });
            }
        });
    });

    const itemsWithChangesDedup = Array.from(itemsWithChangesMap.values());
    const additionalItemsDedup = Array.from(additionalItemsMap.values());

    const access = await runtime.accessControl.getAccessFilter(principal);
    const effectiveToDate = toDate ?? new Date();
    const weights = runtime.config.rankingWeights;
    const scores = scoreItems(itemsWithChangesDedup, fromDate, effectiveToDate, weights);
    const additonalItemsScores = scoreItems(additionalItemsDedup, fromDate, effectiveToDate, weights);
    const [summarizedChanges, docDiffsForItems] = await Promise.all([
        generateChangelogSummary(itemsWithChangesDedup, runtime.connectorTraits),
        getDocDiffsForPromptBatch(
            runtime,
            principal,
            itemsWithChanges.map((it) => it.item.uuid),
            fromDate,
            toDate,
        ),
    ]);

    additonalItemsScores.forEach((score, key) => {
        if (!scores.has(key)) {
            scores.set(key, score);
        }
    });

    const itemsForTimelineDedupIdMap = new Map<string, WorkItem>(
        itemsWithChangesDedup.map((v) => [v.item.uuid, v.item]),
    );
    additionalItemsDedup.forEach((v) => {
        if (!itemsForTimelineDedupIdMap.has(v.item.uuid)) {
            itemsForTimelineDedupIdMap.set(v.item.uuid, v.item);
        }
    });

    const timelineItems: TimelineItem[] = await Promise.all(
        Array.from(itemsForTimelineDedupIdMap.values()).map(async (item) => {
            const score = scores.get(item.uuid);
            if (score === undefined) {
                throw new Error(`score for ${item.uuid} is undefined`);
            }
            const timelineItem = await mapItemToTimelineItem(
                item,
                score.totalScore,
                {},
                runtime.connectorTraits,
                async (parentUuid) => {
                    let p = itemsForTimelineDedupIdMap.get(parentUuid);
                    if (!p) {
                        const fetched = await runtime.repos.items.getByUuids([parentUuid], access);
                        p = fetched[0];
                    }
                    if (!p) {
                        return [];
                    }
                    return p.parents;
                },
            );
            score.featureScores.forEach((v) => {
                timelineItem.featureScores[v.name] = calcFeatureScore(v.value, v.denom);
            });
            return timelineItem;
        }),
    );

    const allItemsFetched: Map<string, TimelineItem> = new Map();
    const parentUuidsToFetch: Set<string> = new Set();

    timelineItems.forEach((t) => {
        t.parents.forEach((p) => {
            parentUuidsToFetch.add(p.uuid);
        });
        allItemsFetched.set(t.itemUuid, t);
    });

    // most task management systems do not have a deep hierarchy for sub-tasks
    const numLevelsToFetch = runtime.config.limits.parentFetchDepth;
    for (let i = 0; i < numLevelsToFetch; i++) {
        if (parentUuidsToFetch.size === 0) {
            break;
        }

        // get the parent items
        const parentItems = await runtime.repos.items.getByUuids(Array.from(parentUuidsToFetch.values()), access);
        // make into TimelineItem
        const parentTimeline: TimelineItem[] = await Promise.all(
            parentItems.map((item) =>
                mapItemToTimelineItem(item, 0, {}, runtime.connectorTraits, async (parentUuid) => {
                    const p = itemsForTimelineDedupIdMap.get(parentUuid);
                    // OK to return empty parents here since the timeline does not show the whole tree
                    return p?.parents || [];
                }),
            ),
        );
        // Save in the map
        parentTimeline.forEach((t) => {
            allItemsFetched.set(t.itemUuid, t);
        });
        // Clear and fetch the next level
        parentUuidsToFetch.clear();
        parentTimeline.forEach((t) => {
            t.parents.forEach((p) => {
                if (!allItemsFetched.has(p.uuid)) {
                    parentUuidsToFetch.add(p.uuid);
                }
            });
        });
    }

    const docDiffs: Record<string, { diff: string }> = {};
    docDiffsForItems.forEach((diffs, itemUuid) => {
        if (diffs) {
            docDiffs[itemUuid] = { diff: diffs.diffsForPrompt };
        }
    });

    const res: Timeline = {
        changes: summarizedChanges,
        items: {},
        additionalRelevantItems: additionalRelevantItems.map((v) => ({
            type: v.type,
            uuids: v.additionalRelevantItems.map((i) => i.uuid),
        })),
        scopesWithChildUuids: {},
        docDiffs,
    };

    scopesWithChildUuids.forEach((v) => {
        res.scopesWithChildUuids[v.scopeUuid] = v.childItemUuids;
    });

    allItemsFetched.forEach((item) => {
        res.items[`${item.itemUuid}`] = item;
    });
    return res;
}

export async function getTimelineFromScopes(
    runtime: EngineRuntime,
    principal: Principal,
    scopes: Scope[],
    fromDate: Date,
    toDate?: Date,
): Promise<Timeline> {
    if (!scopes || scopes.length === 0) {
        return {
            changes: [],
            items: {},
            additionalRelevantItems: [],
            scopesWithChildUuids: {},
            docDiffs: {},
        };
    }

    const data = new ScopesData(runtime, principal, scopes);
    const children = await data.getChildren(fromDate, toDate, false);

    return getTimelineForItems(
        runtime,
        principal,
        children.items,
        children.additionalRelevantItems,
        children.scopesWithChildUuids,
        fromDate,
        toDate,
    );
}

/** Fetches a cached timeline by id, enforcing that it belongs to the requesting user. */
export async function getCachedTimeline(
    runtime: EngineRuntime,
    userId: string,
    timelineId: string,
): Promise<CachedTimeline> {
    const cacheKey = getTimelineCacheKey(runtime.config.cacheKeyPrefixes.timeline, timelineId);
    const cached = await runtime.cache.get(cacheKey);
    if (!cached) {
        throw new ChronicleError(`Timeline with cache id ${timelineId} not found`, ChronicleErrorCode.CacheInvalid);
    }

    const cachedObject = JSON.parse(cached) as CachedTimeline;
    cachedObject.timeline = getTimelineFromJson(cachedObject.timeline);

    if (cachedObject?.userId !== userId) {
        throw new ChronicleError(`Timeline ${timelineId} not found`, ChronicleErrorCode.NotFound);
    }

    return cachedObject;
}

/**
 * Builds (or returns from cache) the timeline for a set of scopes.
 *
 * The timeline id is a deterministic hash over (scopes, dates, user, session key) —
 * repeated calls with the same inputs return the same timeline while it is cached.
 * NOTE: the hash-input shape is preserved verbatim from the original system so
 * identity carries over — do not change it.
 */
export async function getCachedTimelineFromScopes(
    runtime: EngineRuntime,
    principal: Principal,
    scopes: Scope[],
    fromDateQuery: TimelineCreateDate,
    cacheSessionKey: string,
    ttlMin: number,
    returnNullOnNoChanges?: boolean,
    toDateQuery?: TimelineCreateDate,
): Promise<{ timelineId: string; creationDateIso: string; cached: CachedTimeline } | undefined> {
    const hash = ohash({
        items: scopes.map((it) => `${it.uuid}.${it.hierarchyType}`).join('-'),
        fromDate: fromDateQuery,
        toDate: toDateQuery,
        user: principal.userId,
        iana: fromDateQuery.userIanaZone,
        cacheSessionKey,
    });
    const cacheKey = getTimelineCacheKey(runtime.config.cacheKeyPrefixes.timeline, hash);
    const cached = await runtime.cache.get(cacheKey);
    if (cached) {
        const cachedObject = JSON.parse(cached) as CachedTimeline;
        if (cachedObject && cachedObject.version === CachedTimelineVersion.Version) {
            // Convert Date strings back to Date objects
            cachedObject.timeline = getTimelineFromJson(cachedObject.timeline);
            return {
                timelineId: cachedObject.hash,
                // default to now for older timelines that might not have this field set
                creationDateIso: cachedObject.creationDateIso || DateTime.now().toISO(),
                cached: cachedObject,
            };
        }
    }

    const fromDate = getAndValidateTimelineDate(fromDateQuery);
    const toDate = toDateQuery ? getAndValidateTimelineDate(toDateQuery) : undefined;
    const timeline = await getTimelineFromScopes(runtime, principal, scopes, fromDate, toDate);
    const cacheObject: CachedTimeline = {
        scopes,
        fromDate: fromDateQuery,
        toDate: toDateQuery,
        hash,
        timeline,
        userId: principal.userId,
        creationDateIso: DateTime.now().toISO(),
        version: CachedTimelineVersion.Version,
    };

    if (returnNullOnNoChanges && timeline.changes.length === 0 && Object.keys(timeline.docDiffs).length === 0) {
        return undefined;
    }

    await runtime.cache.set(cacheKey, JSON.stringify(cacheObject), ttlMin * 60 * 1000);
    return {
        timelineId: hash,
        // default to now for older timelines that might not have this field set
        creationDateIso: cacheObject.creationDateIso || DateTime.now().toISO(),
        cached: cacheObject,
    };
}

/**
 * Builds/returns the timeline for scopes, first giving the host a chance to
 * refresh data via the onTimelineRequested hook (fire-and-forget).
 */
export async function getTimelineFromScopesAndRefreshIfRequired(
    runtime: EngineRuntime,
    principal: Principal,
    scopes: Scope[],
    fromDate: TimelineCreateDate,
    cacheSessionKey: string,
    ttlMinutes: number,
    toDate: TimelineCreateDate | undefined,
): Promise<{ timelineId: string; creationDateIso: string; cached: CachedTimeline }> {
    // Fire-and-forget: give the host a chance to trigger a data refresh.
    // The timeline is built from currently stored data either way.
    if (runtime.hooks.onTimelineRequested) {
        runtime.hooks.onTimelineRequested(principal, scopes).catch((e) => {
            runtime.log.error(`onTimelineRequested hook failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    }

    const timeline = await getCachedTimelineFromScopes(
        runtime,
        principal,
        scopes,
        fromDate,
        cacheSessionKey,
        ttlMinutes,
        false,
        toDate,
    );
    if (!timeline) {
        throw new ChronicleError('Failed to create timeline', ChronicleErrorCode.NotFound);
    }
    return timeline;
}
