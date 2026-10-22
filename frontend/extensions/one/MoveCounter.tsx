import React from 'react';
import { ArrowUturnRightIcon } from '@heroicons/react/24/outline';
export default function MoveCounter({
    moves,
    compact = false,
}: {
    moves: number;
    compact?: boolean;
}) {
    if (moves <= 0) return null;
    return (
        <span
            className={
                compact
                    ? 'inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'
                    : 'inline-flex items-center gap-1 h-8 px-1.5 rounded-md text-xs text-gray-400 dark:text-gray-400'
            }
            title={`Переносов: ${moves}`}
            aria-label={`Переносов: ${moves}`}
        >
            <ArrowUturnRightIcon
                className={compact ? 'h-3 w-3' : 'h-4 w-4'}
                aria-hidden="true"
            />
            <span>{moves}</span>
        </span>
    );
}
