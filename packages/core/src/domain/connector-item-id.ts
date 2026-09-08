/**
 * Since most apps don't use UUIDs and our model enforces
 * the use of UUIDs, these fields can be used to enforce
 * some uniqueness when searching or mapping connector IDs
 * to our own UUIDs
 */
export interface ConnectorItemId {
    /**
     * ID from for the object from the connector. If this is guaranteed to be unique,
     * `idIsUnique` can be set to true with the other fields set to empty strings
     */
    idFromConnector: string;
    /**
     * An additional ID from the connector (e.g. the parent's id)
     * since most apps don't use UUIDs while our model enforces
     * the use of UUIDs. By using idFromConnector+additionalIdFromConnector+connectorObjectType
     * we can derive an unique identifier.
     */
    additionalIdFromConnector?: string;
    /**
     * The object type dependent on the connector (e.g. sprint, task, sheet, doc)
     */
    connectorObjectType: string;
    /**
     * User account id from the connector
     */
    connectorUserId: string;
    /**
     * Set to true if idFromConnector is unique. The other fields can be empty strings if so.
     */
    idIsUnique?: boolean;
}
