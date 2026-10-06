import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('mlu', Path(__file__).resolve().parents[1] / 'migrate-legacy-user.py')
mlu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mlu)


class StatementsTest(unittest.TestCase):
    def test_poradi_a_parametry(self):
        st = mlu.statements('jindra', 'g:42')
        sqls = [s for s, _ in st]
        # duplicitní vlaječky nového účtu pryč dřív, než se přejmenují staré (PK id = user:instrument)
        self.assertLess(next(i for i, s in enumerate(sqls) if s.startswith('DELETE FROM watch_flags')),
                        next(i for i, s in enumerate(sqls) if s.startswith('UPDATE watch_flags')))
        # totéž pro progress (PK id = user:lesson)
        self.assertLess(next(i for i, s in enumerate(sqls) if s.startswith('DELETE FROM progress')),
                        next(i for i, s in enumerate(sqls) if s.startswith('UPDATE progress')))
        self.assertNotIn(('UPDATE progress SET user_id=%s WHERE user_id=%s', ('g:42', 'jindra')), st)
        self.assertIn(("UPDATE progress SET id=CONCAT(%s,':',lesson_id), user_id=%s WHERE user_id=%s", ('g:42', 'g:42', 'jindra')), st)
        self.assertTrue(sqls[-1].startswith('DELETE FROM members'))
        for table in ('trades', 'messages'):
            self.assertIn((f'UPDATE {table} SET user_id=%s WHERE user_id=%s', ('g:42', 'jindra')), st)
        self.assertIn(('DELETE FROM members WHERE id=%s', ('jindra',)), st)

    def test_odmitne_stejne_id(self):
        with self.assertRaises(ValueError):
            mlu.statements('jindra', 'jindra')


if __name__ == '__main__':
    unittest.main()
