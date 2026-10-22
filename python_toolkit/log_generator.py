#!/usr/bin/env python3
"""
Synthetic Web Server Log Generator (Apache Combined Log Format)
Generates realistic web server logs for Big Data Analytics testing.
Compatible with Python 3.8+ (Zero third-party dependencies).
"""

import sys
import random
import datetime
from pathlib import Path

IP_POOL = [
    ("198.51.100.42", "United States", "San Francisco"),
    ("203.0.113.19", "India", "Bangalore"),
    ("192.0.2.78", "Germany", "Frankfurt"),
    ("185.199.108.153", "United Kingdom", "London"),
    ("103.21.244.0", "Singapore", "Singapore"),
    ("142.250.190.46", "United States", "New York"),
    ("117.200.45.88", "India", "Mumbai"),
    ("151.101.65.140", "Japan", "Tokyo"),
    ("185.220.101.5", "Russia", "Moscow"),
    ("45.33.32.156", "Brazil", "São Paulo"),
]

ENDPOINTS = [
    ("GET", "/api/v1/products", 65, False),
    ("GET", "/api/v1/products/search", 110, False),
    ("POST", "/api/v1/auth/login", 120, False),
    ("POST", "/api/v1/cart/items", 95, False),
    ("POST", "/api/v1/checkout/payment", 340, False),
    ("GET", "/dashboard/overview", 75, False),
    ("GET", "/static/css/theme-dark.min.css", 15, False),
    ("GET", "/static/js/bundle.core.js", 22, False),
    ("GET", "/favicon.ico", 8, False),
    ("GET", "/wp-login.php", 35, True), # Scanner probe
    ("GET", "/.env", 20, True),
    ("GET", "/admin/config.php", 40, True),
]

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "curl/8.4.0",
    "masscan/1.3.2 (scanner)",
]

REFERRERS = [
    "https://www.google.com/search?q=ecommerce+store",
    "https://github.com/topics/big-data-analytics",
    "https://twitter.com/feed",
    "https://linkedin.com/feed",
    "-",
]

def generate_logs(count=2000, output_path=None, scenario="normal"):
    """Generates synthetic logs and optionally writes to file."""
    now = datetime.datetime.now(datetime.timezone.utc)
    lines = []

    print(f"[*] Generating {count} web server log records (Scenario: {scenario})...")

    for i in range(count):
        # Distribute over the past 2 hours
        offset_seconds = random.randint(0, 7200)
        log_time = now - datetime.timedelta(seconds=(7200 - offset_seconds))
        time_str = log_time.strftime("%d/%b/%Y:%H:%M:%S +0000")

        # Select IP
        if scenario == "ddos" and random.random() < 0.65:
            ip, country, city = ("185.220.101.5", "Russia", "Moscow")
        else:
            ip, country, city = random.choice(IP_POOL)

        # Select Endpoint
        if scenario == "probe" and random.random() < 0.6:
            probes = [e for e in ENDPOINTS if e[3]]
            method, path, base_latency, is_probe = random.choice(probes)
        else:
            normal = [e for e in ENDPOINTS if not e[3] or random.random() < 0.05]
            method, path, base_latency, is_probe = random.choice(normal)

        # Status code
        if is_probe:
            status = 404 if random.random() < 0.85 else 403
        elif scenario == "ddos":
            status = random.choice([503, 502, 200, 503])
        else:
            r = random.random()
            if r < 0.80: status = 200
            elif r < 0.86: status = 201
            elif r < 0.90: status = 304
            elif r < 0.94: status = 400
            elif r < 0.96: status = 401
            elif r < 0.985: status = 404
            else: status = 500

        # Latency & size
        bytes_sent = random.randint(120, 480) if status >= 400 else random.randint(1200, 18500)
        latency = round(base_latency * random.uniform(0.7, 1.4), 1)
        if scenario == "slow" and "products" in path:
            latency += random.randint(800, 2200)

        user_agent = random.choice(USER_AGENTS)
        referrer = random.choice(REFERRERS)

        # Apache Combined Log Format:
        # %h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i" [optional latency]
        line = f'{ip} - - [{time_str}] "{method} {path} HTTP/1.1" {status} {bytes_sent} "{referrer}" "{user_agent}" {latency}'
        lines.append(line)

    if output_path:
        out_file = Path(output_path)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        with open(out_file, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"[✓] Saved {len(lines)} log lines to {out_file}")

    return lines

if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    out = sys.argv[2] if len(sys.argv) > 2 else "data/access.log"
    scenario = sys.argv[3] if len(sys.argv) > 3 else "normal"
    generate_logs(count=count, output_path=out, scenario=scenario)
