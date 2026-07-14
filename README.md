# 私有云传输

局域网内手机和电脑文件互传工具。电脑端启动一个本地 HTTP 传输服务和管理界面，手机端通过扫码或手动输入连接信息，把图片、视频、文档等文件分片上传到电脑；电脑端也可以把本地文件加入列表，供手机端下载。

## 快速交接

- 当前主线：`apps/desktop` 是可运行的电脑端服务和 Electron 桌面壳，`apps/mobile` 是 Expo/React Native 手机端，`packages/shared` 放两端共用的协议常量和上传工具。
- 常用启动：Windows 双击 `start-private-cloud.bat`，或命令行运行 `npm run desktop:app`。
- 常用停止：双击 `stop-private-cloud.bat`，会停止占用默认端口 `5188` 的本项目进程。
- APK 打包：运行 `build-mobile-apk.bat`，输出到 `apps/desktop/public/releases/private-cloud-transfer.apk`，日志写到 `build-mobile-apk.log`。
- 默认服务端口：`5188`。可用 `PORT` 环境变量覆盖。
- 默认数据目录：项目根目录下的 `data/`。可用 `PRIVATE_CLOUD_DATA_DIR` 环境变量覆盖。
- 局域网地址识别异常时，用 `LAN_HOST` 手动指定电脑 IP。

## 一键脚本

| 脚本 | 作用 | 备注 |
| --- | --- | --- |
| `start-private-cloud.bat` | 启动桌面端应用 | 先调用停止脚本清理旧进程，再执行 `scripts/start-private-cloud.ps1`，最终启动 `npm run desktop:app`。 |
| `stop-private-cloud.bat` | 停止桌面端应用 | 调用 `scripts/stop-private-cloud.ps1`，按 `.run-logs/private-cloud-desktop.pid`、默认端口 `5188` 和窗口标题清理进程。 |
| `build-mobile-apk.bat` | 构建 Android release APK | 如缺少 `apps/mobile/android/gradlew.bat` 会先跑 `npm run prebuild:android`，再执行 Gradle `assembleRelease`，并把 APK 复制到桌面端发布目录。 |
| `android/gradlew.bat` | 根目录 Android 工程 Gradle Wrapper | 根目录 Android 工程的构建入口。当前 APK 打包脚本不走这里。 |
| `apps/mobile/android/gradlew.bat` | 移动端 Android 工程 Gradle Wrapper | `build-mobile-apk.bat` 实际使用的 Gradle 入口。 |

PowerShell 实际逻辑在 `scripts/`：

- `scripts/start-private-cloud.ps1`：创建 `.run-logs/`，打开一个 `cmd` 窗口并运行 `npm run desktop:app`，把启动器 PID 写入 `.run-logs/private-cloud-desktop.pid`。
- `scripts/stop-private-cloud.ps1`：读取 PID 文件，查找监听 `PORT` 或 `5188` 的进程，并按窗口标题 `private-cloud-desktop*` 做兜底清理。

## 代码结构

```text
private-cloud/
  apps/
    desktop/
      src/
        server.js          # Node HTTP 服务入口，负责路由、鉴权、静态页面和二维码接口
        storage.js         # 文件落盘、分片任务、目录、标签、设置、AI 标签等持久化逻辑
        network.js         # 局域网 IPv4 探测，支持 LAN_HOST 覆盖
        electron-main.js   # Electron 主进程，启动桌面窗口和本地服务
        preload.js         # Electron preload，暴露受控桌面能力给页面
      public/
        desktop/           # 电脑端管理页面，上传列表、目录、标签、设置等 UI
        mobile/            # 手机浏览器调试页和移动端安装页
        releases/          # APK 发布目录，build-mobile-apk.bat 会写入这里
      test/                # Node test 测试用例
    mobile/
      App.tsx              # Expo 手机端主界面，扫码、连接、上传、下载入口
      src/
        api/client.ts      # 手机端请求电脑端 API 的客户端封装
        transfer/chunkUploader.ts
                           # 手机端分片上传实现
      android/             # Expo prebuild 生成的 Android 原生工程，当前 APK 构建入口
  packages/
    shared/
      src/index.js         # 两端共享协议、请求工具、分片上传通用逻辑
      src/index.d.ts       # shared 包类型声明
  docs/
    01-product-requirements.md
    02-technical-design.md
    03-development-plan.md
  scripts/
    start-private-cloud.ps1
    stop-private-cloud.ps1
  data/                    # 运行时数据，上传文件、设置、标签、目录清单等
  .run-logs/               # 启停脚本 PID 和运行日志目录
```

注意：项目里同时存在根目录 `android/` 和 `apps/mobile/android/`。目前 `build-mobile-apk.bat` 明确使用 `apps/mobile/android/`，交接时优先维护这一份移动端 Android 工程。

## npm 命令

| 命令 | 作用 |
| --- | --- |
| `npm run desktop` | 启动电脑端浏览器模式，只运行 Node 服务。 |
| `npm run desktop:app` | 启动 Electron 桌面应用，内部会启动本地传输服务并打开管理台。 |
| `npm run mobile` | 启动 Expo 开发服务，用于调试手机端 App。 |
| `npm test` | 运行桌面端 Node 测试：`apps/desktop/test/*.test.js`。 |
| `npm run android` | 运行 Expo Android 调试构建。 |
| `npm run ios` | 运行 Expo iOS 调试构建。 |

## 本地运行

安装依赖：

```bash
npm install
```

电脑端桌面应用：

```bash
npm run desktop:app
```

电脑端浏览器模式：

```bash
npm run desktop
```

移动端 Expo：

```bash
npm run mobile
```

如果自动识别出的局域网 IP 不是手机能访问的地址，手动指定：

```powershell
$env:LAN_HOST="192.168.1.10"; npm run desktop:app
```

如果端口冲突，手动指定：

```powershell
$env:PORT="5199"; npm run desktop:app
```

## 调试流程

1. 电脑上运行 `start-private-cloud.bat` 或 `npm run desktop:app`。
2. 在电脑端管理台查看连接二维码。
3. 手机端打开 Expo App 扫码连接，或访问电脑端展示的移动端调试地址。
4. 手机选择文件上传，电脑端在文件列表中查看结果。
5. 电脑端可上传本地文件到管理台，手机端刷新后下载。
6. 调试完成后运行 `stop-private-cloud.bat`。

## 数据目录

默认运行数据在 `data/`：

```text
data/
  uploads/                 # 上传任务元数据和分片缓存
  completed/               # 手机上传完成后的文件默认存放位置
  outbox/
    files/                 # 电脑端上传到管理台后托管的文件副本
    manifest.json          # 电脑发送给手机的文件清单
  directories.json         # 管理台虚拟目录结构
  settings.json            # 存储目录和 AI 标签服务设置
  tags.json                # 文件标签
  ai-tag-errors.log        # AI 打标签失败日志
```

想把运行数据放到其他位置：

```powershell
$env:PRIVATE_CLOUD_DATA_DIR="D:\PrivateCloudData"; npm run desktop:app
```

## 主要接口

服务入口在 `apps/desktop/src/server.js`。核心接口包括：

- `GET /api/health`：健康检查。
- `GET /api/connect-info`：获取手机连接信息。
- `GET /api/connect-qr.svg`：连接二维码。
- `GET /api/mobile-install-info`、`GET /api/mobile-install-qr.svg`：移动端安装信息和安装二维码。
- `POST /api/uploads/init`：初始化上传任务。
- `PUT /api/uploads/:uploadId/chunks/:chunkIndex`：上传单个分片。
- `GET /api/uploads/:uploadId`：查询上传任务和已完成分片。
- `POST /api/uploads/:uploadId/complete`：合并分片并生成文件记录。
- `GET /api/files`、`GET /api/files/search`：文件列表和搜索。
- `GET /api/files/:fileId/download`：下载已登记文件。
- `POST /api/directories`、`GET /api/directories`：目录管理。
- `GET /api/tags`、`POST /api/tags`：标签管理。
- `GET /api/settings`、`PUT /api/settings/file-storage`、`PUT /api/settings/ai-provider`：设置管理。

除健康检查、连接信息和二维码外，`/api/` 接口需要带 `x-pair-token`。

## APK 构建

Windows 下推荐直接运行：

```bat
build-mobile-apk.bat
```

构建流程：

1. 检查 `apps/mobile/android/gradlew.bat` 是否存在。
2. 不存在则在 `apps/mobile` 下执行 `npm run prebuild:android`。
3. 在 `apps/mobile/android` 下执行 `gradlew.bat assembleRelease --no-daemon --console=plain`。
4. 复制 `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` 到 `apps/desktop/public/releases/private-cloud-transfer.apk`。
5. 全量日志写入 `build-mobile-apk.log`。

## 验证命令

```bash
node --check apps/desktop/src/server.js
node --check apps/desktop/src/electron-main.js
node --check apps/desktop/src/preload.js
npx tsc --noEmit -p apps/mobile/tsconfig.json
npm test
```

## 当前边界

- 传输优先走局域网直连，不经过公网云盘。
- 手机上传到电脑已支持分片上传、并发上传和基础续传结构。
- 电脑发送到手机已支持文件登记和下载。
- 手机端下载目前仍偏调试链路，后续需要完善原生保存目录和权限处理。
- 配对令牌在服务启动时生成，过期后页面会刷新连接信息。
- SHA-256 完整性校验、暂停继续、失败重试体验、Electron 安装包仍是后续工作。
