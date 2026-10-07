import sys
import threading
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from robot_web_stack import verify_video_streams,video_stream_url


class VideoReadinessTests(unittest.TestCase):
    def serve(self, bodies, content_type='multipart/x-mixed-replace; boundary=frame'):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body=bodies.get(self.path,b'no frames')
                self.send_response(200);self.send_header('Content-Type',content_type)
                self.send_header('Content-Length',str(len(body)));self.end_headers()
                self.wfile.write(body)
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever);thread.start()
        def close():server.shutdown();thread.join();server.server_close()
        self.addCleanup(close)
        return f'http://127.0.0.1:{server.server_port}'

    def test_both_topics_require_complete_jpegs(self):
        frame=b'--frame\r\n\xff\xd8data\xff\xd9\r\n'
        # Installed server query values are not percent-decoded.
        base=self.serve({'/stream?topic=/camera/color/image_raw':frame*2,
                         '/stream?topic=/detected_image':frame*3})
        counts=verify_video_streams(base,timeout=1)
        self.assertGreaterEqual(counts['/camera/color/image_raw'],2)
        self.assertGreaterEqual(counts['/detected_image'],2)

    def test_open_http_service_without_frames_is_rejected(self):
        base=self.serve({'/stream?topic=/detected_image':b'--frame\r\n\xff\xd8unfinished'})
        with self.assertRaisesRegex(RuntimeError,'detected_image.*0/2'):
            verify_video_streams(base,topics=('/detected_image',),timeout=1)

    def test_wrong_endpoint_html_is_rejected(self):
        base=self.serve({},content_type='text/html')
        with self.assertRaisesRegex(RuntimeError,'Expected MJPEG'):
            verify_video_streams(base,topics=('/detected_image',),timeout=1)

    def test_legacy_topic_slashes_stay_literal_and_query_injection_is_rejected(self):
        self.assertEqual(video_stream_url('http://robot:8080/','/camera/color/image_raw'),
                         'http://robot:8080/stream?topic=/camera/color/image_raw')
        for topic in ('/raw&topic=/other','/raw?type=png','%2Fraw','/raw\r\n','raw'):
            with self.assertRaises(ValueError):video_stream_url('http://robot:8080',topic)

    def test_reconnects_when_topic_discovery_closes_first_stream(self):
        from unittest.mock import patch
        import io
        from email.message import Message
        frame=b'--frame\r\n\xff\xd8data\xff\xd9\r\n'
        responses=[]
        for body in (b'',frame*2):
            response=io.BytesIO(body);response.headers=Message()
            response.headers['Content-Type']='multipart/x-mixed-replace; boundary=frame'
            responses.append(response)
        from robot_web_stack import urllib
        with patch.object(urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=responses
            result=verify_video_streams(topics=('/detected_image',),timeout=1)
            self.assertEqual(result['/detected_image'],2)
            self.assertEqual(opener.return_value.open.call_count,2)

    def test_single_frames_across_reconnections_do_not_satisfy_two_frame_gate(self):
        frame=b'--frame\r\n\xff\xd8data\xff\xd9\r\n'
        base=self.serve({'/stream?topic=/detected_image':frame})
        with self.assertRaisesRegex(RuntimeError,'detected_image.*1/2'):
            verify_video_streams(base,topics=('/detected_image',),timeout=.4)

    def test_reconnects_after_connection_error_but_does_not_retry_service_failure(self):
        from unittest.mock import patch,Mock
        import io
        from email.message import Message
        from robot_web_stack import urllib
        frame=b'--frame\r\n\xff\xd8data\xff\xd9\r\n'
        response=io.BytesIO(frame*2);response.headers=Message()
        response.headers['Content-Type']='multipart/x-mixed-replace; boundary=frame'
        with patch.object(urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=[OSError('early connection closed'),response]
            self.assertEqual(verify_video_streams(topics=('/detected_image',),timeout=1)['/detected_image'],2)
        with patch.object(urllib.request,'build_opener') as opener:
            check=Mock(side_effect=RuntimeError('yolo exited'))
            with self.assertRaisesRegex(RuntimeError,'yolo exited'):
                verify_video_streams(topics=('/detected_image',),timeout=1,check=check)
            opener.return_value.open.assert_not_called()


if __name__=='__main__':unittest.main()
