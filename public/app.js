/**
 * ElasticLog - Frontend Application Logic & Chart Orchestration
 * Handles Elasticsearch API querying, aggregations, Chart.js rendering,
 * live SSE streaming, and document inspection.
 */

// Application State
const state = {
  isBrowserMode: false,
  liveStreamTimer: null,
  query: '',
  method: '',
  status: '',
  timeRange: '1h',
  activeChip: 'all',
  minLatency: undefined,
  maxLatency: undefined,
  endpointFilter: '',
  sortField: '@timestamp',
  sortOrder: 'desc',
  page: 1,
  pageSize: 25,
  totalHits: 0,
  lastDslQuery: null,
  currentHits: [],
  isLiveStreaming: false,
  eventSource: null,
  charts: {}
};

// DOM Elements
const elements = {
  // Navigation & Badges
  engineStatusBadge: document.getElementById('engineStatusBadge'),
  engineStatusText: document.getElementById('engineStatusText'),
  clusterHealthTag: document.getElementById('clusterHealthTag'),
  liveStreamToggle: document.getElementById('liveStreamToggle'),
  btnViewDsl: document.getElementById('btnViewDsl'),
  btnUploadModal: document.getElementById('btnUploadModal'),
  btnGenerateModal: document.getElementById('btnGenerateModal'),

  // KPI Elements
  valTotalDocs: document.getElementById('valTotalDocs'),
  subQueryTook: document.getElementById('subQueryTook'),
  valErrorRate: document.getElementById('valErrorRate'),
  subErrorCounts: document.getElementById('subErrorCounts'),
  valAvgLatency: document.getElementById('valAvgLatency'),
  subP95Latency: document.getElementById('subP95Latency'),
  valBandwidth: document.getElementById('valBandwidth'),
  subThroughput: document.getElementById('subThroughput'),

  // Search & Filters
  searchInput: document.getElementById('searchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),
  filterMethod: document.getElementById('filterMethod'),
  filterStatus: document.getElementById('filterStatus'),
  filterTimeRange: document.getElementById('filterTimeRange'),
  btnRefresh: document.getElementById('btnRefresh'),
  sortFieldSelect: document.getElementById('sortFieldSelect'),
  chips: document.querySelectorAll('.chip'),
  btnExportJson: document.getElementById('btnExportJson'),
  btnExportCsv: document.getElementById('btnExportCsv'),

  // Table & Pagination
  logTableBody: document.getElementById('logTableBody'),
  logResultsCount: document.getElementById('logResultsCount'),
  paginationInfo: document.getElementById('paginationInfo'),
  pageCurrentDisplay: document.getElementById('pageCurrentDisplay'),
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),

  // Modals
  modalDocInspector: document.getElementById('modalDocInspector'),
  inspectorDocId: document.getElementById('inspectorDocId'),
  inspectorQuickFields: document.getElementById('inspectorQuickFields'),
  inspectorJsonCode: document.getElementById('inspectorJsonCode'),
  btnCopyDocJson: document.getElementById('btnCopyDocJson'),

  modalDslViewer: document.getElementById('modalDslViewer'),
  dslCodeBlock: document.getElementById('dslCodeBlock'),
  btnCopyDsl: document.getElementById('btnCopyDsl'),

  modalGenerate: document.getElementById('modalGenerate'),
  formGenerate: document.getElementById('formGenerate'),
  genScenario: document.getElementById('genScenario'),
  genCount: document.getElementById('genCount'),
  genTimeWindow: document.getElementById('genTimeWindow'),

  modalUpload: document.getElementById('modalUpload'),
  fileUploadInput: document.getElementById('fileUploadInput'),
  rawLogPaste: document.getElementById('rawLogPaste'),
  btnSubmitUpload: document.getElementById('btnSubmitUpload'),

  modalSettings: document.getElementById('modalSettings'),
  settingEsHost: document.getElementById('settingEsHost'),
  settingEngineMode: document.getElementById('settingEngineMode'),
  diagReachable: document.getElementById('diagReachable'),
  diagStatus: document.getElementById('diagStatus'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  btnClearIndexBtn: document.getElementById('btnClearIndexBtn'),

  toastContainer: document.getElementById('toastContainer')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkSystemStatus();
  executeSearch();
});

/**
 * Register all UI Event Listeners
 */
function setupEventListeners() {
  // Search input debounced
  let searchDebounceTimer;
  elements.searchInput.addEventListener('input', e => {
    state.query = e.target.value;
    elements.btnClearSearch.style.display = state.query ? 'block' : 'none';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.page = 1;
      executeSearch();
    }, 350);
  });

  elements.btnClearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.query = '';
    elements.btnClearSearch.style.display = 'none';
    state.page = 1;
    executeSearch();
  });

  // Filters
  elements.filterMethod.addEventListener('change', e => {
    state.method = e.target.value;
    state.page = 1;
    executeSearch();
  });

  elements.filterStatus.addEventListener('change', e => {
    state.status = e.target.value;
    state.page = 1;
    executeSearch();
  });

  elements.filterTimeRange.addEventListener('change', e => {
    state.timeRange = e.target.value;
    state.page = 1;
    executeSearch();
  });

  elements.btnRefresh.addEventListener('click', () => {
    checkSystemStatus();
    executeSearch();
    showToast('Refreshing logs and aggregations...', 'info');
  });

  // Sorting
  elements.sortFieldSelect.addEventListener('change', e => {
    const [field, order] = e.target.value.split(':');
    state.sortField = field;
    state.sortOrder = order;
    state.page = 1;
    executeSearch();
  });

  // Pagination
  elements.btnPrevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      executeSearch();
    }
  });

  elements.btnNextPage.addEventListener('click', () => {
    const maxPage = Math.ceil(state.totalHits / state.pageSize);
    if (state.page < maxPage) {
      state.page++;
      executeSearch();
    }
  });

  // Quick Filter Chips
  elements.chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const chipType = chip.getAttribute('data-chip');

      // If clicking already active non-all chip, toggle back to 'all'
      if (chip.classList.contains('active') && chipType !== 'all') {
        elements.chips.forEach(c => c.classList.remove('active'));
        const allChip = document.querySelector('[data-chip="all"]');
        if (allChip) allChip.classList.add('active');
        state.activeChip = 'all';
        state.minLatency = undefined;
        state.endpointFilter = '';
        elements.filterStatus.value = '';
        state.status = '';
        state.page = 1;
        executeSearch();
        return;
      }

      elements.chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      state.activeChip = chipType;
      state.page = 1;

      // Reset specific filters
      state.minLatency = undefined;
      state.endpointFilter = '';
      elements.filterStatus.value = '';
      state.status = '';

      if (chipType === 'errors') {
        state.status = '400,401,403,404,500,502,503';
      } else if (chipType === 'slow') {
        state.minLatency = 500;
      } else if (chipType === 'probes') {
        state.endpointFilter = 'login,admin,env,config';
      } else if (chipType === 'api') {
        state.endpointFilter = '/api/';
      } else if (chipType === 'static') {
        state.endpointFilter = '/static/';
      }

      executeSearch();
    });
  });

  // Modals Open/Close Handlers
  elements.btnViewDsl.addEventListener('click', () => openModal(elements.modalDslViewer));
  elements.btnUploadModal.addEventListener('click', () => openModal(elements.modalUpload));
  elements.btnGenerateModal.addEventListener('click', () => openModal(elements.modalGenerate));
  elements.engineStatusBadge.addEventListener('click', () => {
    openModal(elements.modalSettings);
    checkSystemStatus();
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      const target = document.getElementById(modalId);
      if (target) closeModal(target);
    });
  });

  // Close modals on clicking overlay backdrop
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  // Copy Buttons
  elements.btnCopyDocJson.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.inspectorJsonCode.textContent);
    showToast('Document JSON copied to clipboard!', 'success');
  });

  elements.btnCopyDsl.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.dslCodeBlock.textContent);
    showToast('Elasticsearch Query DSL copied to clipboard!', 'success');
  });

  // Ingest Synthetic Traffic
  elements.formGenerate.addEventListener('submit', async e => {
    e.preventDefault();
    const scenario = elements.genScenario.value;
    const count = parseInt(elements.genCount.value, 10);
    const timeWindowMinutes = parseInt(elements.genTimeWindow.value, 10);

    closeModal(elements.modalGenerate);
    showToast(`Generating & indexing ${count} logs (${scenario})...`, 'info');

    try {
      if (state.isBrowserMode) {
        const data = window.ElasticLogBrowser.instance.generate(scenario, count, timeWindowMinutes);
        showToast(`Successfully indexed ${data.generated} logs into In-Browser Engine!`, 'success');
        checkSystemStatus();
        executeSearch();
      } else {
        const res = await fetch('/api/index/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenario, count, timeWindowMinutes })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Successfully indexed ${data.generated} logs into ${data.engine}!`, 'success');
          checkSystemStatus();
          executeSearch();
        } else {
          showToast(`Generation failed: ${data.error}`, 'error');
        }
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });

  // Upload Custom Logs
  elements.btnSubmitUpload.addEventListener('click', async () => {
    let content = elements.rawLogPaste.value.trim();
    const file = elements.fileUploadInput.files[0];

    if (file) {
      content = await file.text();
    }

    if (!content) {
      showToast('Please select a file or paste raw log lines', 'error');
      return;
    }

    closeModal(elements.modalUpload);
    showToast('Parsing and bulk indexing custom logs...', 'info');

    try {
      if (state.isBrowserMode) {
        const data = window.ElasticLogBrowser.instance.upload(content);
        showToast(`Successfully indexed ${data.indexed} logs (${data.parseErrors} skipped)`, 'success');
        elements.rawLogPaste.value = '';
        elements.fileUploadInput.value = '';
        checkSystemStatus();
        executeSearch();
      } else {
        const res = await fetch('/api/index/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: content
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Successfully indexed ${data.indexed} logs (${data.parseErrors} skipped)`, 'success');
          elements.rawLogPaste.value = '';
          elements.fileUploadInput.value = '';
          checkSystemStatus();
          executeSearch();
        } else {
          showToast(`Upload failed: ${data.error}`, 'error');
        }
      }
    } catch (err) {
      showToast(`Upload error: ${err.message}`, 'error');
    }
  });

  // Settings Save
  elements.btnSaveSettings.addEventListener('click', async () => {
    const host = elements.settingEsHost.value.trim();
    const enginePreference = elements.settingEngineMode.value;

    try {
      if (state.isBrowserMode) {
        showToast('Settings saved for In-Browser Engine', 'success');
        closeModal(elements.modalSettings);
        checkSystemStatus();
        executeSearch();
      } else {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, enginePreference })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Settings saved successfully', 'success');
          closeModal(elements.modalSettings);
          checkSystemStatus();
          executeSearch();
        }
      }
    } catch (err) {
      showToast(`Failed to save settings: ${err.message}`, 'error');
    }
  });

  // Clear Index
  elements.btnClearIndexBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear all documents in the web-server-logs index?')) {
      return;
    }
    try {
      if (state.isBrowserMode) {
        window.ElasticLogBrowser.instance.clear();
        showToast('Index data cleared', 'info');
        closeModal(elements.modalSettings);
        checkSystemStatus();
        executeSearch();
      } else {
        const res = await fetch('/api/index/clear', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Index data cleared', 'info');
          closeModal(elements.modalSettings);
          checkSystemStatus();
          executeSearch();
        }
      }
    } catch (err) {
      showToast(`Clear failed: ${err.message}`, 'error');
    }
  });

  // Live Stream Toggle
  elements.liveStreamToggle.addEventListener('click', toggleLiveStream);

  // Exports
  elements.btnExportJson.addEventListener('click', () => triggerExport('json'));
  elements.btnExportCsv.addEventListener('click', () => triggerExport('csv'));
}

function activateBrowserMode() {
  state.isBrowserMode = true;
  if (window.ElasticLogBrowser && window.ElasticLogBrowser.instance) {
    window.ElasticLogBrowser.instance.init(1500);
  }

  elements.engineStatusBadge.className = 'engine-badge in-browser';
  const dot = elements.engineStatusBadge.querySelector('.status-dot');
  if (dot) dot.className = 'status-dot embedded pulse';
  elements.engineStatusText.textContent = 'In-Browser ES Engine (GitHub Pages)';
  elements.clusterHealthTag.textContent = 'CLIENT-SIDE';
  elements.clusterHealthTag.className = 'cluster-tag in-browser';

  if (elements.diagReachable) {
    elements.diagReachable.textContent = 'Active (In-Browser Virtual Cluster)';
    elements.diagReachable.style.color = '#34d399';
  }
  if (elements.diagStatus) {
    elements.diagStatus.textContent = 'Online (Zero Backend Required)';
  }
}

/**
 * Check Backend Engine & Elasticsearch Cluster Health
 */
async function checkSystemStatus() {
  const isStaticHost = window.location.protocol === 'file:' || window.location.hostname.endsWith('github.io');
  if (isStaticHost) {
    activateBrowserMode();
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('/api/status', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      activateBrowserMode();
      return;
    }

    const data = await res.json();
    state.isBrowserMode = false;

    const isES = data.activeEngine === 'elasticsearch';
    const es = data.elasticsearch;

    elements.engineStatusBadge.className = 'engine-badge';
    const dot = elements.engineStatusBadge.querySelector('.status-dot');

    if (isES) {
      elements.engineStatusText.textContent = `Elasticsearch (localhost:9200)`;
      elements.clusterHealthTag.textContent = (es.status || 'GREEN').toUpperCase();
      elements.clusterHealthTag.className = `cluster-tag ${es.status || 'green'}`;
      dot.className = 'status-dot pulse';
    } else {
      elements.engineStatusText.textContent = `Embedded ES Engine`;
      elements.clusterHealthTag.textContent = 'STANDALONE';
      elements.clusterHealthTag.className = 'cluster-tag embedded';
      dot.className = 'status-dot embedded pulse';
    }

    // Modal Diagnostics
    elements.diagReachable.textContent = es.reachable ? 'Yes (Online)' : 'No (Offline)';
    elements.diagReachable.style.color = es.reachable ? '#34d399' : '#f43f5e';
    elements.diagStatus.textContent = es.reachable ? `${es.status} (${es.cluster_name})` : 'Unreachable';
    elements.settingEngineMode.value = data.enginePreference || 'auto';
  } catch (err) {
    activateBrowserMode();
  }
}

/**
 * Execute Search & Fetch Big Data Aggregations from Elasticsearch API
 */
async function executeSearch() {
  // Build query request payload
  const payload = {
    query: state.query,
    methods: state.method ? [state.method] : [],
    statusCodes: state.status ? state.status.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : [],
    timeRange: state.timeRange,
    minLatency: state.minLatency,
    maxLatency: state.maxLatency,
    endpointFilter: state.endpointFilter,
    sortField: state.sortField,
    sortOrder: state.sortOrder,
    page: state.page,
    pageSize: state.pageSize
  };

  try {
    let data;
    if (state.isBrowserMode) {
      if (!window.ElasticLogBrowser || !window.ElasticLogBrowser.instance) {
        throw new Error('In-browser Elasticsearch engine failed to initialize');
      }
      data = window.ElasticLogBrowser.instance.search(payload);
    } else {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      data = await res.json();
    }

    state.lastDslQuery = data.dslQuery;
    state.totalHits = data.total;
    state.currentHits = data.hits || [];

    // Update DSL Modal Code
    elements.dslCodeBlock.textContent = JSON.stringify(data.dslQuery, null, 2);

    // Update KPI summary cards
    updateKpis(data);

    // Update charts from Elasticsearch aggregations
    updateCharts(data.aggregations || {});

    // Render table rows
    renderLogTable(state.currentHits);

    // Update pagination
    updatePagination();
  } catch (err) {
    console.error('Search query failed:', err);
    if (!state.isBrowserMode && window.ElasticLogBrowser) {
      console.warn('Backend call failed, falling back to In-Browser Engine');
      activateBrowserMode();
      return executeSearch();
    }
    elements.logTableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: #f43f5e; padding: 30px;">
          Error executing Elasticsearch query: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
    showToast(`Query error: ${err.message}`, 'error');
  }
}

/**
 * Update KPI Metric Cards
 */
function updateKpis(data) {
  const aggs = data.aggregations || {};
  const total = data.total || 0;

  elements.valTotalDocs.textContent = total.toLocaleString();
  elements.subQueryTook.textContent = `Elasticsearch took: ${data.took}ms (${data.engine})`;

  // Error rate calculation
  let errorCount = 0;
  if (aggs.traffic_over_time?.buckets) {
    for (const b of aggs.traffic_over_time.buckets) {
      if (b.error_count?.doc_count) {
        errorCount += b.error_count.doc_count;
      }
    }
  } else if (aggs.status_distribution?.buckets) {
    for (const b of aggs.status_distribution.buckets) {
      if (parseInt(b.key, 10) >= 400) {
        errorCount += b.doc_count;
      }
    }
  }

  const errorPct = total > 0 ? ((errorCount / total) * 100).toFixed(1) : '0.0';
  elements.valErrorRate.textContent = `${errorPct}%`;
  elements.subErrorCounts.textContent = `${errorCount.toLocaleString()} error logs in window`;

  // Latency metrics
  const avgLat = aggs.latency_stats?.avg ? Math.round(aggs.latency_stats.avg) : 0;
  const p95 = aggs.latency_percentiles?.values?.['95'] || 0;
  elements.valAvgLatency.innerHTML = `${avgLat} <span class="unit">ms</span>`;
  elements.subP95Latency.textContent = `95th percentile (p95): ${p95}ms`;

  // Bandwidth calculation
  const totalBytes = aggs.total_bytes?.sum || 0;
  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  const gb = (totalBytes / (1024 * 1024 * 1024)).toFixed(3);
  if (totalBytes > 1024 * 1024 * 1024) {
    elements.valBandwidth.innerHTML = `${gb} <span class="unit">GB</span>`;
  } else {
    elements.valBandwidth.innerHTML = `${mb} <span class="unit">MB</span>`;
  }
  elements.subThroughput.textContent = `${(aggs.total_bytes?.count || total).toLocaleString()} transfers recorded`;
}

/**
 * Render Interactive Log Table Rows
 */
function renderLogTable(hits) {
  elements.logResultsCount.textContent = `Showing ${hits.length} of ${state.totalHits.toLocaleString()} documents`;

  if (hits.length === 0) {
    elements.logTableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-dim); padding: 40px;">
          No web server logs matched the current search criteria or time window.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (const hit of hits) {
    const s = hit._source;
    const statusCode = s.status_code || 200;
    const statusGroup = `status-${Math.floor(statusCode / 100)}xx`;
    const methodClass = `method-${s.http_method || 'GET'}`;

    // Latency color
    let latencyClass = 'latency-fast';
    if (s.response_time_ms > 400) latencyClass = 'latency-slow';
    else if (s.response_time_ms > 150) latencyClass = 'latency-med';

    // Format timestamp nicely
    const dateStr = s['@timestamp'] ? s['@timestamp'].replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '-';

    html += `
      <tr data-id="${hit._id}">
        <td class="timestamp-cell">${escapeHtml(dateStr)}</td>
        <td class="ip-cell">${escapeHtml(s.client_ip || '-')}</td>
        <td><span class="method-badge ${methodClass}">${escapeHtml(s.http_method || 'GET')}</span></td>
        <td class="endpoint-cell" title="${escapeHtml(s.endpoint)}">${escapeHtml(s.endpoint || '/')}</td>
        <td><span class="status-badge ${statusGroup}">${statusCode}</span></td>
        <td class="latency-badge ${latencyClass}">${s.response_time_ms || 0}ms</td>
        <td>${formatBytes(s.response_size || 0)}</td>
        <td>${escapeHtml(s.country || 'Unknown')}</td>
        <td>
          <button class="btn-inspect" onclick="inspectDocument('${hit._id}')">View</button>
        </td>
      </tr>
    `;
  }

  elements.logTableBody.innerHTML = html;
}

/**
 * Update Pagination Controls
 */
function updatePagination() {
  const maxPage = Math.max(1, Math.ceil(state.totalHits / state.pageSize));
  elements.paginationInfo.textContent = `Page ${state.page} of ${maxPage} (${state.totalHits.toLocaleString()} results)`;
  elements.pageCurrentDisplay.textContent = state.page;
  elements.btnPrevPage.disabled = state.page <= 1;
  elements.btnNextPage.disabled = state.page >= maxPage;
}

/**
 * Open Document Inspector Modal
 */
window.inspectDocument = function(docId) {
  const hit = state.currentHits.find(h => h._id === docId);
  if (!hit) return;

  const s = hit._source;
  elements.inspectorDocId.textContent = `_id: ${hit._id} | _index: ${hit._index || 'web-server-logs'}`;

  // Quick info fields
  elements.inspectorQuickFields.innerHTML = `
    <div class="inspector-field">
      <span class="inspector-label">Client IP</span>
      <span class="inspector-val">${escapeHtml(s.client_ip)} (${escapeHtml(s.city || '-')}, ${escapeHtml(s.country || '-')})</span>
    </div>
    <div class="inspector-field">
      <span class="inspector-label">HTTP Method & Status</span>
      <span class="inspector-val">${escapeHtml(s.http_method)} ${s.status_code}</span>
    </div>
    <div class="inspector-field">
      <span class="inspector-label">Latency & Size</span>
      <span class="inspector-val">${s.response_time_ms}ms | ${formatBytes(s.response_size)}</span>
    </div>
    <div class="inspector-field">
      <span class="inspector-label">Browser & OS</span>
      <span class="inspector-val">${escapeHtml(s.browser || '-')} on ${escapeHtml(s.os || '-')}</span>
    </div>
    <div class="inspector-field" style="grid-column: span 2;">
      <span class="inspector-label">Endpoint</span>
      <span class="inspector-val">${escapeHtml(s.endpoint)}</span>
    </div>
  `;

  elements.inspectorJsonCode.textContent = JSON.stringify(s, null, 2);
  openModal(elements.modalDocInspector);
};

/**
 * Render & Update Chart.js Visualizations
 */
function updateCharts(aggs) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded, skipping visual chart rendering');
    return;
  }

  // Chart 1: Traffic & Errors Over Time (date_histogram)
  renderTrafficTimeChart(aggs.traffic_over_time?.buckets || []);

  // Chart 2: Status Code Distribution (terms)
  renderStatusDistributionChart(aggs.status_distribution?.buckets || []);

  // Chart 3: Top Endpoints (terms)
  renderTopEndpointsChart(aggs.top_endpoints?.buckets || []);

  // Chart 4: Latency Percentiles (percentiles)
  renderLatencyPercentilesChart(aggs.latency_percentiles?.values || {});

  // Chart 5: Geographic Distribution (terms)
  renderGeoDistributionChart(aggs.country_distribution?.buckets || []);
}

function renderTrafficTimeChart(buckets) {
  const ctx = document.getElementById('chartTrafficTime');
  if (!ctx) return;

  const labels = buckets.map(b => {
    const d = new Date(b.key);
    if (state.timeRange === '24h' || state.timeRange === '7d' || state.timeRange === 'all') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[d.getMonth()]} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const trafficData = buckets.map(b => b.doc_count);
  const errorData = buckets.map(b => b.error_count?.doc_count || 0);

  if (state.charts.trafficTime) state.charts.trafficTime.destroy();

  state.charts.trafficTime = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Requests',
          data: trafficData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2
        },
        {
          label: 'Errors (4xx / 5xx)',
          data: errorData,
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244, 63, 94, 0.25)',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } },
          beginAtZero: true
        }
      }
    }
  });
}

function renderStatusDistributionChart(buckets) {
  const ctx = document.getElementById('chartStatusDist');
  if (!ctx) return;

  const labels = buckets.map(b => `HTTP ${b.key}`);
  const data = buckets.map(b => b.doc_count);

  const colorPalette = {
    '200': '#10b981',
    '201': '#34d399',
    '304': '#38bdf8',
    '400': '#f59e0b',
    '401': '#fbbf24',
    '403': '#fb923c',
    '404': '#f97316',
    '500': '#f43f5e',
    '502': '#e11d48',
    '503': '#be123c'
  };

  const bgColors = buckets.map(b => colorPalette[String(b.key)] || '#8b5cf6');

  if (state.charts.statusDist) state.charts.statusDist.destroy();

  state.charts.statusDist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: bgColors,
          borderWidth: 1,
          borderColor: '#111726'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }
        }
      },
      cutout: '68%'
    }
  });
}

function renderTopEndpointsChart(buckets) {
  const ctx = document.getElementById('chartTopEndpoints');
  if (!ctx) return;

  const labels = buckets.map(b => {
    const p = b.key;
    return p.length > 25 ? p.substring(0, 24) + '…' : p;
  });
  const data = buckets.map(b => b.doc_count);

  if (state.charts.topEndpoints) state.charts.topEndpoints.destroy();

  state.charts.topEndpoints = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Hits',
          data,
          backgroundColor: 'rgba(56, 189, 248, 0.75)',
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });
}

function renderLatencyPercentilesChart(percentiles) {
  const ctx = document.getElementById('chartLatencyPercentiles');
  if (!ctx) return;

  const labels = ['p50 (Median)', 'p90 (Fast)', 'p95 (Target SLA)', 'p99 (Outliers)'];
  const data = [
    percentiles['50'] || 0,
    percentiles['90'] || 0,
    percentiles['95'] || 0,
    percentiles['99'] || 0
  ];

  if (state.charts.latency) state.charts.latency.destroy();

  state.charts.latency = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Latency (ms)',
          data,
          backgroundColor: [
            'rgba(16, 185, 129, 0.75)',
            'rgba(6, 182, 212, 0.75)',
            'rgba(245, 158, 11, 0.75)',
            'rgba(244, 63, 94, 0.85)'
          ],
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

function renderGeoDistributionChart(buckets) {
  const ctx = document.getElementById('chartGeoDist');
  if (!ctx) return;

  const labels = buckets.map(b => b.key);
  const data = buckets.map(b => b.doc_count);

  if (state.charts.geo) state.charts.geo.destroy();

  state.charts.geo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Requests',
          data,
          backgroundColor: 'rgba(139, 92, 246, 0.75)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

/**
 * Toggle Live Real-Time Log Streaming via SSE or In-Browser Simulator
 */
function toggleLiveStream() {
  if (state.isLiveStreaming) {
    if (state.liveStreamTimer) {
      clearInterval(state.liveStreamTimer);
      state.liveStreamTimer = null;
    }
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    state.isLiveStreaming = false;
    elements.liveStreamToggle.classList.remove('active');
    showToast('Live stream simulation paused', 'info');
  } else {
    state.isLiveStreaming = true;
    elements.liveStreamToggle.classList.add('active');
    showToast('Live traffic stream started! Ingesting real-time logs...', 'success');

    if (state.isBrowserMode) {
      state.liveStreamTimer = setInterval(() => {
        const batchCount = Math.floor(1 + Math.random() * 3);
        const newLogs = window.ElasticLogBrowser.instance.generateLiveBatch(batchCount);
        state.totalHits += newLogs.length;
        elements.valTotalDocs.textContent = state.totalHits.toLocaleString();

        if (Math.random() < 0.4) {
          executeSearch();
        }
      }, 2000);
    } else {
      state.eventSource = new EventSource('/api/live/stream');

      state.eventSource.addEventListener('log', e => {
        try {
          const newLogs = JSON.parse(e.data);
          if (Array.isArray(newLogs) && newLogs.length > 0) {
            state.totalHits += newLogs.length;
            elements.valTotalDocs.textContent = state.totalHits.toLocaleString();

            if (Math.random() < 0.4) {
              executeSearch();
            }
          }
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      });

      state.eventSource.onerror = () => {
        console.warn('SSE connection interrupted, retrying...');
      };
    }
  }
}

/**
 * Trigger Export of Search Hits to JSON or CSV
 */
async function triggerExport(format = 'json') {
  showToast(`Preparing ${format.toUpperCase()} export...`, 'info');
  const payload = {
    query: state.query,
    methods: state.method ? [state.method] : [],
    statusCodes: state.status ? state.status.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : [],
    timeRange: state.timeRange,
    minLatency: state.minLatency,
    endpointFilter: state.endpointFilter,
    format
  };

  try {
    if (state.isBrowserMode) {
      const { blob, filename } = window.ElasticLogBrowser.instance.export(payload, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast(`Exported ${format.toUpperCase()} successfully!`, 'success');
    } else {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `web_server_logs_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast(`Exported ${format.toUpperCase()} successfully!`, 'success');
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
}

/**
 * Helper Functions
 */
function openModal(modalEl) {
  if (modalEl) modalEl.classList.add('active');
}

function closeModal(modalEl) {
  if (modalEl) modalEl.classList.remove('active');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
