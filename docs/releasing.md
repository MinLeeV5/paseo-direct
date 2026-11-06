# 发布 Paseo Direct

本地构建与公开发布分开进行。以下命令不自动推送仓库、创建公开 release、提交插件目录或发布 npm。

## 构建与验收

1. 使用 Node 22，运行 `npm ci --ignore-scripts`。
2. 同时更新 `package.json`、`shared/version.ts` 和 `CHANGELOG.md`，并更新锁文件。manifest 的 Paseo 兼容范围保持为 `>=0.13.0`，连接接口兼容性由运行时能力检查确认。
3. 运行 `npm run release:pack`，生成 `dist/paseo-direct-<version>.tgz` 和同名 `.sha256`。
4. 运行 `npm run verify:daemon -- dist/paseo-direct-<version>.tgz`。测试使用独立 daemon，结束时确认清理。
5. 用支持版本的实际 App 验证设置持久化、前后台、Relay 切换与网络故障回退。记录设备、版本和真实结果，不能用 Web 验收代替 iOS 验收。
6. 检查打包清单、英文与中文 OVERVIEW、512px PNG 图标、使用示例数据的当前界面截图。包中不应有 node_modules、凭据、测试报告或本机配置。

## 本地分发

接收者校验 SHA-256 后，解压分发包并安装其中的目录：

```sh
tar -xzf paseo-direct-1.2.4.tgz
paseo plugin install /absolute/path/to/package
```

归档包含 TypeScript 源码，由 Paseo 编译。安装时无需构建工具或 npm 依赖。

## 公开发布（单独执行）

- Git：将审核过的代码推送到配置的 repository，建立版本 tag / release，再从 Git URL 与 tag 安装验证。当前本地完成不代表远端已有这些内容。
- npm：先确认发布账号拥有包名、检查 npm pack 内容，再显式执行 npm publish。不要把占用情况或发布权限当成已经确认。
- Paseo 插件目录：按官方 [Publishing](https://paseo.sh/docs/plugins/publishing) 提交 listing，填写英文介绍、兼容版本、来源、图标、截图及隐私说明。此项目的中英文 OVERVIEW 可直接作为审核素材。

CI 仅验证和上传构建 artifact，不包含自动发布凭据。首次公开发布前还应确认 repository 访问权限和来源地址。

## 更新已收录的 Git 插件

官方目录记录为 [`plugins/minleev5/direct.json`](https://github.com/getpaseo/plugins/blob/main/plugins/minleev5/direct.json)，安装 ID 为 `minleev5/direct`。Git 插件的新标签不会自动触发目录更新；每次发布后都需要按官方 [手动 Git 更新流程](https://github.com/getpaseo/plugins#submit-a-plugin) 提交。

1. 确认公开稳定版、发布说明和验证记录。同步英文 `OVERVIEW.md` 与 `OVERVIEW.zh-CN.md`，说明当前配置步骤、升级要求、数据去向与验证边界；目录介绍不放安装命令或 changelog。
2. 从官方 `getpaseo/plugins` 的最新 `main` 创建分支，通过自己的 fork 提交 PR。已有记录可直接更新，无需重复提交首次收录申请。
3. 将 `artifact.commit` 与 `repository.commit` 固定到同一个公开、可达的 40 位提交号。若保留 `artifact.tag`，必须确认标签仍指向该提交。发布后补充说明的提交可沿用相同运行版本，以其精确提交号送审并省略标签；不要移动已发布的版本标签。
4. 保留原有 ID、来源、分类、提交者、`submittedAt` 与 `publishedAt`。`reviewedAt` 留待官方审核更新。作者 OVERVIEW 优先于目录里的说明副本，应直接更新作者文件。
5. 在目录仓库运行可信验证脚本：

   ```sh
   node scripts/validate.ts --online --changed --base origin/main
   ```

   此命令针对已提交到分支的改动。macOS 若临时目录符号链接触发路径检查，可使用 `TMPDIR=/private/tmp`。目录审核遵循官方 [Review policy](https://github.com/getpaseo/plugins/blob/main/REVIEW.md)，静态检查插件内容，不执行插件或依赖代码；作者自己的发布 CI 与安装验证另行记录。

6. PR 正文简述插件名、版本变化与待审核状态，把功能变化、精确提交、发布 / 对比 / 验证链接和检查结果放入折叠详情。提交后核对官方 CI 与审核反馈；只有审核合并并发布后，目录安装才使用新版本。
