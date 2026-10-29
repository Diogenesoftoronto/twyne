"""Loopback-only trace viewer. Serves only explicit assets and trace projections."""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from indexer import build_dataset, OLD

HERE = Path(__file__).resolve().parent
cache, updated = None, 0
lock = threading.Lock()


def dataset():
    global cache, updated
    with lock:
        if cache is None or time.time() - updated > 2:
            cache = build_dataset()
            updated = time.time()
        return cache


def snapshot(data=None):
    data = data or dataset()
    encoded = base64.b64encode(gzip.compress(json.dumps(data, ensure_ascii=False).encode())).decode()
    html = (HERE / 'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">', '<style>' + (HERE / 'style.css').read_text() + '</style>')
    return html.replace('<script src="/app.js" defer></script>', '<script>window.TRACE_DATA_B64=' + json.dumps(encoded) + ';</script><script>' + (HERE / 'app.js').read_text() + '</script>')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, mime, download=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if download:
            self.send_header('Content-Disposition', f'attachment; filename="{download}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/favicon.ico':
            return self.send(204, b'', 'image/x-icon')
        if path in ['/', '/index.html', '/app.js', '/style.css']:
            name = 'index.html' if path == '/' else path[1:]
            mime = {'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8'}[name]
            return self.send(200, (HERE / name).read_bytes(), mime)
        if path == '/api/index':
            return self.send(200, json.dumps(dataset()['index'], ensure_ascii=False), 'application/json')
        if path.startswith('/api/trace/'):
            ident = path[len('/api/trace/'):]
            trace = dataset()['details'].get(ident)
            if trace is None:
                return self.send(404, '{"error":"Trace not found"}', 'application/json')
            return self.send(200, json.dumps(trace, ensure_ascii=False), 'application/json')
        if path == '/snapshot.html':
            return self.send(200, snapshot(), 'text/html; charset=utf-8', 'flint-trace-explorer.html')
        if path == '/report':
            return self.send(200, (OLD / 'report.html').read_bytes(), 'text/html; charset=utf-8')
        return self.send(404, 'Not found', 'text/plain')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8879)
    parser.add_argument('--export', type=Path)
    args = parser.parse_args()
    if args.export:
        args.export.write_text(snapshot())
        print(args.export)
    else:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        print(f'Trace explorer: http://127.0.0.1:{args.port}', flush=True)
        server.serve_forever()
