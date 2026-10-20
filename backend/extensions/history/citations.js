'use strict';
const sourceHref = (source) =>
    `/extensions/history?source=${encodeURIComponent(`${source.type}:${source.uid}`)}`;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function linkSources(text, sources) {
    // Leave already formed Markdown links intact. Resolve only identifiers
    // supplied by our own permission-filtered retrieval, never invented IDs.
    return text
        .split(/(\[[^\]]*\]\([^)]*\))/g)
        .map((part) => {
            if (/^\[[^\]]*\]\([^)]*\)$/.test(part)) return part;
            let linked = part;
            for (const source of sources) {
                const label = source.title
                    .replace(/[\[\]\r\n]/g, '')
                    .slice(0, 100);
                const pattern = new RegExp(
                    `(?<![A-Za-z0-9_])(?:(?:note|task|comment)[ /]+)?${escapeRegex(source.uid)}(?![A-Za-z0-9_])`,
                    'g'
                );
                linked = linked.replace(
                    pattern,
                    `[${label}](${sourceHref(source)})`
                );
            }
            return linked;
        })
        .join('');
}
module.exports = { sourceHref, linkSources };
