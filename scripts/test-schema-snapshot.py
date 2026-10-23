import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).with_name('schema-snapshot.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SchemaSafety(unittest.TestCase):
    def test_rows_are_excluded_and_database_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'synthetic.sqlite'
            with closing(sqlite3.connect(path)) as db:
                db.executescript('CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id), content TEXT DEFAULT NULL); CREATE INDEX child_parent ON children(parent_id); CREATE TRIGGER preserve_row AFTER INSERT ON parents BEGIN SELECT 1; END;')
                db.execute('INSERT INTO children(content) VALUES (?)', ('PRIVATE_SENTINEL_NEVER_EXPORT',))
                db.commit()
            before = path.read_bytes()
            result = module.snapshot(path)
            self.assertNotIn('PRIVATE_SENTINEL', str(result))
            self.assertEqual(result, module.snapshot(path))
            self.assertEqual(before, path.read_bytes())
            self.assertEqual(result['tables']['children']['foreign_keys'][0]['table'], 'parents')
            self.assertTrue(any(obj['type'] == 'trigger' for obj in result['objects']))


if __name__ == '__main__':
    unittest.main()
