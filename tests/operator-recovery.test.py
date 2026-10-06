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
        self.probe=patch.object(self.recovery,'online_status',return_value=None)
        self.probe_mock=self.probe.start()
        self.addCleanup(self.probe.stop)
    def tearDown(self):self.temp.cleanup()

    def test_connection_settings_are_local_only_and_do_not_expose_credentials(self):
        with patch('operator_recovery.subprocess.run') as run:
            data=self.recovery.connection_settings()
            self.assertEqual(data['videoUrl'],'http://192.168.137.2:8080')
            self.assertEqual(data['navigationUrl'],'http://192.168.137.2:8092')
            self.assertEqual(len(data),6)
            run.assert_not_called();self.probe_mock.assert_not_called()
        for host in ['192.168.55.1','::1','[::1]']:
            (self.root/'config/web_navigation_operator.json').write_text(json.dumps({'host':host,'navigation_port':8093}))
            self.assertEqual(self.recovery.connection_settings()['navigationUrl'],
                'http://'+('192.168.55.1' if host=='192.168.55.1' else '[::1]')+':8093')
        for config in [{'host':'http://robot'},{'host':'robot:8080'},{'host':'robot','navigation_port':True},{'host':'robot','navigation_port':70000}]:
            (self.root/'config/web_navigation_operator.json').write_text(json.dumps(config))
            with self.assertRaises(ValueError):self.recovery.connection_settings()

    def test_http_connection_endpoint_reads_config_without_robot_probe(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(0,recovery=self.recovery))
        thread=threading.Thread(target=server.serve_forever);thread.start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/operator/connection') as response:
                self.assertEqual(json.load(response)['videoUrl'],'http://192.168.137.2:8080')
            self.probe_mock.assert_not_called()
        finally:server.shutdown();thread.join();server.server_close()

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
        self.assertEqual(self.recovery.state['status'],'ready')

    def test_live_service_supersedes_old_failure_without_starting_anything(self):
        self.recovery.state={'status':'failed','message':'old failed report'}
        self.probe_mock.return_value={'connection':'ONLINE','read_only':False,
            'control':{'phase':'READY','localization_valid':True},
            'mission':{'stationary_confirmed':True,'action_server_ready':True}}
        with patch('operator_recovery.subprocess.run') as run:
            self.assertEqual(self.recovery.snapshot()['status'],'ready')
            run.assert_not_called()
        self.assertEqual(self.recovery.state['message'],'old failed report')
        self.probe_mock.return_value['control']['phase']='NAVIGATING'
        self.assertEqual(self.recovery.snapshot()['status'],'online')

    def test_offline_does_not_keep_previous_ready_and_starting_is_not_overridden(self):
        self.recovery.state={'status':'ready','message':'old ready'}
        self.assertEqual(self.recovery.snapshot()['status'],'offline')
        self.recovery.state={'status':'starting','message':'validating'}
        self.probe_mock.reset_mock()
        self.assertEqual(self.recovery.snapshot()['status'],'starting')
        self.probe_mock.assert_not_called()

    def test_probe_rejects_invalid_or_offline_responses(self):
        self.probe.stop()
        for body in (b'{',b'[]',b'{"connection":"OFFLINE"}'):
            opener=MagicMock();opener.open.return_value.__enter__.return_value=io.BytesIO(body)
            with patch('operator_recovery.urllib.request.build_opener',return_value=opener):
                self.assertIsNone(self.recovery.online_status({'host':'192.168.137.2'}))

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
