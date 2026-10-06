import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('stack',Path(__file__).resolve().parents[1]/'tools/robot_web_stack.py')
stack=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stack)


class ReadinessTests(unittest.TestCase):
    def sample(self, gate, now=100):
        for i in range(3):
            for kind in ('camera','detections'):
                gate.observe(kind,now-1+i*.1,now)
            gate.observe('annotated',0,now)

    def test_unstamped_annotations_require_fresh_camera_and_detection_messages(self):
        gate=stack.VisionReadiness();self.sample(gate)
        self.assertTrue(gate.ready(100))
        self.assertFalse(gate.ready(104))

    def test_annotations_alone_cannot_grant_readiness(self):
        gate=stack.VisionReadiness()
        for _ in range(5):gate.observe('annotated',0,100)
        self.assertFalse(gate.ready(100))

    def test_zero_stale_future_or_repeated_detection_stamps_do_not_pass(self):
        for stamp in (0,90,101,99):
            gate=stack.VisionReadiness()
            for _ in range(3):gate.observe('detections',stamp,100)
            self.assertLess(gate.counts['detections'],3)

    def test_invalid_or_stale_images_do_not_pass(self):
        gate=stack.VisionReadiness()
        for _ in range(3):
            gate.observe('annotated',0,100,False)
            gate.observe('annotated',90,100)
        self.assertEqual(gate.counts['annotated'],0)


if __name__=='__main__':unittest.main()
