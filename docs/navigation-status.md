# 导航只读状态接入与暂停点

最新：后续本地模拟命令与控制权模块已完成，见 [navigation-control.md](navigation-control.md)。本文件保留只读模块记录；实车接口依然只读，按钮仅在回环模拟控制服务下启用。

更新：充电期间完成 12 个浏览器检查点和 4 项前端接口测试，过期、断连、重连、不同模式样例、异常/冲突、320/390 像素布局通过。本轮复用电脑上的实际桥接代码，不运行 ROS 或小车；真实适配器待命联调仍待开机后完成。测试工具为 `C:/Users/02/Desktop/小车/tools/local_navigation_status.py`，记录为 `C:/Users/02/Desktop/小车/docs/web_navigation_local_acceptance.md`。

本轮截图：`navigation-status-stale.jpg`、`navigation-status-mobile.jpg`、`navigation-local-preview.jpg`。真实格式样例中的停车/就绪字段仅用于显示测试。测试服务已关闭，网页恢复小车地址并保持断开；运动按钮仍禁用。

2026-10-01：只读状态接入已实现，充电暂停，全部验收尚未完成。原手动页面及控制逻辑保持原样。

`navigation-api.js` 校验公共任务协议 v1，通过 GET 轮询 `/api/v1/status`；连接需主动操作，断开时取消请求并忽略迟到响应。页面区分模拟、真实适配器与模拟清理，显示目标、任务阶段、尝试次数、告警及状态新鲜度。导航、暂停、恢复、接管、停止按钮均禁用。

本地启动：在本目录运行 `python -m http.server 8001 --bind 127.0.0.1`，访问 `http://127.0.0.1:8001/navigation.html`。在连接设置保存 `http://192.168.55.1:8091`，再点击“连接只读状态”。小车桥接服务需另行启动，命令记录在 `C:/Users/02/Desktop/小车/连接.txt`。

已验证：4 项前端接口测试；浏览器连接模拟节点并显示最终暂停状态；模拟完整流程通过桥接接口。界面截图 `navigation-status-preview.jpg` 是本次模拟在线时的历史截图，不能作为当前运行状态。

待验证：网页数据过期、服务不可达、隔离真实适配器待命显示及新版窄屏布局。小车快没电后已停止本轮服务并保存日志；充电后从这些验收继续，不启用运动按钮。

接口提供 `connect`、`getStatus`、`subscribeStatus`、`disconnect` 的只读能力；`getMap` 和全部控制方法仍拒绝执行，`implemented=false`、`readOnly=true`。地图、定位、控制权尚未接入。

完整开发记录：`C:/Users/02/Desktop/小车/docs/web_navigation_status.md`。
