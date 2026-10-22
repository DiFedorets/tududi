import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { oneApi } from './client';
type Status = { state: string; checkedAt?: string; lastSuccessAt?: string; expiresAt?: string; intervalSeconds?: number; error?: string; conflicts?: { id: string; field: string; reason: string; href?: string }[]; records?: number; notes?: number; files?: number };
const labels: Record<string, string> = { healthy: 'One: обмен работает', conflict: 'One: есть конфликт', error: 'One: ошибка обмена', stale: 'One: давно нет связи', stopped: 'One: обмен остановлен', expired: 'One: срок обмена истёк', unavailable: 'One: статус пока недоступен', unreadable: 'One: не удалось прочитать статус' };
const when = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : 'ещё не было';
export default function SyncStatus({ compact = false }: { compact?: boolean }) {
    const [data, setData] = useState<Status | null>(null);
    useEffect(() => {
        let live = true;
        const load = async () => {
            if (document.visibilityState !== 'visible') return;
            try { const status = await oneApi<Status>('/sync'); if (live) setData(status); }
            catch { if (live) setData({ state: 'unreadable' }); }
        };
        void load(); const timer = setInterval(() => void load(), 15000);
        window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
        return () => { live = false; clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
    }, []);
    const state = data?.state || 'loading';
    const label = labels[state] || 'One: проверяем связь…';
    const healthy = state === 'healthy';
    const tone = healthy ? 'text-emerald-700 dark:text-emerald-300' : state === 'loading' || state === 'unavailable' ? 'text-gray-500 dark:text-gray-400' : 'text-amber-800 dark:text-amber-300';
    if (compact) return <Link to="/extensions/one#sync" title={`${label}. Последний проход: ${when(data?.checkedAt)}`} aria-label={label} className={`mx-3 mb-3 flex items-center gap-2 text-xs ${tone}`}><span aria-hidden="true">{healthy ? '●' : '◌'}</span><span>{label}</span></Link>;
    return <section id="sync" className="scroll-mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2 text-sm">
        <h2 className={`font-semibold ${tone}`}>{label}</h2>
        <p>Последний проход: {when(data?.checkedAt)}. Успешный проход: {when(data?.lastSuccessAt)}.</p>
        <p className="text-gray-500 dark:text-gray-400">Изменения после этого времени ждут следующего прохода. Статус обновляется автоматически.</p>
        {data?.records !== undefined && <p>Задач: {data.records} · заметок: {data.notes ?? 0} · файлов: {data.files ?? 0}.</p>}
        {data?.expiresAt && <p>Временный обмен до {when(data.expiresAt)}.</p>}
        {state === 'stale' && <p role="alert">Синхронизация давно не сообщала о результате. Последний успешный проход не подтверждает перенос новых изменений.</p>}
        {state === 'stopped' && <p>Процесс остановлен. Новые изменения пока не передаются.</p>}
        {state === 'expired' && <p>Срок пилота закончился. Новые изменения больше не передаются.</p>}
        {state === 'unreadable' && <p role="alert">Не удалось проверить состояние обмена. Попробуем снова автоматически.</p>}
        {state === 'unavailable' && <p>Процесс ещё не опубликовал статус для этой учётной записи.</p>}
        {data?.error && <p role="alert" className="whitespace-pre-wrap">{data.error}</p>}
        {!!data?.conflicts?.length && <div role="alert" className="space-y-2"><p>Есть изменения, которые не удалось перенести. Версии сохранены для разбора.</p><ul className="list-disc pl-5 space-y-1">{data.conflicts.map((c, i) => <li key={i}>{c.href ? <Link className="underline" to={c.href}>Открыть запись {/^\d+$/.test(c.id) ? `#${c.id}` : ''}</Link> : `Запись ${c.id}`}: {c.reason}</li>)}</ul></div>}
    </section>;
}
