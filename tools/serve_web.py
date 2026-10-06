"""Local static website, optionally with the existing hardware-free simulator."""
import argparse
import json
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def make_handler(port, runtime=None, recovery=None):
    origins = {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def respond(self, code, data):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?', 1)[0]
            if recovery is not None and path == '/api/operator/connection':
                try:self.respond(200,recovery.connection_settings())
                except (ValueError,KeyError,OSError) as error:self.respond(400,{'error':str(error)})
            elif recovery is not None and path == '/api/operator/status':
                self.respond(200,recovery.snapshot())
            elif runtime is not None and path == '/api/v1/status':
                self.respond(200, runtime.snapshot())
            elif runtime is not None and path == '/events':
                self.respond(200, {'detected': False, 'count': 0, 'message': '本地模拟：未注入钉子',
                                   'observed_at_ros_ns': str(time.time_ns())})
            else:
                super().do_GET()

        def do_POST(self):
            if recovery is not None and self.path=='/api/operator/restart':
                if (self.client_address[0] not in ('127.0.0.1','::1')
                        or self.headers.get('Origin') not in origins
                        or 'http://'+self.headers.get('Host','') not in origins):
                    self.respond(403,{'error':'只允许电脑本地网页操作。'});return
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=2048 or self.headers.get('Content-Type','').split(';')[0]!='application/json':
                        raise ValueError('请求格式错误。')
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict):raise ValueError('请求格式错误。')
                    self.respond(202,recovery.start(data))
                except (ValueError,TypeError,KeyError) as error:
                    self.respond(400,{'error':str(error)})
                return
            if runtime is None:
                self.respond(405, {'error': 'static_website_only'})
                return
            if self.headers.get('Origin') not in origins | {None}:
                self.respond(403, {'error': 'origin_rejected'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('INVALID_BODY_SIZE')
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('JSON_REQUIRED')
                def invalid_number(_):
                    raise ValueError('NON_FINITE_NUMBER')
                data = json.loads(self.rfile.read(length), parse_constant=invalid_number)
                if not isinstance(data, dict):
                    raise ValueError('OBJECT_REQUIRED')
                if self.path == '/api/v1/command':
                    result = runtime.command(data)
                    code = 409 if result['status'] == 'rejected' else 202 if result['status'] == 'pending' else 200
                elif self.path == '/api/v1/heartbeat':
                    with runtime.lock:
                        runtime.coordinator.heartbeat(data, time.monotonic())
                    result, code = {'schema_version': 1, 'status': 'accepted'}, 200
                else:
                    self.respond(404, {'error': 'not_found'})
                    return
                self.respond(code, result)
            except (ValueError, TypeError, KeyError) as error:
                self.respond(400, {'error': str(error)})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--simulate', action='store_true')
    parser.add_argument('--operator-project',type=Path,default=ROOT.parent/'小车')
    parser.add_argument('--simulation-project', type=Path, default=ROOT.parent / '小车')
    args = parser.parse_args()
    runtime = None
    stopping = threading.Event()
    worker = None
    if args.simulate:
        source = args.simulation_project / 'tools' / 'local_navigation_control.py'
        if not source.is_file():
            parser.error('Local simulator not found. Use --simulation-project with the 小车 project path.')
        sys.path.insert(0, str(source.parent))
        import local_navigation_control as simulator
        (ROOT / '.local').mkdir(exist_ok=True)
        simulator.TRACE = ROOT / '.local' / 'simulation_trace.jsonl'
        runtime = simulator.Runtime()
        def tick():
            while not stopping.wait(0.05):
                runtime.step(time.monotonic())
        worker = threading.Thread(target=tick, daemon=True)
    try:
        from operator_recovery import OperatorRecovery
        recovery=OperatorRecovery(args.operator_project) if not args.simulate and (args.operator_project/'tools/web_navigation_operator.py').is_file() else None
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(args.port, runtime,recovery))
    except OSError as error:
        parser.error(f'Cannot open port {args.port}: {error}. Close the old web server or use --port.')
    if worker:
        worker.start()
    address = f'http://localhost:{args.port}/index.html' + ('?simulation=1' if runtime else '')
    print(address, flush=True)
    print('LOCAL SIMULATION ONLY' if runtime else 'Website only; robot services must be started separately.', flush=True)
    if args.open:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        if worker:
            worker.join(timeout=2)
            with runtime.lock:
                runtime.coordinator.backend.halt(time.monotonic())
        server.server_close()


if __name__ == '__main__':
    main()
