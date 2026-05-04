#!/bin/bash
# 快速启动脚本 - 杀掉旧进程，后台启动服务
# 用法: bash start.sh

set -e

PORT=1335
HOST=127.0.0.1
LOG=/tmp/stock-server.log
DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$DIR"

# 杀掉占用 1335 端口的进程
PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo "杀掉旧进程 PID=$PID"
    kill -9 $PID 2>/dev/null || true
    sleep 1
fi

# 激活虚拟环境并启动
source venv/bin/activate

echo "启动服务 → http://$HOST:$PORT"
nohup python -m uvicorn main:app \
    --host "$HOST" \
    --port "$PORT" \
    --log-level info \
    > "$LOG" 2>&1 &

echo "PID: $!"
echo "日志: $LOG"
echo "停止: kill \$(lsof -ti:$PORT)"
