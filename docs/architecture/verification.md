# Сверка покрытия #2 / #6

Исторический отчёт первой сверки. Найденный ниже дефект чистой установки исправлен в последующей ветке; актуальные результаты — [clean-install-validation.md](../clean-install-validation.md). Текущий снимок схемы теперь получен всей цепочкой миграций, а не model-derived builder.

23.10.2026. База кода `69b2c423`; ветка `codex/architecture-planning-docs`. Проверки выполнялись в одноразовых контейнерах без сети, с искусственными SQLite-базами. Пилот, его данные и процесс One не подключались. Проценты строкового покрытия не измерялись: ниже сопоставлены реальные сценарии и тесты.

## Матрица

Все пути ниже относительно корня репозитория. Наборы backend — `backend/tests/integration/`, frontend — `frontend/components/`.

| Гарантия | Проверки | Оценка |
|---|---|---|
| Первый день, смена дня, изменение времени, export | `native-planning.test.js` | Покрыто REST + сервисами |
| Очистка, повтор той же даты, новая дата после очистки | Два новых регрессионных случая в `native-planning.test.js` (первый из них) | Пробел закрыт реальными API-записями и проверкой сохранённой истории |
| `defer_until`, завершение и открытие обычной задачи | Второй новый случай в `native-planning.test.js` | Проверены неизменность даты OnePlan, версии, счётчика и позиций дня |
| Старый week без дня, взаимная исключительность | `one-workflow.test.js`, `native-planning.test.js` | Покрыто |
| Дневной порядок/время/длительность/очистка | `daily-plan.test.js`, `one-workflow.test.js` | Покрыто; исторические снимки сохраняются |
| Старая ревизия One и дневного списка | `one-workflow.test.js` | Покрыто, включая пустой старый снимок после выбора недели |
| Конкурентные переносы доски и новая запись One | `native-planning.test.js` | Покрыто; один победитель, устаревшее изменение отклоняется |
| Прямая транзакционная запись прежнего адаптера | `native-planning.test.js` | Hook-проекция и отсутствие двойного счёта покрыты; это не живой обмен |
| MCP планирование/доступ | `one-workflow.test.js`, случай authenticated MCP | Покрыт `one_schedule`; не все сочетания конкурирующих транспортов |
| Повторяющиеся задачи | `recurring-tasks.test.js`; запрет завершения без ответа в `one-workflow.test.js`; UI защита серии в `Task/__tests__/UpcomingBoard.test.tsx` | Частично: нет полного цикла recurrence → завершение → новый occurrence → OnePlan/moves → повторное открытие |
| Диапазон, прошлые дни, переносы | `upcoming-range.test.js`, `Task/__tests__/UpcomingRangePicker.test.tsx`, `UpcomingBoard.test.tsx` | Покрытие API и компонентов; браузерный E2E в этой ветке не повторялся |
| Комментарии | `one-workflow.test.js`, `Task/__tests__/TaskComments.test.tsx` | Сервисный контракт и компоненты; живой round-trip One не запускался |
| Иерархия / данные / ссылки | `strict-project-context.test.js`, `task-note-links.test.js`, `note-fragments.test.js` | Прогнаны существующие регрессии |
| Экспорт схемы | `scripts/test-schema-snapshot.py` | Нет пользовательских строк, read-only, повторяемость, FK/триггер; файл неизменен |

Не считать `plan-enforcement.test.js` проверкой личного планирования: это ограничения тарифов.

## Результаты

- Backend: 8 наборов, 159 тестов успешно до дополнения. Изменённый `native-planning.test.js` повторно: 12/12 успешно; два новых теста прошли. Итого проверены 161 разных backend-теста.
- Экспортёр: 1/1 успешно, включая проверку синтетической секретной строки и неизменности базы на Windows.
- Frontend: 4 набора, 40/40 успешно (`UpcomingBoard`, `UpcomingRangePicker`, `TodayPage`, `TaskComments`). В логах есть предупреждения тестового окружения feature flags; проваленных тестов нет.
- Снимок: 64 прикладные таблицы, 738 колонок, 104 записи FK, 3 триггера. Внутренние `sqlite_*` исключены. Это схема документационного builder, а не количество объектов пилота.
- На двух независимо созданных пустых базах JSON и Mermaid совпали побайтно. SHA-256 JSON: `b2fca259972a83642147d5e50c2fba14d7ff79d44ef7c94de34c14bd57cf3ca8`; Mermaid: `3a8a72d15870c46327d2725dd4eb4a824d3188c0c353fafc06a91a4695616388`.

Команды Jest внутри контейнера с зависимостями проекта (сеть отключена, примонтирован только каталог исходников соответствующего слоя):

```sh
cd /app/backend
NODE_ENV=test npx jest --runInBand tests/integration/native-planning.test.js tests/integration/one-workflow.test.js tests/integration/daily-plan.test.js tests/integration/recurring-tasks.test.js tests/integration/strict-project-context.test.js tests/integration/upcoming-range.test.js tests/integration/task-note-links.test.js tests/integration/note-fragments.test.js
# После добавления двух случаев повторялся изменённый native-planning.test.js.
cd /app
npx jest --runInBand frontend/components/Task/__tests__/UpcomingBoard.test.tsx frontend/components/Task/__tests__/UpcomingRangePicker.test.tsx frontend/components/DailyPlan/__tests__/TodayPage.test.tsx frontend/components/Task/__tests__/TaskComments.test.tsx
```

## Подтверждённый дефект свежей установки

На новой пустой базе команда `db-prepare`, затем `db-migrate` заканчивается ошибкой:

```text
SQLITE_ERROR: index task_note_links_pair_type already exists
```

Причина: `sequelize.sync()` уже создаёт `task_note_links` и именованный индекс из `backend/models/task_note_link.js`, а миграция `20261022000002-create-task-note-links.js` без проверки снова вызывает `addIndex` с тем же именем. Последующие миграции не завершаются. Предположение в комментарии `db-prepare`, что все SQLite-миграции идемпотентны поверх sync, теперь неверно.

Воспроизведение только в disposable DB:

```sh
NODE_ENV=test DB_FILE=/tmp/new-install.sqlite node backend/scripts/db-prepare.js
NODE_ENV=test DB_FILE=/tmp/new-install.sqlite node backend/scripts/db-migrate.js
```

Это блокирует чистую установку. Обновление уже существующей базы не проверялось этой командой и не должно объявляться сломанным на основании этого результата. Сервисные тесты создают схему иначе, поэтому зелёные 161 тест не исключают дефект bootstrap.

В этой ветке runtime-код не исправлялся. Следующий шаг: отдельная миграционная правка с тестами пустой установки и обновления, затем детерминированный снимок всей миграционной цепочки. Проверить не только первый повторный индекс, но и более поздние миграции полей/фрагментов. До этого текущий снимок явно маркирован как model-derived.

## Оставшиеся ограничения покрытия

1. Добавить интеграционный цикл повторов с OnePlan и проверкой счётчика, не приравнивая автоматическое следующее повторение к ручному переносу без согласованного правила.
2. Проверить конкуренцию REST ↔ редактор дня ↔ MCP/адаптер на общих исходных ревизиях. Сейчас проверены отдельные гонки и stale snapshots, а не вся матрица транспортов.
3. Проверить полную цепочку bootstrap после исправления. Сервисные тесты и model-derived ERD не заменяют эту проверку.

Ни один из этих пунктов не является разрешением менять пилот. Рабочие данные, пароли, токены, архивы и конфигурация обмена в изменения не включены.
