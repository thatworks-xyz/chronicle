export function Capitalize(s: string): string {
    if (!s) {
        return s;
    }
    if (s.length < 2) {
        return s[0].toUpperCase();
    }
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

const IRREGULAR_PLURALS: Record<string, string> = {
    person: 'people',
    child: 'children',
    man: 'men',
    woman: 'women',
    foot: 'feet',
    tooth: 'teeth',
    mouse: 'mice',
    goose: 'geese',
};

/**
 * Pluralizes a singular English word when count !== 1, using standard suffix
 * rules plus a small irregulars table. Expects singular input (already-plural
 * words are not normalized). Preserves leading capitalization.
 */
export function pluralizeWord(word: string, count: number): string {
    if (count === 1 || word.length === 0) {
        return word;
    }
    const irregular = IRREGULAR_PLURALS[word.toLowerCase()];
    if (irregular) {
        return word[0] === word[0].toUpperCase() ? Capitalize(irregular) : irregular;
    }
    if (/(?:s|x|z|ch|sh)$/i.test(word)) {
        return `${word}es`;
    }
    if (/[^aeiou]y$/i.test(word)) {
        return `${word.slice(0, -1)}ies`;
    }
    return `${word}s`;
}
