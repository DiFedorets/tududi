import React from 'react';
import { render } from '@testing-library/react';
import HighlightedText, { matchRanges } from '../HighlightedText';

describe('history search highlighting', () => {
    it('keeps original Cyrillic spelling while matching case, ё/е and word parts', () => {
        const { container } = render(
            <HighlightedText
                text="Ёлка, ВИТАМИН и витамины"
                terms={['елка', 'витамин']}
            />
        );
        expect(
            Array.from(container.querySelectorAll('mark'), (m) => m.textContent)
        ).toEqual(['Ёлка', 'ВИТАМИН', 'витамин']);
        expect(container.textContent).toBe('Ёлка, ВИТАМИН и витамины');
    });
    it('preserves exact phrases and merges overlapping terms', () => {
        expect(matchRanges('Урбан Скетч', ['урбан скетч', 'скетч'])).toEqual([
            [0, 11],
        ]);
        expect(matchRanges('Урбан новый Скетч', ['урбан скетч'])).toEqual([]);
    });
    it('maps NFKC expansions, combining accents and emoji offsets', () => {
        const { container } = render(
            <HighlightedText
                text={'😀 ﬃ e\u0301 Ａ'}
                terms={['ffi', 'é', 'a']}
            />
        );
        expect(
            Array.from(container.querySelectorAll('mark'), (m) => m.textContent)
        ).toEqual(['ﬃ', 'e\u0301', 'Ａ']);
    });
    it('treats regex and HTML as literal text', () => {
        const { container } = render(
            <HighlightedText
                text="<img src=x onerror=alert(1)> [a].*"
                terms={['[a].*']}
            />
        );
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('mark')?.textContent).toBe('[a].*');
    });
    it('leaves unmatched text intact', () => {
        expect(matchRanges('Сахалин', ['витамин', ''])).toEqual([]);
    });
});
