import { Scope } from '../domain/context.js';
import { Principal } from './access-control.js';

/**
 * Optional engine hooks. All hooks are fire-and-forget from the engine's
 * perspective — failures are logged, never propagated.
 */
export interface EngineHooks {
    /**
     * Called when a timeline is requested for scopes — a chance for the host to
     * trigger a data refresh (e.g. enqueue a connector poll). The engine does not
     * wait for the refresh; the timeline is built from currently stored data.
     */
    onTimelineRequested?: (principal: Principal, scopes: Scope[]) => Promise<void>;
}
