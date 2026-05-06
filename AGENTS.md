# Agent Instructions

- After completing a user task in this repository, send a completion email using the default parameters from `/home/huangxuan/code/emailSend/send_email.py`.
- Use a concise subject that includes `StockAnalysis任务完成` and a short body describing what was completed and any important validation result.
- Command pattern: `python3 /home/huangxuan/code/emailSend/send_email.py -s '<subject>' -b '<body>'`.
- Do not commit or include runtime data from `server/data/` or `server/cache/` unless the user explicitly asks.
