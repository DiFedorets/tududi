import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchResults from '../SearchResults';
import { searchUniversal, searchHistory } from '../../../utils/searchService';
const navigate = jest.fn();
jest.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/notes' }),
}));
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../../../utils/focus', () => ({
    useFocus: () => null,
    focusKey: () => 'all',
    focusScopeParams: () => ({}),
}));
jest.mock('../../../utils/searchService', () => ({
    searchUniversal: jest.fn(),
    searchHistory: jest.fn(),
}));
const props = {
    searchQuery: 'Сахалин',
    selectedFilters: [],
    selectedPriority: null,
    selectedStatus: null,
    selectedDue: null,
    selectedDefer: null,
    selectedTags: [],
    selectedExtras: [],
    onClose: jest.fn(),
};
beforeEach(() => {
    jest.clearAllMocks();
    (searchUniversal as jest.Mock).mockResolvedValue({
        results: [
            { type: 'Note', id: 1, uid: 'n1', name: 'Старая выдача' },
            { type: 'Project', id: 2, uid: 'p1', name: 'Проект' },
        ],
    });
    (searchHistory as jest.Mock).mockResolvedValue({
        terms: ['сахалин'],
        total: 1,
        results: [
            {
                type: 'comment',
                uid: 'c1',
                title: 'Встреча',
                excerpts: [{ text: 'Передать концепцию: Сахалин' }],
            },
        ],
    });
});
it('includes discussion text, avoids duplicate native notes and opens the highlighted source', async () => {
    const { container } = render(<SearchResults {...props} />);
    await screen.findByText('Обсуждения');
    expect(container.querySelector('mark')?.textContent).toBe('Сахалин');
    expect(screen.queryByText('Старая выдача')).toBeNull();
    expect(screen.getByText('Проект')).toBeTruthy();
    fireEvent.click(screen.getByText('Встреча'));
    expect(navigate).toHaveBeenCalledWith(
        '/extensions/history?q=%D0%A1%D0%B0%D1%85%D0%B0%D0%BB%D0%B8%D0%BD&source=comment%3Ac1'
    );
});
it('retains native filters without mixing unfiltered history into their results', async () => {
    render(<SearchResults {...props} selectedFilters={['Task']} />);
    await screen.findByText('Старая выдача');
    expect(searchHistory).not.toHaveBeenCalled();
});
it('shows a history failure instead of claiming there are no matches', async () => {
    (searchHistory as jest.Mock).mockRejectedValue(
        new Error('History unavailable')
    );
    render(<SearchResults {...props} />);
    await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
            'History unavailable'
        )
    );
});
