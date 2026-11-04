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
