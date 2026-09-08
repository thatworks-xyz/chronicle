import { ConnectorItemId } from '../domain/connector-item-id.js';
import { NamespacedIdMap, NamespacedSet } from '../vendor/namespaced-containers.js';

export class ConnectorItemIdMap<Data> extends NamespacedIdMap<ConnectorItemId, Data> {
    makeKey(c: ConnectorItemId): string {
        if (c.idIsUnique) {
            return c.idFromConnector;
        }
        return super.makeKey(c);
    }
}

export class ConnectorItemIdSet extends NamespacedSet<ConnectorItemId> {
    makeKey(c: ConnectorItemId): string {
        if (c.idIsUnique) {
            return c.idFromConnector;
        }
        return super.makeKey(c);
    }
}
