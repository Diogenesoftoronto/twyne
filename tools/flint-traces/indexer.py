"""Read-only, source-bound projection of the Flint evaluation artifacts."""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime
from pathlib import Path
from benchmarks import discover, batch_label

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'reports'
OLD = REPORTS / 'flint-pilot-20261025'
BATCH = REPORTS / 'flint-timeout-batch-20261025'
CASE_IDS = {'rewrite': 'rewrite-oped-bloat-paragraph', 'interview': 'iv-early-minimal', 'room': 'room-oped-congestion'}


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def read_lines(path):
    rows, pending = [], False
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return rows, pending
    for line in lines:
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            pending = True
    return rows, pending


def stamp(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    except (AttributeError, ValueError):
        return None


def response_json(path):
    try:
        text = Path(path).read_text()
    except OSError:
        return None, None
    try:
        return json.loads(text), text
    except ValueError:
        # Preserve unsupported/incomplete streaming data without inventing a final answer.
        return None, text


def message_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(x.get('text', '') for x in content if isinstance(x, dict) and x.get('type') == 'text')
    return ''


def native_data(directory, sequence, events):
    if not directory:
        return None
    name = f'raw-eval-{sequence:06d}'
    dispatch = read_json(directory / f'{name}.dispatch.json')
    receipt = read_json(directory / f'{name}.receipt.json')
    relevant = [x for x in events if x.get('case_id') == name]
    if not dispatch and not receipt and not relevant:
        return None
    ticks = []
    for event in relevant:
        if event.get('event') != 'returned':
            continue
        channels = event.get('channels', [])
        ticks.append({'index': len(ticks), 'forwardId': event.get('decision_forward_id'),
                      'seconds': event.get('native_forward_elapsed_seconds'),
                      'emitted': event.get('emitted_ids', []), 'channels': channels})
    config = read_json(directory / 'service-config.json', {})
    return {'dispatch': dispatch, 'receipt': receipt, 'ticks': ticks,
            'limits': {'requestSeconds': config.get('request_seconds'),
                       'capacityTicks': config.get('max_cells', 0) // 4 if config.get('max_cells') else None,
                       'outputTicks': 256},
            'attempts': sum(x.get('event') == 'attempt' for x in relevant),
            'errors': [x for x in relevant if x.get('event') == 'error'],
            'rawEvents': relevant,
            'sameNonidle': sum(len(x['emitted']) == 2 and x['emitted'][0] == x['emitted'][1] != 150001 for x in ticks),
            'bothIdle': sum(x['emitted'] == [150001, 150001] for x in ticks)}


def classify(status, native, error, active, interrupted, answer):
    receipt = (native or {}).get('receipt') or {}
    if receipt.get('error_code'):
        code = receipt['error_code']
        return ('timeout', 'Model deadline') if receipt.get('error_message') == 'case_deadline' else ('model-error', code.replace('_', ' '))
    if status == 200:
        calls = answer.get('tool_calls') if isinstance(answer, dict) else None
        return ('tool', 'Tool call') if calls else ('answer', 'Answer returned')
    if status or error:
        return 'transport-error', 'Transport failure'
    if interrupted:
        return 'interrupted', 'Interrupted smoke run'
    if active:
        return ('running', 'Generating') if native else ('queued', 'Awaiting dispatch')
    return 'incomplete', 'No completion recorded'


def build_trace(path, variant, model, suite, native_dir=None, events=(), active=False, interrupted=False, diagnostic=None):
    record = read_json(path)
    if not isinstance(record, dict):
        return None
    sequence = int(path.name.split('.')[0]) if diagnostic is None else diagnostic['sequence']
    original = record.get('original', record)
    forwarded = record.get('forwarded', original)
    base = path.with_name(path.name.replace('.request.json', ''))
    receipt = read_json(str(base) + '.receipt.json', {}) if diagnostic is None else diagnostic['result']
    error = read_json(str(base) + '.error.json')
    body, raw_text = response_json(str(base) + ('.response.txt' if diagnostic is None else '.response.json'))
    if body is None and diagnostic:
        body = diagnostic['result'].get('body')
    answer = ((body.get('choices') or [{}])[0].get('message') or {}) if isinstance(body, dict) else {}
    native = native_data(native_dir, sequence, events)
    started = record.get('received')
    if started is None and native and native.get('dispatch'):
        started = native['dispatch'].get('dispatched_at_epoch', 0) * 1000
    duration = receipt.get('upstreamMs')
    if duration is None and diagnostic:
        duration = diagnostic['result'].get('elapsed_seconds', 0) * 1000
    if duration is None and native and native.get('receipt'):
        duration = native['receipt'].get('elapsed_seconds', 0) * 1000
    status = receipt.get('status')
    kind, label = classify(status, native, error, active, interrupted, answer)
    relative = str(path.relative_to(ROOT))
    ident = hashlib.sha256(relative.encode()).hexdigest()[:18]
    messages = original.get('messages', [])
    text = message_text(answer.get('content'))
    tool_calls = answer.get('tool_calls', [])
    case_id = diagnostic['case_id'] if diagnostic else CASE_IDS.get(suite, 'unassigned')
    detail = {'id': ident, 'variant': variant, 'model': model, 'suite': suite, 'caseId': case_id,
              'sequence': sequence, 'status': kind, 'statusLabel': label, 'httpStatus': status,
              'started': started, 'durationMs': duration, 'queueMs': receipt.get('queueMs'),
              'source': relative, 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'inputHash': hashlib.sha256(json.dumps(messages, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest(),
              'original': original, 'forwarded': forwarded, 'changes': record.get('changes', []),
              'response': body, 'rawResponse': raw_text, 'answer': text, 'toolCalls': tool_calls,
              'reasoning': answer.get('reasoning_content') or answer.get('reasoning') or '',
              'usage': body.get('usage') if isinstance(body, dict) else None,
              'finishReason': (body.get('choices') or [{}])[0].get('finish_reason') if isinstance(body, dict) else None,
              'transportReceipt': receipt, 'transportError': error, 'native': native,
              'dispatched': bool(native) if model == 'trained' else status == 200,
              'diagnostic': diagnostic is not None,
              'search': '\n'.join([variant, model, suite, case_id, label, text] + [message_text(m.get('content')) for m in messages]).lower()}
    return detail


def legacy_suite(phase, request, sequence):
    reports = sorted((read_json(p, {}) for p in (phase / 'reports').glob('*.json')), key=lambda r: r.get('startedAt', ''))
    if not reports:
        return 'unassigned'
    received = request.get('received', 0)
    selected = reports[0]
    for report in reports:
        if (stamp(report.get('startedAt')) or 0) <= received:
            selected = report
    if phase.name == 'stock' and sequence >= 3:
        return 'room'
    return selected.get('suite', 'unassigned')


def build_dataset():
    details = {}
    batch = read_json(BATCH / 'batch-state.json', {'status': 'not_started', 'cases': {}})
    phases = [('trained', 'Trained · 2 min', 'trained', OLD / 'final-remote/trained-receipts'),
              ('stock-reviewed', 'Stock · reviewed', 'stock', None),
              ('stock', 'Stock · serial smoke', 'stock', None)]
    for phase_name, variant, model, native_dir in phases:
        phase = OLD / phase_name
        events, pending = read_lines(native_dir / 'forwards.jsonl') if native_dir else ([], False)
        for path in sorted((phase / 'requests').glob('*.request.json')):
            request = read_json(path, {})
            suite = legacy_suite(phase, request, int(path.name.split('.')[0]))
            trace = build_trace(path, variant, model, suite, native_dir, events, interrupted=phase_name == 'stock' and (phase / 'interruption.json').exists())
            if trace:
                details[trace['id']] = trace
    native_dir = OLD / 'final-remote/trained-diagnostic-receipts'
    events, _ = read_lines(native_dir / 'forwards.jsonl')
    for sequence, case in enumerate(['short-rewrite-no-tools', 'short-editorial-feedback-no-tools'], 1):
        path = OLD / 'trained-diagnostic' / f'{case}.request.json'
        result = read_json(path.with_name(f'{case}.result.json'), {})
        if path.exists():
            trace = build_trace(path, 'Trained · short diagnostics', 'trained', 'diagnostic', native_dir, events,
                                diagnostic={'sequence': sequence, 'result': result, 'case_id': case})
            details[trace['id']] = trace
    batches = []
    for batch_dir in sorted(REPORTS.glob('flint-timeout-batch-*')):
        current = read_json(batch_dir / 'batch-state.json', {'status': 'not_started', 'cases': {}})
        current = dict(current, source=str((batch_dir / 'batch-state.json').relative_to(ROOT)), label=batch_label(batch_dir))
        batches.append(current)
        for suite in ['rewrite', 'interview', 'room']:
            native_dir = batch_dir / 'remote' / suite / 'receipts'
            events, pending = read_lines(native_dir / 'forwards.jsonl')
            active = current.get('cases', {}).get(suite, {}).get('status') in ['loading', 'generating'] and current.get('status') != 'failed'
            for path in sorted((batch_dir / 'runs' / suite / 'requests').glob('*.request.json')):
                trace = build_trace(path, batch_label(batch_dir), 'trained', suite, native_dir, events, active=active)
                if trace:
                    trace['preflight'] = batch_dir == BATCH
                    if trace['native']:
                        trace['native']['snapshotMayHavePartialLine'] = pending
                    details[trace['id']] = trace
    batch = batches[-1] if batches else batch
    rows = []
    for trace in details.values():
        row = {k: trace[k] for k in ['id', 'variant', 'model', 'suite', 'caseId', 'sequence', 'status', 'statusLabel', 'httpStatus', 'started', 'durationMs', 'source', 'inputHash', 'dispatched', 'diagnostic']}
        row['preview'] = trace['answer'][:180] or trace['statusLabel']
        row['ticks'] = len(trace['native']['ticks']) if trace['native'] else None
        row['search'] = trace['search']
        rows.append(row)
    rows.sort(key=lambda x: (x['variant'] == 'Trained · 10 min', x['started'] or 0, x['sequence']), reverse=True)
    reports = []
    for p in (OLD / 'stock-reviewed/reports').glob('*.json'):
        r = read_json(p, {})
        reports.append({'variant': 'Stock · reviewed', 'suite': r.get('suite'), 'cases': r.get('cases', []), 'source': str(p.relative_to(ROOT))})
    for batch_dir in sorted(REPORTS.glob('flint-timeout-batch-*')):
        for p in (batch_dir / 'runs').glob('*/report.json'):
            r = read_json(p, {})
            reports.append({'variant': batch_label(batch_dir), 'suite': r.get('suite'), 'cases': r.get('cases', []), 'source': str(p.relative_to(ROOT))})
    index = {'version': 2, 'generatedAt': time.time() * 1000, 'rows': rows, 'batch': batch,
             'reports': reports, 'batches': batches, 'benchmarks': discover(ROOT, details.values()), 'previousAssessment': read_json(OLD / 'assessment.json', {}),
             'tokenText': {'150001': 'Idle', '5482': '{"', '19964': 'arguments', '16142': '":{"'},
             'sourceCount': len(rows)}
    return {'index': index, 'details': details}
