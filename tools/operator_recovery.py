"""Local-only recovery of an offline robot service; never submit a goal."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import urllib.request


class OperatorRecovery:
    def __init__(self, project):
        self.project=Path(project).resolve()
        self.lock=threading.Lock()
        self.state={'status':'idle','message':'服务离线后，可确认复位并重新启动。'}

    def config(self):
        return json.loads((self.project/'config/web_navigation_operator.json').read_text(encoding='utf-8-sig'))

    def snapshot(self):
        with self.lock:
            state=dict(self.state)
        config=self.config()
        # The command-line launcher can supersede this process's old attempt.
        # A running worker still owns startup validation; don't finish it early.
        if state['status']!='starting':
            online=self.online_status(config)
            if online is not None:
                ready=(online.get('read_only') is False
                       and online.get('control',{}).get('phase')=='READY'
                       and online.get('control',{}).get('localization_valid') is True
                       and online.get('mission',{}).get('stationary_confirmed') is True
                       and online.get('mission',{}).get('action_server_ready') is True)
                state={'status':'ready' if ready else 'online',
                       'message':'导航服务已就绪，请连接任务服务。' if ready else
                                 '导航服务在线，请查看任务状态；人工复位前先结束整套服务。'}
            elif state['status']=='ready':
                state={'status':'offline','message':'导航服务当前不可达，请检查连接及服务状态。'}
        return dict(state,host=config['host'])

    def online_status(self,config):
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://'+config['host']+':'+str(config.get('navigation_port',8092))+'/api/v1/status',timeout=2) as response:
                status=json.load(response)
            return status if isinstance(status,dict) and status.get('connection')=='ONLINE' else None
        except (OSError,ValueError):
            return None

    def start(self, data):
        if data.get('confirmed_origin') is not True:
            raise ValueError('请先确认小车已复位到建图起点、朝向一致并完全静止。')
        config=self.config()
        if data.get('expected_host')!=config['host']:
            raise ValueError('网页小车地址与启动配置不一致，请先修改连接设置。')
        if not (self.project/'tools/web_navigation_operator.py').is_file():
            raise ValueError('未找到小车启动入口。')
        with self.lock:
            if self.state['status']=='starting':
                raise ValueError('正在启动，请勿重复重置。')
            try:
                opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open('http://'+config['host']+':'+str(config.get('navigation_port',8092))+'/api/v1/status',timeout=2) as response:
                    online=json.load(response)
                if online.get('connection')=='ONLINE':
                    raise ValueError('导航服务仍在线，请使用重置任务；人工复位前需先结束整套服务。')
            except OSError:
                pass
            self.state={'status':'starting','message':'正在启动摄像头、YOLO、网页与导航服务；不会发送行驶目标。'}
            threading.Thread(target=self.run,daemon=True).start()
        return self.snapshot()

    def run(self):
        python=Path(os.environ.get('APPDATA',''))/'uv/python/cpython-3.12.14-windows-x86_64-none/python.exe'
        command=[str(python) if python.is_file() else sys.executable,
                 str(self.project/'tools/web_navigation_operator.py'),'start','--origin-confirmed','--no-browser']
        try:
            result=subprocess.run(command,cwd=self.project,capture_output=True,text=True,
                encoding='utf-8',errors='replace',timeout=350,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            state={'status':'ready' if result.returncode==0 else 'failed',
                   'message':'导航服务已就绪，请重新连接并选点。' if result.returncode==0 else (result.stdout+result.stderr)[-1600:]}
        except Exception as error:
            state={'status':'failed','message':'启动未完成：'+str(error)}
        with self.lock:
            self.state=state
