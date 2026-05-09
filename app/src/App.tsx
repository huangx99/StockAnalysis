import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import StockDashboard from './pages/StockDashboard'
import AIReportPage from './pages/AIReport'
import Settings from './pages/Settings'
import DataManager from './pages/DataManager'
import MarketDataManager from './pages/MarketDataManager'
import Screener from './pages/Screener'
import IndustryCompare from './pages/IndustryCompare'
import BacktestValidation from './pages/BacktestValidation'
import SectorAnalysis from './pages/SectorAnalysis'
import Login from './pages/Login'
import Watchlist from './pages/Watchlist'
import UserAdmin from './pages/UserAdmin'
import Profile from './pages/Profile'
import NewsHub from './pages/NewsHub'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/stock/:symbol" element={<StockDashboard />} />
          <Route path="/stock/:symbol/report" element={<AIReportPage />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/industry" element={<IndustryCompare />} />
          <Route path="/backtest" element={<BacktestValidation />} />
          <Route path="/sector" element={<SectorAnalysis />} />
          <Route path="/news" element={<NewsHub />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute adminOnly />}>
        <Route element={<Layout />}>
          <Route path="/data" element={<DataManager />} />
          <Route path="/market" element={<MarketDataManager />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<UserAdmin />} />
        </Route>
      </Route>
    </Routes>
  )
}
