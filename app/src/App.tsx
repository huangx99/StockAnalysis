import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import StockDashboard from './pages/StockDashboard'
import AIReportPage from './pages/AIReport'
import Settings from './pages/Settings'
import DataManager from './pages/DataManager'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/stock/:symbol" element={<StockDashboard />} />
        <Route path="/stock/:symbol/report" element={<AIReportPage />} />
        <Route path="/data" element={<DataManager />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
