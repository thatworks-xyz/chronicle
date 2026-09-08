import { ConnectorId } from '../../domain/connector.js';
import { Scope } from '../../domain/context.js';
import { HierarchyType } from '../../domain/hierarchy.js';
import { InsightConfig } from './types.js';

/**
 * Registry of insight configurations. An engine instance owns one of these;
 * insight packages (e.g. connector packages) register into it during setup —
 * nothing is registered by default.
 */
export class InsightRegistry {
    private readonly _registry: Map<string, InsightConfig> = new Map();

    get all(): InsightConfig[] {
        return Array.from(this._registry.values());
    }

    get(id: string): InsightConfig | undefined {
        return this._registry.get(id);
    }

    register(config: InsightConfig): void {
        if (config.id.includes(':')) {
            // ':' is the analysisId delimiter — see generateAnalysisId
            throw new Error(`Insight id '${config.id}' must not contain ':'`);
        }
        this._registry.set(config.id, config);
    }

    /**
     * Get insight configs that apply to a specific connector and hierarchy
     */
    getRelevantInsights(
        connector: ConnectorId,
        hierarchyId: HierarchyType,
        filter?: { ids?: string[] },
    ): InsightConfig[] {
        const results: InsightConfig[] = [];

        this.all.forEach((config) => {
            // Check if connector matches
            const connectorMatches =
                !config.applicability.connectors || config.applicability.connectors.includes(connector);

            // Check if hierarchy matches
            const hierarchyMatches =
                !config.applicability.hierarchyTypes || config.applicability.hierarchyTypes.includes(hierarchyId);

            if (connectorMatches && hierarchyMatches) {
                results.push(config);
            }
        });

        // Apply id filter if provided
        if (filter?.ids && filter.ids.length > 0) {
            return results.filter((c) => filter?.ids?.includes(c.id));
        }

        return results;
    }

    /**
     * Get insight configs that apply to a set of scopes
     */
    getRelevantInsightsForScopes(
        scopes: Scope[],
        filter?: { ids?: string[] },
    ): { config: InsightConfig; scopes: Scope[] }[] {
        const results: Map<string, { config: InsightConfig; scopes: Scope[] }> = new Map();

        scopes.forEach((item) => {
            const itemConfigs = this.getRelevantInsights(item.connector, item.hierarchyType, filter);
            itemConfigs.forEach((config) => {
                if (results.has(config.id)) {
                    results.get(config.id)?.scopes.push(item);
                } else {
                    results.set(config.id, { config, scopes: [item] });
                }
            });
        });

        return Array.from(results.values());
    }
}
