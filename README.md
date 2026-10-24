# ElasticLog - Web Server Log Search & Big Data Analytics Platform

A high-performance **Elasticsearch-based Web Server Log Search and Analytics Platform** designed for Big Data Analytics (BDA). This application ingests, parses, indexes, queries, and visualizes web server access logs (Apache Combined Log Format, Nginx, and JSON), providing real-time operational intelligence, error detection, SLA monitoring, and security anomaly identification.

---

## 🌟 Key Features

### 1. Ingestion & Pre-processing Pipeline
- **Multi-Format Log Parser**: Parses standard Apache Combined Log Format (`%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i"`), Nginx access logs, and JSON application logs using regex and timestamp normalization.
- **Enrichment Engine**: Extracts and derives client IP, geo-location (country/city), HTTP method, endpoint URI, HTTP status class (2xx, 3xx, 4xx, 5xx), response payload size (bytes), latency (ms), browser, and OS.
- **Bulk Indexing Pipeline**: Utilizes high-throughput Elasticsearch `_bulk` API format for efficient batch indexing.

### 2. Big Data Analytics & Elasticsearch Query DSL
- **Full-Text & Lucene Search**: Sub-second full-text search across messages, endpoints, client IPs, user agents, and referrers with query syntax support (e.g. `status:500`, `method:POST`, `ip:198.51.*`).
- **Time-Series Aggregations**: `date_histogram` aggregation for request volume and error spikes over time.
- **Top-N Categorical Aggregations**: `terms` aggregations for Top 10 most visited endpoints, top client IPs, HTTP status code breakdown, referrers, and geo-traffic distribution.
- **Latency & SLA Metrics**: `stats` and `percentiles` aggregations (`p50`, `p90`, `p95`, `p99`) to pinpoint database bottlenecks and tail latency.
- **Security & Anomaly Detection**: Identifies aggressive 404/403 security probes (e.g., `/wp-login.php`, `/.env`, `/admin`) and potential DDoS traffic bursts.

### 3. Modern Glassmorphic Web Dashboard
- **KPI Metrics**: Real-time counters for Total Log Volume, Error Rate (%), Average & 95th Percentile Latency, Total Bandwidth (MB/GB), and Query Latency (ms).
- **Interactive Visualizations (Chart.js)**:
  - Traffic Volume & Error Trends Over Time (dual line & bar chart)
  - HTTP Status Code Distribution (doughnut chart)
  - Top 10 Requested Endpoints (horizontal bar chart)
  - Latency Percentile Distribution (bar chart)
  - Geographic Traffic Breakdown (country-wise traffic)
- **Live Stream Simulator**: Emits real-time streaming web traffic via Server-Sent Events (SSE) and live-updates charts and counters.
- **Document Inspector & Query DSL Viewer**: Inspect raw Elasticsearch `_source` documents and view the exact JSON Elasticsearch Query DSL payload.
- **Exporting**: Download filtered search results as formatted JSON or CSV.

### 4. Dual-Engine Architecture (Zero-Setup Guarantee)
- **Elasticsearch 8.x Client**: Connects directly to local or remote Elasticsearch (`http://localhost:9200`) using native HTTP/REST APIs.
- **Embedded In-Memory Engine**: Includes an in-memory Lucene/Elasticsearch query engine that supports the identical Elasticsearch query DSL, bool filtering, `date_histogram`, `terms`, and `percentiles` aggregations. Evaluators can run the entire system instantly without needing Docker or JVM pre-installed!

---

## 🏗️ System Architecture

```
                                  [ Web Server Logs ]
                       (Apache Access / Nginx / JSON Log Files)
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       Log Ingestion & Parsing         │
                     │  (Regex Extraction, Geo & UA Enrich)  │
                     └───────────────────┬───────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
            ┌─────────────────────────┐     ┌─────────────────────────┐
            │   Real Elasticsearch    │     │   Embedded In-Memory    │
            │   Cluster (Port 9200)   │     │    Elasticsearch Engine │
            │  - Inverted Index       │     │  - Fast Lucene Filter   │
            │  - Shards & Replicas    │     │  - Exact Aggregations   │
            └────────────┬────────────┘     └────────────┬────────────┘
                         │                               │
                         └───────────────┬───────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          ElasticLog Server            │
                     │     (REST API & Streaming Engine)     │
                     └───────────────────┬───────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │    Interactive Analytics Dashboard    │
                     │  (Chart.js, Search Bar, Inspector)    │
                     └───────────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18+ or v22+)
- *(Optional)* **Docker & Docker Compose** (if running official Elasticsearch container)
- *(Optional)* **Python 3.8+** (for running the CLI toolkit)

---

### Step 1: Start the ElasticLog Dashboard
Clone the repository and run:
```bash
# Start the server (Zero external npm dependencies needed!)
node server.js
```
Open your browser and navigate to:
```
http://localhost:3000
```
> **Note**: ElasticLog boots up with 1,500 pre-loaded realistic web server logs in its embedded engine so you can explore the dashboard and query capabilities immediately!

---

### Step 2 (Optional): Run with Real Elasticsearch via Docker
If you want to run against an official Elasticsearch 8.x instance:
```bash
# Spin up single-node Elasticsearch 8.13.0
docker compose up -d elasticsearch
```
Once healthy (`http://localhost:9200`), open the ElasticLog dashboard and click the **Engine Status Badge** in the top navbar. Select **"Auto-Detect"** or **"Enforce Real Elasticsearch"** and click **"Save & Re-test"**. The badge will switch to a green pulse: `Elasticsearch (localhost:9200) [GREEN]`.

---

### Step 3: Explore Features on the Dashboard
1. **Search Logs**:
   - Type `status:500` to find all internal server errors.
   - Type `method:POST` to inspect transactional traffic.
   - Type `/api/v1/auth` to filter authentication endpoints.
2. **Quick Facets**:
   - Click **"HTTP Errors (4xx/5xx)"** to view failure rates.
   - Click **"Slow Requests (>500ms)"** to analyze high latency requests.
   - Click **"Security Probes & Scanners"** to see vulnerability scanners scanning `/wp-login.php`, `/.env`, etc.
3. **Ingest Traffic Scenarios**:
   - Click **"Ingest Traffic"** to generate 500, 1,500, or 10,000 logs simulating **Normal Traffic**, **DDoS Attacks**, or **Database Slowdowns**.
4. **Live Streaming**:
   - Click **"LIVE STREAM"** to start real-time log ingestion every 2 seconds with animated updates.
5. **Inspect Queries**:
   - Click **"ES Query DSL"** to view the exact JSON payload sent to `POST /web-server-logs/_search`.

---

## 🐍 Python Big Data Analytics Toolkit

A complete standalone Python CLI toolkit is provided in `python_toolkit/` using only Python standard libraries:

### 1. Generate Custom Log Datasets
```bash
# Generate 5,000 logs under DDoS scenario to data/access.log
python3 python_toolkit/log_generator.py 5000 data/access.log ddos
```

### 2. Run Terminal Analytics Queries
```bash
# Query Elasticsearch cluster at http://localhost:9200
python3 python_toolkit/analytics_cli.py http://localhost:9200

# Bulk ingest a custom log file into Elasticsearch via CLI
python3 python_toolkit/analytics_cli.py http://localhost:9200 ingest data/access.log
```

---

## 📑 Elasticsearch Schema & Mapping Design

Index: `web-server-logs`
```json
{
  "mappings": {
    "properties": {
      "@timestamp": { "type": "date" },
      "client_ip": {
        "type": "ip",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "http_method": { "type": "keyword" },
      "endpoint": {
        "type": "text",
        "fields": { "raw": { "type": "keyword" } }
      },
      "status_code": { "type": "integer" },
      "status_group": { "type": "keyword" },
      "response_size": { "type": "long" },
      "response_time_ms": { "type": "float" },
      "referrer": { "type": "keyword" },
      "user_agent": {
        "type": "text",
        "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } }
      },
      "browser": { "type": "keyword" },
      "os": { "type": "keyword" },
      "country": { "type": "keyword" },
      "city": { "type": "keyword" },
      "is_error": { "type": "boolean" },
      "raw_message": { "type": "text" }
    }
  }
}
```

### Design Rationale:
- **`endpoint` multi-field**: Tokenized `text` enables full-text search (e.g. searching "products" matches `/api/v1/products`), while `endpoint.raw` (`keyword`) is used for exact `terms` aggregation without token fragmentation.
- **`client_ip`**: Stored as native `ip` type for CIDR range queries (e.g., `192.168.0.0/16`) and `keyword` for fast exact-match filters.
- **`response_time_ms` & `response_size`**: Numeric types (`float`, `long`) allow `stats` (min, max, avg) and `percentiles` (p50, p90, p95, p99) calculations.

