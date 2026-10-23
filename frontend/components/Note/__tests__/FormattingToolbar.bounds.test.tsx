import React from 'react';
import { render, screen } from '@testing-library/react';
import FormattingToolbar from '../FormattingToolbar';
it('keeps a selection toolbar inside the viewport even when its anchor is scrolled away', () => {
    const fn = jest.fn();
    render(
        <FormattingToolbar
            visible
            x={-100}
            y={-500}
            onBold={fn}
            onItalic={fn}
            onStrikethrough={fn}
            onCode={fn}
            onLink={fn}
            onHeading={fn}
        />
    );
    const toolbar = screen.getByTitle('Bold').parentElement!;
    expect(toolbar.style.top).toBe('8px');
    expect(parseFloat(toolbar.style.left)).toBeGreaterThanOrEqual(8);
});
