# Paseo 自动直连插件可行性调研

调研日期：2026-10-28。本文将 host 理解为 Paseo App 保存的 PC 主机及其连接地址。

后续进展：已基于本调研实现最小原型，并收到 Android 手机直连与本地保存成功的诊断。实际验证范围见 [原型验证记录](../verification.md)；下文保留调研时的判断与基线。

**结论：功能可以实现，但当前公开插件 API 没有覆盖“修改手机 host、主动选择连接”这两个环节。** 可以先通过私有接口制作无需 fork App 的原型；长期维护则适合给上游补充客户端连接 API，让插件负责地址发现、策略和管理界面。私有接口方案目前属于源码级可行，尚未经过 iOS / Android 真机验证。

## 1. 调研基线

| 项目 | 已核实的版本 / 状态 |
| --- | --- |
| 官方仓库 | `getpaseo/paseo` |
| 当前稳定版 | `v0.13.2`，2026-10-26 发布 |
| 本机 CLI | `0.13.2` |
| 本机运行中的 daemon | `0.13.0` |
| 本机 daemon 监听 | `0.0.0.0:6767`，relay 已启用 |
| 手机 App | 本轮未读取版本，也未进行真机测试 |
| 稳定版源码 | `d2941157a8f91512daf54fc688241d416e8f5ebd`，即 `v0.13.2` |
| 对照的 main | `33faacc0556e71dd0604413953385d497698cc4d`；包版本为 `0.14.0-beta.1`，包含尚未发布的后续改动 |

对比 `v0.13.0` 和 `v0.13.2`，本次依赖的插件客户端入口、贡献接口、执行器、catalog 同步、HostRuntime、连接选择和 host 数据结构文件没有差异。因此下文的核心接口判断也适用于本机正在运行的版本；手机包的实际表现仍需单独验证。

本轮只读取本机运行状态，在临时目录下载上游源码并生成官方脚手架。没有安装或启用新插件，没有修改 daemon 配置、监听地址或手机 host。

来源：[稳定版发布](https://github.com/getpaseo/paseo/releases/tag/v0.13.2)、[固定版本源码](https://github.com/getpaseo/paseo/tree/d2941157a8f91512daf54fc688241d416e8f5ebd)。

## 2. Paseo 插件如何开发和运行

插件是安装到一个 daemon 的 TypeScript 项目，客户端代码会交给连接该 daemon 的桌面、Web、iOS 和 Android App 执行。一个插件可以同时有两个入口：

| 入口 / 目录 | 运行位置 | 适合本需求的用途 |
| --- | --- | --- |
| `index.server.ts`、`server/` | PC 上的 daemon 子进程 | 枚举网卡、提供候选地址、读取有效监听信息、保存插件设置 |
| `index.client.tsx`、`client/` | 每个连接的 App 内 | 手机侧验证可达性、监听前台状态、显示直连管理界面 |
| `shared/` | 两端都可使用 | Zod RPC 契约、候选地址和探测结果类型 |
| `paseo-plugin.json` | daemon 与 App 检查 | 插件 ID、说明、兼容版本范围 |

两端入口默认导出注册函数，并返回清理函数。PC 端通过 `server.handle(contract, handler)` 注册 RPC，客户端通过 `client.rpc(...)` 或 `useRpc(...)` 调用。客户端可以贡献设置页、独立页面、侧边栏、工作区面板和命令；自动任务可在客户端入口启动，不必等用户打开管理页，但必须在卸载时清理定时器、监听器和未完成任务。

Paseo 提供 React、React Native、插件 SDK、TanStack Query 和 Zod 的运行时。客户端不能使用 Node 的 `os`、`net`、`fs` 等模块，枚举 PC 网卡必须放在服务端；新增需要原生链接的手机模块，也需要 App 构建支持。

官方开发流程是 `paseo plugin init <绝对路径>`、安装开发依赖、运行 `npm run typecheck`，随后安装目录源；开发中修改代码后执行 `paseo plugin reload <id>`。也支持 Git、npm 和插件 registry 分发。daemon 的 `pluginsEnabled` 控制第三方插件运行。

实际使用本机 CLI 在临时目录生成了脚手架，确认它默认写入 `requirements.paseo: ">=0.13.2"` 并固定 `@getpaseo/plugin: "0.13.2"`。这个默认要求高于本机正在运行的 daemon `0.13.0`，进入实现阶段时需要统一版本，或针对已验证能力明确声明兼容范围。

来源：[插件快速开始](https://paseo.sh/docs/plugins)、[插件运行与编译边界](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/docs/plugins.md)、[客户端贡献接口](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/plugin/src/client/contracts.ts#L176)。

## 3. 公开 API 能做到哪里

| 能力 | 当前判断 |
| --- | --- |
| PC 枚举 LAN / VPN 网卡地址 | 可用服务端 Node API 实现 |
| 将候选地址传给手机 | 可通过已有连接上的插件 RPC 实现 |
| 手机测试候选地址 | 可以设计客户端 WebSocket 探测；握手、认证和真机权限需要验证 |
| 显示手机已配置的 host | `useHosts()` 支持，但只暴露 `serverId`、`label`、`status` |
| 通过已有 host 操作 agent / workspace | `getPaseoClient(serverId)` 支持 |
| 写入手机保存的直连地址 | 公开插件 SDK 未提供接口 |
| 获取或选择手机当前使用的连接 | 公开插件 SDK 未提供对应连接管理接口 |
| 手机被挂起、退出后继续持续探测 | 不能依靠普通插件 JS 保证 |

这里有一个容易误读的 API：`usePaseo().hosts.add/update/remove` 管理的是**选中 daemon 保存的远端主机连接**，数据在该 daemon 的 `hosts.json`，不是手机的 host registry。它不能直接完成本需求。

更准确地说，区别在于连接配置的所有者：即使代码运行在手机里，`client.hosts.add()` 仍会发送 `hosts.add.request`，由当前连接的 daemon 执行并持久化。官方 SDK 文档对此的定义是管理连接到选中 daemon 的 hosts。给 PC A 登记 PC B，建立的是 A 到 B 的连接；不能用同一接口给手机到 A 的连接增加 LAN 地址。若候选实际指向 A 自己，daemon 会将其识别为 `self_host`。

这个 API **可以间接影响手机显示的主机列表**：App 的 `syncHostDiscovery()` 订阅 daemon 的 host directory，将发现的 B 加入手机 registry，但添加的是 `type: "routed"`、`originServerId: A` 的候选。因此手机能经 A 访问 B，不能据此得到手机到 B 的直连。不能将“无法直接写手机直连配置”扩大为“SDK 添加的主机绝不会出现在手机里”。

手机 App 本身具备完整的本地主机管理能力，内部 `useHostMutations()` 暴露 `probeAndUpsertDirectConnection()`、`removeConnection()` 等操作，内置设置页面使用这些接口；目前没有通过 `@getpaseo/plugin/client` 将这些写入能力开放给插件。

公开文档明确说明，借用的 `PaseoApi` 不暴露连接生命周期控制。仅使用公开 API，可以做“候选地址发现、诊断和管理界面”，暂时不能完整交付自动修改手机 host 的体验。

来源：[客户端 host 摘要定义](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/plugin/src/client/index.ts#L82)、[插件连接能力说明](https://paseo.sh/docs/plugins/reference#discover-hosts-and-target-another-host)、[daemon host 与 App 连接的所有权](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/docs/connected-hosts.md#ownership-and-authority)。

2026-10-28 补充核对：[SDK client.hosts 文档](https://paseo.sh/docs/sdk/reference#clienthosts)、[addHost 发出 RPC](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/client/src/daemon-client.ts#L1753)、[手机同步 routed host](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L2450)、[App 内部 HostMutations](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L3009)。

## 4. 现有直连机制与缺口

### 手机的一个 host 可以同时保存直连和 relay

`HostProfile` 用稳定的 `serverId` 标识一台 daemon，包含 `connections[]`、`preferredConnectionId` 和主机级密码等字段。连接类型包括 `directTcp` 和 `relay`。手机通过 AsyncStorage 的 `@paseo:daemon-registry` 保存自己的主机列表。

新增直连地址时，现有逻辑会按 `serverId` 合并进同一个 host。因此正确实现是为已配对 PC 增加直连候选，保留 relay；不用再建一个重复主机。

来源：[host 数据结构](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/types/host-connection.ts#L86)、[host 合并逻辑](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/types/host-connection.ts#L297)、[本地存储实现](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L1529)。

### App 已经会探测已保存地址，但不会自动发现新 LAN 地址

`HostRuntimeController` 会连接已保存的候选、检查 `serverId`、测量延迟并切换连接。这部分可以复用。

目前的 V2 配对 offer 只包含 `serverId`、daemon 公钥、relay 参数和可选安全模式，没有 PC 的 LAN / VPN 地址。仓库虽然还保留 `buildOfferEndpoints()` 这样的地址辅助函数，但当前 V2 配对 schema 不会把这些直连地址传给手机。仅扫描配对二维码不能据此推断已配置自动 LAN 发现。

来源：[配对 schema](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/protocol/src/connection-offer.ts#L3)、[offer 构建](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/server/src/server/connection-offer.ts)、[连接探测逻辑](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L927)。

### “自动保存直连”与“只要可达就使用直连”是两个要求

现有策略按延迟选择连接，不按 transport 类型优先选择。稳定版中的参数是：

- 另一条连接至少快 `40 ms`，连续 `3` 次命中后才进行自适应切换。
- 已有在线连接时，非活动候选的常规探测间隔是 `120 秒`。
- 无活动连接时可以先激活最先连接成功的候选；故障回退会在可用候选中按延迟选路。

例如 relay 为 `25 ms`、直连为 `0.4 ms`，差值不足 `40 ms`，即使已保存直连，App 也可能继续用 relay。维护者在 issue #7613 的回复中确认这是当前设计。

所以如果产品目标包含“直连可达就优先使用”，还需要一个明确的选路策略，而不能只写入 host。修改保存字段也不等同于稳定控制当前活动连接。

来源：[切换参数](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L240)、[切换判断](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L1065)、[维护者解释](https://github.com/getpaseo/paseo/issues/7613#issuecomment-6372749935)。

## 5. 无需 fork App 的私有接口原型

源码里存在一条可验证的路径：

1. App 将 `HostRuntimeStore` 实例放在 `globalThis.__paseoHostRuntimeStore`。
2. 插件客户端 bundle 通过同一 JS 全局环境的 `eval` 执行。
3. store 已有 `getHosts()`、`getSnapshot(serverId)`、`probeAndUpsertDirectConnection(...)`、`upsertDirectConnection(...)` 和 `runProbeCycleNow(...)` 等方法。

其中 `probeAndUpsertDirectConnection()` 能执行真实 daemon 连接、取得主机身份、合并连接并触发本地保存。它把已连接的探测 client 交回连接管理器；现有 host 的同步逻辑还会激活这个连接。因此，它比直接写 AsyncStorage 更接近 App 原生“添加直连”的完整流程。

**据此推断：可以尝试用一个私有 bridge 做自动配置原型，不必先重新构建 Paseo。** 但源码观察不能替代发布版手机包验证，方法名、全局对象可见性和安装生命周期都没有公开兼容保证。

原型应把私有调用集中到一个适配器：检查对象和方法是否存在；接口不兼容时停止自动写入，在管理页说明状态。当前版本策略为支持 Paseo 0.13.0 及以上，不设版本上限，保留运行时能力检查。不要让业务逻辑到处读取内部对象。

还需注意，现有 `probeAndUpsertDirectConnection()` 没有 `expectedServerId` 参数，会先探测再写入实际返回的 host。因此不能直接把所有候选交给它，写完之后才核对身份。应先完成只读验证，再提交匹配已配对 PC 的地址；长期 API 应把身份核对与写入合成一个原子操作。

来源：[全局 store](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L2849)、[插件执行器](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/plugins/evaluate.ts#L534)、[探测并保存](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L1987)、[激活已有 host 的新连接](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/runtime/host-runtime.ts#L2384)。

## 6. 建议的实现方案

### 首版：先通过现有 relay 交换候选地址

建议首版以“手机已配对 PC，App 前台或恢复前台时自动配置”为边界：

1. PC 插件读取有效监听地址和端口，通过 `os.networkInterfaces()` 枚举可用网卡；将通配监听展开为具体地址，过滤 loopback 和无效地址，支持 LAN IPv4，并允许配置 VPN / 固定域名候选。
2. 手机通过已认证连接上的插件 RPC 取得 PC 的 `serverId` 和候选列表；候选只来自目标 PC 及明确配置的地址。
3. 手机限并发、带超时地测试这些地址，完成 Paseo 握手和认证，并核对预期主机身份。
4. 验证通过后，在同一个 host 中增加或更新直连候选，保留原 relay、主机名称和认证设置。
5. 如果启用“直连优先”，在可达状态发生变化时请求切换；连接管理器负责故障回退，避免插件与核心延迟策略不断争抢。
6. 在插件入口初始化和 `AppState` 恢复 `active` 时检查；前台进行适度轮询。多次执行保持幂等，清理时取消所有任务。

不建议首版从扫描整个局域网或读取 Wi-Fi SSID 开始。获取目标 PC 自己上报的少量地址，再由手机验证，更直接；换网后只要 relay 可用，也能重新取得 PC 的新地址。同一个 Wi-Fi 名称或相同网段不能证明可达，实际 TCP / WebSocket 结果才决定是否配置。

`/api/health` 只返回存活状态和时间戳，不能证明目标是已配对 PC，也不能证明认证后的 Paseo 协议可用。它最多是预筛选。`serverId` 比对能避免误连其他正常 daemon，但它自身不是密码学身份凭据；不可信网络还需要 TLS、VPN，或补充基于已认证通道的一次性身份验证设计。密码认证本身不加密直连流量。

地址是否可达、当前连接和最近成功记录应按设备处理，避免一台手机的网络判断影响其他客户端。地址清理只处理插件自己添加的候选，不能删除用户人工维护的连接。

来源：[存活接口](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/server/src/server/bootstrap.ts#L815)、[App 探测与握手](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/utils/test-daemon-connection.ts#L221)、[直连安全模型](https://paseo.sh/docs/security#direct-connections)、[AppState](https://reactnative.dev/docs/appstate)。

### 长期：补充公开的 App 连接 API

适合上游扩展的能力包括：读取当前 App 的连接摘要；按 `expectedServerId` 探测候选；原子地保存已验证的直连；设置“自动 / 直连优先 / relay 优先”策略；订阅连接变化。具体命名需与上游讨论，不能与已有 daemon 侧 `paseo.hosts` 混淆。

身份验证、凭据复用、本地持久化、活动连接切换和回退应继续由 App 核心拥有。插件负责候选发现、用户偏好和诊断展示。这样后续可以移除私有 bridge，保留主要插件逻辑。

## 7. 产品边界

| 场景 | 预期能力与限制 |
| --- | --- |
| 已通过 relay 连上 PC，手机与 PC 网络可直达 | 首版主要场景，能够获取新候选并进行自动配置 |
| PC 换 IP，relay 仍可用 | 可重新获取候选，更新同一个 host |
| 已保存直连，relay 不可用 | App 核心仍可尝试已保存地址；不应依赖插件保持加载 |
| 首次启动时 relay 不通，且没有可用直连地址 | 稳定版插件无法先下载并启动，不能承诺自动发现；需要核心发现机制或其他引导 |
| App 被系统挂起或退出 | 不承诺持续后台检测，恢复前台后重新检查 |
| 同一 Wi-Fi 但存在客户端隔离、防火墙或权限拒绝 | 探测失败时继续使用 relay，不把同网段误判为可达 |
| PC daemon 仅监听 loopback / socket | 需要先配置网络监听或额外转发；枚举网卡不会使服务自动对外可达 |
| 不同网络且没有可用路由、VPN 或入口 | 本方案不提供 NAT 打洞，继续使用 relay |

iOS 本地网络访问受系统权限控制；若以后引入 Bonjour，还需匹配服务声明和所需的原生支持。普通插件不能替 App 绕过这些条件。Apple 也明确说明普通 App 进入后台后会被挂起，所以“检测到就自动配置”应首先定义为 App 有执行机会时的行为。

另一个版本差异是：`v0.13.2` 在 host 断连时会卸载其客户端插件。2026-10-28 合并的 PR #8105 改为保留同一个 client 暂时断连期间的插件状态，但当时稳定版及 `v0.14.0-beta.1` 都尚未包含这个改动；direct / relay 切换仍会重建插件。初始化、写入和清理必须容忍重复执行。

来源：[稳定版插件卸载行为](https://github.com/getpaseo/paseo/blob/d2941157a8f91512daf54fc688241d416e8f5ebd/packages/app/src/plugins/catalog-sync.tsx#L20)、[PR #8105](https://github.com/getpaseo/paseo/pull/8105)、[发布状态说明](https://github.com/getpaseo/paseo/issues/7247#issuecomment-6465521194)、[Apple 本地网络说明](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)、[Apple 后台执行说明](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)。

## 8. 下一步与验证标准

建议先做一个锁定版本、可移除的最小原型，优先验证私有 bridge 在实际手机 App 中是否可用，再决定是否维护它或提交上游 SDK 扩展。先验证闭环，再完善管理界面。

原型需要覆盖以下真实行为：

- 通过 relay 进入后，客户端插件入口无需打开设置页即可启动；确认全局 store 和必要方法在发布版手机包中可见。
- LAN 直连握手成功后，同一 `serverId` 下只增加一条对应候选；重复执行不产生重复 host 或重复连接。
- 带密码、错误主机身份和认证失败的候选不会被错误保存；探测任务有超时并释放 socket。
- “自动保存地址”和“优先使用直连”分别验证；使用 relay 25 ms、直连 1 ms 的场景确认不会被默认 40 ms 阈值误导。
- 手机离开 LAN 后能回退 relay，回到 LAN 后按选定策略重新使用直连，agent 会话能继续。
- PC 换 IP、手机恢复前台、插件卸载重载、App 重启后结果保持一致，原有 relay 与人工配置保留。
- 在 iOS、Android 分别验证权限和网络行为；接口缺失时停止自动操作并给出可理解的状态。

本轮已经完成官方资料与固定版本源码核对、版本比较、本机状态检查和脚手架生成。尚未编写或安装直连插件，尚未执行手机端网络、自动写入或切换测试；上面的验收项是后续开发验证标准。
