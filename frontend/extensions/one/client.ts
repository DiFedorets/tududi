import { getApiPath } from '../../config/paths';
import {
    getDefaultHeaders,
    getPostHeadersWithCsrf,
    isQueuedOfflineResponse,
} from '../../utils/authUtils';
export type Plan = {
    task_uid: string;
    planned: string | null;
    week: string | null;
    last_planned: string | null;
    moves: number;
    revision: number;
};
export type PlannedTask = {
    uid: string;
    name: string;
    status: number;
    due_date: string | null;
    plan: Plan;
};
export type Debt = {
    task_uid: string;
    name: string;
    status: number;
    count?: number;
    comments?: { uid: string; body: string; created_at: string }[];
    comment?: { uid: string; body: string; created_at: string };
};
export type Overview = {
    enabled: boolean;
    today: string;
    week: string;
    timezone: string;
    agent_owes: Debt[];
    human_owes: Debt[];
    unclassified_comments: number;
    tasks: PlannedTask[];
};
export async function oneApi<T>(
    path = '',
    method = 'GET',
    body?: unknown
): Promise<T> {
    const response = await fetch(getApiPath(`extensions/one${path}`), {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers:
            method === 'GET'
                ? getDefaultHeaders()
                : await getPostHeadersWithCsrf(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (isQueuedOfflineResponse(response))
        throw new Error(
            'Изменение ещё не подтверждено сервером. Ваш выбор остаётся в форме.'
        );
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось получить данные One.');
    }
    return response.json();
}
export const changed = () =>
    window.dispatchEvent(new Event('oneWorkflowChanged'));
export const shift = (date: string, days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
export const monday = (date: string) => {
    const d = new Date(`${date}T12:00:00Z`);
    return shift(date, -((d.getUTCDay() + 6) % 7));
};
