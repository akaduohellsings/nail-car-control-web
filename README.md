# 钉探 Web 控制端

最新（2026-10-02）：保留页面布局，完成共用连接设置、两页任务状态与模拟接管、视频/事件新鲜度及断连重试；电脑可双击 `start_web.cmd`，充电期间可双击 `start_simulation.cmd`。22 项自动测试和浏览器模拟流程通过。小车统一启动脚本已准备，未部署、未实车验收；真实任务协调仍只读。使用方式与边界见 [docs/web-improvements.md](docs/web-improvements.md)。以下为历史模块记录。

最新模块（2026-10-01）：已完成本地模拟导航命令与手动接管。实车地址保持只读，只有明确声明模拟控制能力的回环服务可启用按钮。29 项自动测试及浏览器流程检查通过，模拟服务已关闭。本模块说明见 [docs/navigation-control.md](docs/navigation-control.md)。下文保留之前的只读开发记录。

2026-10-01 最新：只读状态页面完成本地过期、断连、恢复、模式与异常显示及窄屏验收（12 个浏览器检查点、4 项接口测试）。没有启动小车；小车真实适配器待命显示仍待联调。本轮没有修改页面业务代码。最新说明见 [docs/navigation-status.md](docs/navigation-status.md)。

现有页面为原生 HTML/CSS/JavaScript，包含摄像头显示、方向控制与检测事件。代码位置：`C:\Users\02\Desktop\frontend_web_car`。

## Git 与开发基线

目录已有 Git 历史，保留原提交。本轮分支 `codex/web-navigation-design`，提交 `1b4f41b` 保存设计前的现有页面及 prompt.txt，作为可恢复基线；没有推送远端。

## 导航与手动协调设计

说明见 [docs/web-navigation-design.md](docs/web-navigation-design.md)。已新增独立导航页面 `navigation.html`，包含地图占位、单点目标草稿、任务状态、手动接管流程、连接设置与操作记录。原手动页顶部增加导航入口，手动控制逻辑未修改。

页面支持保存和恢复本地目标草稿、保存导航服务地址，并主动连接只读任务状态。显示模式、任务阶段、目标、告警与状态新鲜度；导航、暂停、恢复、接管和停止按钮保持禁用。最新接入及充电暂停点见 [docs/navigation-status.md](docs/navigation-status.md)，原页面壳设计见 [docs/navigation-shell.md](docs/navigation-shell.md)。

建议先做单点导航与明确的手动接管，再做多点巡航。前端不能单凭 HTTP 成功认定导航已取消或车辆已停；后端需统一控制权和速度入口，手动结束后显式恢复。

## 现有页面本地启动

在此目录运行 `python -m http.server 8001 --bind 127.0.0.1`，访问 `http://127.0.0.1:8001/navigation.html` 查看导航页面；访问 `/index.html` 查看原手动页面。

原手动页面连接 `192.168.0.100` 的 8080 视频、5000 手动命令和 5001 事件接口；方向按钮仍具有实际控制作用。此次导航页面开发在本地进行，未发送小车命令。
