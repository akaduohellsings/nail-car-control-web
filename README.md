# 钉探 Web 控制端

现有页面为原生 HTML/CSS/JavaScript，包含摄像头显示、方向控制与检测事件。代码位置：`C:\Users\02\Desktop\frontend_web_car`。

## Git 与开发基线

目录已有 Git 历史，保留原提交。本轮分支 `codex/web-navigation-design`，提交 `1b4f41b` 保存设计前的现有页面及 prompt.txt，作为可恢复基线；没有推送远端。

## 导航与手动协调设计

说明见 [docs/web-navigation-design.md](docs/web-navigation-design.md)。本轮先完成交互规则和接口边界设计；独立离线交互原型的形式待用户选择，真实导航/接管后端尚未接入当前页面。

建议先做单点导航与明确的手动接管，再做多点巡航。前端不能单凭 HTTP 成功认定导航已取消或车辆已停；后端需统一控制权和速度入口，手动结束后显式恢复。

## 现有页面本地启动

在此目录运行 `python -m http.server 8000`，访问 `http://localhost:8000`。

现有页面连接 `192.168.0.100` 的 8080 视频、5000 手动命令和 5001 事件接口；方向按钮仍具有实际控制作用。小车充电期间仅查看设计文档，导航设计本轮未发送小车命令。
