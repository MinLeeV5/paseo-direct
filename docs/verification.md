# Paseo Direct 验证记录

## 1.2.3 · 2026-11-06

修复原生后台探测复用活动会话身份、触发服务端回收中继通道的问题，并保留用户手动发送的被动连接历史。具体触发链与证据限制见 [分析记录](research/paseo-reconnect-0.15.md)。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 与行为回归 | 通过，108 项测试 | 探测身份隔离、并发、原生工厂接收参数与 client 保留、空身份配对、认证错误、离线中继来源、超时与晚到清理；被动诊断历史、隐私和订阅释放 |
| 实际 0.15.0 身份碰撞对照 | 通过 | 独立测试身份连接实际 daemon；同身份探测使已有中继通道以 permission_denied 关闭，独立身份则保留通道，B 均保持在线 |
| 修复代码与实际 SDK | 通过 | 使用插件适配器、官方原生工厂和实际 0.15.0 SDK；连续 5 次探测 B 未关闭已有通道；routed 探测与原有通道请求均核对目标身份 |
| 原版工厂与控制器兼容 | 通过 | 官方 0.13.0、0.13.2、0.15.0 源码，控制器共享 deps；非活动探测释放、活动连接保留、故障回退正常，显式提升继续使用同一 client 并开启重连 |
| 实际 SDK 被动诊断 | 通过 | 独立本机 TCP 转发中断记录原生 1006，报告保留断开类别，符合边界 schema，未记录 URL |
| 分发包干净安装 | 通过 | 独立 Paseo 0.15.0 编译归档中的客户端与服务端；设置重载保留、带密码转发请求身份一致、错误密码拒绝，临时进程与目录已清理 |

手机增强报告与碰撞机制的周期和连接表现吻合，但尚未记录到通道关闭的原生错误码。升级后的手机持续稳定性尚待确认，不能用本机验证代替真机验收。原始证据在本地忽略目录 `probe-session-revocation.json`、`isolated-probes-native.json`、`runtime-diagnostics-native.json` 中。

已发布 `v1.2.3`（`2466b29`）并从该 tag 更新日常 Mac。确认编译后的客户端包含探测身份隔离与被动诊断，已有目标注册保持在线，真实转发请求身份匹配；日常 supervisor、daemon 与桌面客户端进程均未重启。本地验收摘要为 `local-stable-1.2.3.json`。

## 1.2.2 · 2026-11-05

修复原生探测与连接交接竞争，以及 Paseo 0.15.0 在“在线 → 在线”替换 client 后，切换 workspace 长期显示“正在更新消息”的同步生命周期问题。具体机制见 [分析记录](research/paseo-reconnect-0.15.md)。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 与行为回归 | 通过，90 项测试 | 新增旧探测误关闭、异步交接串行保护、取消及失败唤醒、TLS 与偏好变更保护、手动选择幂等、保存中重载的归属，以及消息同步 owner 初始化、client 替换与订阅清理 |
| 官方原版控制器 | 通过 | 使用官方 v0.13.0、v0.13.2、v0.15.0 控制器与对应连接选择代码；验证可写探测槽、旧 client 异步关闭期间不启动探测、新连接保留、完成后恢复原生探测；v0.15.0 另覆盖取消与 ping 失败 |
| 官方原版消息同步 | 通过 | 使用 v0.15.0 同步函数及 SessionProvider 的两个原版 effect 表达式，按 React 依赖比较和清理顺序执行。原实现替换 client 后停在 pending、不发送新请求；实际兼容代码使其新增订阅并恢复 ready，释放后订阅数为零 |
| 分发包干净安装 | 通过 | 独立 Paseo 0.15.0 编译归档中的客户端与服务端；设置重载保留、带密码转发请求身份一致、错误密码拒绝；验证进程正常退出并清理 |
| 本机上游链路采样 | 通过 | 连续 20 次真实转发请求身份一致，耗时约 23–27ms；不代表手机 Wi-Fi 稳定性或修复后的真机验收 |

实际手机持续前台使用、反复切换 workspace 的修复后验收尚待用户确认。升级后需要完全退出并重开手机 Paseo，以重建升级前已经卡住的同步 owner。原始证据保存在忽略目录中的 `native-probe-race.json`、`native-handoff-fixed.json`、`native-handoff-lease-review.json`、`native-timeline-client-replacement-review.json` 与 `intermittent-link-probe.json`。

## 1.2.1 · 2026-11-05

修复旧常驻 supervisor 的 `paseo.pid` 缺少 `serverId` 时，插件虽显示 `running`，但地址发现持续失败、页面与中继管理无法初始化的问题。兼容分支按 daemon 的规则读取显式身份覆盖或同一目录的 `server-id`，继续核对当前主机身份。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 与行为回归 | 通过，72 项测试 | 新增旧格式成功初始化、运行目录身份不匹配、身份文件缺失、显式身份覆盖，以及新格式兼容与冲突保护 |
| 原故障环境 | 通过 | 本机 Paseo 0.15.0，保留旧 supervisor 与缺少 `serverId` 的运行文件；仅重载插件后，发现 RPC 返回实际监听地址与候选，主机身份匹配 |
| 真实中继请求 | 通过 | 用户在本机保存目标密码后，经此 PC 的原生主机转发请求目标目录，目标在线且身份匹配；单次往返约 47ms，不作为跨设备延迟保证 |
| Android 手机中继 | 用户确认成功 | Android App 0.15.0，手机与中继 PC 位于同一 Wi-Fi；daemon 日志确认手机完成局域网握手，用户随后确认“使用此中继”连接成功。本项未重新测试两段故障回退 |
| 示例地址 | 已替换 | 文档、输入框占位符、测试数据与分发截图使用文档示例地址，真实目标地址与配置不进入本次发布包 |

本次没有重新进行手机网络切换与 iOS 真机验收。修复前后的本机 RPC 摘要保存在忽略目录 `test-results/local-runtime.json`、`test-results/target-route.json`，不随发布包分发。

## 1.2.0 · 2026-11-04

新增按设备与目标保存的“自动优先此中继”：验证手机到 B 的直连和 B 到 A 的通道，再交接已验证的原生连接。失效时恢复已保存的非转发连接，并带退避地重试。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 与行为回归 | 通过，66 项测试 | 两跳优先、B 使用 Relay 时回退、上游失效、所有路径不可达、退避恢复、前后台取消、共享策略单实例、重载、偏好写入竞争、身份核对及晚到 socket 清理 |
| 实际 App 开关 | 通过 | Paseo 0.15.0 Web bundle；在 B 的目标列表开启自动优先，A 自动成为 `routed` / `online`，目标身份匹配；关闭折叠面板后继续运行 |
| C → B 故障与恢复 | 通过 | 关闭独立 TCP 转发并销毁活动 socket，未操作回退按钮，A 自动恢复已保存的原有直连；恢复转发后，等待冷却结束自动回到经 B 的路由 |
| B → A 故障与恢复 | 通过 | B 保持 `directTcp` / `online`，单独关闭上游 TCP 转发，A 自动恢复原有连接；上游恢复后自动回到路由 |
| App 刷新持久化 | 通过 | 整页刷新后仍读取原有优先来源，自动恢复 `routed` / `online`，目标身份匹配 |
| 目标侧设置 | 通过 | A 页面显示已选择 B 及实时路由状态；可在目标页面取消偏好，与 B 列表共享同一个设备设置 |
| 窄屏 | 通过 | 360×800 实际 App 设置页，文档宽度 360px，开关、说明与按钮正常换行，无横向溢出；原始截图 `test-results/route-360.png` |
| 分发包干净安装 | 通过 | `npm run release:pack` 与归档安装验证；独立 Paseo 0.15.0 编译最终客户端、服务端，并完成带密码原生转发请求 |

本次 App 故障验收的原有路径为带密码的直连；Relay 作为原有路径的选择与凭据保留另由行为回归覆盖。测试使用独立 daemon、浏览器数据目录和两个 TCP 转发器，不修改用户日常主机配置。它模拟传输中断，不代表已在用户的 VPN / frp 或 iOS / Android 真机上验收。

本地忽略目录中保存 `route-c-to-b-loss.json`、`route-c-to-b-recovery.json`、`route-b-to-a-loss.json`、`route-b-to-a-recovery.json`、`route-app-refresh.json` 和 `route-360.json`。分发截图 `assets/forwarding.png` 使用示例地址和名称，不作为网络测量证据。

## 1.1.0 · 2026-11-04

新增“通过此 PC 中继”，复用 Paseo 的原生主机注册和 `routed` 连接。目标连接由 B 保存，当前客户端可显式选择经 B 到 A 的路由。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 与行为回归 | 通过，46 项测试 | 目标去重、并发上限、凭据排除、人工配置保护、错误后的重试、按指定来源切换及目标身份核对 |
| 分发包与干净安装 | 通过 | 无 `node_modules` 的源目录及归档分别安装；真实 Paseo 0.15.0 编译客户端与服务端，RPC 正常 |
| B → A 真实主机转发 | 通过 | 两个隔离 daemon；A 配置随机密码，B 注册后用经 B 的 API 请求核对 A 的身份；错误密码被拒绝 |
| 保存与清理 | 通过 | 重复保存不覆盖密码，插件重载后目标保留，移除后列表清空；临时 daemon 已停止并清理 |
| 实际 App 界面 | 通过 | Paseo 0.15.0 Web bundle，独立浏览器和测试 Origin；页面添加带密码目标、清空密码输入、显示在线状态、点击使用此中继，实际目标连接为 `routed` / `online` 且身份匹配；页面可移除目标 |
| 手机宽度 | 通过 | 390×844 操作、360×800 检查；文档宽度等于视口宽度，输入和按钮无横向溢出，内容可通过键盘焦点滚动访问 |

测试复用了独立 daemon 的真实原生主机 API，未操作用户日常主机的注册表。原始摘要见本地忽略目录 `test-results/daemon.json`、`forwarding-app.json`，布局截图为 `forwarding-360.png`。这不等同于在用户的 VPN / frp 网络或 iOS / Android 真机上验收；路径延迟与 VPN 进程可达性仍需在实际设备确认。

## 1.0.1 · 2026-10-29

本次将 Paseo 兼容范围扩大为 `>=0.13.0`，移除 manifest 和连接适配器的版本上限，保留运行时接口能力与 PC 身份检查。

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 类型检查与行为回归 | 通过，38 项测试 | `npm run release:pack`；新增最低版本、后续补丁 / 次版本 / 主版本、预发布版本边界及无版本信息场景 |
| 正式分发包 | 通过 | `paseo-direct-1.0.1.tgz` 与 `.sha256`；检查发布清单，不包含 node_modules 或本机配置 |
| 归档干净安装 | 通过 | `npm run verify:daemon -- dist/paseo-direct-1.0.1.tgz`；独立 Paseo 0.14.0 daemon，无 node_modules；客户端编译、发现 RPC、身份与实际监听端口检查 |
| PC 共享设置 | 通过 | 实际读写、过期 revision 冲突、非法地址拒绝、插件重载后保留设置、TLS 自定义候选 |
| 独立环境清理 | 通过 | 验证脚本正常退出，已确认临时 daemon 停止并移除临时目录 |

版本范围回归使用模拟连接；本次新增的实际 daemon 验证版本为 0.14.0，未重新进行手机真机与完整 App 界面验收。既有真机验证范围见下方记录。

## 1.0.0 · 2026-10-29

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript 类型检查 | 通过 | `npm run typecheck` |
| 行为回归 | 35 项通过 | `npm test`；主机身份、取消与连接清理、并发上限、持久偏好、双策略、地址归属与排除、重载、手动诊断、当前连接 RPC |
| 正式分发包 | 通过 | `npm run release:pack`；仅含发布清单中的源代码、图标、截图、说明和许可证，生成 SHA-256 |
| 归档干净安装 | 通过 | `npm run verify:daemon -- dist/paseo-direct-1.0.0.tgz`；独立 v0.13.2 daemon，无 node_modules；实际客户端编译与 RPC |
| 本机升级 | 通过 | 现有 v0.13.0 daemon 上重载，状态 running；正式客户端包含 1.0.0，PC 身份与共享设置 RPC 确认正常，未重启 daemon |
| PC 共享设置 | 通过 | 实际读写、非法地址拒绝、过期 revision 冲突、插件重载后保留设置、TLS 自定义候选；读写采用官方 settings RPC |
| 页面设置 | 通过 | 发布版 App 的 Web bundle：编辑忽略网卡与补充地址；暂停时保存 PC 配置只刷新地址，不切换连接 |
| 设备设置持久化 | 通过 | 页面选择 English 后刷新 App，语言和开关仍保留；设备与 PC 隔离、并发写入由自动化补充 |
| 地址管理 | 通过 | 页面将插件创建的非活动地址移除，registry 随之删除并加入设备排除列表；人工地址和活动地址保护另有回归覆盖 |
| 实际连接交接 | 通过 | 复用随机测试密码，保存相同 PC 直连，确认本地存储；主动切换 Relay 与恢复直连 |
| 故障回退 | 通过 | 在独立 TCP 转发承载的活动直连上终止转发，未点击回退按钮，Paseo 自动恢复 Relay online |
| 故障恢复 | 通过 | 修复旧连接 RPC 后再次中断并恢复 TCP 转发，自动回直连 online，error 为 null，persisted / relaySaved 为 true |
| RPC 跨传输切换 | 通过 | 发现旧 SDK 闭包问题后修复；每次解析当前 client。主动切换后仍可读取 PC 设置与手动发送诊断 |
| 诊断主动性 | 通过 | 多次自动检查、保存与切换后 PC 报告为 0；点击发送后产生 1 份，状态 directTcp / online、persisted / relaySaved 为 true |
| 窄屏布局 | 通过 | 实际 App 390×844、360×800，页面宽度等于视口，无横向溢出；详情可滚动访问 |

实际 App 验收使用本机 Paseo v0.13.2 安装包中的 Web bundle，配合独立测试 daemon、独立无个人浏览记录的 Chrome、随机测试密码及测试 host registry。仅测试 daemon 允许验收页面的准确 Origin。没有修改日常 daemon 的监听、认证、CORS、Relay，也没有中断用户手机网络。

接口适配的一个关键问题是：Paseo 0.13 可能在更换 socket 后保留插件实例，其 SDK RPC 闭包仍引用原来的 client。1.0 的 `client/rpc.ts` 只在首次获取 PC 身份时使用安装时 RPC，之后每次通过 `client/bridge.ts` 解析当前活动连接。PC 共享配置仍使用官方 settings 协议与 revision 校验，设置页打开且在前台时每 10 秒刷新，并在连接变化后重新读取。

本地原始证据保存在被 Git 忽略的 `test-results/`：`daemon.json`、`local-install.json`、`release-tcp-fallback.json`、`release-tcp-restored.json`、`release-manual-report.json`、`release-mobile.png`、`release-360.png`。`assets/screenshot.png` 是当前页面的分发截图，地址替换为示例值；不可将其作为真实网络测量报告。

### 尚需真机覆盖

- 1.0 新增设备设置在 iOS / Android 真正杀进程后的保留，以及前后台权限行为。
- iOS 直连、权限、Wi-Fi / 蜂窝切换。
- Windows / Linux daemon、TLS / IPv6 的真实网络连接（地址解析和候选生成已有自动化覆盖）。
- 不同客户端版本组合、Paseo 升级后的私有接口兼容性。

Android v0.13.2 的真实 Wi-Fi 直连 → Relay → 直连已在 0.1 原型验证，记录见下方；该结果不能替代 1.0 新界面的全量真机验收。

手机验收入口现为 **Paseo Direct**。需要收集报告时展开“诊断与事件”，点击“发送诊断到 PC”；PC 执行 `npm run reports`。背景探测停止由自动化验证，不声称已完成 iOS 真机验收。

---

## 0.1.0 原型记录 · 2026-10-28

日期：2026-10-28。原型版本：`0.1.0`。

### 已完成

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript 类型检查 | 通过 | `npm run typecheck` |
| 定向自动化测试 | 14 项通过 | 错误身份不写入、后台取消、密码复用、同 socket 交接、持久化读取、relay 保留、幂等、并发上限与清理、重载冷却 |
| 独立 daemon 安装 | 通过 | v0.13.2；不携带 node_modules 的干净源目录 |
| 官方编译器与 RPC | 通过 | 编译客户端 bundle，调用真实 `direct.discover`，校验身份和实际绑定端口 |
| 本机安装 | 通过 | 当前 daemon v0.13.0，插件 `paseo-direct` 状态为 running；原有全局插件开关已开启 |
| 发布版 App 私有接口 | 通过 | 本机安装包 v0.13.2 的实际 Web bundle 中存在所需 store、连接器、保存和 controller 接口 |
| 真实 App：relay → 直连 | 通过 | 带随机测试密码的隔离 daemon；由插件页面触发，复用密码完成握手，交接同一 client |
| 真实 App：本地保存 | 通过 | App registry 同一 serverId 下同时保存 relay 与新直连，并读取本地存储确认落盘 |
| 真实 App：主动切回 relay | 通过 | 页面按钮触发；连接在线，回退计数增加；冷却与观察记录跨插件重载保留 |
| 真实 App：TCP 中断自动回退 | 通过 | 独立 TCP 代理承载直连，移除测试 registry 中其他直连候选，再终止代理；未点击回退按钮，App 自动使用保存的 relay |
| 手机宽度布局 | 通过 | 实际 App 页面以 390 × 844 浏览器视口检查，控件与记录可滚动访问 |
| Android 手机前台直连 | 通过 | 用户确认已直连；手机报告 `directTcp`、`online`，观察到直连在线 1 次 |
| Android 手机本地保存 | 通过 | 手机报告 `persisted: true`、`relaySaved: true`，保留原有连接并新增 PC LAN 地址 |
| Android 手机关闭 Wi-Fi 后回退 | 通过 | 用户确认发送时 Wi-Fi 仍关闭；诊断显示 `relay`、`online`、`relayReturns: 1`，直连不可达且原有配置保留 |
| Android 手机恢复 Wi-Fi 后回切 | 通过 | 用户确认自动恢复直连；最新诊断为 `directTcp`、`online`，直连在线计数 2、relay 回退计数 1，保存状态仍为 true |

App 端验证使用独立的无个人浏览数据的本地浏览器、独立测试 daemon、随机测试密码和测试 host registry。测试 daemon 中只额外允许验收页面的准确 Origin，未修改日常使用的 PC daemon 的认证、监听、CORS 或 relay 配置。

TCP 故障场景中，活动直连从 `online` 进入错误状态后，App 核心自动选择 relay 并恢复 `online`；插件记录的 relay 回退次数从主动测试后的 1 增加至 2。该测试验证真实传输故障处理，不等同于手机无线网络切换。

屏幕和原始摘要保存在本地忽略目录 `test-results/`：`app-mobile-width.png`、`app-handover.json`、`app-tcp-fault.json`、`daemon.json` 为 Web / daemon 验证证据；`phone.json`、`phone-fallback.json` 和 `phone-roundtrip.json` 为 Android 手机直连、回到 relay 和恢复直连的诊断报告。

### 未覆盖的扩展验证

- Android 前台探测、保存与直连已由手机报告确认；iOS 尚未实测。
- 进入后台不继续发起探测，恢复前台后重新检查。
- App 重启后，直连候选仍保存在原 host 中。

手机验收时打开“直连实验”，点击“发送诊断到 PC”；PC 用 `npm run reports` 查看报告。使用过程和清理说明见 [README](../README.md)。
