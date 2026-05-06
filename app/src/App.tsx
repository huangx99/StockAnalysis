import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import StockDashboard from './pages/StockDashboard'
import AIReportPage from './pages/AIReport'
import Settings from './pages/Settings'
import DataManager from './pages/DataManager'
import MarketDataManager from './pages/MarketDataManager'
import Screener from './pages/Screener'
import IndustryCompare from './pages/IndustryCompare'
import BacktestValidation from './pages/BacktestValidation'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/stock/:symbol" element={<StockDashboard />} />
        <Route path="/stock/:symbol/report" element={<AIReportPage />} />
        <Route path="/data" element={<DataManager />} />
        <Route path="/market" element={<MarketDataManager />} />
        <Route path="/screener" element={<Screener />} />
        <Route path="/industry" element={<IndustryCompare />} />
        <Route path="/backtest" element={<BacktestValidation />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
