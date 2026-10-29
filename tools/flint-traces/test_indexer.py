import json
import tempfile
import unittest
from pathlib import Path

from indexer import ROOT, build_trace, classify, native_data, read_lines


class EvidenceProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'tools/flint-traces')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def request(self, phase):
        p = self.root / phase / '001.request.json'
        p.parent.mkdir()
        p.write_text(json.dumps({'received': 1000, 'original': {'model': 'flint', 'temperature': .4, 'messages': [{'role': 'user', 'content': 'Keep this exact text.'}]}, 'forwarded': {'model': 'flint', 'temperature': 0, 'messages': [{'role': 'user', 'content': 'Keep this exact text.'}]}, 'changes': [{'parameter': 'temperature', 'from': .4, 'to': 0}]}))
        return p

    def test_closed_worker_retry_is_not_a_model_evaluation(self):
        p = self.request('retry')
        (p.parent / '001.receipt.json').write_text(json.dumps({'status': 503, 'upstreamMs': 4}))
        trace = build_trace(p, 'Trained', 'trained', 'rewrite')
        self.assertFalse(trace['dispatched'])
        self.assertIsNone(trace['native'])
        self.assertEqual(trace['status'], 'transport-error')
        self.assertNotIn('quality', trace)

    def test_overrides_do_not_rewrite_original_context(self):
        p = self.request('context')
        trace = build_trace(p, 'Trained', 'trained', 'rewrite')
        self.assertEqual(trace['original']['temperature'], .4)
        self.assertEqual(trace['forwarded']['temperature'], 0)
        self.assertEqual(trace['original']['messages'], trace['forwarded']['messages'])
        self.assertEqual(trace['changes'][0]['parameter'], 'temperature')

    def test_same_sequence_in_different_runs_keeps_distinct_identity(self):
        a = build_trace(self.request('run-a'), 'A', 'trained', 'rewrite')
        b = build_trace(self.request('run-b'), 'B', 'trained', 'rewrite')
        self.assertNotEqual(a['id'], b['id'])
        self.assertEqual(a['inputHash'], b['inputHash'])

    def test_incomplete_telemetry_line_never_becomes_a_returned_tick(self):
        p = self.root / 'forwards.jsonl'
        event = {'event': 'returned', 'case_id': 'raw-eval-000001', 'emitted_ids': [150001, 150001], 'channels': [], 'native_forward_elapsed_seconds': .2}
        p.write_text(json.dumps(event) + '\n{"event":"returned"')
        events, pending = read_lines(p)
        native = native_data(self.root, 1, events)
        self.assertTrue(pending)
        self.assertEqual(len(native['ticks']), 1)
        self.assertEqual(native['bothIdle'], 1)
        self.assertEqual(native['sameNonidle'], 0)

    def test_deadline_is_a_generation_failure_not_a_completed_answer(self):
        native = {'receipt': {'error_code': 'terminal_runtime_failure', 'error_message': 'case_deadline'}}
        kind, _ = classify(503, native, None, False, False, {})
        self.assertEqual(kind, 'timeout')
        kind, _ = classify(422, {'receipt': {'error_code': 'generated_empty_turn'}}, None, False, False, {})
        self.assertEqual(kind, 'model-error')


if __name__ == '__main__':
    unittest.main()
