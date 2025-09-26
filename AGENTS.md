# AGENTS.md – AI Agent 开发协作指南

**项目名称**：基于 Chatwoot API 的 Next.js 在线聊天网页

---

## 🎯 核心原则

在执行任何开发任务前，AI Agent **必须**完成以下两步：

1. **深度理解 Chatwoot SDK/API 规范**
2. **全面扫描现有代码库**  
   **禁止**在未完成上述步骤时直接生成代码或提供建议。

---

## 🔍 任务执行前必做事项

### 1. 收集需求相关 Chatwoot SDK/API 信息

- **官方 SDK Swagger**（优先使用 [Chatwoot 官方文档](docs/chatwoot/swagger/)）

### 2. 分析现有代码库

在生成新代码前，必须：

- **扫描 `package.json`**：确认是否已安装 `@chatwoot/sdk` 或相关依赖
- **检查 `next.config.js`**：是否存在环境变量配置（如 `NEXT_PUBLIC_CHATWOOT_URL`）
- **审查现有组件**：
  - 是否存在 `ChatWidget.tsx` 或类似组件？
  - 是否已实现身份验证逻辑（如 `setUser`）？
  - 是否有自定义消息渲染逻辑？
- **验证路由结构**：确认聊天页面路径（如 `/support`）

> 💡 **Agent 行动**：若代码库结构未知，应要求用户提供：  
> _“请分享 `src/components/` 和 `src/lib/` 目录结构，以及 `env.local` 中的 Chatwoot 相关变量。”_

---

## 🛠️ 开发任务执行规范

### ✅ 允许的行为

- **基于官方 SDK 生成代码**：优先使用[Chatwoot 官方文档](docs/chatwoot/swagger/)定义的接口标准，次优使用 `@chatwoot/sdk`
- **复用现有模式**：若项目已用 TypeScript，则新代码必须严格遵循类型定义
- **环境变量隔离**：所有敏感配置（如 `websiteToken`）必须通过 `process.env.NEXT_PUBLIC_*` 注入
- **错误边界处理**：为聊天组件添加 `ErrorBoundary` 并记录 `console.error`

### ❌ 禁止的行为

- 假设 Chatwoot 配置（如默认 `baseUrl` 为 `https://app.chatwoot.com`）
- 生成未经过类型检查的 JavaScript 代码（项目使用 TS 时）
- 修改未明确授权的文件（如直接修改 `next.config.js` 而不说明原因）

---

## 🚨 关键检查清单（任务完成前自检）

- [ ] 所有 API 调用均通过 `lib/chatwoot/client.ts` 封装
- [ ] 敏感配置通过环境变量注入（非硬编码）
- [ ] 组件支持 SSR/SSG（使用 `useEffect` 初始化 SDK）
- [ ] 已处理用户身份同步（`window.$chatwoot.setUser()`）
- [ ] 包含离线状态降级方案（如网络错误提示）

---

## 💬 与用户协作话术模板

- **信息缺失时**：
  > “为确保代码兼容性，请提供 Chatwoot 的 `websiteToken` 格式（是否包含 `-`）及用户属性字段列表。”
- **代码冲突风险时**：
  > “检测到 `src/lib/api.ts` 已存在 Chatwoot 服务，请确认是否复用该文件，或新建独立模块？”
- **功能边界模糊时**：
  > “您需要的是基础聊天窗口，还是包含自定义消息模板/文件上传的高级功能？请明确范围。”

---

> **最后提醒**：本项目的核心是 **安全集成** 与 **无缝体验**。任何代码生成必须以官方文档为基准，以现有代码为上下文。**宁可多问，不可假设。**
