[English](README.md) | [简体中文](README.zh-CN.md)

# vscode-ai (Void) / opencode for the Web

Run and manage CLI coding agents from the browser: opencode, Claude Code, pi, and more; multi-window / multi-tab terminals, multiple projects, prompt workflows, Markdown preview, static sites / reverse proxy / LLM relay, phone remote control, and portable packages — all in one web UI.

> **Keywords (for search)**: opencode web UI, Claude Code web UI, pi agent, browser terminal, web terminal, online terminal, multi-window terminal, multi-session terminal, multi-project file tree, workflow orchestration, prompt workflow, Markdown preview, complex tables, Mermaid flowchart, line chart, pie chart, ECharts, PPT presentation, static site hosting, reverse proxy, Nginx rules, LLM relay, OpenAI-compatible API, API gateway, Postman, Navicat, YAML, Base64, remote access, phone remote control, portable package, Windows, macOS, Vue 3, Vite, TypeScript, Node.js, node-pty, WebSocket.

## What problems does it solve?

- **CLI coding agents (opencode, Claude Code, pi) lack a web workspace and switching projects/sessions is tedious**: a multi-window / multi-tab terminal in the browser; sessions live on the server, so closing the page or losing network does not kill them.
- **Prompts are scattered and hard to reuse**: organize them into workflows / groups / stages, then fill the input or run a whole group with one click.
- **Docs, charts, and presentations live in different tools**: Markdown preview ships with complex tables, line/bar/pie charts, and a PPT presentation mode.
- **Local static sites, API forwarding, and LLM key management are fiddly**: built-in static site hosting, reverse proxy, and LLM relay with visual configuration.
- **opencode usage across team machines is hard to aggregate**: collaboration modules cover group members, group chat, and machine usage reporting.
- **Target machines should not need Node or native compilers**: portable packages bundle the Node runtime and node-pty; unzip and run.
- **Both Chinese and English users need it**: the UI and messages support zh-CN and English, switchable at runtime.

## Features

- **Agents and web multi-window management**: run opencode, Claude Code, pi, and other CLI coding agents in the same web terminal; manage multiple sessions/windows as tabs, with reconnect and buffer replay.
- **Terminals and sessions**: multi-session tabs, reconnect with buffer replay, session notes/descriptions, message history, and prompt collection.
- **Projects and files**: multi-project file tree, file preview/edit, code search, Git statistics, and code line counting.
- **Workflows**: workflows → groups → stages → skills (Markdown files) stored as folders; stage prompt chips; reload from files and edit prompts in place. The workflow editor edits the current project's `.void/workflows` directly (refresh, move, delete, and restore-default all apply to project files).
- **Markdown enhancements**: complex tables, Mermaid flowcharts (branches, back-edges, subgraphs, custom colors), Mermaid `xychart-beta` line/bar charts, `pie` charts (rendered as ECharts), `mermaid row` side-by-side charts, `mermaid-data` data scripts, and PPT presentation; diagrams share a blue tech theme.
- **Toolbox**: TXT/Markdown, YAML, translation, Postman (curl history), Navicat (MySQL / PostgreSQL / SQLite / Redis), Nginx, Base64.
- **Static sites / reverse proxy / LLM relay**: static directory hosting, SPA fallback, site prefix, request capture; expose via path or dedicated port; issue JWTs for external machines to call upstream models.
- **Collaboration and statistics**: group members, group chat, machine usage reporting, token statistics.
- **Scheduled tasks and queues**: shell / AI tasks; the job queue supports SQLite (default) or MySQL.
- **Remote access and phone control**: temporary remote access (password / expiry / failed-attempt lockout); open `/?phone=1` on a phone to control desktop sessions.
- **Internationalization**: zh-CN and English messages share one source; the UI switches instantly.

## Tech stack

### Frontend (`web/`)

- **Framework**: Vue 3 (`<script setup>` + Composition API), TypeScript, Vite
- **Terminal**: `@xterm/xterm` + `@xterm/addon-fit` (xterm v5)
- **Editor**: CodeMirror 6 (JS/TS, Python, Java, C/C++, Rust, PHP, SQL, YAML, JSON, Markdown, HTML/CSS/Sass/XML, and more)
- **UI**: Element Plus (tables, dialogs, messages)
- **Markdown / charts**: `markdown-it`, `highlight.js`, `mermaid`, `echarts`
- **Other**: `yaml`, `prettier`, `html-to-image`
- **Testing**: Vitest + `@vue/test-utils` + happy-dom; type checking with `vue-tsc`

### Backend (`server/`)

- **Runtime**: Node.js (ESM); `http.createServer` serves HTTP, static assets, and SSE
- **Realtime**: `ws` (WebSocket; protocol constants live in `shared/`)
- **Terminal**: `node-pty` (Windows ConPTY / macOS PTY)
- **Database**: Node built-in `node:sqlite` (`DatabaseSync`), single file `void.db`
- **Optional storage**: `mysql2` (job queue), `pg`, `redis`
- **Markdown / code processing**: `markdown-it`, `highlight.js`, `esbuild` (online minify/transform)
- **Testing**: `node:test`

### Shared layer (`shared/`)

- WebSocket protocol constants and types (single source of truth for client and server)
- zh-CN / English messages and `translate()` (`shared/i18n/`)
- Reusable logic for Markdown rendering, client-side chart enhancement, the PPT controller, CSV, file icons, and workflow grouping

### Build, test, and packaging

- npm workspaces (`shared` / `server` / `web`)
- Vite builds the frontend; `scripts/build*.js` assembles portable packages (bundled Node runtime + compiled node-pty)
- Tests: `node --test` (backend) + Vitest (frontend); `npm run typecheck`; `npm run check:i18n`

## Quick start

Requirements: Node.js ≥ 20 (prefer the same major version as the portable package so node-pty's ABI matches) and npm.

```bash
npm install
npm run dev            # start backend and frontend together (Ctrl-C stops both)
```

Or start them separately:

```bash
npm run dev:server     # backend at http://127.0.0.1:33333 (fixed dev port)
npm run dev:web        # Vite at http://127.0.0.1:5173 (proxies /api and /ws)
```

Open <http://localhost:5173>.

Production mode (serves `web/dist`):

```bash
npm run build:web
node server/index.js   # default http://127.0.0.1:22222 (port from data/port.txt)
```

> On Windows PowerShell, if `npm.ps1` is blocked by the execution policy, use `npm.cmd` instead.
> On a fresh clone, if npm blocks node-pty / esbuild install scripts, run `npm.cmd approve-scripts node-pty esbuild`.

## Portable packages

```bash
node scripts/build-all.js            # build the frontend first, then all platform packages
node scripts/build.js                # Windows standard package
node scripts/build-opencode.js       # Windows package with bundled opencode
node scripts/build-mac.js            # macOS (must run on macOS; builds arm64 + x64)
```

Artifacts go to `dist-portable/` as `vscode-ai-windows-x64-vYYYYMMDDHHmmss` directories with matching `.zip` files. Packages bundle `runtime/node.exe` and a compiled node-pty, so target machines do not need Node installed. When the source repo has `.void/skills`, it is bundled too, so project-level skills are detected on first run.

## Project layout

```text
shared/   WS protocol constants/types, i18n messages, shared Markdown / chart / PPT / CSV / workflow logic
server/   Node ESM backend: HTTP API, WebSocket, PTY sessions, collaboration, scheduler queue, proxy engine, storage
web/      Vue 3 + Vite + TypeScript + xterm + CodeMirror + Element Plus frontend
config/   Seed configuration for first run (devflow.xml, default workflows)
scripts/  Dev startup, packaging, i18n checks, code statistics
demo_ppt/ Markdown / chart / PPT sample data
```

## Configuration and data directories

- **Listen port**: `<app dir>/data/port.txt` (a single number). Precedence: `DEVFLOW_PORT` > this file > `22222`. Restart the backend after changing it.
- **Port data profile**: `%USERPROFILE%\.local\share\void\ports\<port>\` on Windows (or the equivalent path in the user data directory). Data for different ports is fully isolated.
- Main files inside a profile:
  - `projects.json`: project list `{ id, name, root }`
  - `downloads/devflow.xml`: language, listen host, agent list
  - `workflows/`: workflow folders (workflow / group / stage / skill Markdown)
  - `scheduler/`: scheduled tasks, run records, and reports
  - `collab/`, `message-history.jsonc`, `void.db`, `input-stats.json`, etc.
- **Agent list**: edit `<agents>` in `downloads/devflow.xml` and refresh the page; the language can also be switched in Settings (takes effect immediately on the server).

Keep secrets (tokens, passwords, keys, credential-bearing URLs) in the local `env/` directory only. Do not put them in code, docs, or commits.

## Markdown enhancements

Markdown preview (in-app file preview, the TXT/Markdown tools, and static site pages) shares one rendering pipeline:

- **Complex tables**: GFM tables render as Element Plus tables with column alignment, horizontal scrolling for wide tables, and duplicate-row deduplication.
- **Flowcharts**: `flowchart TD / LR` supports branches, back-edges (loops), subgraphs (`subgraph`, each with its own `direction`), and `classDef` / `class` custom colors; rendered as ECharts, with elbow connectors across subgraphs.
- **CSS animations**: `<style>` blocks and inline `style` work in Markdown preview and static `.md` pages; content styles are scoped to the document, while page-level styles (`<style data-scope="page">`) apply only to static pages. Inline SVG is allowed; scripts remain disabled.
- **Line / bar charts**: Mermaid `line` / `bar` inside `xychart-beta` are converted to ECharts; `line "name" [...]` shows a legend.
- **Pie charts**: Mermaid `pie` is converted to an ECharts pie chart.
- **Side-by-side charts**: tag a code block as `mermaid row` and multiple charts (e.g. line + pie) render on the same row.
- **PPT presentation**: click "PPT mode" in Markdown preview (static site pages are also supported). Slides are split by H1 headings only (H2 and deeper stay on the same slide); previous/next, fullscreen, arrow keys / PageUp / PageDown / Space (Shift+Space for previous) / Home / End navigate, and Esc exits. Typing in an input does not turn pages. A hide-pager button hides the whole pager for the current session (keyboard navigation keeps working); reopen PPT to show it again. Tables and charts render on each slide.
- **Data-script charts**: `mermaid-data` code blocks can read CSV/JSON from the same directory and return Mermaid source to generate charts.
- **Unified theme**: Mermaid diagrams use a blue tech palette for both dark and light themes (no pink/purple), with tighter node and rank spacing and width fitting.

See `demo_ppt/markdown_data/` (`charts.md`, `mermaid-line-pie.md`, `mermaid-flowchart.md`, `flowchart-two-subgraphs.md`, etc.) for examples; `demo_ppt/multi-slide-charts-sample.md` is a full multi-slide PPT sample.

## Tests

```bash
npm test               # backend node:test + frontend Vitest
npm run typecheck      # frontend vue-tsc
npm run check:i18n     # zh/en message symmetry and hard-coded text checks
npm run count:code     # real code lines (excluding comments and blank lines)
```

## FAQ

- **Cannot open the page / port already in use**: check that `data/port.txt` and `DEVFLOW_PORT` agree; restart the backend after changing the port.
- **Terminal creation fails (node-pty error)**: the Node major version must match node-pty's ABI. Run `npm.cmd approve-scripts node-pty esbuild` in a new environment; for portable packages, use the bundled `runtime/node`.
- **opencode not found in the terminal**: put opencode on `PATH`, use a package with bundled opencode, or set `DEVFLOW_OPENCODE` to the executable.
- **Changes to `projects.json` do not apply**: the file is not watched by `--watch`; restart the backend.
- **Some text stays Chinese after switching to English**: names entered by users (project names, site names, prompts) are user data and are not translated automatically; default names follow the UI language.
- **Static site / reverse proxy rules**: configure them on the Proxy page. A static site becomes accessible once its root directory is set, with SPA fallback, site prefix, and a left-side file tree.

## Security notes

- The service can execute arbitrary shell commands from the browser. By default, bind it to `127.0.0.1` or an internal address only.
- For public or remote access, use the built-in temporary invite link and password, or add authentication at an outer reverse proxy, and revoke access when done.
- Never commit `env/`, runtime databases, collaboration private keys, logs, or similar files.
