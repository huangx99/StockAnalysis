"""Email notification service for monitor alerts."""

from __future__ import annotations

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_SERVER = os.getenv("EMAIL_SMTP_SERVER", "smtp.qq.com")
SMTP_PORT = int(os.getenv("EMAIL_SMTP_PORT", "465"))
SMTP_USER = os.getenv("EMAIL_USER", "1318680677@qq.com")
SMTP_PASS = os.getenv("EMAIL_PASS", "xelfttuyybgzhdgf")


def send_email(recipient: str, subject: str, html_body: str) -> bool:
    """Send an HTML email via QQ SMTP."""
    msg = MIMEMultipart()
    msg["From"] = SMTP_USER
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        logger.info("Email sent to %s: %s", recipient, subject)
        return True
    except smtplib.SMTPAuthenticationError:
        logger.error("Email auth failed - check SMTP credentials")
        return False
    except Exception as e:
        logger.error("Email send failed: %s", e)
        return False


def build_alert_email(hits: list[dict], rule_name: str) -> str:
    """Build HTML email content for monitor alert hits."""
    rows = ""
    for h in hits:
        sentiment = h.get("sentiment", "neutral")
        color = {"positive": "#22c55e", "negative": "#ef4444"}.get(sentiment, "#eab308")
        label = {"positive": "利好", "negative": "利空"}.get(sentiment, "中性")
        url = h.get("url", "")
        title = h.get("title", "")
        source = h.get("source", "")
        importance = h.get("importance", 0)
        time_str = h.get("publishTime", h.get("seenAt", ""))

        title_html = f'<a href="{url}" style="color:#1a73e8;text-decoration:none">{title}</a>' if url else title
        rows += f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">{title_html}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">
            <span style="background:{color}22;color:{color};padding:2px 8px;border-radius:4px;font-size:12px">{label}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">{importance}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px">{source}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px">{time_str}</td>
        </tr>"""

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1a1a1a;border-bottom:2px solid #1a73e8;padding-bottom:8px">📡 新闻监控告警</h2>
      <p style="color:#333">规则「<strong>{rule_name}</strong>」发现 <strong>{len(hits)}</strong> 条新匹配：</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px 12px;text-align:left;font-size:13px">标题</th>
            <th style="padding:8px 12px;text-align:center;font-size:13px;width:60px">情绪</th>
            <th style="padding:8px 12px;text-align:center;font-size:13px;width:50px">重要度</th>
            <th style="padding:8px 12px;text-align:center;font-size:13px;width:80px">来源</th>
            <th style="padding:8px 12px;text-align:center;font-size:13px;width:100px">时间</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#999;font-size:12px;margin-top:24px">— 股票分析系统新闻监控</p>
    </div>"""


def send_alert_email(recipient: str, rule_name: str, hits: list[dict]) -> bool:
    """Send a monitor alert email."""
    if not recipient or not hits:
        return False
    subject = f"[新闻监控] {rule_name} - 发现 {len(hits)} 条新匹配"
    html = build_alert_email(hits, rule_name)
    return send_email(recipient, subject, html)
