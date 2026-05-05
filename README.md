# StockAnalysis

StockAnalysis 是一个面向 A 股研究的本地化股票分析系统，目标是把“行情 + 财务 + 新闻研报 + AI”整合成可解释、可验证的投研工作台。项目支持本地数据下载、个股分析、公式选股、AI 洞察、财务规则引擎和行业横向对比，适合用于个人研究、策略验证和投研辅助。

## 核心功能

- **个股数据管理**：下载并管理股票基本信息、日/周/月 K 线、财务数据、新闻、公告、研报、分红等本地数据。
- **个股分析工作台**：展示行情、财务图表、新闻研报、公告与 AI 分析结果。
- **财务图表驾驶舱**：将财务表格转换为增长、盈利、现金流、安全性、效率、费用等图形化模块，并保留计算公式与实际依据。
- **规则评分引擎**：基于成长、盈利、现金流、安全性和效率生成 0-100 分综合评分、风险等级、投资类型、关注点和跨模块判断。
- **公式选股系统**：支持用自然语言或公式进行排序筛选，可通过字段引用构建自定义策略，并保存公式模板和 AI 生成解释。
- **结果洞察**：对筛选结果生成规则洞察和 AI 洞察，支持持久化，避免重复生成。
- **行业对比评分**：支持按行业横向比较同行公司，生成综合评分榜、行业相对分、行业洞察和分组标签。
- **本地行业快照**：自动推导并保存本地行业分类快照，下次打开优先读取，减少重复扫描和等待时间。

## 技术栈

- **前端**：React 19、TypeScript、Vite、Recharts、Tailwind CSS、Lucide Icons
- **后端**：FastAPI、Uvicorn、Pydantic、AKShare
- **AI 接入**：支持 OpenAI、Anthropic Claude 和自定义 OpenAI-Compatible 服务
- **数据存储**：本地 JSON 文件，运行时数据默认位于 `server/data/`

## 目录结构

```text
StockAnalysis/
├── app/                  # 前端应用
│   ├── src/              # 页面、组件、API 与类型定义
│   └── package.json
├── server/               # FastAPI 后端
│   ├── routers/          # API 路由
│   ├── services/         # 数据下载、AI、缓存等服务
│   ├── models/           # 数据模型
│   └── main.py
├── docs/                 # 设计文档
├── start.sh              # 一键构建并启动服务
└── README.md
```

## 快速开始

### 1. 安装前端依赖

```bash
cd app
npm install
```

### 2. 安装后端依赖

建议在 `server/venv` 中安装依赖：

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. 一键启动

回到项目根目录执行：

```bash
bash start.sh
```

启动后访问：

```text
http://127.0.0.1:1335
```

停止服务：

```bash
bash start.sh stop
```

## 开发命令

前端开发：

```bash
cd app
npm run dev
```

前端构建：

```bash
cd app
npm run build
```

后端开发：

```bash
cd server
source venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 1335
```

## AI 配置

项目支持在系统配置中选择 AI 服务提供商。也可以通过环境变量或本地配置接入：

- OpenAI
- Anthropic Claude
- 自定义 OpenAI-Compatible API

AI 功能主要用于公式生成、个股分析、筛选结果洞察等场景。AI 失败时系统会尽量保留规则引擎结果，不编造内容。

## 数据说明

- 本地运行数据位于 `server/data/`，包括下载的股票数据、行业快照、AI 结果等。
- `server/data/` 和 `server/cache/` 已在 `.gitignore` 中忽略，不建议提交到仓库。
- 行业快照文件为 `server/data/industry_snapshot.json`，可在“行业对比”页面点击“重建快照”手动刷新。

## 注意事项

- AKShare 接口可能受网络、数据源和版本影响，若数据拉取失败可稍后重试或更新 AKShare。
- 新增后端接口后，需要重启后端服务才能生效。
- 本系统输出为投研辅助信息，不构成投资建议，使用前应结合公告、财报原文和市场风险自行判断。
