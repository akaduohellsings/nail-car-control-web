"""Run on the robot: camera readiness -> separate conda YOLO -> web services.

No Nav2, lidar, chassis launch or motion requests. Ctrl+C stops owned groups.
This script is prepared offline; hardware startup/shutdown still needs validation.
"""
import argparse
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path


def video_stream_url(base_url, topic):
    # The installed async_web_server_cpp does not decode query values.
    if not isinstance(topic, str) or not re.fullmatch(r'/[A-Za-z_][A-Za-z0-9_]*(/[A-Za-z_][A-Za-z0-9_]*)*', topic):
        raise ValueError('Invalid absolute image topic')
    return base_url.rstrip('/') + '/stream?' + urllib.parse.urlencode({'topic': topic}, safe='/')


def verify_video_streams(base_url='http://127.0.0.1:8080',
                         topics=('/camera/color/image_raw', '/detected_image'),
                         timeout=8, check=lambda: None):
    """Require two complete JPEG frames per topic through the actual HTTP path."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    counts = {}
    for topic in topics:
        url = video_stream_url(base_url, topic)
        deadline = time.monotonic() + timeout
        pending = b''
        count = 0
        try:
            check()
            with opener.open(url, timeout=timeout) as response:
                content_type = response.headers.get('Content-Type', '').lower()
                if 'multipart/' not in content_type:
                    raise RuntimeError('Expected MJPEG, received ' + content_type)
                while count < 2 and time.monotonic() < deadline:
                    check()
                    chunk = response.read1(65536)
                    if not chunk:
                        break
                    pending += chunk
                    while True:
                        start = pending.find(b'\xff\xd8')
                        if start < 0:
                            pending = pending[-1:]
                            break
                        pending = pending[start:]
                        end = pending.find(b'\xff\xd9', 2)
                        if end < 0:
                            break
                        count += 1
                        pending = pending[end+2:]
                    if len(pending) > 4 * 1024 * 1024:
                        raise RuntimeError('Incomplete JPEG exceeds 4 MiB')
                if count < 2:
                    raise RuntimeError('Received ' + str(count) + '/2 complete JPEG frames')
                counts[topic] = count
        except (OSError, ValueError, RuntimeError) as error:
            raise RuntimeError('VIDEO_NOT_READY ' + url + ': ' + str(error)) from error
    return counts

CAMERA = r'''
import time, rclpy
from sensor_msgs.msg import Image
from rclpy.qos import qos_profile_sensor_data
rclpy.init(); node=rclpy.create_node('web_stack_camera_ready'); frames=[]
def receive(msg):
    stamp=msg.header.stamp.sec+msg.header.stamp.nanosec/1e9
    if msg.width>0 and msg.height>0 and 0<=time.time()-stamp<3:
        if not frames or stamp>frames[-1]: frames.append(stamp)
node.create_subscription(Image, '/camera/color/image_raw', receive, qos_profile_sensor_data)
end=time.monotonic()+35
try:
    while len(frames)<3 and time.monotonic()<end: rclpy.spin_once(node,timeout_sec=.2)
    if len(frames)<3: raise RuntimeError('No three fresh camera frames; check ROS time and camera')
    print('CAMERA_READY',flush=True)
finally: node.destroy_node(); rclpy.shutdown()
'''
class VisionReadiness:
    """Legacy annotated images lack headers; fresh detections prove inference freshness."""
    def __init__(self):
        self.counts = dict(camera=0, annotated=0, detections=0)
        self.last_stamp = {}
        self.last_received = {}

    def observe(self, kind, stamp, now, valid=True):
        if not valid:
            return
        if kind!='annotated' or stamp!=0:
            if not 0<=now-stamp<3 or stamp<=self.last_stamp.get(kind,-1):
                return
            self.last_stamp[kind]=stamp
        self.counts[kind]+=1
        self.last_received[kind]=now

    def ready(self, now):
        return all(self.counts[k]>=3 and 0<=now-self.last_received.get(k,-1)<3
                   for k in self.counts)


VISION = r'''
import time, rclpy
from sensor_msgs.msg import Image
from vision_msgs.msg import Detection2DArray
from rclpy.qos import qos_profile_sensor_data
from robot_web_stack import VisionReadiness
rclpy.init(); node=rclpy.create_node('web_stack_yolo_ready'); readiness=VisionReadiness()
def receive(kind,msg):
    stamp=msg.header.stamp.sec+msg.header.stamp.nanosec/1e9
    valid=kind=='detections' or (msg.width>0 and msg.height>0 and bool(msg.data))
    readiness.observe(kind,stamp,time.time(),valid)
subscriptions=[
    node.create_subscription(Image,'/camera/color/image_raw',lambda m:receive('camera',m),qos_profile_sensor_data),
    node.create_subscription(Image,'/detected_image',lambda m:receive('annotated',m),qos_profile_sensor_data),
    node.create_subscription(Detection2DArray,'/detections',lambda m:receive('detections',m),10)]
end=time.monotonic()+45
try:
    while not readiness.ready(time.time()) and time.monotonic()<end:
        rclpy.spin_once(node,timeout_sec=.2)
    if not readiness.ready(time.time()):
        raise RuntimeError('YOLO output not ready: '+str(readiness.counts))
    print('YOLO_READY '+str(readiness.counts),flush=True)
finally: node.destroy_node(); rclpy.shutdown()
'''



def active_processes():
    lines = subprocess.check_output(['ps', '-eo', 'pid,args'], text=True).splitlines()
    markers = ('astra_camera_node', 'ultralytics_ros2', 'web_video_server', 'web_control_ros2',
               '/bt_navigator', '/amcl', '/controller_server', 'lslidar_driver')
    return [line for line in lines if any(marker in line for marker in markers)]


def group_alive(process):
    process.poll()  # Reap the direct child before checking descendants.
    try:
        os.killpg(process.pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=Path.home() / 'wheeltec_ros2')
    parser.add_argument('--conda-script', type=Path,
                        default=Path.home() / 'anaconda3/etc/profile.d/conda.sh')
    args = parser.parse_args()
    if os.name != 'posix':
        parser.error('Run this script on the Linux robot, not on the computer.')
    services = active_processes()
    if services:
        parser.error('Existing camera/vision/web/navigation/lidar processes found; stop them first:\n' + '\n'.join(services))
    if not args.conda_script.is_file():
        parser.error('Conda activation script not found.')
    environment = ('source /opt/ros/humble/setup.bash && source ' +
                   shlex.quote(str(args.workspace.expanduser() / 'install/setup.bash')) +
                   ' && export ROS_DOMAIN_ID=0 && ')
    folder = Path.home() / 'nail_dev_runs' / (time.strftime('%Y%m%d_%H%M%S') + '_web_stack')
    folder.mkdir(parents=True, exist_ok=False)
    processes, logs = [], []
    report = {'camera_ready_before_yolo': False, 'navigation_started': False,
              'lidar_started': False, 'motion_command_sent': False, 'ready': False}

    def launch(name, command):
        log = (folder / (name + '.log')).open('w')
        logs.append(log)
        process = subprocess.Popen(['bash', '--noprofile', '--norc', '-c', environment + command],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append((name, process))
        return process

    def gate(name, code):
        process = launch(name, 'exec /usr/bin/python3 -c ' + shlex.quote(code))
        if process.wait(timeout=60) != 0:
            raise RuntimeError(name + ' failed; see ' + str(folder / (name + '.log')))

    exit_code = 0
    try:
        def interrupted(_signal, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupted)
        launch('camera', 'exec ros2 launch turn_on_wheeltec_robot wheeltec_camera.launch.py')
        gate('camera_ready', CAMERA)
        report['camera_ready_before_yolo'] = True
        print('Camera ready; starting YOLO in a separate conda process.', flush=True)
        launch('yolo', 'source ' + shlex.quote(str(args.conda_script.expanduser())) +
               ' && conda activate wheeltec && exec ros2 launch ultralytics_ros2 yolo.launch.py')
        gate('yolo_ready', VISION)
        launch('video', 'exec ros2 run web_video_server web_video_server')
        launch('control', 'exec ros2 run web_control_ros2 web_server')
        end = time.monotonic() + 25
        waiting = {8080, 5000}
        while waiting and time.monotonic() < end:
            for port in list(waiting):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.5):
                        waiting.remove(port)
                except OSError:
                    pass
            if waiting:
                time.sleep(.2)
        if waiting:
            raise RuntimeError('Web ports not ready: ' + str(sorted(waiting)))
        report['listening_ports'] = [5000, 8080]
        report['video_frames'] = verify_video_streams()
        print('Raw and YOLO video frames received over HTTP. No chassis or radar started.', flush=True)
        report['ready'] = True
        while True:
            for name, process in processes:
                if name.endswith('_ready'):
                    continue
                if process.poll() is not None:
                    raise RuntimeError(name + ' exited: ' + str(process.returncode))
            time.sleep(0.5)
    except KeyboardInterrupt:
        print('Stopping owned services...', flush=True)
    except Exception as error:
        report['error'], exit_code = str(error), 1
        print(report['error'], flush=True)
    finally:
        for sig, timeout in ((signal.SIGINT, 6), (signal.SIGTERM, 3), (signal.SIGKILL, 2)):
            for _, process in reversed(processes):
                if group_alive(process):
                    try:
                        os.killpg(process.pid, sig)
                    except ProcessLookupError:
                        pass
            end = time.monotonic() + timeout
            while any(group_alive(process) for _, process in processes) and time.monotonic() < end:
                time.sleep(.1)
        report['remaining_owned_groups'] = [name for name, process in processes if group_alive(process)]
        report['remaining_relevant_processes'] = active_processes()
        report['shutdown_clean'] = not report['remaining_owned_groups'] and not report['remaining_relevant_processes']
        for log in logs:
            log.close()
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('Shutdown verified.' if report['shutdown_clean'] else 'Shutdown incomplete: inspect report.json.', flush=True)
        print(str(folder), flush=True)
        if not report['shutdown_clean']:
            exit_code = 1
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
