"""Saved harness evidence. Never infer provider identity or reconstruct prompts."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def metric_summary(cases, metric):
    values, errors, missing = [], 0, 0
    for case in cases:
        score = case.get('scores', {}).get(metric, {})
        value = score.get('score') if isinstance(score, dict) else score
        if number(value):
            values.append(value)
        elif isinstance(score, dict) and (score.get('error') or 'error' in str(score.get('label', '')).lower() or score.get('itemErrors')):
            errors += 1
        else:
            missing += 1
    return {'mean': sum(values) / len(values) if values else None, 'scored': len(values), 'missing': missing, 'errors': errors}


def project_reports(entries, root, traces=()):
    """Collapse identical report copies only; repeats inside a report remain samples."""
    runs, copies = [], {}
    for path, report, label in entries:
        if not isinstance(report, dict) or not isinstance(report.get('cases'), list):
            continue
        fingerprint = digest(report)
        source = str(path.relative_to(root))
        if fingerprint in copies:
            copies[fingerprint]['sources'].append(source)
            copies[fingerprint]['sourceFiles'].append({'path': source, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            continue
        run_id = digest([source, report.get('suite')])[:18]
        model = report.get('model') or 'Identity unrecorded'
        cases = []
        for i, original in enumerate(report['cases']):
            if not isinstance(original, dict) or not original.get('case_id'):
                continue
            case = dict(original)
            case.update(id=f'{run_id}-{i}', sample=i+1, runId=run_id, savedCase=original)
            # A hash is evidence only when saved with the executed case. Current fixtures are not historical proof.
            case['inputHash'] = original.get('inputHash') or original.get('promptHash')
            case['traces'] = [t['id'] for t in traces if t['variant'] == label and t['suite'] == report.get('suite') and t['caseId'] == case['case_id']]
            linked = sorted((t for t in traces if t['id'] in case['traces']), key=lambda t: t.get('sequence', 0))
            case['firstRequestHash'] = linked[0].get('inputHash') if linked else None
            cases.append(case)
        keys = sorted({key for c in cases for key in c.get('scores', {})})
        evaluator = {k: report.get(k) for k in ('judge', 'jev', 'evaluatorVersion', 'fixtureVersion', 'promptVersion')}
        run = {'id': run_id, 'model': model, 'label': label or report.get('experiment') or path.stem,
               'suite': report.get('suite', 'unrecorded'), 'date': report.get('startedAt'),
               'identity': 'Saved model identifier' if model.startswith('neuralwatt/') else 'Recorded route; upstream model unrecorded' if 'notorganic' in model else 'Recorded serving configuration' if 'flint' in model.lower() or 'trained-step' in model else 'Identity unrecorded',
               'sources': [source], 'sourceFiles': [{'path': source, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}], 'sha256': fingerprint, 'fileSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
               'config': {k: v for k, v in report.items() if k != 'cases'}, 'evaluator': evaluator,
               'evaluatorKey': digest(evaluator), 'evaluatorVersionRecorded': bool(report.get('evaluatorVersion')),
               'cases': cases, 'metrics': {key: metric_summary(cases, key) for key in keys},
               'caseCount': len({c['case_id'] for c in cases}), 'sampleCount': len(cases),
               'success': sum(c.get('ok') is True for c in cases), 'failed': sum(c.get('ok') is False for c in cases),
               'unknown': sum(c.get('ok') not in (True, False) for c in cases),
               'preflight': path.parts[-4:-3] == ('flint-timeout-batch-20261025',) or 'flint-timeout-batch-20261025/' in source,
               'mock': 'mock' in model.lower()}
        copies[fingerprint] = run
        runs.append(run)
    return sorted(runs, key=lambda r: (r['date'] or '', r['label']), reverse=True)


def discover(root, traces):
    entries, omitted, supplements = [], [], []
    for path in sorted((root / 'reports').rglob('*.json')):
        if 'flint-trace-explorer' in path.parts:
            continue
        try:
            report = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(report, dict) and isinstance(report.get('cases'), list):
            if report.get('sourceReport') and report.get('sourceReportSha256'):
                supplements.append({'source': str(path.relative_to(root)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'report': report})
            if not report.get('suite'):
                omitted.append({'source': str(path.relative_to(root)), 'reason': 'Supplemental result without suite/model; retained in source artifacts, not counted as a new run.'})
                continue
            label = report.get('experiment') or path.parent.parent.name + ' / ' + report['suite']
            src = str(path.relative_to(root))
            if '/stock-reviewed/reports/' in src: label = 'Stock · reviewed'
            elif '/stock/reports/' in src: label = 'Stock · serial smoke'
            elif '/trained/reports/' in src: label = 'Trained · 2 min'
            elif 'flint-timeout-batch-' in src: label = batch_label(path.parents[2])
            entries.append((path, report, label))
    # This older diagnostic records a concrete model. Keep each probe as its own suite.
    path = root / 'evals/robustness-scores.json'
    try:
        report = json.loads(path.read_text())
        for probe, body in report.get('probes', {}).items():
            rows = body.get('cases', []) if isinstance(body, dict) else []
            if rows:
                cases = [dict(c, scores={'agreement': {'score': c.get('agreement')}}, output=json.dumps(c, ensure_ascii=False)) for c in rows if isinstance(c, dict)]
                entries.append((path, {'model': report.get('model'), 'suite': 'robustness/' + probe, 'cases': cases, 'probe': body, 'judge': 'unrecorded'}, 'Legacy robustness / ' + probe))
    except (OSError, ValueError): pass
    runs = project_reports(entries, root, traces)
    for run in runs:
        run['supplements'] = [s for s in supplements if s['report'].get('sourceReport') in run['sources'] and s['report'].get('sourceReportSha256') == run['fileSha256']]
    return {'runs': runs, 'omitted': omitted, 'policy': 'Each row is one saved run and suite. Identical report copies collapse; repeated cases remain samples. No overall ranking. Evaluator and historical fixture versions may be unrecorded.'}


def batch_label(path):
    return 'Trained · transport preflight (360 s abort)' if path.name == 'flint-timeout-batch-20261025' else 'Trained · 600 s · ' + path.name.removeprefix('flint-timeout-batch-')
