import { lazy } from 'react';
const HistoryPage = lazy(() => import('./history/HistoryPage'));
const OnePage = lazy(() => import('./one/OnePage'));
// Trusted build-time modules; this is not a loader for arbitrary code.
export const extensions = [
    {
        id: 'one-workflow',
        version: '0.1.0',
        path: '/extensions/one',
        title: 'Ответы и план',
        component: OnePage,
    },
    {
        id: 'one-history',
        version: '0.1.0',
        path: '/extensions/history',
        title: 'История и поиск',
        component: HistoryPage,
    },
];
