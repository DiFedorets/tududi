import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UpcomingRangePicker, {
    rangePreset,
    validRange,
} from '../UpcomingRangePicker';
it('selects the previous week including upcoming days and handles Monday/Sunday consistently', () => {
    expect(rangePreset('pastweek', '2026-10-23')).toEqual({
        start: '2026-10-12',
        end: '2026-10-30',
    });
    expect(rangePreset('week', '2026-10-25')).toEqual({
        start: '2026-10-19',
        end: '2026-10-25',
    });
    expect(rangePreset('yesterday', '2027-01-01').start).toBe('2026-12-31');
});
it('applies a custom range and rejects invalid calendar/reversed/overlong periods', () => {
    const change = jest.fn();
    render(
        <UpcomingRangePicker
            value={{ start: '2026-10-22', end: '2026-10-27' }}
            onChange={change}
        />
    );
    fireEvent.click(screen.getByLabelText('Диапазон предстоящих'));
    fireEvent.change(screen.getByLabelText('Начало диапазона'), {
        target: { value: '2026-10-28' },
    });
    fireEvent.click(screen.getByText('Показать'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Конец диапазона'), {
        target: { value: '2026-10-30' },
    });
    fireEvent.click(screen.getByText('Показать'));
    expect(change).toHaveBeenCalledWith({
        start: '2026-10-28',
        end: '2026-10-30',
    });
    expect(validRange({ start: '2026-02-30', end: '2026-03-05' })).toBe(false);
    expect(validRange({ start: '2026-01-01', end: '2026-02-05' })).toBe(false);
});
it('closes with Escape without applying edits', () => {
    const change = jest.fn();
    render(
        <UpcomingRangePicker
            value={{ start: '2026-10-22', end: '2026-10-27' }}
            onChange={change}
        />
    );
    fireEvent.click(screen.getByLabelText('Диапазон предстоящих'));
    fireEvent.keyDown(screen.getByLabelText('Начало диапазона'), {
        key: 'Escape',
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
});
