import json
import tempfile
import unittest
from unittest.mock import patch
import indexer
from pathlib import Path
from benchmarks import project_reports, metric_summary, batch_label
from indexer import ROOT


class BenchmarkEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tools/flint-traces')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def report(self, name, value):
        p = self.root / name
        p.write_text(json.dumps(value))
        return p, value, name

    def test_missing_score_never_zero_filled_and_errors_remain_visible(self):
        cases = [{'scores': {'quality': {'score': .8}}}, {'scores': {'quality': {'score': None, 'label': 'error'}}}, {'scores': {}}]
        self.assertEqual(metric_summary(cases, 'quality'), {'mean': .8, 'scored': 1, 'errors': 1, 'missing': 1})
        self.assertIsNone(metric_summary(cases[1:], 'quality')['mean'])

    def test_identical_report_copies_collapse_but_repeated_samples_remain(self):
        report = {'model': 'notorganic', 'suite': 'rewrite', 'cases': [{'case_id': 'a'}, {'case_id': 'a'}]}
        a = self.report('a.json', report)
        b = self.report('b.json', report)
        runs = project_reports([a, b], self.root)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]['sampleCount'], 2)
        self.assertEqual(runs[0]['caseCount'], 1)
        self.assertEqual(len(runs[0]['sources']), 2)
        self.assertNotEqual(runs[0]['cases'][0]['id'], runs[0]['cases'][1]['id'])

    def test_changed_routes_evaluators_and_runs_are_never_pooled(self):
        report = {'model': 'notorganic', 'suite': 'rewrite', 'judge': 'none', 'cases': [{'case_id': 'a', 'ok': False, 'scores': {}}]}
        other = dict(report, judge='reasoning', model='notorganic; research other')
        runs = project_reports([self.report('a.json', report), self.report('b.json', other)], self.root)
        self.assertEqual(len(runs), 2)
        self.assertNotEqual(runs[0]['evaluatorKey'], runs[1]['evaluatorKey'])
        self.assertIn('upstream model unrecorded', runs[0]['identity'])
        self.assertIsNone(runs[0]['cases'][0]['inputHash'])
        self.assertEqual(runs[0]['failed'], 1)
        self.assertEqual(runs[0]['metrics'], {})

    def test_case_id_is_not_prompt_equivalence_and_trace_link_is_exact(self):
        report = {'model': 'flint', 'suite': 'rewrite', 'cases': [{'case_id': 'same'}]}
        trace = {'id': 'wrong', 'variant': 'other', 'suite': 'rewrite', 'caseId': 'same'}
        run = project_reports([self.report('a.json', report)], self.root, [trace])[0]
        self.assertEqual(run['cases'][0]['traces'], [])
        self.assertIsNone(run['cases'][0]['inputHash'])

    def test_preflight_and_corrected_batch_labels_are_distinct(self):
        self.assertIn('preflight', batch_label(Path('flint-timeout-batch-20261025')))
        self.assertIn('600 s', batch_label(Path('flint-timeout-batch-20261025-r2')))
        self.assertNotEqual(batch_label(Path('flint-timeout-batch-20261025-r2')), batch_label(Path('flint-timeout-batch-20261025-r3')))

    def test_future_batches_discovered_without_merging_preflight(self):
        reports = self.root / 'reports'
        for name in ['flint-timeout-batch-20261025', 'flint-timeout-batch-20261025-r2', 'flint-timeout-batch-20261025-r3']:
            batch = reports / name
            req = batch / 'runs/rewrite/requests/001.request.json'
            req.parent.mkdir(parents=True)
            req.write_text(json.dumps({'original': {'messages': [{'role': 'user', 'content': 'same'}]}}))
            (batch / 'batch-state.json').write_text(json.dumps({'status': 'running', 'cases': {'rewrite': {'status': 'generating'}}}))
        with patch.multiple(indexer, ROOT=self.root, REPORTS=reports, OLD=reports/'missing-pilot', BATCH=reports/'flint-timeout-batch-20261025'):
            data = indexer.build_dataset()
        self.assertEqual(len(data['details']), 3)
        self.assertEqual(len({t['variant'] for t in data['details'].values()}), 3)
        self.assertEqual(sum(t['preflight'] for t in data['details'].values()), 1)
        self.assertEqual(len(data['index']['batches']), 3)

    def test_multiple_diagnostic_suites_from_one_file_keep_unique_run_identity(self):
        a = {'model': 'neuralwatt/test', 'suite': 'probe/a', 'cases': [{'case_id': 'x'}]}
        b = dict(a, suite='probe/b')
        path, _, label = self.report('robustness.json', a)
        runs = project_reports([(path,a,label),(path,b,label)], self.root)
        self.assertEqual(len({r['id'] for r in runs}), 2)

if __name__ == '__main__':
    unittest.main()
