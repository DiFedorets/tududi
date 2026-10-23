'use strict';
const changed = (a, b, d) =>
    `${a} ${d === 'sqlite' ? 'IS NOT' : 'IS DISTINCT FROM'} ${b}`;
async function install(sequelize, transaction) {
    const d = sequelize.getDialect();
    const run = (sql) => sequelize.query(sql, { transaction });
    if (d === 'sqlite') {
        const area =
            '(SELECT CASE WHEN area_id IN (SELECT id FROM areas) THEN area_id ELSE NULL END FROM projects WHERE id=NEW.project_id)';
        const goal =
            '(SELECT CASE WHEN goal_id IN (SELECT id FROM goals) THEN goal_id ELSE NULL END FROM projects WHERE id=NEW.project_id)';
        for (const event of [
            'INSERT',
            'UPDATE OF project_id, area_id, goal_id',
        ]) {
            const insert = event === 'INSERT';
            await run(`CREATE TRIGGER strict_task_context_${insert ? 'insert' : 'update'} AFTER ${event} ON tasks
    WHEN NEW.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id)
     AND (NEW.area_id IS NOT ${area} OR NEW.goal_id IS NOT ${goal})
    BEGIN
     INSERT INTO task_context_history(task_id,previous_project_id,area_id,goal_id,reason,created_at)
     VALUES(NEW.id,${insert ? 'NEW' : 'OLD'}.project_id,${insert ? 'NEW' : 'OLD'}.area_id,${insert ? 'NEW' : 'OLD'}.goal_id,'task_project_context',CURRENT_TIMESTAMP);
     UPDATE tasks SET area_id=${area},goal_id=${goal} WHERE id=NEW.id;
    END`);
        }
        await run(`CREATE TRIGGER strict_project_context_update AFTER UPDATE OF area_id,goal_id ON projects
   WHEN OLD.area_id IS NOT NEW.area_id OR OLD.goal_id IS NOT NEW.goal_id
   BEGIN
    INSERT INTO task_context_history(task_id,previous_project_id,area_id,goal_id,reason,created_at)
     SELECT id,project_id,area_id,goal_id,'project_context_changed',CURRENT_TIMESTAMP FROM tasks
     WHERE project_id=NEW.id AND (area_id IS NOT NEW.area_id OR goal_id IS NOT NEW.goal_id);
    UPDATE tasks SET area_id=NEW.area_id,goal_id=NEW.goal_id WHERE project_id=NEW.id;
   END`);
    } else if (d === 'postgres') {
        await run(`CREATE FUNCTION strict_task_context_fn() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE a integer; g integer;
   BEGIN
    IF NEW.project_id IS NOT NULL THEN
     SELECT area_id,goal_id INTO a,g FROM projects WHERE id=NEW.project_id;
     IF FOUND AND (NEW.area_id IS DISTINCT FROM a OR NEW.goal_id IS DISTINCT FROM g) THEN
      INSERT INTO task_context_history(task_id,previous_project_id,area_id,goal_id,reason,created_at)
       VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN NEW.project_id ELSE OLD.project_id END,
       CASE WHEN TG_OP='INSERT' THEN NEW.area_id ELSE OLD.area_id END,
       CASE WHEN TG_OP='INSERT' THEN NEW.goal_id ELSE OLD.goal_id END,'task_project_context',CURRENT_TIMESTAMP);
      NEW.area_id:=a;NEW.goal_id:=g;
     END IF;
    END IF;RETURN NEW;
   END $$`);
        // The task history FK is deferred on PostgreSQL: BEFORE INSERT precedes the task row.
        await run(
            'ALTER TABLE task_context_history DROP CONSTRAINT task_context_history_task_id_fkey'
        );
        await run(
            'ALTER TABLE task_context_history ADD CONSTRAINT task_context_history_task_id_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED'
        );
        await run(
            'CREATE TRIGGER strict_task_context BEFORE INSERT OR UPDATE OF project_id,area_id,goal_id ON tasks FOR EACH ROW EXECUTE FUNCTION strict_task_context_fn()'
        );
        await run(`CREATE FUNCTION strict_project_context_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   INSERT INTO task_context_history(task_id,previous_project_id,area_id,goal_id,reason,created_at)
    SELECT id,project_id,area_id,goal_id,'project_context_changed',CURRENT_TIMESTAMP FROM tasks WHERE project_id=NEW.id AND (area_id IS DISTINCT FROM NEW.area_id OR goal_id IS DISTINCT FROM NEW.goal_id);
   UPDATE tasks SET area_id=NEW.area_id,goal_id=NEW.goal_id WHERE project_id=NEW.id;
   RETURN NEW;END $$`);
        await run(
            'CREATE TRIGGER strict_project_context AFTER UPDATE OF area_id,goal_id ON projects FOR EACH ROW WHEN (OLD.area_id IS DISTINCT FROM NEW.area_id OR OLD.goal_id IS DISTINCT FROM NEW.goal_id) EXECUTE FUNCTION strict_project_context_fn()'
        );
    } else throw new Error('Strict context requires SQLite or PostgreSQL');
}
module.exports = {
    install,
    async up(q, S) {
        await q.sequelize.transaction(async (transaction) => {
            await q.createTable(
                'task_context_history',
                {
                    id: {
                        type: S.INTEGER,
                        primaryKey: true,
                        autoIncrement: true,
                        allowNull: false,
                    },
                    task_id: {
                        type: S.INTEGER,
                        allowNull: false,
                        references: { model: 'tasks', key: 'id' },
                        onDelete: 'CASCADE',
                    },
                    previous_project_id: { type: S.INTEGER, allowNull: true },
                    area_id: { type: S.INTEGER, allowNull: true },
                    goal_id: { type: S.INTEGER, allowNull: true },
                    reason: { type: S.STRING, allowNull: false },
                    created_at: { type: S.DATE, allowNull: false },
                },
                { transaction }
            );
            await q.addIndex('task_context_history', ['task_id'], {
                transaction,
            });
            const d = q.sequelize.getDialect(),
                where = `project_id IS NOT NULL AND (${changed('tasks.area_id', '(SELECT area_id FROM projects WHERE id=tasks.project_id)', d)} OR ${changed('tasks.goal_id', '(SELECT goal_id FROM projects WHERE id=tasks.project_id)', d)})`;
            await q.sequelize.query(
                `INSERT INTO task_context_history(task_id,previous_project_id,area_id,goal_id,reason,created_at) SELECT id,project_id,area_id,goal_id,'initial_strict_context',CURRENT_TIMESTAMP FROM tasks WHERE ${where}`,
                { transaction }
            );
            await q.sequelize.query(
                `UPDATE tasks SET area_id=(SELECT area_id FROM projects WHERE id=tasks.project_id),goal_id=(SELECT goal_id FROM projects WHERE id=tasks.project_id) WHERE ${where}`,
                { transaction }
            );
            await install(q.sequelize, transaction);
        });
    },
    async down(q) {
        await q.sequelize.transaction(async (transaction) => {
            const run = (sql) => q.sequelize.query(sql, { transaction });
            if (q.sequelize.getDialect() === 'sqlite') {
                for (const name of [
                    'strict_task_context_insert',
                    'strict_task_context_update',
                    'strict_project_context_update',
                ])
                    await run(`DROP TRIGGER IF EXISTS ${name}`);
            } else {
                await run(
                    'DROP TRIGGER IF EXISTS strict_task_context ON tasks'
                );
                await run(
                    'DROP TRIGGER IF EXISTS strict_project_context ON projects'
                );
                await run('DROP FUNCTION IF EXISTS strict_task_context_fn()');
                await run(
                    'DROP FUNCTION IF EXISTS strict_project_context_fn()'
                );
            }
            await q.dropTable('task_context_history', { transaction });
        });
    },
};
