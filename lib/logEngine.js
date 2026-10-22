/**
 * ElasticLog Engine - Core Log Parsing, Generation, and Query Abstraction
 * Handles Apache/Nginx parsing, realistic synthetic traffic generation,
 * Elasticsearch 8.x schema definition, and dual-mode query execution.
 */

const crypto = require('node:crypto');

// Apache Combined Log Format regex pattern
const APACHE_COMBINED_REGEX =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"\s]+)(?:\s+HTTP\/[\d\.]+)?\"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+(\d+(?:\.\d+)?))?/;

// Realistic reference data for synthetic traffic generation
const IP_POOLS = [
  { ip: '198.51.100.42', country: 'United States', city: 'San Francisco' },
  { ip: '203.0.113.19', country: 'India', city: 'Bangalore' },
  { ip: '192.0.2.78', country: 'Germany', city: 'Frankfurt' },
  { ip: '185.199.108.153', country: 'United Kingdom', city: 'London' },
  { ip: '103.21.244.0', country: 'Singapore', city: 'Singapore' },
  { ip: '142.250.190.46', country: 'United States', city: 'New York' },
  { ip: '117.200.45.88', country: 'India', city: 'Mumbai' },
  { ip: '151.101.65.140', country: 'Japan', city: 'Tokyo' },
  { ip: '185.220.101.5', country: 'Russia', city: 'Moscow' }, // often used for scanner probes
  { ip: '45.33.32.156', country: 'Brazil', city: 'São Paulo' },
  { ip: '13.234.120.91', country: 'India', city: 'Hyderabad' },
  { ip: '104.244.42.1', country: 'Canada', city: 'Toronto' }
];

const ENDPOINTS = [
  { path: '/api/v1/auth/login', method: 'POST', weight: 15, baseLatency: 120 },
  { path: '/api/v1/auth/logout', method: 'POST', weight: 5, baseLatency: 45 },
  { path: '/api/v1/products', method: 'GET', weight: 35, baseLatency: 65 },
  { path: '/api/v1/products/search', method: 'GET', weight: 20, baseLatency: 110 },
  { path: '/api/v1/cart/items', method: 'POST', weight: 15, baseLatency: 95 },
  { path: '/api/v1/checkout/payment', method: 'POST', weight: 10, baseLatency: 340 },
  { path: '/api/v1/orders/history', method: 'GET', weight: 12, baseLatency: 180 },
  { path: '/api/v1/analytics/realtime', method: 'GET', weight: 8, baseLatency: 280 },
  { path: '/dashboard/overview', method: 'GET', weight: 25, baseLatency: 75 },
  { path: '/static/css/theme-dark.min.css', method: 'GET', weight: 30, baseLatency: 15 },
  { path: '/static/js/bundle.core.js', method: 'GET', weight: 30, baseLatency: 22 },
  { path: '/favicon.ico', method: 'GET', weight: 20, baseLatency: 8 },
  // Malicious/Security scanning endpoints for detection analytics:
  { path: '/wp-login.php', method: 'GET', weight: 3, baseLatency: 35, isProbe: true },
  { path: '/.env', method: 'GET', weight: 2, baseLatency: 20, isProbe: true },
  { path: '/admin/config.php', method: 'GET', weight: 2, baseLatency: 40, isProbe: true },
  { path: '/phpmyadmin/index.php', method: 'GET', weight: 2, baseLatency: 30, isProbe: true }
];

const USER_AGENTS = [
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    browser: 'Chrome',
    os: 'macOS'
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    browser: 'Chrome',
    os: 'Windows'
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    browser: 'Mobile Safari',
    os: 'iOS'
  },
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    browser: 'Firefox',
    os: 'Linux'
  },
  {
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36',
    browser: 'Chrome Mobile',
    os: 'Android'
  },
  {
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    browser: 'Googlebot',
    os: 'Bot'
  },
  {
    ua: 'curl/8.4.0',
    browser: 'cURL',
    os: 'CLI'
  },
  {
    ua: 'masscan/1.3.2 (scanner)',
    browser: 'Security Scanner',
    os: 'Automated'
  }
];

const REFERRERS = [
  'https://www.google.com/search?q=ecommerce+store',
  'https://github.com/topics/big-data-analytics',
  'https://twitter.com/feed',
  'https://linkedin.com/feed',
  'https://news.ycombinator.com',
  '-'
];

/**
 * Elasticsearch Index Mapping Definition for BDA Log Analytics
 */
const ELASTICSEARCH_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        log_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding']
        }
      }
    }
  },
  mappings: {
    properties: {
      '@timestamp': { type: 'date' },
      client_ip: {
        type: 'ip',
        fields: {
          keyword: { type: 'keyword' }
        }
      },
      http_method: { type: 'keyword' },
      endpoint: {
        type: 'text',
        analyzer: 'log_analyzer',
        fields: {
          raw: { type: 'keyword' }
        }
      },
      status_code: { type: 'integer' },
      status_group: { type: 'keyword' }, // 2xx, 3xx, 4xx, 5xx
      response_size: { type: 'long' },
      response_time_ms: { type: 'float' },
      referrer: { type: 'keyword' },
      user_agent: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword', ignore_above: 256 }
        }
      },
      browser: { type: 'keyword' },
      os: { type: 'keyword' },
      country: { type: 'keyword' },
      city: { type: 'keyword' },
      is_error: { type: 'boolean' },
      raw_message: { type: 'text' }
    }
  }
};

/**
 * Parses Apache/Nginx format log line into structured Elasticsearch document
 */
function parseLogLine(line) {
  if (!line || !line.trim()) return null;
  const match = line.match(APACHE_COMBINED_REGEX);

  if (match) {
    const [
      ,
      client_ip,
      ,
      ,
      rawTime,
      http_method,
      endpoint,
      statusCodeStr,
      bytesStr,
      referrer,
      user_agent,
      latencyStr
    ] = match;

    const statusCode = parseInt(statusCodeStr, 10);
    const responseSize = bytesStr === '-' ? 0 : parseInt(bytesStr, 10) || 0;
    const responseTimeMs = latencyStr ? parseFloat(latencyStr) : Math.round(15 + Math.random() * 120);

    // Parse date: 22/Oct/2026:14:32:10 +0000 or ISO
    let timestamp;
    try {
      const parts = rawTime.match(/(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
      if (parts) {
        const months = {
          Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
          Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
        };
        const dateObj = new Date(Date.UTC(
          parseInt(parts[3], 10),
          months[parts[2]] || 0,
          parseInt(parts[1], 10),
          parseInt(parts[4], 10),
          parseInt(parts[5], 10),
          parseInt(parts[6], 10)
        ));
        timestamp = dateObj.toISOString();
      } else {
        timestamp = new Date(rawTime).toISOString();
      }
    } catch {
      timestamp = new Date().toISOString();
    }

    const { browser, os } = detectBrowserOS(user_agent);
    const geo = detectGeo(client_ip);

    return {
      '@timestamp': timestamp,
      client_ip,
      http_method,
      endpoint,
      status_code: statusCode,
      status_group: `${Math.floor(statusCode / 100)}xx`,
      response_size: responseSize,
      response_time_ms: responseTimeMs,
      referrer,
      user_agent,
      browser,
      os,
      country: geo.country,
      city: geo.city,
      is_error: statusCode >= 400,
      raw_message: line.trim()
    };
  }

  // Fallback: try parsing JSON formatted log line
  try {
    const jsonDoc = JSON.parse(line);
    const statusCode = jsonDoc.status_code || jsonDoc.status || 200;
    return {
      '@timestamp': jsonDoc['@timestamp'] || jsonDoc.timestamp || new Date().toISOString(),
      client_ip: jsonDoc.client_ip || jsonDoc.ip || '127.0.0.1',
      http_method: jsonDoc.http_method || jsonDoc.method || 'GET',
      endpoint: jsonDoc.endpoint || jsonDoc.path || jsonDoc.url || '/',
      status_code: statusCode,
      status_group: `${Math.floor(statusCode / 100)}xx`,
      response_size: jsonDoc.response_size || jsonDoc.bytes || 1024,
      response_time_ms: jsonDoc.response_time_ms || jsonDoc.latency || 50,
      referrer: jsonDoc.referrer || '-',
      user_agent: jsonDoc.user_agent || 'Mozilla/5.0',
      browser: jsonDoc.browser || 'Unknown',
      os: jsonDoc.os || 'Unknown',
      country: jsonDoc.country || 'United States',
      city: jsonDoc.city || 'Unknown',
      is_error: statusCode >= 400,
      raw_message: line.trim()
    };
  } catch {
    return null;
  }
}

function detectBrowserOS(ua = '') {
  let browser = 'Other';
  let os = 'Other';

  if (ua.includes('Googlebot')) {
    browser = 'Googlebot';
    os = 'Bot';
  } else if (ua.includes('masscan') || ua.includes('scanner') || ua.includes('Nmap')) {
    browser = 'Security Scanner';
    os = 'Automated';
  } else if (ua.includes('curl')) {
    browser = 'cURL';
    os = 'CLI';
  } else if (ua.includes('Chrome')) {
    browser = ua.includes('Mobile') ? 'Chrome Mobile' : 'Chrome';
  } else if (ua.includes('Firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('Safari')) {
    browser = ua.includes('Mobile') ? 'Mobile Safari' : 'Safari';
  }

  if (os === 'Other') {
    if (ua.includes('Macintosh')) os = 'macOS';
    else if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Linux')) os = 'Linux';
  }

  return { browser, os };
}

function detectGeo(ip) {
  const match = IP_POOLS.find(p => p.ip === ip);
  if (match) return { country: match.country, city: match.city };
  // Hash IP to deterministic geo for unknown IPs
  const hash = Array.from(ip).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const sample = IP_POOLS[hash % IP_POOLS.length];
  return { country: sample.country, city: sample.city };
}

/**
 * Generates realistic synthetic web server logs for Big Data Analytics testing
 * @param {number} count Number of log entries to generate
 * @param {object} options Simulation options (scenario: 'normal'|'spike'|'ddos'|'slow')
 */
function generateSyntheticLogs(count = 1000, options = {}) {
  const {
    scenario = 'normal',
    timeWindowMinutes = 60,
    startTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000)
  } = options;

  const logs = [];
  const startMs = startTime.getTime();
  const timeSpan = timeWindowMinutes * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Distribute timestamps realistically
    const offset = Math.floor((i / count) * timeSpan + (Math.random() * 5000 - 2500));
    const timestamp = new Date(Math.max(startMs, startMs + offset));

    // Choose client IP
    let ipEntry = IP_POOLS[Math.floor(Math.random() * IP_POOLS.length)];
    if (scenario === 'ddos' && Math.random() < 0.6) {
      // 60% of traffic from malicious IP
      ipEntry = { ip: '185.220.101.5', country: 'Russia', city: 'Moscow' };
    }

    // Pick endpoint weighted
    let endpointObj;
    if (scenario === 'probe' && Math.random() < 0.7) {
      endpointObj = ENDPOINTS.find(e => e.isProbe) || ENDPOINTS[0];
    } else {
      const normalEndpoints = ENDPOINTS.filter(e => !e.isProbe || Math.random() < 0.08);
      endpointObj = normalEndpoints[Math.floor(Math.random() * normalEndpoints.length)];
    }

    // Determine status code
    let statusCode = 200;
    if (endpointObj.isProbe) {
      statusCode = Math.random() < 0.85 ? 404 : 403;
    } else if (scenario === 'ddos') {
      statusCode = Math.random() < 0.4 ? 503 : (Math.random() < 0.2 ? 502 : 200);
    } else {
      const rand = Math.random();
      if (rand < 0.82) statusCode = 200;
      else if (rand < 0.88) statusCode = 201;
      else if (rand < 0.92) statusCode = 304;
      else if (rand < 0.95) statusCode = 400;
      else if (rand < 0.97) statusCode = 401;
      else if (rand < 0.985) statusCode = 404;
      else statusCode = 500;
    }

    // Compute realistic response size
    let responseSize = Math.floor(250 + Math.random() * 14500);
    if (statusCode >= 400) responseSize = Math.floor(120 + Math.random() * 450);

    // Compute realistic latency
    let latency = endpointObj.baseLatency * (0.8 + Math.random() * 0.5);
    if (scenario === 'slow' && endpointObj.path.includes('/reports')) {
      latency += 800 + Math.random() * 1400; // latency degradation
    }
    if (statusCode === 503 || statusCode === 504) {
      latency = 2000 + Math.random() * 3000;
    }
    latency = Math.round(latency * 10) / 10;

    // Pick User Agent
    let uaObj = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    if (endpointObj.isProbe) {
      uaObj = USER_AGENTS.find(u => u.browser === 'Security Scanner') || uaObj;
    }

    const referrer = REFERRERS[Math.floor(Math.random() * REFERRERS.length)];

    // Format Apache string
    const day = String(timestamp.getUTCDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[timestamp.getUTCMonth()];
    const year = timestamp.getUTCFullYear();
    const hours = String(timestamp.getUTCHours()).padStart(2, '0');
    const mins = String(timestamp.getUTCMinutes()).padStart(2, '0');
    const secs = String(timestamp.getUTCSeconds()).padStart(2, '0');
    const apacheDate = `${day}/${month}/${year}:${hours}:${mins}:${secs} +0000`;

    const rawMessage = `${ipEntry.ip} - - [${apacheDate}] "${endpointObj.method} ${endpointObj.path} HTTP/1.1" ${statusCode} ${responseSize} "${referrer}" "${uaObj.ua}" ${latency}`;

    logs.push({
      '@timestamp': timestamp.toISOString(),
      client_ip: ipEntry.ip,
      http_method: endpointObj.method,
      endpoint: endpointObj.path,
      status_code: statusCode,
      status_group: `${Math.floor(statusCode / 100)}xx`,
      response_size: responseSize,
      response_time_ms: latency,
      referrer,
      user_agent: uaObj.ua,
      browser: uaObj.browser,
      os: uaObj.os,
      country: ipEntry.country,
      city: ipEntry.city,
      is_error: statusCode >= 400,
      raw_message: rawMessage
    });
  }

  // Sort chronologically
  logs.sort((a, b) => new Date(a['@timestamp']) - new Date(b['@timestamp']));
  return logs;
}

/**
 * Embedded In-Memory Search & Aggregation Engine
 * Faithfully mirrors Elasticsearch query DSL, bool filtering, range,
 * date_histogram, terms aggregations, and stats for seamless standalone execution.
 */
class InMemoryElasticEngine {
  constructor() {
    this.documents = [];
    this.indexName = 'web-server-logs';
  }

  createIndex() {
    return { acknowledged: true, shards_acknowledged: true, index: this.indexName };
  }

  deleteIndex() {
    this.documents = [];
    return { acknowledged: true };
  }

  bulkIndex(docs) {
    let indexed = 0;
    for (const doc of docs) {
      const docWithId = {
        _id: crypto.randomUUID(),
        _index: this.indexName,
        _source: doc
      };
      this.documents.push(docWithId);
      indexed++;
    }
    return {
      took: 12,
      errors: false,
      items: docs.map(() => ({ index: { status: 201 } })),
      count: indexed
    };
  }

  count() {
    return { count: this.documents.length };
  }

  search(esQuery = {}) {
    const startTook = Date.now();
    const query = esQuery.query || {};
    const aggs = esQuery.aggs || esQuery.aggregations || {};
    const size = typeof esQuery.size === 'number' ? esQuery.size : 50;
    const from = typeof esQuery.from === 'number' ? esQuery.from : 0;
    const sort = esQuery.sort || [{ '@timestamp': { order: 'desc' } }];

    // Filter documents matching query
    let filtered = this.documents.filter(doc => this._matchesQuery(doc._source, query));

    // Sort documents
    filtered.sort((a, b) => this._compareSort(a._source, b._source, sort));

    const totalHits = filtered.length;
    const pagedHits = filtered.slice(from, from + size);

    // Compute aggregations over all filtered documents
    const aggregations = this._computeAggregations(filtered.map(d => d._source), aggs);

    return {
      took: Date.now() - startTook,
      timed_out: false,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: {
        total: { value: totalHits, relation: 'eq' },
        max_score: 1.0,
        hits: pagedHits.map(d => ({
          _index: d._index,
          _id: d._id,
          _score: 1.0,
          _source: d._source
        }))
      },
      aggregations
    };
  }

  _matchesQuery(source, query) {
    if (!query || Object.keys(query).length === 0 || query.match_all) {
      return true;
    }

    if (query.bool) {
      const { must, filter, should, must_not } = query.bool;

      if (must && Array.isArray(must)) {
        for (const sub of must) {
          if (!this._matchesQuery(source, sub)) return false;
        }
      }

      if (filter && Array.isArray(filter)) {
        for (const sub of filter) {
          if (!this._matchesQuery(source, sub)) return false;
        }
      }

      if (must_not && Array.isArray(must_not)) {
        for (const sub of must_not) {
          if (this._matchesQuery(source, sub)) return false;
        }
      }

      if (should && Array.isArray(should) && should.length > 0) {
        const matchesAny = should.some(sub => this._matchesQuery(source, sub));
        if (!matchesAny) return false;
      }

      return true;
    }

    // Match / multi_match
    if (query.multi_match) {
      const { query: searchStr, fields } = query.multi_match;
      if (!searchStr) return true;
      const terms = searchStr.toLowerCase().split(/\s+/).filter(Boolean);
      return terms.every(term => {
        return (fields || ['raw_message', 'endpoint', 'client_ip', 'user_agent']).some(f => {
          const val = String(source[f] || '').toLowerCase();
          return val.includes(term);
        });
      });
    }

    if (query.match) {
      const field = Object.keys(query.match)[0];
      const target = String(query.match[field]).toLowerCase();
      const val = String(source[field] || '').toLowerCase();
      return val.includes(target);
    }

    // Term query
    if (query.term) {
      const field = Object.keys(query.term)[0];
      const expected = query.term[field];
      const actual = source[field.replace('.raw', '').replace('.keyword', '')];
      return String(actual).toLowerCase() === String(expected).toLowerCase();
    }

    // Terms query
    if (query.terms) {
      const field = Object.keys(query.terms)[0];
      const list = query.terms[field];
      const actual = source[field.replace('.raw', '').replace('.keyword', '')];
      return list.map(String).includes(String(actual));
    }

    // Range query
    if (query.range) {
      const field = Object.keys(query.range)[0];
      const cond = query.range[field];
      const rawVal = source[field];

      if (field === '@timestamp') {
        const docTime = new Date(rawVal).getTime();
        if (cond.gte && docTime < new Date(cond.gte).getTime()) return false;
        if (cond.gt && docTime <= new Date(cond.gt).getTime()) return false;
        if (cond.lte && docTime > new Date(cond.lte).getTime()) return false;
        if (cond.lt && docTime >= new Date(cond.lt).getTime()) return false;
        return true;
      }

      const numVal = parseFloat(rawVal);
      if (isNaN(numVal)) return false;
      if (cond.gte !== undefined && numVal < cond.gte) return false;
      if (cond.gt !== undefined && numVal <= cond.gt) return false;
      if (cond.lte !== undefined && numVal > cond.lte) return false;
      if (cond.lt !== undefined && numVal >= cond.lt) return false;
      return true;
    }

    // Wildcard query
    if (query.wildcard) {
      const field = Object.keys(query.wildcard)[0];
      const pattern = String(query.wildcard[field]).toLowerCase().replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${pattern}$`, 'i');
      const cleanField = field.replace('.raw', '').replace('.keyword', '');
      const val = String(source[cleanField] || '');
      return regex.test(val);
    }

    return true;
  }

  _compareSort(a, b, sortRules) {
    for (const rule of sortRules) {
      let field;
      let order = 'asc';
      if (typeof rule === 'string') {
        field = rule;
      } else {
        field = Object.keys(rule)[0];
        order = rule[field]?.order || 'asc';
      }

      const valA = a[field];
      const valB = b[field];

      if (field === '@timestamp') {
        const timeA = new Date(valA).getTime();
        const timeB = new Date(valB).getTime();
        if (timeA !== timeB) {
          return order === 'desc' ? timeB - timeA : timeA - timeB;
        }
      } else if (typeof valA === 'number' && typeof valB === 'number') {
        if (valA !== valB) {
          return order === 'desc' ? valB - valA : valA - valB;
        }
      } else {
        const cmp = String(valA || '').localeCompare(String(valB || ''));
        if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  }

  _computeAggregations(docs, aggsDef = {}) {
    const result = {};

    for (const aggName of Object.keys(aggsDef)) {
      const def = aggsDef[aggName];

      // date_histogram aggregation
      if (def.date_histogram) {
        const { field, fixed_interval = '1m', calendar_interval } = def.date_histogram;
        const interval = fixed_interval || calendar_interval || '1m';

        let bucketMs = 60 * 1000;
        if (interval.endsWith('s')) bucketMs = parseInt(interval, 10) * 1000;
        else if (interval.endsWith('m')) bucketMs = parseInt(interval, 10) * 60 * 1000;
        else if (interval.endsWith('h')) bucketMs = parseInt(interval, 10) * 3600 * 1000;
        else if (interval.endsWith('d')) bucketMs = parseInt(interval, 10) * 86400 * 1000;

        const bucketsMap = new Map();

        for (const doc of docs) {
          const t = new Date(doc[field]).getTime();
          const bucketKey = Math.floor(t / bucketMs) * bucketMs;
          if (!bucketsMap.has(bucketKey)) {
            bucketsMap.set(bucketKey, { key: bucketKey, key_as_string: new Date(bucketKey).toISOString(), doc_count: 0, _docs: [] });
          }
          const b = bucketsMap.get(bucketKey);
          b.doc_count++;
          b._docs.push(doc);
        }

        const sortedKeys = Array.from(bucketsMap.keys()).sort((a, b) => a - b);
        const buckets = sortedKeys.map(k => {
          const item = bucketsMap.get(k);
          const out = {
            key: item.key,
            key_as_string: item.key_as_string,
            doc_count: item.doc_count
          };

          // Handle sub-aggregations (e.g. error rate or avg latency per bucket)
          if (def.aggs) {
            const subAggs = this._computeAggregations(item._docs, def.aggs);
            Object.assign(out, subAggs);
          }
          return out;
        });

        result[aggName] = { buckets };
      }

      // terms aggregation
      else if (def.terms) {
        const { field, size = 10 } = def.terms;
        const cleanField = field.replace('.raw', '').replace('.keyword', '');
        const countMap = new Map();

        for (const doc of docs) {
          const val = doc[cleanField] !== undefined && doc[cleanField] !== null ? String(doc[cleanField]) : 'Unknown';
          countMap.set(val, (countMap.get(val) || 0) + 1);
        }

        const sorted = Array.from(countMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, size);

        result[aggName] = {
          doc_count_error_upper_bound: 0,
          sum_other_doc_count: Math.max(0, countMap.size - size),
          buckets: sorted.map(([k, count]) => ({ key: k, doc_count: count }))
        };
      }

      // stats aggregation
      else if (def.stats) {
        const { field } = def.stats;
        let min = Infinity, max = -Infinity, sum = 0, count = 0;
        for (const doc of docs) {
          const v = parseFloat(doc[field]);
          if (!isNaN(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
            count++;
          }
        }
        result[aggName] = {
          count,
          min: count > 0 ? Math.round(min * 100) / 100 : 0,
          max: count > 0 ? Math.round(max * 100) / 100 : 0,
          avg: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
          sum: Math.round(sum * 100) / 100
        };
      }

      // percentiles aggregation
      else if (def.percentiles) {
        const { field, percents = [50, 90, 95, 99] } = def.percentiles;
        const values = [];
        for (const doc of docs) {
          const v = parseFloat(doc[field]);
          if (!isNaN(v)) values.push(v);
        }
        values.sort((a, b) => a - b);

        const valuesOut = {};
        for (const p of percents) {
          if (values.length === 0) {
            valuesOut[p.toString()] = 0;
          } else {
            const index = Math.min(values.length - 1, Math.max(0, Math.floor((p / 100) * values.length)));
            valuesOut[p.toString()] = Math.round(values[index] * 10) / 10;
          }
        }
        result[aggName] = { values: valuesOut };
      }

      // filter aggregation
      else if (def.filter) {
        const filteredDocs = docs.filter(d => this._matchesQuery(d, def.filter));
        const out = { doc_count: filteredDocs.length };
        if (def.aggs) {
          Object.assign(out, this._computeAggregations(filteredDocs, def.aggs));
        }
        result[aggName] = out;
      }
    }

    return result;
  }
}

module.exports = {
  APACHE_COMBINED_REGEX,
  IP_POOLS,
  ENDPOINTS,
  USER_AGENTS,
  ELASTICSEARCH_MAPPING,
  parseLogLine,
  detectBrowserOS,
  detectGeo,
  generateSyntheticLogs,
  InMemoryElasticEngine
};
