export enum ChronicleErrorCode {
    /** A referenced cached object (e.g. a timeline/context id) has expired or does not exist. */
    CacheInvalid = 'cache_invalid',
    /** A referenced entity does not exist or is not accessible. */
    NotFound = 'not_found',
    /** The request is invalid. */
    InvalidInput = 'invalid_input',
}

export class ChronicleError extends Error {
    constructor(
        message: string,
        public readonly code: ChronicleErrorCode,
    ) {
        super(message);
        this.name = 'ChronicleError';
    }
}
