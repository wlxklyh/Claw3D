# Paperclip 工作台接入

打开 `/paperclip`，可在 Claw3D 的 3D 办公室中查看一个真实 Paperclip 公司的岗位、任务、运行记录、成果以及人工与异常待办。原有 OpenClaw `/office` 入口继续独立使用。

此版本是**只读数据适配器**。它不会创建示例岗位、虚构活动或自动批准事项。新建任务、分派任务、回复问题、审批和人工验收会跳转到该公司的 Paperclip 原始页面，由用户在那里完成；权限检查和审计记录由 Paperclip 保持。

## 本机配置与启动

使用 Node.js 20+、npm 10+。Claw3D 前端本身不要求 WSL、Docker 或数据库；Paperclip 服务需要单独安装、启动并完成公司初始化。

在 Claw3D 仓库目录执行 `npm ci`，然后创建被 Git 忽略的 `.env.local`：

```dotenv
PAPERCLIP_BASE_URL=http://127.0.0.1:3100
PAPERCLIP_COMPANY_ID=<真实公司的 UUID>
# 仅在 Paperclip 部署要求认证时设置服务端凭据：
# PAPERCLIP_API_TOKEN=
```

服务地址必须是 HTTP(S) origin，不带路径、查询参数或内嵌账号密码。公司 UUID 来自 Paperclip API；不能用公司名称或任务编号代替。不要将凭据放进 `NEXT_PUBLIC_*` 变量、浏览器存储或版本库。

Windows PowerShell 中，在启动命令前设置监听地址和端口：

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
npm run dev
```

自定义 Node 服务在 Next.js 读取 `.env.local` 之前就解析监听地址，所以启动脚本应明确设置 `HOST`。打开 `http://127.0.0.1:3000/paperclip`。修改连接配置后重启 Claw3D；重启前先确认该端口是否已有本项目服务，避免启动第二份。

前台启动的服务使用该终端中的 `Ctrl+C` 停止。后台启动时应记录本次创建的 PID，停止前核对 PID、命令行和监听端口，不能按 `node.exe` 名称批量终止进程。更改本工作台配置不需要停止 Paperclip。不要把本机可信模式的 Paperclip 数据通过无保护的公共 Claw3D 地址暴露出去。

## 页面如何使用

1. 点击 3D 角色或岗位卡，查看该岗位的任务、成果和运行记录；“所有岗位”取消岗位筛选。项目筛选可切换同一公司内的不同项目。
2. 任务状态来自 Paperclip 任务记录。点击任务后，通过“查看任务 / 分派”进入原任务；顶部“新建 / 分派任务”打开该公司的任务页。
3. “成果”只展示 Paperclip 已登记的文档、附件和工作产物。任务完成不会被转换成虚构文件。成果链接打开其所属任务中的原始产物。
4. “人工待办”始终有固定入口，只统计明确需要人工处理的事项。它合并统一待办流与明确分派给人工的未完成任务，按任务去重；AI、共享处理和未知处理规则的项目保留在下方“协作与异常”，不计入人工数量。点击查看原因、关联任务、处理人规则、可用操作、绑定文档版本及后续流程，再进入原始事项。人工任务使用“打开任务并操作”，不会被当作产物审批；有依赖关系时显示需要先完成和受影响的任务与岗位。
5. Paperclip 处理完成后，本页会在下一次读取时反映变化。按钮跳转和提交回应本身都不代表 Agent 已恢复运行；只有实际运行记录能确认恢复。

## 运行与审核的显示规则

- 浏览器每次请求结束后等待 8 秒再读取；标签页隐藏时停止定时读取，重新可见时立即刷新。这是轮询视图，不是逐事件直播。
- 只有 `/live-runs` 中未结束的 `running` 记录会驱动“运行中”角色。排队、任务分配以及 `in_progress` 任务状态都不能证明进程正在执行。
- 角色空闲时的行走是空间表现，不代表工具调用。日志链接指向真实运行记录。客户端读取请求 20 秒超时；快照超过 30 秒未更新时，即使请求尚未返回，也停止把缓存角色显示为运行中。连接失败或快照过期后保留最近数据并明确标示状态待更新。
- 上游有些任务交接会结束旧运行。仅当状态为 `cancelled` 且原因精确为 `Cancelled before issue reassignment` 时，额外显示“因任务交接结束”；原始“已取消”状态和日志仍保留。暂停或其他取消不套用此说明，也不从交接推断产物成功。
- 统一待办包含决策、审批、任务问答、验收和异常，不等于全部必须人工处理。`human_only`（兼容旧 `board_only`）标为必须人工；`anyone` / `not_creator` 保留可由获授权 Agent 处理的含义。执行阶段的当前参与人另行区分人工验收和 AI 验收。
- `blocker_attention` 依据关联任务的 `unblockDescriptor.owner` 与 `assigneeUserId` 区分人工或 Agent 处理。普通失败运行不会仅因失败就标成必须人审。人工操作后的恢复必须等待真实核验和调度，页面不自动解除阻塞。
- 终端阻塞项以 `subject` 指向的任务作为处理对象，`relatedIssue` 可能只是被影响的父任务，不能借用父任务的处理人规则。Paperclip 只对人工/board 所有者生成的恢复操作也列入人工待办。
- 问答或确认绑定的 `target.revisionId` / `revisionNumber` 与任务当前文档版本分别展示。版本已变化会提示核对；没有绑定版本则明确说明，不能把当前文档默认为已批准的版本。
- 后续流程仅展示服务端已配置的验收阶段、退回负责人及继续策略。`none` 不会自动唤醒；`wake_assignee_on_accept` 仅在接受后按配置唤醒。
- WebGL 出错或图形连接丢失时，3D 区域显示降级提示，可手动“重新载入 3D”；岗位、任务、成果和待办仍可使用，也可主动收起 3D。某个浏览器或软件渲染配置下成功显示，不代表所有 GPU、浏览器或首次加载都已通过。

## 只读接口契约

Claw3D 的 `GET /api/paperclip/snapshot` 仅请求服务端配置的 Paperclip 地址，返回列入白名单的展示字段，不返回原始 Agent 配置、密钥或环境变量。

| Paperclip GET 接口（均在 `/api` 下） | 用途 |
| --- | --- |
| `/companies/:id` | 公司名称和真实公司 URL 前缀 |
| `/companies/:id/agents` | 真实岗位名册、状态和适配器类型 |
| `/companies/:id/issues?limit=100&offset=…&sortField=updated&sortDir=desc&includeBlockedBy=true` | 分页读取任务、人工负责人和阻塞依赖，最多 1,000 条，达到上限时明确提示 |
| `/companies/:id/projects` | 项目筛选 |
| `/companies/:id/live-runs?limit=100` | 活跃运行；不设置用于补充历史记录的 `minCount` |
| `/companies/:id/heartbeat-runs?summary=true&limit=30` | 最近运行及日志入口 |
| `/companies/:id/attention?all=true&sort=decide` | 决策、审批、任务交互与异常的统一视角 |
| `/companies/:id/artifacts?limit=50` | 最近成果；更多成果通过完整成果库查看 |

选择待办后，`GET /api/paperclip/issues/:id` 先读取原任务并验证其属于当前配置公司，再读取任务交互。它只返回审核所需的执行状态、策略、文档修订摘要和交互的继续策略。所有站内跳转必须位于配置服务的同源、同公司路径下。

上述两个 Claw3D 接口不提供 POST、PATCH 或 DELETE 操作，也不代理任务调度或审批提交。Paperclip 页面自己的登录态由 Paperclip 管理，Claw3D 不代替用户建立浏览器登录会话。

## 故障定位与验证边界

未设置公司时，接口返回 503 并提示配置；服务无法连接、公司不匹配或必要 API 失败时，页面显示原因。待办等可选来源读取失败会标为未知，不能把失败当成“没有待办”。

`attention` 接口需要 Paperclip 的 board 用户上下文。本机 `local_trusted` 部署可提供本地 board 上下文；单独的 Agent API token 通常不能读取这一接口。认证部署应先确认该部署允许的 board 认证方式，不能通过放宽权限来掩盖 403。

最小真实验收应检查：公司与岗位 ID 一致、任务与成果链接落在正确公司、真实运行开始和结束能够反映在岗位状态中、待审事项包含正确任务/文档版本、处理人规则没有把 AI 验收误标成人审，以及桌面和窄屏交互可用。未配置页、单元测试中的构造数据和静态设计图均不能替代真实数据验收。

可运行 `npm run typecheck`、`npx vitest run tests/unit/paperclip.test.ts`，以及针对 `src/lib/paperclip`、`src/features/paperclip`、`src/app/paperclip`、`src/app/api/paperclip` 的 ESLint 检查。全仓测试或 lint 结果应分别记录本次改动与既有问题。包含真实任务内容的浏览器截图保存在本机被忽略的 `output/playwright/`，不随源码提交。

## 定制、上游更新与回滚

岗位名称、岗位职责、任务和项目在 Paperclip 中配置，本页读取真实记录；不在组件内硬编码个人岗位或公司 ID。界面定制集中在 `src/features/paperclip/`，展示字段与只读边界在 `src/lib/paperclip/`，页面和接口入口在 `src/app/paperclip/` 与 `src/app/api/paperclip/`。尽量保留原有 OpenClaw 入口和共享3D组件的默认行为；修改接口映射时同时更新边界测试。

上游仓库是 `https://github.com/iamlukethedev/Claw3D.git`。定制分支保存在自己的 fork，更新时先确认工作区干净并保存已验证代码的提交号或备份分支；未提交的定制不能靠上游合并来保存。私有 `.env.local` 和被忽略的证据不在 Git 备份内，应另行保留。此接入文档不表示已经执行过一次上游升级。

若没有 `upstream` remote，可先执行 `git remote add upstream https://github.com/iamlukethedev/Claw3D.git`。已有时先用 `git remote -v` 核对，不能盲目覆盖。随后 `git fetch upstream`、`git remote set-head upstream -a`，新建升级验证分支，再合并 `upstream/HEAD`；在合并前确认当前工作目录与分支，勿使用 `reset --hard` 覆盖未保存工作。发生冲突且决定放弃本次合并时使用 `git merge --abort`。

升级后按锁文件运行 `npm ci`，执行上述类型、定向 lint 和测试，再连接真实公司复验角色状态、任务/成果链接和人工规则。验证通过后才将合并结果纳入定制主分支。需要回退已完成的合并时，先检查工作区并保存新工作；可在备份提交上建立新的恢复分支，或由维护者审查后对合并提交执行 revert，保留历史。更换运行版本前应停掉已核对归属的 Claw3D 进程，确认端口释放，再使用该版本锁文件安装并按本页启动方法运行。

这些 Git 操作只回退 Claw3D 代码，不会回退 Paperclip 的任务、成果或数据库，也不会撤销已经由用户在 Paperclip 中作出的决定。停止后检查端口无监听，重启后确认实际显示所选公司与最新读取时间；不以浏览器仍能显示旧快照当作服务恢复证据。
