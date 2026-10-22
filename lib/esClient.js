/**
 * Real Elasticsearch Client using Native Fetch (Node.js 22+)
 * Communicates directly with Elasticsearch 8.x / 7.x REST API
 * Supports cluster health, index lifecycle, bulk indexing, and search DSL.
 */

class ElasticsearchRestClient {
  constructor(baseUrl = 'http://localhost:9200', indexName = 'web-server-logs') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.indexName = indexName;
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/_cluster/health`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) {
        return { reachable: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data = await res.json();
      return {
        reachable: true,
        cluster_name: data.cluster_name,
        status: data.status, // green, yellow, red
        number_of_nodes: data.number_of_nodes,
        active_primary_shards: data.active_primary_shards
      };
    } catch (err) {
      return { reachable: false, error: err.message };
    }
  }

  async getClusterInfo() {
    try {
      const res = await fetch(`${this.baseUrl}/`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async indexExists() {
    try {
      const res = await fetch(`${this.baseUrl}/${this.indexName}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async createIndex(mapping) {
    const res = await fetch(`${this.baseUrl}/${this.indexName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
      signal: AbortSignal.timeout(10000)
    });
    return await res.json();
  }

  async deleteIndex() {
    const res = await fetch(`${this.baseUrl}/${this.indexName}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000)
    });
    return await res.json();
  }

  async bulkIndex(docs) {
    if (!docs || docs.length === 0) return { count: 0 };

    // Format into NDJSON:
    // {"index":{"_index":"web-server-logs"}}
    // { ...document... }
    let ndjson = '';
    for (const doc of docs) {
      ndjson += JSON.stringify({ index: { _index: this.indexName } }) + '\n';
      ndjson += JSON.stringify(doc) + '\n';
    }

    const res = await fetch(`${this.baseUrl}/_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: ndjson,
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      throw new Error(`Elasticsearch bulk indexing failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      took: data.took,
      errors: data.errors,
      count: docs.length,
      items: data.items
    };
  }

  async count() {
    const res = await fetch(`${this.baseUrl}/${this.indexName}/_count`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Count failed: HTTP ${res.status}`);
    return await res.json();
  }

  async search(queryPayload) {
    const res = await fetch(`${this.baseUrl}/${this.indexName}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryPayload),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Elasticsearch search failed (${res.status}): ${errBody}`);
    }

    return await res.json();
  }
}

module.exports = { ElasticsearchRestClient };
