/**
 * Minimal logging port. Compatible with console, pino, winston wrappers, etc.
 */
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug?(message: string): void;
}

/** Default logger backed by the console. */
export const consoleLogger: Logger = {
    info: (m) => console.info(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
    debug: (m) => console.debug(m),
};

/** Logger that discards everything. */
export const noopLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
};
