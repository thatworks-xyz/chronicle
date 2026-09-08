// One-shot migration: rewrite extensionless relative import specifiers to
// .js-extensioned ESM specifiers, resolving against the filesystem (file .ts
// first, then directory index.ts). Throws on anything it cannot resolve.
// Run from the repo root: node scripts/codemod-esm-imports.mjs
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['packages', 'examples'];
const SPEC_RE = /((?:import|export)[\s\S]*?from\s*|import\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist') continue;
            yield* walk(full);
        } else if (full.endsWith('.ts')) {
            yield full;
        }
    }
}

let rewrites = 0;
for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
        const src = readFileSync(file, 'utf8');
        const out = src.replace(SPEC_RE, (whole, prefix, quote, spec) => {
            if (spec.endsWith('.js') || spec.endsWith('.json')) return whole;
            const base = path.resolve(path.dirname(file), spec);
            let next;
            if (existsSync(base + '.ts')) {
                next = spec + '.js';
            } else if (existsSync(path.join(base, 'index.ts'))) {
                next = spec.replace(/\/$/, '') + '/index.js';
            } else {
                throw new Error(`${file}: cannot resolve '${spec}'`);
            }
            rewrites++;
            return `${prefix}${quote}${next}${quote}`;
        });
        if (out !== src) writeFileSync(file, out);
    }
}
console.log(`rewrote ${rewrites} specifiers`);
