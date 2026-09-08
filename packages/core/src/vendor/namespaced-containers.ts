// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IdObject = Record<string, any>;

// Basic namespacing to avoid clashes in IDs between connector object types
export function makeNamespacedKey<Names extends IdObject>(n: Names): string {
    // Should be a stable sort
    const keys = Object.keys(n).sort();
    const valStr: string[] = [];
    keys.forEach((k) => {
        const value = n[k];
        if (value) {
            valStr.push(value.toString());
        }
    });
    return valStr.join('.');
}

export class NamespacedIdMap<Names extends IdObject, Data> implements Iterable<[string, Data]> {
    private _map: Map<string, Data>;

    constructor(items?: Data[], getNames?: (item: Data) => Names) {
        if (!items || !getNames) {
            this._map = new Map();
            return;
        }

        this._map = items.reduce<Map<string, Data>>((p, c) => p.set(this.makeKey(getNames(c)), c), new Map());
    }

    [Symbol.iterator](): Iterator<[string, Data]> {
        return this._map[Symbol.iterator]();
    }

    forEach(cb: (value: Data, key: string) => void) {
        this._map.forEach((value, key) => cb(value, key));
    }

    has(c: Names): boolean {
        return this._map.has(this.makeKey(c));
    }

    get(c: Names): Data | undefined {
        return this._map.get(this.makeKey(c));
    }

    set(c: Names, item: Data) {
        this._map.set(this.makeKey(c), item);
    }

    deleteUsingTypespacedKey(typespacedKey: string): boolean {
        return this._map.delete(typespacedKey);
    }

    delete(c: Names) {
        return this._map.delete(this.makeKey(c));
    }

    values(): IterableIterator<Data> {
        return this._map.values();
    }

    get size() {
        return this._map.size;
    }

    makeKey(c: Names) {
        return makeNamespacedKey(c);
    }
}

export class NamespacedSet<Names extends IdObject> {
    private _set = new Set<string>();

    add(c: Names) {
        this._set.add(this.makeKey(c));
    }

    addNamespaced(v: string) {
        this._set.add(v);
    }

    has(c: Names): boolean {
        return this._set.has(this.makeKey(c));
    }

    forEach(cb: (namespacedKey: string) => void) {
        this._set.forEach((key) => cb(key));
    }

    values() {
        return this._set.values();
    }

    makeKey(c: Names) {
        return makeNamespacedKey(c);
    }
}
