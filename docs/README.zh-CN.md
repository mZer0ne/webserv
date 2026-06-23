# WebServ

现代跨平台桌面应用程序，用于本地 Web 开发。

## 描述

WebServ 是一款桌面应用程序，旨在通过提供现代化的跨平台解决方案来简化本地 Web 开发。它利用 Electron 提供原生的桌面体验，使用 React 构建动态用户界面，并通过 `dockerode` 集成 Docker 来管理本地 Web 开发环境。该工具旨在简化您本地机器上各种 Web 服务和项目的设置和管理。

## 功能

*   **跨平台**: 可在 Windows、macOS 和 Linux 上使用。
*   **本地 Web 开发环境管理**: 轻松管理您的 Web 项目和服务。
*   **Docker 集成**: 利用 Docker 容器实现隔离和一致的开发环境。
*   **现代用户界面**: 使用 React 构建，提供响应式和直观的用户体验。
*   **配置管理**: 使用 `electron-store` 和 `yaml` 进行持久化应用程序设置。

## 使用的技术

*   **Electron**: 用于构建跨平台桌面应用程序。
*   **React**: 用于构建用户界面的 JavaScript 库。
*   **TypeScript**: JavaScript 的类型化超集，可编译为纯 JavaScript。
*   **Vite**: 现代 Web 项目的快速构建工具。
*   **Dockerode**: 用于与 Docker 守护程序交互的 Node.js 模块。
*   **Axios**: 适用于浏览器和 Node.js 的基于 Promise 的 HTTP 客户端。
*   **Electron Log**: 适用于 Electron 的简单日志模块。
*   **Electron Store**: 像专业人士一样保存和加载数据。
*   **YAML**: 用于解析和字符串化 YAML。

## 安装

要获取本地副本并运行，请按照以下简单步骤操作。

### 先决条件

*   Node.js（推荐 LTS 版本）
*   npm（随 Node.js 提供）
*   Docker Desktop（或 Docker Engine）已安装并运行

### 步骤

1.  **克隆仓库:**
    ```bash
    git clone https://github.com/mZer0ne/WebServ.git
    cd WebServ
    ```
2.  **安装依赖项:**
    ```bash
    npm install
    ```

## 使用方法

### 开发模式

要在开发模式下运行应用程序：

```bash
npm run dev
npm run electron:dev
```

这将启动 Vite 开发服务器，然后启动 Electron 应用程序，从而实现热重载和更简单的调试。

### 构建生产版本

要为您的特定操作系统构建应用程序：

*   **适用于 Windows (64 位):**
    ```bash
    npm run electron:win
    ```
*   **适用于 macOS (ARM64):**
    ```bash
    npm run electron:mac
    ```

构建输出将位于 `release` 目录中。

## 贡献

贡献是使开源社区成为一个学习、启发和创造的绝佳场所的原因。非常感谢您的任何贡献。

1.  Fork 项目
2.  创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3.  提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4.  推送到分支 (`git push origin feature/AmazingFeature`)
5.  打开拉取请求

## 许可证

根据 MIT 许可证分发。有关更多信息，请参阅 `LICENSE` 文件。

## 作者

mZer0ne
