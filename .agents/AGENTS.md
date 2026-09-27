## 约定

- 先执行mx-dev-guide了解mindx-work的开发规范
- 超过500行代码就要执行mx-audit进行代码审计

## 已知坑

- `pnpm dev` 报 "Port 5273 is already in use"：是上次会话残留的 vite 进程占用端口。先 `lsof -nP -iTCP:5273 -sTCP:LISTEN` 找到 PID，确认是 mindx-work 的 vite 后 `kill <PID>`，不要改端口。
- 一键起 app：`pnpm mac`（根 package.json，Vite + Electron 并行）。注意 pnpm 的 `--parallel` 必须放在 `dev` 子命令之前，放最后会被透传给 vite/electron 导致 Unknown option 报错。
