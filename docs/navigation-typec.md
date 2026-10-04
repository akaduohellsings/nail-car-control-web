# Web 单点导航（2026-10-04）

电脑网页与车端接口已部署，通过 Type-C 实际读取小车状态；保留现有布局。车端只读服务在线，尚未启动底盘或实际 Nav2，地图、定位与行驶尚未验收。热点暂未被小车扫描到，Type-C 继续保留。

## 网页操作

双击 `start_web.cmd`，打开 `http://localhost:8000/navigation.html`。连接设置选择 Type-C，导航服务地址为 `http://192.168.55.1:8091`。连接只读取状态，不启动导航。

服务发布真实导航控制能力后，网页显示地图和当前车位。点击地图空白区填写 X/Y，也可手动输入米制坐标；填写目标朝向（度）后点击开始。选点和保存草稿均不会移动。

开始请求的 HTTP 202 仅表示已接收，页面随后等待 Nav2 接受反馈。暂停取消本服务的目标，等待取消终态和新鲜里程计持续停车后才显示完成。恢复继续原地图目标；停止并暂停后需显式恢复。窗口失焦、隐藏、断连会尽力提交停止，独立的三秒控制租约到期也会取消任务。

没有导航服务、没有地图/新鲜地图到车体 TF、未确认停车、状态过期、其他页面占用或发生故障时，不开放新导航操作。地图内容变化后旧 map_id 请求会被拒绝。地图像素与米制坐标支持地图原点旋转和屏幕 Y 轴反向转换。

本轮真实接口只支持 start/pause/resume/reset/stop。手动接管、拾取、多点巡航、路径叠加与地图缩放未启用。之前的本地模拟接管仍可使用；旧只读服务保持兼容，不能仅换地址就开启实车控制。

## 车端连接配置

小车代码位于相邻 `小车/robot_src/nail_mission_ros2`。新增 `navigation_control_bridge`，复用现有 Nav2Backend 的目标、取消与停车逻辑；不启动底盘、雷达、Nav2、相机或拾取，不订阅稳定钉子事件。Web 请求由 HTTP 线程入队，在 ROS 线程执行，避免并发修改任务。

已通过 Type-C 部署、编译，并运行 Domain 83 的隔离假 Nav2/HTTP 测试。实际导航环境仍待静止联调。不能与 mission_nav2、旧 Web 手动速度控制或其他导航客户端同时控制车辆。

小车当前配置在 `/home/wheeltec/nail_config/navigation_web.json`，模板在 `nail_mission_ros2/config/navigation_web.example.json`。配置只含连接与导航选项，不保存 Wi-Fi 名称或密码。启动入口默认只读；已有后台实例运行时先停止它，避免端口冲突：

```bash
source /opt/ros/humble/setup.bash
source /home/wheeltec/wheeltec_ros2/install/setup.bash
ros2 run nail_mission_ros2 navigation_control_bridge --config /home/wheeltec/nail_config/navigation_web.json --disable-control
```

当前后台只读实例记录在 `/home/wheeltec/nail_config/navigation_web_process.json`，日志在同目录 `navigation_web.log`。未设置开机自启；重启小车后需重新启动服务。

配置项 `bind`、`port`、`allowed_client`、`allowed_origin` 可分别修改绑定地址、端口、允许访问的电脑 IP 与网页来源。当前模板为 Type-C：小车 `192.168.55.1`、电脑 `192.168.55.100`、端口 8091。切换热点后填实际获取的 IP，再重启服务；网页“连接设置 → 服务地址”也可修改导航地址。Wi-Fi 密码由小车网络管理器管理，不进入这些文件。不提供配置文件时，服务只绑定回环地址并只允许回环客户端。

显式命令行参数覆盖 JSON 配置。真实联调时使用 `--enable-control` 替换 `--disable-control`；需要已启动并正确定位的 Nav2、`/map`、`map -> base_link` 的新鲜 TF 和 `/odom_combined`，并先确认现场与运动授权。热点 IP 需实际获取，不能沿用历史 `192.168.0.100` 假定。

电脑上的部署工具支持 `python tools/deploy_navigation_control.py --host 当前小车IP`，Type-C 和无线共用入口。

## 已验证与待验证

25 项前端测试、45 项 Python 逻辑回归通过（新增导航桥 7 项、控制协调 15 项、协议 6 项、任务 17 项），共 70 项。

浏览器使用本机 8094 的导航接口预览服务验证了地图加载/选点、开始接收与接受反馈、暂停停车确认、原目标恢复、停止，以及 390 像素宽度无横向溢出。预览服务的地图、位置、导航和停车均为模拟，不导入 ROS 或 SSH。

本次增加连接配置校验后，车端 9 项接口测试与 3 项 HTTP/ROS Action 隔离测试通过。后者使用假的 Nav2 服务验证实际 ROS 通信，未启动硬件、未发送实车目标。车端单包编译通过。

浏览器连接实际 Type-C 服务，显示任务状态在线、真实单点导航适配、导航服务未就绪、定位未确认，开始按钮禁用。截图 `navigation-typec-readonly.png` 是真实状态读取；`navigation-typec-preview.png` 仍只作为模拟页面预览证据。实际地图/TF、真实停车时序与实际运动仍待验收。
