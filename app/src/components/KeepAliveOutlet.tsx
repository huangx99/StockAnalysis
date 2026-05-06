import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { matchPath, useLocation, useOutlet } from 'react-router-dom'

type CacheEntry = {
  key: string
  element: ReactElement
  group: 'static' | 'stock' | 'report'
  lastActiveAt: number
}

const STATIC_ROUTE_KEYS: Record<string, string> = {
  '/': 'home',
  '/data': 'data-manager',
  '/market': 'market-data-manager',
  '/screener': 'screener',
  '/industry': 'industry-compare',
  '/backtest': 'backtest-validation',
  '/settings': 'settings',
}

const MAX_STOCK_CACHE = 8
const MAX_REPORT_CACHE = 4

function getKeepAliveRoute(pathname: string): Pick<CacheEntry, 'key' | 'group'> | null {
  if (STATIC_ROUTE_KEYS[pathname]) {
    return { key: STATIC_ROUTE_KEYS[pathname], group: 'static' }
  }

  const reportMatch = matchPath({ path: '/stock/:symbol/report', end: true }, pathname)
  if (reportMatch?.params.symbol) {
    return { key: `stock-report:${reportMatch.params.symbol}`, group: 'report' }
  }

  const stockMatch = matchPath({ path: '/stock/:symbol', end: true }, pathname)
  if (stockMatch?.params.symbol) {
    return { key: `stock:${stockMatch.params.symbol}`, group: 'stock' }
  }

  return null
}

function trimCache(cache: Map<string, CacheEntry>, group: CacheEntry['group'], maxItems: number) {
  const entries = Array.from(cache.values())
    .filter((entry) => entry.group === group)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)

  while (entries.length > maxItems) {
    const entry = entries.shift()
    if (!entry) return
    cache.delete(entry.key)
  }
}

export default function KeepAliveOutlet() {
  const outlet = useOutlet()
  const location = useLocation()
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const [, forceRender] = useState(0)
  const activeRoute = getKeepAliveRoute(location.pathname)
  const activeKey = activeRoute?.key ?? null

  if (outlet && activeRoute) {
    const current = cacheRef.current.get(activeRoute.key)
    if (current) {
      current.lastActiveAt = Date.now()
    } else {
      cacheRef.current.set(activeRoute.key, {
        key: activeRoute.key,
        element: outlet,
        group: activeRoute.group,
        lastActiveAt: Date.now(),
      })
      trimCache(cacheRef.current, 'stock', MAX_STOCK_CACHE)
      trimCache(cacheRef.current, 'report', MAX_REPORT_CACHE)
      queueMicrotask(() => forceRender((value) => value + 1))
    }
  }

  const cachedEntries = Array.from(cacheRef.current.values())

  return (
    <>
      {cachedEntries.map((entry) => {
        const active = entry.key === activeKey
        return (
          <div
            key={entry.key}
            aria-hidden={!active}
            style={active ? { display: 'contents' } : { display: 'none' }}
          >
            {entry.element}
          </div>
        )
      })}
      {!activeRoute && outlet}
    </>
  )
}
