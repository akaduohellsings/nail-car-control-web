# Web 单点导航（2026-10-05）

## USB 完整单点导航验收（2026-10-05 15:03）

用户要求先用USB开发，确认起点、朝向、空旷区域和线缆后，本次按修正后的厂家导航模式完成网页开始、暂停、恢复原目标、到达和停止。用户现场确认过程一致且最终停下。[暂停与停车](navigation-speed-cleanup-paused.png)、[恢复与停止记录](navigation-speed-cleanup-finished.png)。

暂停位置约9.7 cm，确认停车保持11.94秒；120条融合里程计，vx微小残差峰值约0.00000757 m/s、位置跨度约0.00000858 m。最终轮式前进0.37416 m，地图(0.37901,0.00304) m，在目标(0.4,0)的3 cm容差内。活跃导航Action合计12.678秒，命令峰值0.04451 m/s、融合实测峰值0.08620 m/s，电压10.559–10.740 V。暂停取消CANCELED、恢复到达SUCCEEDED、stop回执成功且停车确认。

原始检查passed=true/shutdown_clean=true，所有运动服务和子进程正常退出、无残留。保护器速度、电量与方向限制保持，提速参数仍只用于临时验收。本次验证补齐导航模式修正后的完整直行及收尾；任意地图点、转向、避障、更长路线、检测与拾取尚未验收。原始IMU校准未完成。

已恢复正常可修改的Type-C地址192.168.55.1:8091，只读桥与真实地图在线，定位未确认、开始禁用。[最终只读页面](navigation-usb-workflow-readonly.png)。小车保持本轮终点，下一轮需确认期间是否搬动，不能自动视为起点。未修改Wi-Fi配置。本次开机时间回到1970年，从电脑校正成功；离线断电时间保持仍未解决。

小车项目证据：docs/web_navigation_usb_workflow_20261005.md，test_results/web_navigation_usb_nav_mode_workflow_verified.json为原始报告；workflow_acceptance.json加入现场确认，明确本次受限直行movement_acceptance_complete=true。以下为历史记录。

## 最新方向漂移修正（2026-10-05 14:31）

本轮开始目标因报告朝向超过受限允许差而被拒绝，未发Nav2目标、未arm、非零输出0；用户确认车一直静止。核对发现受限启动遗漏厂家导航模式，普通定位直接使用原始惯性数据。已明确启用厂家导航模式，保留所有保护与厂家配置。原拒绝报告保持失败。

修正后的静止对照实际读取定位服务使用/imu/data_filtered；约30秒融合方向基本不变，原始惯性数据仍漂移约1.3°。524条里程计、516帧扫描，电压10.473–10.581 V，无非零输出、无运动目标，所有服务正常退出且无残留。[检查期间方向与停车](navigation-heading-static-fixed.png)。静止修正已验证，运动时的方向响应和完整提速流程尚待复测。

当前已恢复8091只读地图、定位未确认、开始禁用，[最终页面](navigation-heading-fixed-readonly.png)。车仍在建图起点，无需再次复位，除非期间搬动。小车项目说明 `docs/navigation_heading_fix_20261005.md`、报告 `test_results/web_navigation_heading_static_nav_mode_verified.json`。下一轮先复查电量与现场，再补测完整实车流程。

## 最新充电开机复查（2026-10-05 14:14）

用户确认放回建图起点、朝向一致。Type-C与电脑热点恢复，两个8091接口实际返回同一只读实例，当前网页仍用可修改的Type-C地址。本次开机时间自动同步成功，未人工校时；离线断电保持未验证。

静止检查通过：电压10.650–10.769 V，331条里程计、313帧扫描，起点定位、停车与导航就绪，未发目标或非零输出。完整底盘/雷达/Nav2/保护器/临时桥正常退出，单次启动器通知，无清理异常或残留。截图 [检查期间](navigation-reboot-cleanup-static.png)。这是完整服务静止收尾验证，提速行驶后的收尾尚未复测，之前失败记录保持。

结束后恢复正常8091只读桥及地图，定位未确认、开始禁用，[当前只读页面](navigation-reboot-cleanup-readonly.png)。小车仍在本轮起点，后续运动先确认现场与期间是否搬动。小车项目报告 `test_results/web_navigation_reboot_cleanup_latest.json`，说明 `docs/web_navigation_reboot_cleanup_20261005.md`。

## 最新收尾修正（2026-10-05 12:54）

雷达单独静止检查已收到20帧新鲜扫描并正常退出，未启动底盘/Nav2、未发送运动目标。导航检查收尾改为先通知启动器一次，由其统一通知子进程，保留超时升级清理与失败判定；单次通知/升级两项既有测试及四种生成观察程序编译通过，厂家雷达驱动没有修改。整个导航流程退出仍待下一轮验证，之前提速报告的清理失败保持。起初独立检查错误沿用M10P模板、扫描为0，现已改用实际N10Plus配置并保留失败记录。

退出核对无运动服务残留，正常8091只读桥在线、控制禁用、原地图保留；小车仍在约0.38 m终点，不初始化回零。小车项目详细说明 `docs/radar_shutdown_20261005.md`，报告 `test_results/radar_shutdown_supervisor_verified.json`。下一轮先确认电量与充电后位置，再验证完整导航收尾。

## 最新提速试验（2026-10-05 12:35）

用户确认复位并授权提速后，保留独立速度/电量/位移保护，仅调整临时规划参数。Web开始→约12 cm暂停→确认停车约10.95秒→恢复原0.4 m目标→到达→停止完成；用户确认“更快、更连续，最终已停下”。排除主动暂停后，两段导航Action合计由23.9秒降至12.7秒，缩短约47%；两次各一轮、暂停位置/终点/电压不同，不能推广为普遍提升。截图 [暂停确认](navigation-speed-trial-paused.png)、[最后停止](navigation-speed-trial-finished.png)。

本轮里程计前移0.38128 m，map终点约(0.38614,0.00171,0.000760 rad)，在3 cm临时容差内；最高前进命令0.04396 m/s，实测速度峰值0.09868 m/s，电压10.317–10.450 V。独立命令上限仍0.06 m/s、实测保护仍0.12 m/s、低电量门槛仍10 V。临时规划参数vx_max=0.08、vx_std=0.035经过读取核对，没有设为永久默认。

雷达在停止帧写入后的SIGINT清理阶段退出-2，原报告passed=false/shutdown_clean=false保持；运行完成与整体清理验收分别记录。进程核对无运动服务残留，已恢复正常8091只读地图，定位未确认、开始禁用，小车保持约0.38 m终点。[恢复后的页面](navigation-speed-trial-restored-readonly.png)。小车项目报告为 `test_results/web_navigation_speed_trial_motion_result.json` 和 `web_navigation_speed_trial_comparison.json`，详细说明 `docs/web_navigation_speed_trial_20261005.md`。下一步先处理退出异常，再决定提速配置，不从当前终点初始化回零或继续加速。

## 最新完整 Web 流程验收（2026-10-05 12:14）

本轮从用户重新确认的建图起点出发，真实网页开始→前进约5.4 cm后暂停→确认停车约9秒→恢复同一0.4 m目标→到达→停止已完整通过。start/pause/resume/stop成功回执齐全；原Nav2目标取消确认，恢复的新Action到达，最终无所属目标且保护器静止、未授权、零输出。用户现场确认完整现象。截图 [暂停完成](navigation-real-paused-confirmed.png)、[恢复后停止完成](navigation-real-resumed-stopped.png)。

里程计前移0.40412 m，最终地图位姿约 `(0.39569,0.00808,0.00274 rad)`；电压10.471–10.902 V，保护无fault，检查和所有子进程正常退出。原始报告 `test_results/web_navigation_motion_workflow_passed.json`，综合现场确认的限定验收 `web_navigation_motion_workflow_acceptance.json` 均在小车项目，详细记录 `docs/web_navigation_workflow_20261005.md`。

本次完成单点Web任务控制验收。低速停走现象尚未优化，命令最高0.02367 m/s但里程计速度峰值0.10579 m/s，0.06 m/s为命令上限；多点巡航、检测和拾取未接入。服务退出后已恢复正常Type-C8091只读地图，当前定位未确认、开始禁用，小车保持约0.40 m终点，不会自动重新行驶。

## 最新实车到达与停走现象（2026-10-05 12:07）

网页原始 `(0.4,0,0°)` 目标被真实导航接受并到达，用户现场确认数次短停后最终到达约40 cm。里程计前移0.39260 m、累计路径0.39432 m，停车 map 位姿 `(0.393579,0.003830,-0.022563 rad)`，位置误差约7.5 mm；3 cm 临时容差已核对并实际到达。到达后 Web stop 完成，保护器确认静止、未授权、零输出。

本次只有 start/stop 成功回执，暂停位置等待超时、后续暂停没赶上到达，pause/resume 未完成，整体测试仍失败。中途短停期间保护器没有反复撤销授权，速度命令持续很低（最高0.02412 m/s），里程计却出现静止和前进突跳，实测峰值0.09323 m/s。记录支持低速底盘响应不平顺，具体原因未确认；不能把观察到的短停当作网页暂停/恢复验收，也不能将0.06 m/s命令上限解释为实测速度始终低于此值。

测试退出时 launch 返回-11，后续进程核对无运动服务残留；恢复正常8091只读地图，当前定位未确认、开始禁用。原始报告和审计为小车项目 `test_results/web_navigation_motion_040cm_partial.json`、`web_navigation_motion_040cm_audit.json`。截图 `navigation-motion-finished-readonly.png` 是结束后的只读页面。当前位置已约0.394 m，后续不能再初始化为起点。

## 最新开机恢复（2026-10-05 11:57）

用户已开机并将车辆放回建图起点、朝向一致。本次 Type-C 可连接，网页保存 `http://192.168.55.1:8091`，正常只读服务和真实地图已恢复，定位未确认、开始禁用。热点/Type-C 地址仍可编辑。截图 `navigation-reboot-readonly.png` 为检查结束后的只读地图状态。

首次静止检查中底盘串口异常退出，系统记录多个 USB 设备断开重连，用户确认当时插拔过设备。保存失败证据后保持连接复查：passed=true、shutdown_clean=true，电量 11.001–11.099 V，起点定位、新鲜 TF、92.0% 静止扫描地图匹配和导航就绪有反馈，底盘仅接受独立保护器速度。524 条里程计、515 条扫描，导航目标与非零输出均为零，所有检查进程正常退出。截图 `navigation-reboot-static-pose.png` 记录检查期间定位可用，不能当作运动验证；结束后关闭硬件，恢复只读桥和地图，当前定位未确认。

开机时 NTP 已启用但未同步，系统仍为 1970；已从电脑校正时间和写入 RTC，未验证断电保持，也未声称此次已联网自动校时。车端报告 `test_results/web_navigation_reboot_static_latest.json` 和 `web_navigation_reboot_serial_diagnostic_latest.json` 留存本次证据。

电脑网页与车端接口已部署，先通过 Type-C 实际读取小车状态，随后切换到电脑热点；保留现有布局和可修改连接地址。真实地图、车位与静止停车反馈已接通，现已实际启动一段导航，完整暂停/恢复仍待验收。

## 最新实车进展与充电接续（2026-10-05）

用户明确同意后，网页发出原始 `(0.4,0,0°)` 目标，Nav2 接受并驱动车辆。里程计前进 0.17323 m 后确认静止，用户现场确认已前进并停下。商家原有到达容差 0.25 m 导致提前报成功；临时参数已收紧为位置 0.03 m、朝向 0.05 rad，尚未完成修复后实车到达精度验收。没有完成整套开始→暂停→恢复→停车。

接续保留原目标及累计距离范围，不能把当前位置恢复为原点，也不能在当前位置再向前增加 0.4 m。停车位姿为 `(0.17317,-0.00800,-0.02133 rad)`。已修复雷达启动、保护命令序号衔接和初始定位参数覆盖，并加入开放控制前的位置核对。12 项受限后端及 9 项保护器纯逻辑测试通过；修复后的接续定位因低电量仍待实车验证。

最后预检电压 9.975–10.074 V，触发原有 10 V 保护，未发新目标或非零输出。等待充电，不降低门槛。之后无线与 Type-C SSH 均超时，无法再次核对车端或恢复地图服务；网页已保存正常 `http://192.168.137.2:8091` 地址，保持未连接、开始禁用。截图 [navigation-motion-charge-pending.png](navigation-motion-charge-pending.png) 仅记录该断开状态，不是在线导航成功证据。

车端原始证据 `test_results/web_navigation_motion_arrival_tolerance_partial.json`，最新低电量报告 `test_results/web_navigation_motion_latest.json`。运动轮 AMCL 清理退出 -11，最后检查雷达退出 -2，子进程清理异常仍需排查。充电后先确认是否搬动车辆、电量、现有进程与定位，再继续同一目标；若搬动需重新定位。Type-C 和热点仍可自由选择，没有固化 IP 或热点密码。

以下为此前静止准备与历史检查记录。

## 最新受限导航准备（2026-10-05）

受限车端适配器和独立电量/速度保护已部署。仅允许首次起点前方约 0.4 米目标，保护器确认后才发送 Nav2 目标；暂停/停止先切断速度再取消导航，恢复保留原始目标与范围。限速 0.06 m/s，电量低于既有 10 V 门槛或反馈超时会停车。

实车静止检查通过：底盘速度输入仅由保护器发布，无直接速度旁路。网页连接临时 8092 只读保护桥，显示真实地图、小车位置、停车已确认、导航已就绪，开始保持禁用。电压 10.496–10.607 V，非零输出 0；前方 0.4 米只规划，最低路径净空约 0.203 米。截图 [navigation-guarded-readonly.png](navigation-guarded-readonly.png)。实际行驶和实车暂停/恢复仍待明确行驶授权与验收。

本次小车重启后联网自动校时成功，Chrony 已启用开机启动。NTP 配置持久生效，但断电离线保持时间尚未修复。检查后关闭硬件和 8092 临时桥，恢复正常 8091 只读服务和真实地图；网页回到定位未确认，地址仍可编辑。

车端入口 `tools/check_web_navigation_guarded.py --host 当前IP --map-yaml 地图路径 --origin-confirmed` 只静止检查，报告 `test_results/web_navigation_guarded_latest.json`。首轮桥退出异常已修复，最终保护器/桥/Nav2 均正常退出。受限后端、保护器与协调回归已通过；三项车端实际 HTTP/ROS 假 Nav2 测试仍属于无硬件隔离验证。

## 前一轮静止联调（2026-10-04）

用户确认小车仍在保存地图的建图起点且车头方向一致。已加载真实地图（69×135、0.05 米/格），网页显示小车 `(0.00, 0.00)`、当前朝向、定位可用、导航服务已就绪、停车已确认。截图 `navigation-static-map-pose.png` 为检查服务运行时的真实画面。

底盘速度输入重映射到无发布者的隔离话题，Nav2 速度输出另行隔离；没有执行 NavigateToPose、没有非零速度指令，最大实测线速度为 0。电压约 11.032–11.088 V。AMCL、map_server、planner_server、controller_server、bt_navigator 均 active；雷达与地图端点匹配比例约 89.3%（15 cm 内）。这只支持静止匹配和新鲜 TF，不能证明 AMCL 已收敛或行驶精度。

仅通过 ComputePathToPose 计算前方约 0.4 米路径，没有执行。网页保存 X=0.4、Y=0、朝向=0 的草稿，未发送。开始按钮始终禁用。

启动期间出现生命周期状态冲突及服务回执丢失；检查入口改为依次切换并确认实际状态，诊断运行限定 UDP 通信。关闭前先 deactivate/cleanup，最终导航进程正常退出且无遗留硬件服务；完整失败与通过报告均保存在小车项目。最终仍记录一次配置回执缺失，但随后实际 inactive/active 状态检查通过，未重复发送配置请求。

检查完成后已关闭底盘、雷达与 Nav2，保留只读地图和 Web 桥。因此当前车位与定位恢复“未确认”，需重启实际传感器/定位后才可更新，网页不会继续显示检查时的位置。雷达停止帧已按厂家协议写入，未测量物理电机停止。

车端检查入口 `tools/check_web_navigation_static.py --host 当前IP --map-yaml 地图路径 --origin-confirmed` 只用于确认起点后的静止联调；结束后自动关闭自身启动的导航进程。地图服务入口 `tools/start_web_map.py --host 当前IP --map-yaml 地图路径` 只启动地图，不启动硬件。报告 `test_results/web_navigation_static_latest.json`；下一步接受限单点导航执行与实车暂停/停车，不直接启用默认高速与恢复动作。

## 当前无线连接

小车手动接入电脑热点后，实际无线地址为 `192.168.137.2`，电脑热点地址为 `192.168.137.1`。无线 SSH 的身份与 Type-C 已核对一致。网页共用连接设置已保存小车地址 `http://192.168.137.2` 和导航任务服务 `http://192.168.137.2:8091`，实际连接显示任务状态在线；地址仍可编辑，没有改业务代码或预设。

车端实际配置的 bind 改为 `0.0.0.0`，允许客户端保留回环及 Type-C 电脑地址，并增加电脑热点地址。因此无线 `192.168.137.2:8091` 与 Type-C `192.168.55.1:8091` 都能读取同一只读服务。原配置备份在 `/home/wheeltec/nail_config/navigation_web.before_hotspot_20261004_225133.json`。热点重新分配 IP 时，在网页连接设置修改实际地址；电脑热点 IP 变化时也需更新 allowed_client 并重启服务。

未拔掉 Type-C 做现场断线测试。只验证导航状态接口，视频、旧手动和检测服务未启动或验收。无线截图 `navigation-hotspot-online.png`，完整报告在小车项目 `test_results/web_navigation_hotspot_latest.json`。尚未发实车目标。

## 网页操作

双击 `start_web.cmd`，打开 `http://localhost:8000/navigation.html`。当前无线导航地址为 `http://192.168.137.2:8091`；需要退回 Type-C 时，连接设置选择 Type-C，导航服务地址为 `http://192.168.55.1:8091`。连接只读取状态，不启动导航。

服务发布真实导航控制能力后，网页显示地图和当前车位。点击地图空白区填写 X/Y，也可手动输入米制坐标；填写目标朝向（度）后点击开始。选点和保存草稿均不会移动。

开始请求的 HTTP 202 仅表示已接收，页面随后等待 Nav2 接受反馈。暂停取消本服务的目标，等待取消终态和新鲜里程计持续停车后才显示完成。恢复继续原地图目标；停止并暂停后需显式恢复。窗口失焦、隐藏、断连会尽力提交停止，独立的三秒控制租约到期也会取消任务。

没有导航服务、没有地图/新鲜地图到车体 TF、未确认停车、状态过期、其他页面占用或发生故障时，不开放新导航操作。地图内容变化后旧 map_id 请求会被拒绝。地图像素与米制坐标支持地图原点旋转和屏幕 Y 轴反向转换。

本轮真实接口只支持 start/pause/resume/reset/stop。手动接管、拾取、多点巡航、路径叠加与地图缩放未启用。之前的本地模拟接管仍可使用；旧只读服务保持兼容，不能仅换地址就开启实车控制。

## 车端连接配置

小车代码位于相邻 `小车/robot_src/nail_mission_ros2`。新增 `navigation_control_bridge`，复用现有 Nav2Backend 的目标、取消与停车逻辑；不启动底盘、雷达、Nav2、相机或拾取，不订阅稳定钉子事件。Web 请求由 HTTP 线程入队，在 ROS 线程执行，避免并发修改任务。

已通过 Type-C 和热点部署、编译，并运行 Domain 83 的隔离假 Nav2/HTTP 测试。实际静止定位及受保护速度接线已检查，运动仍待验收。不能与 mission_nav2、旧 Web 手动速度控制或其他导航客户端同时控制车辆。

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

前一阶段浏览器连接实际 Type-C 服务，显示任务在线、导航未就绪、定位未确认，开始禁用。截图 `navigation-typec-readonly.png` 是该阶段真实状态读取；`navigation-typec-preview.png` 仍只作为模拟页面预览证据。最新静止联调已验证实际地图/TF 与停车反馈，执行导航后的取消/停车时序和实际运动仍待验收。
