import logging
import time
from datetime import datetime

import pandas as pd
from pytdx.hq import TdxHq_API

logger = logging.getLogger(__name__)

TDX_SERVERS = [
    ('119.147.212.81', 7709),
    ('112.74.214.43', 7727),
    ('180.153.18.170', 7709),
    ('218.75.126.9', 7709),
    ('115.238.56.198', 7709),
    ('124.160.88.183', 7709),
    ('60.12.136.250', 7709),
    ('218.108.98.244', 7709),
    ('218.108.47.69', 7709),
    ('180.153.39.51', 7709),
]

# pytdx category 映射
CATEGORY_MAP = {
    "1min": 8,
    "5min": 0,
    "15min": 1,
    "30min": 2,
    "60min": 3,
}

_api: TdxHq_API | None = None


def _get_api() -> TdxHq_API:
    global _api
    if _api is not None:
        return _api
    api = TdxHq_API()
    for host, port in TDX_SERVERS:
        try:
            if api.connect(host, port):
                logger.info("[pytdx] connected to %s:%s", host, port)
                _api = api
                return api
        except Exception:
            continue
    raise ConnectionError("pytdx: failed to connect to any server")


def _market_of(code: str) -> int:
    """0=SZ, 1=SH, 2=BJ"""
    if code.startswith(('6', '5')):
        return 1
    if code.startswith(('0', '3', '1', '2')):
        return 0
    if code.startswith(('4', '8', '9')):
        return 2
    return 0


def fetch_bid_ask_batch(codes: list[str]) -> list[dict]:
    """Fetch 5-level bid/ask for multiple stocks in batches of 20.
    Returns list of dicts with code, bid1-5, ask1-5 prices and volumes.
    """
    if not codes:
        return []

    BATCH_SIZE = 20
    all_raw = []

    for i in range(0, len(codes), BATCH_SIZE):
        batch = codes[i:i + BATCH_SIZE]
        params = [(_market_of(c), c) for c in batch]
        for attempt in range(3):
            try:
                api = _get_api()
                raw = api.get_security_quotes(params)
                if raw:
                    all_raw.extend(raw)
                    break
                else:
                    logger.warning("[pytdx] batch %d attempt %d returned empty, retrying...", i // BATCH_SIZE, attempt + 1)
                    global _api
                    _api = None
                    time.sleep(0.3)
            except Exception as e:
                logger.warning("[pytdx] batch %d attempt %d failed: %s", i // BATCH_SIZE, attempt + 1, e)
                _api = None
                time.sleep(0.3)

    if not all_raw:
        return []

    results = []
    for q in all_raw:
        code = q.get('code', '')
        results.append({
            'code': code,
            'name': q.get('name', ''),
            'price': q.get('price', 0),
            'lastClose': q.get('last_close', 0),
            'open': q.get('open', 0),
            'high': q.get('high', 0),
            'low': q.get('low', 0),
            'volume': q.get('vol', 0),
            'amount': q.get('amount', 0),
            'bid1Price': q.get('bid1', 0),
            'bid1Volume': q.get('bid_vol1', 0),
            'bid2Price': q.get('bid2', 0),
            'bid2Volume': q.get('bid_vol2', 0),
            'bid3Price': q.get('bid3', 0),
            'bid3Volume': q.get('bid_vol3', 0),
            'bid4Price': q.get('bid4', 0),
            'bid4Volume': q.get('bid_vol4', 0),
            'bid5Price': q.get('bid5', 0),
            'bid5Volume': q.get('bid_vol5', 0),
            'ask1Price': q.get('ask1', 0),
            'ask1Volume': q.get('ask_vol1', 0),
            'ask2Price': q.get('ask2', 0),
            'ask2Volume': q.get('ask_vol2', 0),
            'ask3Price': q.get('ask3', 0),
            'ask3Volume': q.get('ask_vol3', 0),
            'ask4Price': q.get('ask4', 0),
            'ask4Volume': q.get('ask_vol4', 0),
            'ask5Price': q.get('ask5', 0),
            'ask5Volume': q.get('ask_vol5', 0),
        })

    return results


def fetch_security_bars(symbol: str, period: str = "5min", count: int = 800) -> pd.DataFrame | None:
    """获取分钟级K线数据。

    Args:
        symbol: 股票代码，如 "600519"
        period: K线周期，支持 "1min", "5min", "15min", "30min", "60min"
        count: 获取的K线数量，最大800

    Returns:
        DataFrame with columns: 日期, 开盘, 收盘, 最高, 最低, 成交量, 成交额
    """
    category = CATEGORY_MAP.get(period)
    if category is None:
        logger.error("[pytdx] unsupported period: %s", period)
        return None

    try:
        api = _get_api()
        market = _market_of(symbol)
        data = api.get_security_bars(category, market, symbol, 0, count)

        if not data:
            logger.warning("[pytdx] fetch_security_bars(%s, %s) returned empty", symbol, period)
            return None

        rows = []
        for item in data:
            dt = item.get('datetime', '')
            if dt:
                try:
                    dt = datetime.strptime(str(dt), '%Y-%m-%d %H:%M').strftime('%Y-%m-%d %H:%M')
                except ValueError:
                    dt = str(dt)

            rows.append({
                '日期': dt,
                '开盘': item.get('open', 0),
                '收盘': item.get('close', 0),
                '最高': item.get('high', 0),
                '最低': item.get('low', 0),
                '成交量': item.get('vol', 0),
                '成交额': item.get('amount', 0),
            })

        df = pd.DataFrame(rows)
        logger.info("[pytdx] fetch_security_bars(%s, %s) returned %d rows", symbol, period, len(df))
        return df

    except Exception as e:
        logger.warning("[pytdx] fetch_security_bars(%s, %s) failed: %s", symbol, period, e)
        global _api
        _api = None
        return None
