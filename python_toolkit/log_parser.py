#!/usr/bin/env python3
"""
Web Server Log Parser
Parses Apache Combined Log Format and JSON logs into structured Elasticsearch documents.
Compatible with Python 3.8+ (Zero third-party dependencies).
"""

import re
import json
import datetime

APACHE_REGEX = re.compile(
    r'^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"\s]+)(?:\s+HTTP/[\d\.]+)?\"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+(\d+(?:\.\d+)?))?'
)

MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
}

def parse_apache_date(date_str):
    """Converts 22/Oct/2026:14:32:10 +0000 into ISO 8601 UTC timestamp."""
    try:
        match = re.match(r"(\d{2})/([A-Za-z]{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2})", date_str)
        if match:
            day, mon, year, hour, minute, sec = match.groups()
            dt = datetime.datetime(
                int(year), MONTHS.get(mon, 1), int(day),
                int(hour), int(minute), int(sec),
                tzinfo=datetime.timezone.utc
            )
            return dt.isoformat()
    except Exception:
        pass
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def parse_log_line(line):
    """Parses a single log line into an Elasticsearch document dict."""
    line = line.strip()
    if not line:
        return None

    # Try Apache regex
    match = APACHE_REGEX.match(line)
    if match:
        (
            client_ip, _, _, raw_time, method, endpoint,
            status_str, bytes_str, referrer, user_agent, latency_str
        ) = match.groups()

        status_code = int(status_str)
        response_size = int(bytes_str) if bytes_str != "-" and bytes_str.isdigit() else 0
        response_time_ms = float(latency_str) if latency_str else 45.0

        return {
            "@timestamp": parse_apache_date(raw_time),
            "client_ip": client_ip,
            "http_method": method,
            "endpoint": endpoint,
            "status_code": status_code,
            "status_group": f"{status_code // 100}xx",
            "response_size": response_size,
            "response_time_ms": response_time_ms,
            "referrer": referrer,
            "user_agent": user_agent,
            "is_error": status_code >= 400,
            "raw_message": line
        }

    # Try JSON line
    try:
        data = json.loads(line)
        status_code = int(data.get("status_code", data.get("status", 200)))
        return {
            "@timestamp": data.get("@timestamp", datetime.datetime.now(datetime.timezone.utc).isoformat()),
            "client_ip": data.get("client_ip", data.get("ip", "127.0.0.1")),
            "http_method": data.get("http_method", data.get("method", "GET")),
            "endpoint": data.get("endpoint", data.get("path", "/")),
            "status_code": status_code,
            "status_group": f"{status_code // 100}xx",
            "response_size": int(data.get("response_size", data.get("bytes", 1024))),
            "response_time_ms": float(data.get("response_time_ms", data.get("latency", 50.0))),
            "referrer": data.get("referrer", "-"),
            "user_agent": data.get("user_agent", "Mozilla/5.0"),
            "is_error": status_code >= 400,
            "raw_message": line
        }
    except Exception:
        return None
