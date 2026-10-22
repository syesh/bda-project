/**
 * ElasticLog Server - Big Data Web Server Log Analytics Engine
 * Built with native Node.js 22 HTTP server (zero external dependencies).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  ELASTICSEARCH_MAPPING,
  parseLogLine,
  generateSyntheticLogs,
  InMemoryElasticEngine
} = require('./lib/logEngine');
const { ElasticsearchRestClient } = require('./lib/esClient');

const PORT = parseInt(process.env.PORT, 10) || 3000;
let ES_HOST = process.env.ELASTICSEARCH_HOST || 'http://localhost:9200';
const INDEX_NAME = 'web-server-logs';

// State
let enginePreference = 'auto'; // 'auto' | 'elasticsearch' | 'embedded'
const inMemoryEngine = new InMemoryElasticEngine();
const realEsClient = new ElasticsearchRestClient(ES_HOST, INDEX_NAME);

// Preload initial synthetic data into in-memory engine so it works immediately out of the box
console.log('⚡ Initializing ElasticLog with preloaded sample dataset...');
const initialLogs = generateSyntheticLogs(1500, { scenario: 'normal', timeWindowMinutes: 120 });
inMemoryEngine.bulkIndex(initialLogs);

// Keep track of active SSE streams
const activeLiveClients = new Set();

// Live traffic simulation interval
setInterval(async () => {
  if (activeLiveClients.size === 0) return;
  // Generate 1-3 new logs per tick
  const batchCount = Math.floor(1 + Math.random() * 3);
  const newLogs = generateSyntheticLogs(batchCount, {
    timeWindowMinutes: 1,
    startTime: new Date()
  });

  // Index into active engine
  try {
    const isEsActive = await checkActiveModeIsES();
    if (isEsActive) {
      await realEsClient.bulkIndex(newLogs);
    } else {
      inMemoryEngine.bulkIndex(newLogs);
    }
  } catch (err) {
    console.error('Live index error:', err.message);
  }

  // Push to SSE clients
  const payload = JSON.stringify(newLogs);
  for (const client of activeLiveClients) {
    try {
      client.write(`event: log\ndata: ${payload}\n\n`);
    } catch {
      activeLiveClients.delete(client);
    }
  }
}, 2000);

/**
 * Determine which engine to use based on preference and live ES availability
 */
async function checkActiveModeIsES() {
  if (enginePreference === 'embedded') return false;
  const health = await realEsClient.checkHealth();
  if (health.reachable) {
    return true;
  }
  return false;
}

/**
 * Build Elasticsearch DSL Query from incoming dashboard parameters
 */
function buildElasticsearchDSL(params = {}) {
  const {
    query = '',
    statusCodes = [],
    methods = [],
    timeRange = 'all', // '15m', '1h', '24h', '7d', 'all'
    minLatency,
    maxLatency,
    page = 1,
    pageSize = 25,
    sortField = '@timestamp',
    sortOrder = 'desc',
    endpointFilter = '',
    scenarioFilter = ''
  } = params;

  const mustClauses = [];
  const filterClauses = [];

  // Full-text query across multiple fields
  if (query && query.trim()) {
    const q = query.trim();
    // Support syntax like status:500 or method:POST or ip:192.168.1.1
    const fieldMatch = q.match(/^(status|method|ip|endpoint|country):(.+)$/i);
    if (fieldMatch) {
      const [, fieldKey, fieldVal] = fieldMatch;
      const keyLower = fieldKey.toLowerCase();
      if (keyLower === 'status') {
        filterClauses.push({ term: { status_code: parseInt(fieldVal, 10) } });
      } else if (keyLower === 'method') {
        filterClauses.push({ term: { http_method: fieldVal.toUpperCase() } });
      } else if (keyLower === 'ip') {
        filterClauses.push({ term: { 'client_ip.keyword': fieldVal } });
      } else if (keyLower === 'endpoint') {
        filterClauses.push({ wildcard: { 'endpoint.raw': `*${fieldVal}*` } });
      } else if (keyLower === 'country') {
        filterClauses.push({ term: { country: fieldVal } });
      }
    } else {
      mustClauses.push({
        multi_match: {
          query: q,
          fields: ['raw_message', 'endpoint^3', 'client_ip', 'user_agent', 'referrer'],
          fuzziness: 'AUTO'
        }
      });
    }
  }

  // HTTP Method filter
  if (methods && methods.length > 0) {
    filterClauses.push({ terms: { http_method: methods } });
  }

  // HTTP Status code filter
  if (statusCodes && statusCodes.length > 0) {
    const numericCodes = statusCodes.map(Number).filter(n => !isNaN(n));
    if (numericCodes.length > 0) {
      filterClauses.push({ terms: { status_code: numericCodes } });
    }
  }

  // Specific Endpoint filter (supports single pattern or comma-separated list)
  if (endpointFilter && endpointFilter.trim()) {
    const rawFilter = endpointFilter.trim();
    if (rawFilter.includes(',')) {
      const parts = rawFilter.split(',').map(p => p.trim()).filter(Boolean);
      const shouldClauses = parts.map(p => ({ wildcard: { 'endpoint.raw': `*${p}*` } }));
      filterClauses.push({ bool: { should: shouldClauses } });
    } else {
      filterClauses.push({ wildcard: { 'endpoint.raw': `*${rawFilter}*` } });
    }
  }

  // Time Range filter
  if (timeRange && timeRange !== 'all') {
    const now = Date.now();
    let durationMs = 60 * 60 * 1000;
    if (timeRange === '15m') durationMs = 15 * 60 * 1000;
    else if (timeRange === '1h') durationMs = 60 * 60 * 1000;
    else if (timeRange === '24h') durationMs = 24 * 60 * 60 * 1000;
    else if (timeRange === '7d') durationMs = 7 * 24 * 60 * 60 * 1000;

    const gteIso = new Date(now - durationMs).toISOString();
    filterClauses.push({
      range: {
        '@timestamp': {
          gte: gteIso,
          lte: new Date(now).toISOString()
        }
      }
    });
  }

  // Latency range filter
  if (minLatency !== undefined || maxLatency !== undefined) {
    const rangeObj = {};
    if (minLatency !== undefined && minLatency !== '') rangeObj.gte = parseFloat(minLatency);
    if (maxLatency !== undefined && maxLatency !== '') rangeObj.lte = parseFloat(maxLatency);
    filterClauses.push({ range: { response_time_ms: rangeObj } });
  }

  // Construct bool query
  const boolQuery = {
    bool: {
      must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
      filter: filterClauses
    }
  };

  // Determine appropriate date_histogram interval based on time range
  let histogramInterval = '2m';
  if (timeRange === '15m') histogramInterval = '30s';
  else if (timeRange === '1h') histogramInterval = '2m';
  else if (timeRange === '24h') histogramInterval = '30m';
  else if (timeRange === '7d') histogramInterval = '3h';
  else histogramInterval = '5m';

  // Elasticsearch Aggregations Definition
  const aggregations = {
    // 1. Time-series traffic and error trends
    traffic_over_time: {
      date_histogram: {
        field: '@timestamp',
        fixed_interval: histogramInterval
      },
      aggs: {
        avg_latency: { stats: { field: 'response_time_ms' } },
        error_count: {
          filter: { range: { status_code: { gte: 400 } } }
        }
      }
    },
    // 2. HTTP Status Code breakdown
    status_distribution: {
      terms: { field: 'status_code', size: 10 }
    },
    // 3. Top Endpoints
    top_endpoints: {
      terms: { field: 'endpoint.raw', size: 10 }
    },
    // 4. Latency Statistics and Percentiles
    latency_stats: {
      stats: { field: 'response_time_ms' }
    },
    latency_percentiles: {
      percentiles: {
        field: 'response_time_ms',
        percents: [50, 90, 95, 99]
      }
    },
    // 5. Geographic distribution (Country)
    country_distribution: {
      terms: { field: 'country', size: 10 }
    },
    // 6. Top client IPs
    top_client_ips: {
      terms: { field: 'client_ip.keyword', size: 10 }
    },
    // 7. HTTP Methods distribution
    methods_distribution: {
      terms: { field: 'http_method', size: 8 }
    },
    // 8. Total Bytes Transferred
    total_bytes: {
      stats: { field: 'response_size' }
    }
  };

  const from = Math.max(0, (page - 1) * pageSize);

  return {
    from,
    size: pageSize,
    sort: [{ [sortField]: { order: sortOrder } }],
    query: boolQuery,
    aggs: aggregations
  };
}

/**
 * HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helper for JSON response
  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper for reading JSON body
  const readJsonBody = () => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  };

  // Helper for reading raw text body (for log file upload)
  const readTextBody = () => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) reject(new Error('Payload too large'));
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  };

  try {
    // -------------------------------------------------------------
    // API: System Status and Engine Detection
    // -------------------------------------------------------------
    if (pathname === '/api/status' && method === 'GET') {
      const isEsActive = await checkActiveModeIsES();
      const esHealth = await realEsClient.checkHealth();
      const clusterInfo = isEsActive ? await realEsClient.getClusterInfo() : null;

      let docCount = 0;
      if (isEsActive) {
        try {
          const countRes = await realEsClient.count();
          docCount = countRes.count || 0;
        } catch {
          docCount = 0;
        }
      } else {
        docCount = inMemoryEngine.count().count;
      }

      sendJson(200, {
        status: 'online',
        activeEngine: isEsActive ? 'elasticsearch' : 'embedded',
        enginePreference,
        elasticsearch: {
          host: ES_HOST,
          reachable: esHealth.reachable,
          status: esHealth.status || 'offline',
          error: esHealth.error || null,
          cluster_name: esHealth.cluster_name || null,
          version: clusterInfo?.version?.number || '8.x'
        },
        index: {
          name: INDEX_NAME,
          documentCount: docCount
        }
      });
      return;
    }

    // -------------------------------------------------------------
    // API: Update Configuration (Engine preference, ES Host)
    // -------------------------------------------------------------
    if (pathname === '/api/config' && method === 'POST') {
      const body = await readJsonBody();
      if (body.host) {
        ES_HOST = body.host;
        realEsClient.setBaseUrl(ES_HOST);
      }
      if (body.enginePreference) {
        enginePreference = body.enginePreference;
      }
      sendJson(200, { success: true, host: ES_HOST, enginePreference });
      return;
    }

    // -------------------------------------------------------------
    // API: Initialize / Sync Index & Mappings
    // -------------------------------------------------------------
    if (pathname === '/api/index/init' && method === 'POST') {
      const isEsActive = await checkActiveModeIsES();
      if (isEsActive) {
        const exists = await realEsClient.indexExists();
        if (!exists) {
          await realEsClient.createIndex(ELASTICSEARCH_MAPPING);
        }
        // If empty, seed initial data
        const count = (await realEsClient.count().catch(() => ({ count: 0 }))).count;
        if (count === 0) {
          const sample = generateSyntheticLogs(1000, { scenario: 'normal', timeWindowMinutes: 60 });
          await realEsClient.bulkIndex(sample);
        }
        sendJson(200, { success: true, engine: 'elasticsearch', message: 'Index verified & ready' });
      } else {
        inMemoryEngine.createIndex();
        if (inMemoryEngine.count().count === 0) {
          const sample = generateSyntheticLogs(1000, { scenario: 'normal', timeWindowMinutes: 60 });
          inMemoryEngine.bulkIndex(sample);
        }
        sendJson(200, { success: true, engine: 'embedded', message: 'In-memory engine verified & ready' });
      }
      return;
    }

    // -------------------------------------------------------------
    // API: Clear / Reset Index
    // -------------------------------------------------------------
    if (pathname === '/api/index/clear' && method === 'POST') {
      const isEsActive = await checkActiveModeIsES();
      if (isEsActive) {
        try {
          await realEsClient.deleteIndex();
          await realEsClient.createIndex(ELASTICSEARCH_MAPPING);
        } catch (err) {
          return sendJson(500, { error: err.message });
        }
      } else {
        inMemoryEngine.deleteIndex();
      }
      sendJson(200, { success: true, message: 'Index successfully cleared' });
      return;
    }

    // -------------------------------------------------------------
    // API: Generate Synthetic Logs (Normal, Spike, DDoS, Latency)
    // -------------------------------------------------------------
    if (pathname === '/api/index/generate' && method === 'POST') {
      const body = await readJsonBody();
      const count = Math.min(25000, Math.max(10, parseInt(body.count, 10) || 500));
      const scenario = body.scenario || 'normal'; // 'normal', 'spike', 'ddos', 'slow', 'probe'
      const timeWindowMinutes = parseInt(body.timeWindowMinutes, 10) || 60;

      const newDocs = generateSyntheticLogs(count, { scenario, timeWindowMinutes });
      const isEsActive = await checkActiveModeIsES();

      let result;
      if (isEsActive) {
        result = await realEsClient.bulkIndex(newDocs);
      } else {
        result = inMemoryEngine.bulkIndex(newDocs);
      }

      sendJson(200, {
        success: true,
        generated: count,
        scenario,
        engine: isEsActive ? 'elasticsearch' : 'embedded',
        result
      });
      return;
    }

    // -------------------------------------------------------------
    // API: Bulk Upload Raw Log File / Text
    // -------------------------------------------------------------
    if (pathname === '/api/index/upload' && method === 'POST') {
      const text = await readTextBody();
      if (!text || !text.trim()) {
        return sendJson(400, { error: 'Empty log content provided' });
      }

      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const parsedDocs = [];
      let parseErrors = 0;

      for (const line of lines) {
        const doc = parseLogLine(line);
        if (doc) {
          parsedDocs.push(doc);
        } else {
          parseErrors++;
        }
      }

      if (parsedDocs.length === 0) {
        return sendJson(400, {
          error: 'No valid log lines could be parsed. Expected Apache Combined or JSON format.',
          totalLines: lines.length,
          parseErrors
        });
      }

      const isEsActive = await checkActiveModeIsES();
      let result;
      if (isEsActive) {
        result = await realEsClient.bulkIndex(parsedDocs);
      } else {
        result = inMemoryEngine.bulkIndex(parsedDocs);
      }

      sendJson(200, {
        success: true,
        indexed: parsedDocs.length,
        parseErrors,
        totalLines: lines.length,
        engine: isEsActive ? 'elasticsearch' : 'embedded',
        result
      });
      return;
    }

    // -------------------------------------------------------------
    // API: Search & Analytics Query DSL Execution
    // -------------------------------------------------------------
    if (pathname === '/api/search' && method === 'POST') {
      const params = await readJsonBody();
      const esDSL = buildElasticsearchDSL(params);

      const isEsActive = await checkActiveModeIsES();
      let queryResult;

      try {
        if (isEsActive) {
          queryResult = await realEsClient.search(esDSL);
        } else {
          queryResult = inMemoryEngine.search(esDSL);
        }
      } catch (err) {
        return sendJson(500, {
          error: err.message,
          dslQuery: esDSL
        });
      }

      sendJson(200, {
        engine: isEsActive ? 'elasticsearch' : 'embedded',
        dslQuery: esDSL,
        took: queryResult.took,
        total: queryResult.hits?.total?.value || 0,
        hits: queryResult.hits?.hits || [],
        aggregations: queryResult.aggregations || {}
      });
      return;
    }

    // -------------------------------------------------------------
    // API: Live Streaming Server-Sent Events (SSE)
    // -------------------------------------------------------------
    if (pathname === '/api/live/stream' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      res.write(': connected\n\n');
      activeLiveClients.add(res);

      req.on('close', () => {
        activeLiveClients.delete(res);
      });
      return;
    }

    // -------------------------------------------------------------
    // API: Export Logs (CSV / JSON)
    // -------------------------------------------------------------
    if (pathname === '/api/export' && method === 'POST') {
      const params = await readJsonBody();
      params.pageSize = 5000; // max export
      params.page = 1;

      const esDSL = buildElasticsearchDSL(params);
      const isEsActive = await checkActiveModeIsES();
      const queryResult = isEsActive ? await realEsClient.search(esDSL) : inMemoryEngine.search(esDSL);
      const hits = (queryResult.hits?.hits || []).map(h => h._source);
      const format = params.format || 'json';

      if (format === 'csv') {
        const headers = ['@timestamp', 'client_ip', 'http_method', 'endpoint', 'status_code', 'response_size', 'response_time_ms', 'country', 'browser', 'os'];
        const csvRows = [headers.join(',')];

        for (const item of hits) {
          const row = headers.map(h => {
            const val = item[h] !== undefined ? String(item[h]).replace(/"/g, '""') : '';
            return `"${val}"`;
          });
          csvRows.push(row.join(','));
        }

        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="web_server_logs.csv"'
        });
        res.end(csvRows.join('\n'));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="web_server_logs.json"'
      });
      res.end(JSON.stringify(hits, null, 2));
      return;
    }

    // -------------------------------------------------------------
    // Static Files Handler (public/ folder)
    // -------------------------------------------------------------
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(500, { error: 'Internal server error', details: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[!] Port ${PORT} is already in use by another process.`);
    console.error(`    Try running with: PORT=${PORT + 1} node server.js\n`);
  } else {
    console.error(`\n[!] Server error: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 ElasticLog Web Server Analytics is RUNNING!`);
  console.log(`  🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`  🔌 Elasticsearch Target: ${ES_HOST}`);
  console.log(`  📊 Mode: ${enginePreference.toUpperCase()}`);
  console.log(`======================================================\n`);
});
