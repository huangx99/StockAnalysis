# A 股智能信息提取分析系统

基于 React + FastAPI + AKShare 的 A 股单股分析平台。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Recharts |
| 后端 | Python + FastAPI + AKShare |
| 缓存 | cachetools（内存 TTLCache） |
| AI | 可插拔（Claude / OpenAI / 本地 LLM） |

## 项目结构

```
StockAnalysis/
  app/                          # 前端
    src/
      api/
        mock/stockApi.ts        # Mock API（开发备用）
        real/stockApi.ts        # 真实 API（fetch 调后端）
      components/               # UI 组件
      pages/                    # 页面（Home / StockDashboard / AIReport / Settings）
      types/index.ts            # TypeScript 类型定义
    vite.config.ts              # Vite 配置（含 /api 代理）

  server/                       # 后端
    main.py                     # FastAPI 入口，CORS，全局异常处理
    config.py                   # Pydantic Settings（环境变量，TTL 配置）
    requirements.txt            # Python 依赖（akshare 版本锁定）
    .env.example                # 环境变量模板

    models/                     # Pydantic 响应模型（与前端 TS 类型一一对应）
      stock.py                  # StockSearchResult, StockProfile, KLineData, FinancialStatement
      ai.py                     # AIAnalysis, AIReport
      document.py               # StockDocument
      system.py                 # SystemStatus

    adapters/                   # AKShare 适配层（核心防护组件）
      column_schemas.py         # 列定义 + rename_map + 默认值
      akshare_adapter.py        # AKShare 调用包装 + 列校验 + 异常处理

    cache/
      cache_manager.py          # TTLCache 实例（按数据类别分 TTL）

    services/
      stock_service.py          # 业务逻辑：search / profile / kline / financials / news
      ai_service.py             # AI Provider 分发
      ai_providers/
        base.py                 # 抽象基类 AIProvider
        claude_provider.py      # Anthropic Claude 实现
        openai_provider.py      # OpenAI 实现
        custom_provider.py      # 通用 OpenAI 兼容（本地 LLM 等）

    routers/
      stocks.py                 # /api/search, /api/stock/{symbol}/profile|kline|financials|news
      ai.py                     # /api/stock/{symbol}/analyze|report
      system.py                 # /api/system/status

    utils/
      retry.py                  # 异步重试装饰器（指数退避）
      logging_config.py         # 日志配置
```

## 快速开始

### 1. 后端

```bash
cd server

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（可选，AI 功能需要）
cp .env.example .env
# 编辑 .env 填入 API Key

# 启动
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 前端

```bash
cd app
npm install
npm run dev
```

访问 http://localhost:3000

## API 接口

| 方法 | 路径 | 说明 | 数据源 |
|---|---|---|---|
| GET | `/api/search?q={query}` | 模糊搜索股票 | `stock_zh_a_spot_em` |
| GET | `/api/stock/{symbol}/profile` | 股票基本信息 + 实时行情 | `stock_zh_a_spot_em` + `stock_individual_info_em` |
| GET | `/api/stock/{symbol}/kline?period=day\|week\|month` | K 线数据 + MA 均线 | `stock_zh_a_hist` |
| GET | `/api/stock/{symbol}/financials` | 年度财务数据 | `stock_financial_report_sina` |
| GET | `/api/stock/{symbol}/news` | 个股新闻 | `stock_news_em` |
| POST | `/api/stock/{symbol}/analyze` | AI 分析（需配置 API Key） | LLM |
| POST | `/api/stock/{symbol}/report` | AI 研报（需配置 API Key） | LLM |
| GET | `/api/system/status` | 系统状态（AKShare / AI 在线状态） | 健康检查 |

## 缓存策略

| 数据类别 | TTL | 说明 |
|---|---|---|
| 实时行情 / 搜索 | 30s / 1h | 高频变动 / 低频变动 |
| K 线 | 5min | 盘中数据 |
| 财务报表 | 24h | 季报级更新频率 |
| 新闻 | 10min | 中频更新 |

## AKShare 接口防护

AKShare 依赖第三方公开数据源，接口偶尔会变动。本项目通过 `adapters/column_schemas.py` 集中管理列定义，处理接口变更：

### 列名变更

当 AKShare 升级后列名改变，在 `column_schemas.py` 的 `rename_map` 中加一行映射即可：

```python
SPOT_EM_COLUMNS = {
    "rename_map": {
        "市盈率-动态": "市盈率(动态)",  # AKShare 某版本改了列名
    },
    # ...
}
```

其他代码无需改动。

### 缺列降级

- **必需列缺失**：抛出 `ColumnValidationError`，返回 502 错误
- **可选列缺失**：自动填充 `defaults` 中的默认值，日志记录警告

### 版本锁定

`requirements.txt` 中锁定 `akshare>=1.18.50`。启动时检查版本，不匹配会日志告警。

### 网络异常

- AKShare 调用失败自动重试 3 次（指数退避）
- 新闻接口因 curl_cffi TLS 问题额外加重试

## AI 服务配置

在 `server/.env` 中配置：

```bash
# 选择 Provider
STOCK_AI_PROVIDER=claude          # claude | openai | custom

# Claude
STOCK_ANTHROPIC_API_KEY=sk-ant-...
STOCK_ANTHROPIC_MODEL=claude-sonnet-4-20250514

# OpenAI
STOCK_OPENAI_API_KEY=sk-...
STOCK_OPENAI_MODEL=gpt-4o

# 自定义（兼容 OpenAI 接口的本地 LLM）
STOCK_CUSTOM_BASE_URL=http://localhost:11434/v1
STOCK_CUSTOM_MODEL=llama3
```

AI Provider 接收股票的真实数据（行情 + 财务 + 新闻）作为上下文，返回结构化的分析结果。

## 前端切换 Mock / Real API

修改页面中的 import 路径即可：

```typescript
// 使用真实后端
import { searchStocks } from '@/api/real/stockApi'

// 切回 Mock
import { searchStocks } from '@/api/mock/stockApi'
```

涉及文件：
- `pages/StockDashboard.tsx`
- `pages/AIReport.tsx`
- `components/StockSearchBox.tsx`
- `components/Navbar.tsx`

## 数据验证结果

| 接口 | 状态 | 示例数据 |
|---|---|---|
| 搜索 | OK | `600519` → 贵州茅台, SH |
| 行情 | OK | 价格 1384.79, PE 15.91, 行业 白酒 |
| K 线 | OK | 77 根日 K + MA5/10/20/60 |
| 财务 | OK | 2022-2025 年报，毛利率 91.3%, ROE 33.6% |
| 新闻 | OK | 10 条东方财富实时新闻 |
| 系统状态 | OK | AKShare: online |
