# Paseo Direct 验证记录

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
