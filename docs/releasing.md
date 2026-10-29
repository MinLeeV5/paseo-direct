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
tar -xzf paseo-direct-1.0.1.tgz
paseo plugin install /absolute/path/to/package
```

归档包含 TypeScript 源码，由 Paseo 编译。安装时无需构建工具或 npm 依赖。

## 公开发布（单独执行）

- Git：将审核过的代码推送到配置的 repository，建立版本 tag / release，再从 Git URL 与 tag 安装验证。当前本地完成不代表远端已有这些内容。
- npm：先确认发布账号拥有包名、检查 npm pack 内容，再显式执行 npm publish。不要把占用情况或发布权限当成已经确认。
- Paseo 插件目录：按官方 [Publishing](https://paseo.sh/docs/plugins/publishing) 提交 listing，填写英文介绍、兼容版本、来源、图标、截图及隐私说明。此项目的中英文 OVERVIEW 可直接作为审核素材。

CI 仅验证和上传构建 artifact，不包含自动发布凭据。首次公开发布前还应确认 repository 访问权限和来源地址。
