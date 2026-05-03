# A 股单股信息提取分析系统 - Web 前端实现计划

## 项目目标
基于用户提供的《A 股单股信息提取分析系统界面设计报告》，实现一个前后端分离的单股信息提取与分析平台 Web 前端，后端接口留好（Mock API）。

## 技术栈
- React 18 + TypeScript
- Vite + Tailwind CSS + shadcn/ui
- Recharts (图表)
- React Router (路由)
- Zustand / React Context (状态管理)

## 阶段规划

### Stage 1 — 项目初始化与基础架构
- 加载 `vibecoding-webapp-swarm` 技能
- 初始化 React + TypeScript + Vite 项目
- 配置 Tailwind CSS + shadcn/ui
- 搭建基础目录结构 (components/, pages/, api/, types/, data/)
- 实现全局布局组件 (AppLayout, Sidebar, TopNavbar)
- 创建路由结构 (/, /stock/:symbol)
- 定义 TypeScript 类型接口 (StockProfile, AIAnalysis, StockDocument)

### Stage 2 — 首页 (/) 实现
- 搜索入口页面
- 股票搜索框 (支持代码/名称搜索)
- 最近分析记录
- 系统状态指示器
- 页面动效与交互

### Stage 3 — 单股分析页 (/stock/:symbol) 核心布局
- 股票标题区 (名称、代码、行业、当前价等)
- 操作按钮区 (刷新、加入自选、生成报告、导出PDF)
- 核心指标卡片 (8个: 当前价、涨跌幅、成交额、换手率、总市值、PE、PB、股息率)
- 响应式网格布局

### Stage 4 — 图表与AI面板
- K线图区域 (日K/周K/月K + 成交量 + MA均线)
  - 使用 Recharts 实现蜡烛图+柱状图组合
- AI 综合分析面板 (右侧固定)
  - 综合评分
  - 投资风格
  - 核心亮点列表
  - 主要风险列表
  - 重新生成按钮

### Stage 5 — Tab 内容区
- 行情分析 Tab (K线图详情、近5/20/60日涨跌幅、波动率、最大回撤)
- 财务分析 Tab (利润表/资产负债表/现金流量表摘要、核心财务指标表格)
- 公告新闻 Tab (时间流展示、AI摘要、情绪判断、风险点)
- AI研究报告 Tab (固定报告结构、生成/重新生成/复制/导出按钮)

### Stage 6 — Mock API 与数据层
- 创建完整的 Mock API 层 (src/api/mock/)
- 模拟股票概览数据
- 模拟K线历史数据
- 模拟财务数据
- 模拟新闻公告数据
- 模拟AI分析结果
- 定义 API 接口函数 (与实际后端对接的接口契约)

### Stage 7 — 组件拆分与优化
- 按设计报告拆分组件
- layout: AppLayout, Sidebar, TopNavbar
- stock: StockSearchBox, StockHeader, StockMetricCards, StockKLineChart, StockTabs
- financial: FinancialTable, FinancialTrendChart, FinancialIndicatorCards
- news: NewsTimeline, NewsSummaryCard
- ai: AIInsightPanel, AIReportViewer, RiskList
- common: LoadingState, EmptyState, ErrorState, DataSourceTag

### Stage 8 — 样式与交互优化
- 金融终端风格 (深色/浅色主题)
- A股习惯: 红涨绿跌
- 卡片化设计
- 加载态/空态/错误态处理
- 响应式适配

### Stage 9 — 构建与部署
- 生产构建
- 部署到静态站点

## 交付物
- 完整可运行的前端项目
- Mock API 层 (后端接口契约)
- 部署上线的网站

## 关键设计约束
- 第一版 MVP: 首页搜索 + 单股分析页
- 左侧菜单占位扩展 (单股分析、自选股、财务分析、公告新闻、AI研究报告、数据管理、系统设置)
- 红色=上涨，绿色=下跌 (A股习惯)
- 数据密度适中，图表优先，AI结论突出
