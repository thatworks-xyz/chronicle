/**
 * Key-value cache port with per-entry TTL. Values are strings (callers JSON-encode).
 * Implementations: Redis, Memcached, or the built-in {@link InMemoryCache}.
 */
export interface KeyValueCache {
    get(key: string): Promise<string | undefined>;
    /** Stores a value with a time-to-live in milliseconds. */
    set(key: string, value: string, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
}

/**
 * Default in-process cache. Suitable for single-process deployments and tests.
 * Entries are evicted lazily on read and on a best-effort sweep during writes.
 */
export class InMemoryCache implements KeyValueCache {
    private readonly _entries = new Map<string, { value: string; expiresAtMs: number }>();
    private _opsSinceSweep = 0;

    constructor(private readonly _maxEntries: number = 10_000) {}

    async get(key: string): Promise<string | undefined> {
        const entry = this._entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAtMs <= Date.now()) {
            this._entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    async set(key: string, value: string, ttlMs: number): Promise<void> {
        this.sweepIfNeeded();
        this._entries.set(key, { value, expiresAtMs: Date.now() + ttlMs });
        // Bound memory: drop oldest entries beyond the cap (Map preserves insertion order)
        while (this._entries.size > this._maxEntries) {
            const oldest = this._entries.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this._entries.delete(oldest);
        }
    }

    async del(key: string): Promise<void> {
        this._entries.delete(key);
    }

    private sweepIfNeeded(): void {
        this._opsSinceSweep++;
        if (this._opsSinceSweep < 1000) {
            return;
        }
        this._opsSinceSweep = 0;
        const now = Date.now();
        for (const [key, entry] of this._entries) {
            if (entry.expiresAtMs <= now) {
                this._entries.delete(key);
            }
        }
    }
}
