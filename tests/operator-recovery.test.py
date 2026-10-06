import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import MagicMock,patch
from http.server import ThreadingHTTPServer

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from operator_recovery import OperatorRecovery
from serve_web import make_handler


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        (self.root/'config').mkdir();(self.root/'tools').mkdir()
        (self.root/'config/web_navigation_operator.json').write_text(json.dumps({'host':'192.168.137.2'}))
        (self.root/'tools/web_navigation_operator.py').touch()
        self.recovery=OperatorRecovery(self.root)
    def tearDown(self):self.temp.cleanup()

    def test_requires_explicit_origin_and_matching_host(self):
        for data in [{},{'confirmed_origin':True,'expected_host':'192.168.55.1'}]:
            with self.assertRaises(ValueError):self.recovery.start(data)
        self.assertEqual(self.recovery.snapshot()['status'],'idle')

    def test_online_service_cannot_be_reinitialized(self):
        opener=MagicMock();opener.open.return_value.__enter__.return_value=io.BytesIO(b'{"connection":"ONLINE"}')
        with patch('operator_recovery.urllib.request.build_opener',return_value=opener):
            with self.assertRaisesRegex(ValueError,'仍在线'):
                self.recovery.start({'confirmed_origin':True,'expected_host':'192.168.137.2'})

    def test_offline_start_is_single_flight(self):
        opener=MagicMock();opener.open.side_effect=OSError('offline')
        with patch('operator_recovery.urllib.request.build_opener',return_value=opener),patch('operator_recovery.threading.Thread'):
            result=self.recovery.start({'confirmed_origin':True,'expected_host':'192.168.137.2'})
            self.assertEqual(result['status'],'starting')
            with self.assertRaisesRegex(ValueError,'正在启动'):
                self.recovery.start({'confirmed_origin':True,'expected_host':'192.168.137.2'})

    def test_worker_only_starts_services_never_a_goal(self):
        result=MagicMock(returncode=0)
        with patch('operator_recovery.subprocess.run',return_value=result) as run:
            self.recovery.run()
        command=run.call_args.args[0]
        self.assertEqual(command[-3:],['start','--origin-confirmed','--no-browser'])
        self.assertEqual(self.recovery.snapshot()['status'],'ready')

    def test_http_requires_same_origin_and_host(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(0,recovery=self.recovery))
        # Build origins using the actual ephemeral port.
        server.RequestHandlerClass=make_handler(server.server_port,recovery=self.recovery)
        thread=threading.Thread(target=server.serve_forever);thread.start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/api/operator/restart'
            for origin in (None,'http://untrusted.example'):
                headers={'Content-Type':'application/json'}
                if origin:headers['Origin']=origin
                req=urllib.request.Request(url,data=b'{}',headers=headers)
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
                self.assertEqual(error.exception.code,403)
        finally:server.shutdown();thread.join();server.server_close()


if __name__=='__main__':unittest.main()
