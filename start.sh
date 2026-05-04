#!/bin/bash
# 一键启动（构建前端 + 后端服务，统一 1335 端口）
# 用法: bash start.sh
# 停止: bash start.sh stop

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=1335
LOG=/tmp/stock-server.log
VENV_PYTHON="$ROOT/server/venv/bin/python"
SERVER_DIR="$ROOT/server"

stop() {
    echo "停止服务..."
    PID=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        kill -9 $PID 2>/dev/null || true
        echo "已停止 (PID: $PID)"
    else
        echo "服务未运行"
    fi
}

if [ "$1" = "stop" ]; then
    stop
    exit 0
fi

# 先杀旧进程
stop

# 构建前端
cd "$ROOT/app"
echo "构建前端..."
npm run build

echo ""
echo "启动服务 → http://127.0.0.1:$PORT"
setsid nohup "$VENV_PYTHON" -m uvicorn main:app \
    --app-dir "$SERVER_DIR" \
    --host 127.0.0.1 --port $PORT --log-level info > "$LOG" 2>&1 &

sleep 2

# 检查是否启动成功
PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo ""
    echo "启动成功! PID: $PID"
    echo "日志: $LOG"
    echo "访问: http://127.0.0.1:$PORT"
    echo "停止: bash start.sh stop"
else
    echo ""
    echo "启动失败，请查看日志: $LOG"
    tail -5 "$LOG"
fi
