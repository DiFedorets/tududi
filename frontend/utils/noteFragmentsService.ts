import { getApiPath } from '../config/paths';
import { getDefaultHeaders, getPostHeadersWithCsrf } from './authUtils';
export interface NoteFragment {
    uid: string;
    quote: string;
    state: 'located' | 'changed';
    from: number | null;
    to: number | null;
    note_revision: number;
}
async function body(r: Response) {
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || 'Не удалось открыть фрагмент');
    return value;
}
export async function createNoteFragment(
    uid: string,
    from: number,
    to: number,
    content: string
): Promise<{ uid: string; href: string }> {
    const note = await body(
        await fetch(getApiPath('note/' + encodeURIComponent(uid)), {
            credentials: 'include',
            headers: getDefaultHeaders(),
            cache: 'no-store',
        })
    );
    if ((note.content || '').replace(/\r\n?/g, '\n') !== content)
        throw new Error('Дождитесь сохранения заметки и повторите.');
    return body(
        await fetch(
            getApiPath('note/' + encodeURIComponent(uid) + '/fragments'),
            {
                method: 'POST',
                credentials: 'include',
                headers: await getPostHeadersWithCsrf(),
                body: JSON.stringify({
                    from,
                    to,
                    expected_revision: note.revision,
                    expected_content: content,
                }),
            }
        )
    );
}
export async function fetchNoteFragment(
    uid: string,
    fragmentUid: string
): Promise<NoteFragment> {
    return body(
        await fetch(
            getApiPath(
                'note/' +
                    encodeURIComponent(uid) +
                    '/fragments/' +
                    encodeURIComponent(fragmentUid)
            ),
            {
                credentials: 'include',
                headers: getDefaultHeaders(),
                cache: 'no-store',
            }
        )
    );
}
