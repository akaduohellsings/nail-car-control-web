# 本地模拟导航与手动接管

2026-10-01 完成。页面现可向电脑的本地模拟服务发送开始、暂停、恢复、重置、申请/结束手动接管和停止操作。导航/停车/移动均模拟；实车地址继续保持只读，原手动页仍使用旧控制接口。

先在 `C:/Users/02/Desktop/小车` 运行 `python tools/local_navigation_control.py`，本前端目录启动 `python -m http.server 8001 --bind 127.0.0.1`。访问 navigation.html，把连接地址设为 `http://127.0.0.1:8093`，点击“连接任务服务”。模拟地图固定 local-demo，画布未接入实际地图。

接管要等待取消完成与停车确认。方向按钮按住发送模拟意图，松开停止；结束接管保持暂停，显式恢复才继续原目标。HTTP pending 仅表示接收，结果需后台状态确认。控制权属于本页时才可操作，第二页不能同时接管。

只有回环地址、mock 模式且明确声明本地控制能力才允许 POST。原只读 v1 状态仍可显示，非回环地址不能发送控制请求；尚未向小车部署本模块。将来接入实车必须补 ROS 回执、真实取消停车和统一速度控制。

验证：15 项协调逻辑、4 项 HTTP、10 项前端接口测试通过；浏览器流程、故障/过期/双页面限制、390 像素布局与只读兼容已检查。发现并修复切换服务后残留旧操作结果的问题。测试服务已停止，网页恢复小车地址并保持断开。

截图：navigation-control-preview.jpg、navigation-control-fault.jpg、navigation-control-mobile.jpg。完整模块记录与文件位置见 `C:/Users/02/Desktop/小车/docs/web_navigation_control.md`，启动/停止命令见同目录 `连接.txt`。
