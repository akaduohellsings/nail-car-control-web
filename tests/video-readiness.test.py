import sys
import threading
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from robot_web_stack import verify_video_streams


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
        base=self.serve({'/stream?topic=%2Fcamera%2Fcolor%2Fimage_raw':frame*2,
                         '/stream?topic=%2Fdetected_image':frame*3})
        counts=verify_video_streams(base,timeout=1)
        self.assertGreaterEqual(counts['/camera/color/image_raw'],2)
        self.assertGreaterEqual(counts['/detected_image'],2)

    def test_open_http_service_without_frames_is_rejected(self):
        base=self.serve({'/stream?topic=%2Fdetected_image':b'--frame\r\n\xff\xd8unfinished'})
        with self.assertRaisesRegex(RuntimeError,'detected_image.*0/2'):
            verify_video_streams(base,topics=('/detected_image',),timeout=1)

    def test_wrong_endpoint_html_is_rejected(self):
        base=self.serve({},content_type='text/html')
        with self.assertRaisesRegex(RuntimeError,'Expected MJPEG'):
            verify_video_streams(base,topics=('/detected_image',),timeout=1)


if __name__=='__main__':unittest.main()
