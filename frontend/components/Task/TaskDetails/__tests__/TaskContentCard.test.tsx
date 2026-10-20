import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TaskContentCard from '../TaskContentCard';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback: string) => fallback }),
}));

// Capture props passed to MarkdownRenderer so we can assert on them
let capturedMarkdownProps: any = null;
jest.mock('../../../Shared/MarkdownRenderer', () => {
    return function MockMarkdownRenderer(props: any) {
        capturedMarkdownProps = props;
        // Render a simple checkbox so we can test click-through
        const lines = (props.content as string).split('\n');
        return (
            <div>
                {lines.map((line: string, idx: number) => {
                    const match = line.match(/^(\s*)-\s*\[([ xX])\](.*)$/);
                    if (match) {
                        const checked = match[2].toLowerCase() === 'x';
                        return (
                            <input
                                key={idx}
                                type="checkbox"
                                checked={checked}
                                disabled={!props.onContentChange}
                                onChange={() => {
                                    if (props.onContentChange) {
                                        const toggled = checked
                                            ? line.replace(/\[x\]/i, '[ ]')
                                            : line.replace('[ ]', '[x]');
                                        props.onContentChange(toggled);
                                    }
                                }}
                            />
                        );
                    }
                    return <span key={idx}>{line}</span>;
                })}
            </div>
        );
    };
});

describe('TaskContentCard - checkbox interactivity', () => {
    beforeEach(() => {
        capturedMarkdownProps = null;
    });

    it('passes onContentChange to MarkdownRenderer in view mode', () => {
        const onUpdate = jest.fn().mockResolvedValue(undefined);
        render(
            <TaskContentCard content="- [ ] Do something" onUpdate={onUpdate} />
        );

        expect(capturedMarkdownProps).not.toBeNull();
        expect(capturedMarkdownProps.onContentChange).toBeDefined();
    });

    it('checkboxes are enabled in view mode', () => {
        const onUpdate = jest.fn().mockResolvedValue(undefined);
        render(
            <TaskContentCard content="- [ ] Do something" onUpdate={onUpdate} />
        );

        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).not.toBeDisabled();
    });

    it('clicking a checkbox calls onUpdate with toggled content', async () => {
        const onUpdate = jest.fn().mockResolvedValue(undefined);
        render(
            <TaskContentCard content="- [ ] Do something" onUpdate={onUpdate} />
        );

        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith('- [x] Do something');
    });

    it('clicking a checked checkbox calls onUpdate to uncheck it', async () => {
        const onUpdate = jest.fn().mockResolvedValue(undefined);
        render(
            <TaskContentCard content="- [x] Do something" onUpdate={onUpdate} />
        );

        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        expect(onUpdate).toHaveBeenCalledWith('- [ ] Do something');
    });
});

describe('TaskContentCard draft safety', () => {
    it('keeps edited text when the server description changes and refuses to overwrite it', async () => {
        const onUpdate = jest.fn();
        const view = render(
            <TaskContentCard content="Before" onUpdate={onUpdate} />
        );
        fireEvent.click(screen.getByText('Before'));
        fireEvent.change(screen.getByRole('textbox'), {
            target: { value: 'My draft' },
        });
        view.rerender(
            <TaskContentCard content="Agent changed it" onUpdate={onUpdate} />
        );
        expect(screen.getByRole('textbox')).toHaveValue('My draft');
        fireEvent.click(screen.getByText('Save'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'изменилось'
        );
        expect(onUpdate).not.toHaveBeenCalled();
    });
    it('keeps a rejected save in the editor and offers the draft', async () => {
        const onUpdate = jest
            .fn()
            .mockRejectedValue(new Error('Нет соединения'));
        render(<TaskContentCard content="Before" onUpdate={onUpdate} />);
        fireEvent.click(screen.getByText('Before'));
        fireEvent.change(screen.getByRole('textbox'), {
            target: { value: 'My draft' },
        });
        fireEvent.click(screen.getByText('Save'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Нет соединения'
        );
        expect(screen.getByRole('textbox')).toHaveValue('My draft');
        expect(screen.getByText('Скачать черновик')).toBeInTheDocument();
    });
});
