import React from 'react';

const normalize = (value: string) =>
    value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');

// Map normalized matches back to original text, including expanding ligatures
// and combining characters. Render plain text through React, never as HTML.
export function matchRanges(text: string, terms: string[]): [number, number][] {
    let normalized = '';
    const positions: [number, number][] = [];
    for (const match of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
        const start = match.index!;
        const part = normalize(match[0]);
        normalized += part;
        for (let i = 0; i < part.length; i++)
            positions.push([start, start + match[0].length]);
    }
    const ranges: [number, number][] = [];
    for (const raw of new Set(terms)) {
        const term = normalize(raw);
        if (!term) continue;
        for (
            let at = normalized.indexOf(term);
            at !== -1;
            at = normalized.indexOf(term, at + 1)
        ) {
            ranges.push([positions[at][0], positions[at + term.length - 1][1]]);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range[0] < previous[1])
            previous[1] = Math.max(previous[1], range[1]);
        else merged.push([...range]);
    }
    return merged;
}

export default function HighlightedText({
    text,
    terms,
}: {
    text: string;
    terms: string[];
}) {
    const parts: React.ReactNode[] = [];
    let at = 0;
    for (const [start, end] of matchRanges(text, terms)) {
        parts.push(text.slice(at, start));
        parts.push(
            <mark
                key={start}
                data-search-match
                className="rounded-sm bg-amber-200 text-gray-950 dark:bg-amber-400 dark:text-gray-950 px-0.5"
            >
                {text.slice(start, end)}
            </mark>
        );
        at = end;
    }
    parts.push(text.slice(at));
    return <>{parts}</>;
}
