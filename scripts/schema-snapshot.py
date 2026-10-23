"""Read-only SQLite schema export. Never selects application rows."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3


def snapshot(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        objects = [dict(zip(('type', 'name', 'table', 'sql'), row)) for row in db.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")]
        tables = {}
        for obj in objects:
            if obj['type'] != 'table':
                continue
            name = obj['name'].replace('"', '""')
            tables[obj['name']] = {
                'columns': [dict(zip(('cid', 'name', 'type', 'not_null', 'default', 'pk', 'hidden'), row)) for row in db.execute(f'PRAGMA table_xinfo("{name}")')],
                'foreign_keys': [dict(zip(('id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'), row)) for row in db.execute(f'PRAGMA foreign_key_list("{name}")')],
                'indexes': [dict(zip(('seq', 'name', 'unique', 'origin', 'partial'), row)) for row in db.execute(f'PRAGMA index_list("{name}")')],
            }
            for index in tables[obj['name']]['indexes']:
                index_name = index['name'].replace('"', '""')
                index['columns'] = [list(row) for row in db.execute(f'PRAGMA index_xinfo("{index_name}")')]
        return {'format': 1, 'dialect': 'sqlite', 'objects': objects, 'tables': tables}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database')
    parser.add_argument('output')
    args = parser.parse_args()
    data = snapshot(args.database)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'sqlite.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    lines = ['erDiagram']
    for name, table in data['tables'].items():
        lines.append('    ' + name + ' {')
        for col in table['columns']:
            lines.append('        ' + (col['type'].split('(')[0].replace(' ', '_') or 'unknown') + ' ' + col['name'])
        lines.append('    }')
        for fk in table['foreign_keys']:
            lines.append('    ' + fk['table'] + ' ||--o{ ' + name + ' : "' + fk['from'] + '"')
    (out / 'physical-erd.mmd').write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
