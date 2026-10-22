#!/usr/bin/env python3
"""
Big Data Analytics - Terminal Query CLI
Executes aggregations, searches, and analysis against Elasticsearch
(with seamless offline fallback to direct data/access.log parsing).
"""

import sys
import json
import statistics
from collections import Counter
from pathlib import Path

# Ensure directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from log_parser import parse_log_line
from es_client import PythonElasticsearchClient

def print_header(title):
    print("\n" + "=" * 68)
    print(f"  📊 {title}")
    print("=" * 68)

def run_ingest(client, log_file="data/access.log"):
    path = Path(log_file)
    if not path.exists():
        print(f"[!] Log file not found: {log_file}")
        print("    Run 'python3 python_toolkit/log_generator.py 2000 data/access.log' first.")
        return

    print(f"[*] Reading and parsing logs from {path}...")
    docs = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            d = parse_log_line(line)
            if d:
                docs.append(d)

    print(f"[*] Bulk indexing {len(docs)} documents into Elasticsearch ({client.index})...")
    try:
        res = client.bulk_index(docs)
        print(f"[✓] Bulk Index complete! Took: {res.get('took', 0)}ms, Errors: {res.get('errors', False)}")
    except Exception as e:
        print(f"[!] Bulk index failed: {e}")

def run_local_fallback_analytics(log_file="data/access.log"):
    """Performs identical Big Data analytics directly on the raw log dataset if ES is offline."""
    path = Path(log_file)
    if not path.exists():
        print(f"[!] Log file '{log_file}' not found.")
        print("    Generating sample dataset first...")
        from log_generator import generate_logs
        generate_logs(count=2000, output_path=str(path), scenario="normal")

    print_header("Local Dataset Big Data Analytics Report (Direct Log Stream)")
    print(f"Source Dataset : {path.resolve()}")

    docs = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            d = parse_log_line(line)
            if d:
                docs.append(d)

    total_docs = len(docs)
    print(f"Total Log Docs : {total_docs:,}")

    # 1. HTTP Status Code Breakdown
    status_counts = Counter(d["status_code"] for d in docs)
    print("\n[1] HTTP Status Code Distribution (Terms Aggregation):")
    print(f"{'Status Code':<15} {'Request Count':<15} {'Percentage'}")
    print("-" * 45)
    for code, count in sorted(status_counts.items(), key=lambda x: x[1], reverse=True):
        pct = (count / total_docs) * 100
        print(f"HTTP {code:<10} {count:<15,} {pct:.2f}%")

    # 2. Top 10 Requested Endpoints
    endpoint_counts = Counter(d["endpoint"] for d in docs)
    print("\n[2] Top 10 Requested Endpoints (Terms Aggregation):")
    print(f"{'Endpoint URL':<42} {'Hits'}")
    print("-" * 52)
    for endpoint, count in endpoint_counts.most_common(10):
        print(f"{endpoint:<42} {count:,}")

    # 3. Response Time Percentiles (SLA Analysis)
    latencies = [d["response_time_ms"] for d in docs]
    latencies.sort()
    min_lat = min(latencies) if latencies else 0
    max_lat = max(latencies) if latencies else 0
    avg_lat = statistics.mean(latencies) if latencies else 0

    def calc_percentile(data, p):
        if not data: return 0
        idx = int((p / 100) * len(data))
        return data[min(idx, len(data) - 1)]

    print("\n[3] Response Latency Performance Analysis (Percentiles & Stats Aggregation):")
    print(f"  • Min Latency:              {min_lat:.2f} ms")
    print(f"  • Max Latency:              {max_lat:.2f} ms")
    print(f"  • Avg Latency:              {avg_lat:.2f} ms")
    print(f"  • 50th Percentile (Median): {calc_percentile(latencies, 50):.2f} ms")
    print(f"  • 90th Percentile:          {calc_percentile(latencies, 90):.2f} ms")
    print(f"  • 95th Percentile (SLA):    {calc_percentile(latencies, 95):.2f} ms")
    print(f"  • 99th Percentile (Tail):   {calc_percentile(latencies, 99):.2f} ms")

    # 4. Security Anomaly Detection
    error_ips = Counter(d["client_ip"] for d in docs if d["status_code"] >= 400)
    print("\n[4] Top Clients with Failed/Error Requests (Security Anomalies):")
    for ip, count in error_ips.most_common(5):
        print(f"  • IP: {ip:<18} Error count: {count:,}")

    print("=" * 68 + "\n")

def run_es_analytics(client):
    print_header("Elasticsearch Big Data Web Server Log Analytics")

    # Check health & count
    try:
        health = client.check_health()
        print(f"Cluster Status : {health.get('status', 'unknown').upper()} ({health.get('cluster_name', '-')})")
    except Exception as e:
        print(f"[!] Warning: ES health check failed: {e}")

    try:
        count_res = client.count()
        print(f"Total Log Docs : {count_res.get('count', 0):,}")
    except Exception as e:
        print(f"[!] Count error: {e}")
        print("[*] Switching to local dataset analysis...")
        run_local_fallback_analytics()
        return

    # 1. Status Code Breakdown Aggregation
    status_query = {
        "size": 0,
        "aggs": {
            "status_counts": {
                "terms": {"field": "status_code", "size": 10}
            }
        }
    }
    res = client.search(status_query)
    buckets = res.get("aggregations", {}).get("status_counts", {}).get("buckets", [])

    print("\n[1] HTTP Status Code Distribution (Terms Aggregation):")
    print(f"{'Status Code':<15} {'Request Count':<15} {'Percentage'}")
    print("-" * 45)
    total_reqs = sum(b["doc_count"] for b in buckets) or 1
    for b in buckets:
        pct = (b["doc_count"] / total_reqs) * 100
        print(f"HTTP {b['key']:<10} {b['doc_count']:<15,} {pct:.2f}%")

    # 2. Top Visited Endpoints
    endpoint_query = {
        "size": 0,
        "aggs": {
            "top_paths": {
                "terms": {"field": "endpoint.raw", "size": 10}
            }
        }
    }
    res = client.search(endpoint_query)
    buckets = res.get("aggregations", {}).get("top_paths", {}).get("buckets", [])

    print("\n[2] Top 10 Requested Endpoints (Terms Aggregation):")
    print(f"{'Endpoint URL':<42} {'Hits'}")
    print("-" * 52)
    for b in buckets:
        print(f"{b['key']:<42} {b['doc_count']:,}")

    # 3. Response Time Percentiles
    perf_query = {
        "size": 0,
        "aggs": {
            "latency_stats": {"stats": {"field": "response_time_ms"}},
            "latency_percentiles": {
                "percentiles": {"field": "response_time_ms", "percents": [50, 90, 95, 99]}
            }
        }
    }
    res = client.search(perf_query)
    aggs = res.get("aggregations", {})
    stats = aggs.get("latency_stats", {})
    pcts = aggs.get("latency_percentiles", {}).get("values", {})

    print("\n[3] Response Latency Performance Analysis (Percentiles & Stats Aggregation):")
    print(f"  • Min Latency:              {stats.get('min', 0):.2f} ms")
    print(f"  • Max Latency:              {stats.get('max', 0):.2f} ms")
    print(f"  • Avg Latency:              {stats.get('avg', 0):.2f} ms")
    print(f"  • 50th Percentile (Median): {pcts.get('50.0', 0):.2f} ms")
    print(f"  • 90th Percentile:          {pcts.get('90.0', 0):.2f} ms")
    print(f"  • 95th Percentile (SLA):    {pcts.get('95.0', 0):.2f} ms")
    print(f"  • 99th Percentile (Tail):   {pcts.get('99.0', 0):.2f} ms")

    # 4. Security Anomaly Detection
    anomaly_query = {
        "size": 0,
        "query": {
            "range": {"status_code": {"gte": 400}}
        },
        "aggs": {
            "suspicious_ips": {
                "terms": {"field": "client_ip.keyword", "size": 5}
            }
        }
    }
    res = client.search(anomaly_query)
    suspicious = res.get("aggregations", {}).get("suspicious_ips", {}).get("buckets", [])
    print("\n[4] Top Clients with Failed/Error Requests (Security Anomalies):")
    for b in suspicious:
        print(f"  • IP: {b['key']:<18} Error count: {b['doc_count']:,}")

    print("=" * 68 + "\n")

def main():
    host = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "http://localhost:9200"
    client = PythonElasticsearchClient(host=host)

    if len(sys.argv) > 2 and sys.argv[2] == "ingest":
        log_file = sys.argv[3] if len(sys.argv) > 3 else "data/access.log"
        run_ingest(client, log_file)
    else:
        # Check if ES is pingable
        if client.ping():
            run_es_analytics(client)
        else:
            print(f"[*] Elasticsearch not responding on {host}.")
            print("    Switching to standalone Big Data analytics over 'data/access.log'...")
            run_local_fallback_analytics()

if __name__ == "__main__":
    main()
