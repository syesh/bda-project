# ElasticLog 📊

ElasticLog is a web server log search and big data analytics platform that helps analyze server traffic, monitor error rates, inspect latency percentiles, and detect suspicious activity through an interactive visual dashboard.

It is designed with **dual-engine architecture**:
1. **GitHub Pages / In-Browser Mode**: Runs 100% client-side in the browser using an embedded Elasticsearch Lucene-compatible query and aggregation engine. Zero backend required!
2. **Full-Stack Mode**: Connects to Node.js and a live multi-node Elasticsearch 8.x cluster.

---

## 🌐 Live Demo on GitHub Pages

Experience the full interactive dashboard live with zero installation:

👉 **[https://syesh.github.io/bda-project/](https://syesh.github.io/bda-project/)**

---

## 🚀 How to Enable GitHub Pages

To host this repository on your GitHub Pages:

1. Push your changes to GitHub:
   ```bash
   git push origin main
   ```
2. In your GitHub repository (`syesh/bda-project`), go to **Settings** → **Pages** (in the left sidebar).
3. Under **Build and deployment** → **Source**, select either:
   - **GitHub Actions** *(Recommended - an automated workflow in `.github/workflows/deploy.yml` is already included)*, **OR**
   - **Deploy from a branch** → select branch `main` and folder `/ (root)`.
4. Your dashboard will be live at `https://syesh.github.io/bda-project/`!

---

## ✨ Features

- **Elasticsearch Query DSL**: Inspect real JSON Elasticsearch queries (`bool`, `multi_match`, `range`, `wildcard`).
- **Big Data Aggregations**: Computes `date_histogram`, `terms`, `stats`, and `percentiles` (p50, p90, p95, p99).
- **Log Parsing**: Ingest and parse Apache Combined, Nginx, and JSON log lines.
- **Traffic Simulation**: Generate realistic synthetic traffic (Normal, Spike, DDoS Attack, Latency Degradation, Vulnerability Scanning).
- **Live Stream**: Real-time traffic ingestion simulation with dynamic chart updating.
- **Data Export**: Export filtered log documents directly to CSV or JSON.
- **Visual Analytics**: Interactive Chart.js graphs for traffic trends, error rates, status code distribution, top endpoints, geo distribution, and latency.

---

## 💻 Run Locally

### Option 1: Direct In-Browser (Zero Installation)
Simply open `index.html` in any modern web browser.

### Option 2: Node.js Server
```bash
git clone https://github.com/syesh/bda-project.git
cd bda-project
node server.js
```
Open `http://localhost:3000` in your browser.

### Option 3: With Real Elasticsearch Cluster
```bash
docker compose up -d
node server.js
```

---

## 👤 Author

**Swasthik Yesh**
