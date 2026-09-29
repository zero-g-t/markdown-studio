@echo off
setlocal EnableExtensions DisableDelayedExpansion

chcp 65001 >nul
title Markdown Studio - Release Build
cd /d "%~dp0"

set "DIST_DIR=dist"
set "RELEASE_DIR=release"
set "SKIP_INSTALL=0"
set "ZIP_NAME="

rem ---------------------------------------------------------------- 参数解析
if "%~1"=="" goto :checkEnv
if /i "%~1"=="clean" goto :clean
if /i "%~1"=="help" goto :help
if /i "%~1"=="-h" goto :help
if /i "%~1"=="--help" goto :help
if /i "%~1"=="--no-install" set "SKIP_INSTALL=1" & goto :checkEnv
if /i "%~1"=="-NoInstall" set "SKIP_INSTALL=1" & goto :checkEnv

echo [错误] 未知参数：%~1
echo.
goto :help

rem ------------------------------------------------------------------ 帮助
:help
echo Markdown Studio 正式包构建脚本
echo.
echo 用法：
echo   build.bat               安装依赖（如缺失）并构建 dist，再压缩到 release 目录
echo   build.bat --no-install  跳过依赖安装，直接构建并打包（本机已 npm ci 过）
echo   build.bat clean         清理 dist 与 release 目录
echo   build.bat help         显示本帮助
echo.
echo 产物：
echo   %%CD%%\dist                       可直接“加载已解压的扩展程序”的扩展目录
echo   %%CD%%\release\markdown-studio-^<版本^>.zip   用于 Chrome Web Store 上传的压缩包
echo.
exit /b 0

rem ------------------------------------------------------------------ 清理
:clean
echo [清理] 正在删除构建产物...
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
echo [完成] 已清理 %DIST_DIR% 与 %RELEASE_DIR%
echo.
exit /b 0

rem -------------------------------------------------------------- 环境检查
:checkEnv
echo ==============================================================
echo   Markdown Studio 正式包构建
echo ==============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 及以上版本：https://nodejs.org
  echo.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm，请确认 Node.js 安装是否完整。
  echo.
  exit /b 1
)

if not exist "package.json" (
  echo [错误] 当前目录未找到 package.json，请在项目根目录执行本脚本。
  echo.
  exit /b 1
)

for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%v"
if not defined APP_VERSION set "APP_VERSION=0.0.0"
echo [信息] 项目版本：%APP_VERSION%

call node -v
call npm -v
echo.

rem ------------------------------------------------------------ 安装依赖
if "%SKIP_INSTALL%"=="1" (
  echo [跳过] 已指定 --no-install，不检查依赖安装。
  echo.
  goto :build
)

if exist "node_modules" (
  echo [信息] 已存在 node_modules，跳过安装（如需重装请先删除该目录或使用 npm ci）。
  echo.
  goto :build
)

echo [1/3] 安装依赖：npm ci
call npm ci
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败。若仓库缺少 package-lock.json，请改用 npm install 后重试。
  echo.
  exit /b 1
)
echo.

rem ------------------------------------------------------------ 构建产物
:build
echo [2/3] 构建：npm run build
call npm run build
if errorlevel 1 (
  echo.
  echo [错误] 构建失败，未生成可用产物。
  echo.
  exit /b 1
)

if not exist "%DIST_DIR%\manifest.json" (
  echo.
  echo [错误] 未找到 %DIST_DIR%\manifest.json，构建产物不完整。
  echo.
  exit /b 1
)
if not exist "%DIST_DIR%\editor.html" (
  echo.
  echo [错误] 未找到 %DIST_DIR%\editor.html，构建产物不完整。
  echo.
  exit /b 1
)
echo [信息] 构建产物已就绪：%CD%\%DIST_DIR%
echo.

rem ------------------------------------------------------------ 打压缩包
echo [3/3] 打包到 %RELEASE_DIR%
set "ZIP_NAME=markdown-studio-%APP_VERSION%.zip"
set "ZIP_PATH=%CD%\%RELEASE_DIR%\%ZIP_NAME%"

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if errorlevel 1 (
  echo [错误] 无法创建 %RELEASE_DIR% 目录。
  echo.
  exit /b 1
)

if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"
if exist "%ZIP_PATH%" (
  echo [错误] 旧的压缩包被占用，无法覆盖：%ZIP_PATH%
  echo        请关闭占用该文件的程序后重试。
  echo.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%ZIP_PATH%' -CompressionLevel Optimal"
if errorlevel 1 (
  echo.
  echo [错误] 压缩失败，请确认 PowerShell 可用且磁盘空间充足。
  echo.
  exit /b 1
)

if not exist "%ZIP_PATH%" (
  echo.
  echo [错误] 压缩包未生成：%ZIP_PATH%
  echo.
  exit /b 1
)

set "ZIP_SIZE=0"
for %%F in ("%ZIP_PATH%") do set "ZIP_SIZE=%%~zF"
set /a "ZIP_KB=%ZIP_SIZE% / 1024"

echo.
echo ==============================================================
echo   构建打包完成
echo ==============================================================
echo   版本号  ：%APP_VERSION%
echo   扩展目录：%CD%\%DIST_DIR%
echo   压缩包  ：%ZIP_PATH%  ^(%ZIP_KB% KB^)
echo.
echo   本地调试  ：chrome://extensions ^-^> 开发者模式 ^-^> 加载已解压的扩展程序 ^-^> 选择 dist 目录
echo   上架商店  ：上传 %ZIP_NAME% 到 Chrome Web Store 开发者后台
echo.

endlocal
exit /b 0
