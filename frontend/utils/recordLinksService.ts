import { getApiPath } from '../config/paths';
import {
    getDefaultHeaders,
    getPostHeadersWithCsrf,
    handleAuthResponse,
} from './authUtils';
export type RecordType = 'task' | 'note';
export interface RecordLink {
    uid: string;
    type: 'related_to' | 'source';
    can_remove: boolean;
    target: { uid: string; type: RecordType; title: string; status?: number };
}
const path = (type: RecordType, uid: string) =>
    `${type}/${encodeURIComponent(uid)}/${type === 'task' ? 'note' : 'task'}-links`;
export async function fetchRecordLinks(
    type: RecordType,
    uid: string
): Promise<RecordLink[]> {
    const r = await fetch(getApiPath(path(type, uid)), {
        credentials: 'include',
        headers: getDefaultHeaders(),
    });
    await handleAuthResponse(r, 'Could not load links');
    return (await r.json()).links;
}
export async function addRecordLink(
    type: RecordType,
    uid: string,
    target: string,
    relation: RecordLink['type']
) {
    const r = await fetch(getApiPath(path(type, uid)), {
        method: 'POST',
        credentials: 'include',
        headers: await getPostHeadersWithCsrf(),
        body: JSON.stringify({ target_uid: target, type: relation }),
    });
    await handleAuthResponse(r, 'Could not add link');
}
export async function removeRecordLink(
    type: RecordType,
    uid: string,
    linkUid: string
) {
    const r = await fetch(
        getApiPath(path(type, uid) + '/' + encodeURIComponent(linkUid)),
        {
            method: 'DELETE',
            credentials: 'include',
            headers: await getPostHeadersWithCsrf(),
        }
    );
    await handleAuthResponse(r, 'Could not remove link');
}
