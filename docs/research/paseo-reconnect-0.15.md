# Paseo 0.15.0 重连与消息更新停滞

2026-11-05。场景为 Android 客户端通过同一 Wi-Fi 的 Mac 中继到另一台主机。用户确认前台也会发生，且切换 workspace 后，两台主机的页面都可能长期显示“正在更新消息”。本文使用主机 B 表示中继、A 表示目标，不记录实际部署地址。

## 连接交接竞争

Paseo 的 `upsertDirectConnection` 启动原生探测，但不等待探测结束。原生控制器的在途探测保存了旧连接的可用性结果。如果插件在此期间交接新的已验证连接，旧探测完成时仍可能用“不可用”结果关闭新连接、切回 Relay。原生连接切换还会等待旧 client 的异步 `close()`，因此仅在切换前等待一次探测也不足以避免竞争。

在官方 v0.15.0 的 `HostRuntimeController` 中复现：旧直连不可用，Relay 探测尚未完成，此时交接新直连；最后完成旧探测，新直连被关闭并切到 Relay。修复后同一控制器保留新直连，下一次原生探测将其标为可用。

1.2.2 先单独保存地址，等待在途探测结束，再占用控制器现有的 `probeCycleInFlight` 串行槽，直到交接完成。槽必须是可写的已知属性，否则停止自动交接。交接前刷新未交接 socket 的存活样本，核对身份、TLS、来源与设备偏好；所有退出路径都会释放槽并唤醒等待方。已经工作的原生选择不重复替换。

官方参考：[host-runtime.ts](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/app/src/runtime/host-runtime.ts)。

## 在线状态未改变时，消息同步没有启动

Paseo 0.15.0 的 `SessionProvider` 在 `client` 变化时重建消息同步 owner；新 owner 内部的 `connected` 初值为 `false`。另一个负责调用 `setConnected` 的 effect 只依赖 `isConnected`。当 React 把交接过程合并为“在线 → 在线”，后一个 effect 不会重跑，新 owner 就一直保持未连接。切换 workspace 后，缓存历史能显示，但新的消息订阅和补齐请求不会启动。

“正在更新消息”是时间线追赶状态，与“正在重新连接主机”是两个不同的提示。前者会持续显示，直到同步完成。诊断采样时，B 的历史请求处理最多约 6ms，中继打开约 23–31ms，没有请求积压；这种情况不能仅用网络超时解释。

使用官方同步函数及上述两个原版 effect 表达式，按 React 的依赖比较与清理顺序执行：原实现替换 client 后保持 `pending`，没有新增订阅或历史请求；应用 1.2.2 的兼容处理后，新增订阅、完成历史请求，状态恢复 `ready`。

1.2.2 在可用时包装原生 `createViewedTimelineOwner`：为新 owner 立即设置其所绑定 client 的实际连接状态，并订阅该主机的后续状态；被替换的 client 不继续驱动旧 owner。owner 释放时取消订阅，插件重载不会重复安装包装。此处理不读取或修改聊天内容。

已经创建且卡住的 owner 不通过该工厂暴露，因此升级后须完全退出并重新打开手机 Paseo 一次。该要求也确保客户端清除上一版共享选路对象。

官方参考：[session-context.tsx](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/app/src/contexts/session-context.tsx)、[viewed-timeline-sync.ts](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/app/src/timeline/viewed-timeline-sync.ts)、[sync-status.tsx](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/app/src/timeline/sync-status.tsx)。

## 证据范围与复查

自动化覆盖原生探测竞争、异步交接期间的串行保护、取消和失败清理、偏好变更、TLS 冲突、手动选路幂等，以及新旧同步 owner 的连接与订阅生命周期。独立本机转发采样共 20 次，全部成功，耗时约 23–27ms；这不代表已测量手机 Wi-Fi 的持续稳定性。

原始诊断与原版控制器、同步代码的复现脚本保存在被忽略的 `test-results/`，不随插件分发。真实手机升级后的持续使用和 workspace 切换仍需单独确认。若再次发生，应在卡住时发送诊断，核对其中的 `pluginVersion`，并区分连接状态变化与消息同步停滞。

## 1.2.2 后续：前台仍会间歇性重连

2026-11-06，用户确认升级后，持续前台阅读消息或打开文件时仍可能出现“正在更新消息”或“正在重连”。最新手动报告确认为 1.2.2；不能将前述原版代码复现视为手机上的全部原因。

Mac 日志记录到手机直连的异常关闭（1006），相邻窗口没有请求积压或显著的服务端事件循环停顿。1006 只说明没有正常关闭握手，不能单独判断是 Wi-Fi、手机原生传输错误、客户端心跳还是其他原因。现场的被动 TCP 标志观测未覆盖到下一次断开。

本地诊断构建 `1.2.3-diagnostic.1` 增加每个 App runtime 共享的被动记录：最多 32 台主机的当前状态与 120 条连接 / 焦点 / 前台定时器延迟事件。直接订阅原生 client，可在恢复后保留断开类别和关闭码；保留客户端替换序号、心跳 RTT、最后业务消息接收时间和时间线 / 文件 / 订阅消息计数。业务消息时间不包含 transport 层的 ping / pong。

记录只在内存保留，随现有“发送诊断到 PC”手动提交。它不发起新探测、不切换或关闭 socket，不读取消息正文、文件路径、连接 URL、凭据或任意错误原文；最后一个插件实例释放时取消全部订阅与定时器。该构建用于定位未确认的原因，不声称已经修复间歇性故障。

## 后台探测复用身份，导致中继通道被回收

增强报告记录到：手机持续前台，B 保持同一个 `directTcp` / `online` client，A 的 `routed` client 则先断开、恢复，随后回退到延迟较高的 Relay。没有焦点切换或前台 JavaScript 定时器长时间停顿。B 上出现一次 `hosts.route.closed`。故障发生在原生后台探测开始后的约 120 秒周期处，B 的服务端日志同时记录了手机相同 clientId 的 Relay 探测握手。B 的心跳约 11ms，服务端没有请求积压。

官方 0.15.0 的非 routed 探测使用 App 全局 clientId，与当前连接共用身份。服务端 `resumeSession` 对同一身份的新握手重新调用 `Session.setPermissions`；即使权限没有变化，该方法仍会无条件调用 `ConnectedHostSession.revoke()`，以 `permission_denied` 关闭该会话拥有的中继通道。原有 B 连接本身可以继续在线，因此只检查 B 的连接状态无法发现这个问题。

使用实际安装的 0.15.0 SDK 和 daemon，以独立测试身份建立 B → A 通道，再用同一测试身份探测 B：B 仍在线，A 的通道立即以 `permission_denied` 关闭。只改变探测身份后，两端保持在线，目标身份核对成功。进一步使用插件的实际修复代码和官方原生工厂，连续 5 次探测 B，已有通道均正常，未收到通道关闭事件；经 B 的独立 routed 探测也返回了 A 的真实身份。测试没有复用用户正在使用的身份。

1.2.3 在共享原生 `deps` 上一次性替换 `connectToDaemon`：通过原生 `createClient` 为每次探测分配新身份，保留全部原生传输、密码、本地凭据与 App 能力配置。探测期间关闭自动重连，原生提升连接时继续接管同一个 client 并开启重连。普通原生连接的工厂和设备保存的全局身份保持原样。返回实际服务器身份和 hostname，兼容输入身份为空的原生配对流程；保留原生认证错误对象供原生失败分类使用。

适配器保留 routed 来源离线时立即拒绝，以及 direct / Relay / SSH 的默认 6 / 10 / 15 秒期限。失败和超时清理不等待可能长期未完成的 `close()`，晚到连接会再次释放。缺少工厂、不可写接口或必要 client 方法时停止操作，不退回存在身份碰撞的探测器。0.13.0、0.13.2 和 0.15.0 的官方工厂与控制器代码均通过非活动探测、故障回退与连接提升验证。

原生身份碰撞机制已经复现，并与这次手机故障时间高度吻合；但手机报告只保留了 `network` 类别和通道关闭次数，没有保存 `permission_denied` 原码。因此不能据此认定所有手机重连都由同一原因造成，修复后的持续前台、文件查看与 workspace 切换仍待真机确认。

官方参考：[websocket-server.ts](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/server/src/server/websocket-server.ts)、[session.ts](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/server/src/server/session.ts)、[connected-hosts/session.ts](https://github.com/getpaseo/paseo/blob/v0.15.0/packages/server/src/server/connected-hosts/session.ts)。原始报告、身份碰撞对照与修复验证保存在本地忽略目录，不随分发包公开。

## 后台恢复：Relay 先连接触发中继误退避

2026-11-06，用户确认 Android 回到前台后，连接列表偶尔显示“Relay 更快”，需要点击“重试中继”才能恢复。更新前保留的 Android 手动报告仍为 1.2.2，未含增强运行时历史，因此本次能确认代码路径和对照复现，尚不能逐次归因用户真机上的恢复事件。

原生 0.15.0 控制器在活动路径不可用时选择已验证的最快可用路径；健康路径的延迟择优另需至少 40ms 优势且连续 3 次探测。后台恢复时手机到 B、B 到 A 与 A 的 Relay 分别恢复，Relay 先在线并不证明 B 的中继不可用或持续更慢。插件原有策略却将“上次已通过中继、当前路径变为 Relay 或尚未在线”直接计为一次失败，从此刻开始等待 30 秒，连续失败最长等待 300 秒。B 随后直连恢复也只能等到冷却结束。未切换路径的旧客户端还可能沿用后台前的 20 秒健康检查间隔。

1.2.4（先以本地构建 1.2.4-dev.1 验证）在所有插件实例都收到后台状态时，撤销已验证健康中继的旧成功样本与健康检查期限。回前台立即重新验证；B 的直连尚未就绪则继续使用可用的原有连接，B 直连恢复后即可验证并交接中继。真正探测失败、此前已存在的故障冷却、手动选择 Relay 的 60 秒暂停和插件重载均保留原有规则。单个插件实例失焦而另一个仍在前台时，不重置共享策略。

三个新增场景在修改前失败，修改后通过。另用官方 v0.15.0 的原版 HostRuntimeController、插件实际 PrivateBridge 与受控传输模拟相同先后顺序：旧策略最终为 Relay / cooldown，新策略为 routed / online，恢复过程中没有假故障期限。受控传输不是手机网络测量；原始脚本、修复前失败输出和结果保存在忽略目录 `test-results/reconnect-resume-20261106/`。验证真实手机时需保证提供插件的各 PC 都加载同一修复构建，并完全退出后重开 App，以重建全局共享的选路策略；只更新其中一台 PC 不能保证手机使用的新策略由该 PC 提供。
