export function formatPrice(n: number): string {
  return n.toFixed(2);
}

export function formatPercent(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function formatVolume(n: number): string {
  if (n >= 100000000) {
    return `${(n / 100000000).toFixed(2)}亿`;
  }
  if (n >= 10000) {
    return `${(n / 10000).toFixed(2)}万`;
  }
  return n.toLocaleString('zh-CN');
}

export function formatMarketCap(n: number): string {
  if (n >= 1000000000000) {
    return `${(n / 1000000000000).toFixed(2)}万亿`;
  }
  if (n >= 100000000) {
    return `${(n / 100000000).toFixed(2)}亿`;
  }
  return n.toLocaleString('zh-CN');
}

export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function formatTurnover(n: number): string {
  if (n >= 100000000) {
    return `${(n / 100000000).toFixed(2)}亿`;
  }
  if (n >= 10000) {
    return `${(n / 10000).toFixed(2)}万`;
  }
  return n.toFixed(2);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
