/* ================================================================
   Remote.co Job Scraper — Popup Logic
   ================================================================ */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let allJobs = [];
let stats = {};
let pollTimer = null;

/* ── Boot ─────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  wireTabBar();
  wireScrapeTab();
  wireJobsTab();
  wireExportTab();
  await refreshDashboard();
  await refreshJobsList();
  buildCategoryGrid();
});

/* ── Tab Bar ──────────────────────────────────────────────── */

function wireTabBar() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.pane').forEach(p => p.classList.remove('active'));
    t.classList.add('active');
    $(`#tab${cap(t.dataset.tab)}`).classList.add('active');

    if (t.dataset.tab === 'dash') refreshDashboard();
    if (t.dataset.tab === 'jobs') refreshJobsList();
    if (t.dataset.tab === 'export') updateExportStats();
  }));

  $('#btnSettings').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ── Dashboard ────────────────────────────────────────────── */

async function refreshDashboard() {
  const res = await msg({ type: 'GET_STATS' });
  if (res?.error) return;
  stats = res;

  $('#statTotal').textContent = stats.total || 0;
  $('#statCategories').textContent = Object.keys(stats.categories || {}).length;

  let remote = 0;
  for (const [k, v] of Object.entries(stats.locations || {})) {
    if (k.startsWith('Remote')) remote += v;
  }
  $('#statRemote').textContent = remote;

  const today = new Date().toISOString().slice(0, 10);
  const allData = await msg({ type: 'GET_JOBS' });
  const todayCount = (allData?.jobs || []).filter(j =>
    j.dateScraped && j.dateScraped.startsWith(today)
  ).length;
  $('#statToday').textContent = todayCount;

  renderBarChart('#industryBars', stats.industries || {}, '#0969da');
  renderBarChart('#expBars', stats.experiences || {}, '#8250df');
  renderBarChart('#locBars', stats.locations || {}, '#1a7f37');
}

function renderBarChart(selector, data, color) {
  const el = $(selector);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries.length ? Math.max(...entries.map(e => e[1])) : 0;

  if (entries.length === 0) {
    el.innerHTML = '<div class="empty-mini">No data yet</div>';
    return;
  }

  el.innerHTML = entries.map(([label, count]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${max ? (count / max * 100) : 0}%;background:${color}"></div>
      </div>
      <span class="bar-value">${count}</span>
    </div>
  `).join('');
}

/* ── Scrape Tab ───────────────────────────────────────────── */

function buildCategoryGrid() {
  msg({ type: 'GET_CATEGORIES' }).then(res => {
    const cats = res?.categories || {};
    const grid = $('#catGrid');
    const popular = [
      'developer', 'it', 'marketing', 'design', 'healthcare', 'sales',
      'customer-service', 'qa', 'software-engineer', 'project-manager',
      'operations', 'writing',
    ];

    grid.innerHTML = Object.entries(cats).map(([slug, name]) => `
      <label class="cat-check" title="${esc(name)}">
        <input type="checkbox" value="${esc(slug)}" ${popular.includes(slug) ? 'checked' : ''}>
        <span>${esc(name)}</span>
      </label>
    `).join('');
  });
}

function wireScrapeTab() {
  $('#btnSelectAll').addEventListener('click', () => {
    $$('#catGrid input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  $('#btnSelectNone').addEventListener('click', () => {
    $$('#catGrid input[type="checkbox"]').forEach(cb => cb.checked = false);
  });
  $('#btnStartScrape').addEventListener('click', startScrape);
  $('#btnStopScrape').addEventListener('click', stopScrape);
}

async function startScrape() {
  const selected = $$('#catGrid input:checked').map(cb => cb.value);
  if (!selected.length) {
    alert('Select at least one category.');
    return;
  }

  const maxPages = parseInt($('#maxPages').value);
  const scrapeDetails = $('#chkDetails').checked;

  $('#btnStartScrape').classList.add('hidden');
  $('#btnStopScrape').classList.remove('hidden');
  $('#scrapeProgress').classList.remove('hidden');
  $('#scrapeLog').classList.remove('hidden');
  $('#scrapeLog').innerHTML = '';

  logScrape(`Starting scrape: ${selected.length} categories, max ${maxPages} pages each`, 'info');

  msg({
    type: 'START_SCRAPE',
    categories: selected,
    maxPages,
    scrapeDetails,
  }).then(result => {
    stopPolling();
    $('#btnStartScrape').classList.remove('hidden');
    $('#btnStopScrape').classList.add('hidden');
    logScrape(`Done! ${result?.jobsFound || 0} new jobs scraped.`, 'success');
    if (result?.errors?.length) {
      result.errors.forEach(e => logScrape(`Warning: ${e}`, 'warn'));
    }
    refreshDashboard();
  }).catch(err => {
    stopPolling();
    logScrape(`Error: ${err.message}`, 'error');
    $('#btnStartScrape').classList.remove('hidden');
    $('#btnStopScrape').classList.add('hidden');
  });

  startPolling();
}

async function stopScrape() {
  await msg({ type: 'STOP_SCRAPE' });
  stopPolling();
  $('#btnStartScrape').classList.remove('hidden');
  $('#btnStopScrape').classList.add('hidden');
  logScrape('Scrape stopped by user.', 'warn');
}

function startPolling() {
  pollTimer = setInterval(async () => {
    const p = await msg({ type: 'GET_PROGRESS' });
    if (!p) return;
    const pct = p.totalCategories
      ? Math.round((p.completedCategories / p.totalCategories) * 100)
      : 0;
    $('#progressFill').style.width = `${pct}%`;
    $('#progressText').textContent = p.active
      ? `Scraping: ${p.currentCategory} (page ${p.currentPage})`
      : 'Idle';
    $('#progressDetail').textContent =
      `${p.completedCategories}/${p.totalCategories} categories \u00b7 ${p.jobsFound} jobs found`;
  }, 1500);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function logScrape(text, type = 'info') {
  const log = $('#scrapeLog');
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

/* ── Jobs Tab ─────────────────────────────────────────────── */

function wireJobsTab() {
  let debounce;
  $('#jobSearch').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(refreshJobsList, 300);
  });
  $$('.filter').forEach(f => f.addEventListener('change', refreshJobsList));
}

async function refreshJobsList() {
  const filters = {
    search: $('#jobSearch')?.value || '',
    industry: $('#filterIndustry')?.value || 'all',
    experience: $('#filterExp')?.value || 'all',
    locationType: $('#filterLoc')?.value || 'all',
  };

  const res = await msg({ type: 'GET_JOBS', filters });
  const jobs = res?.jobs || [];
  allJobs = jobs;

  // Rebuild industry filter options
  const indSelect = $('#filterIndustry');
  const currentInd = indSelect.value;
  const allData = await msg({ type: 'GET_JOBS' });
  const industries = new Set((allData?.jobs || []).map(j => j.industry).filter(Boolean));
  indSelect.innerHTML = '<option value="all">All Industries</option>'
    + [...industries].sort().map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
  indSelect.value = currentInd;

  $('#jobsCount').textContent = `${jobs.length} jobs${res.total !== jobs.length ? ` (of ${res.total} total)` : ''}`;

  const list = $('#jobsList');
  if (jobs.length === 0) {
    list.innerHTML = '<div class="empty-state">No jobs match your criteria.</div>';
    return;
  }

  list.innerHTML = jobs.slice(0, 100).map(j => buildJobCard(j)).join('');

  // Wire links to open in new tabs
  list.querySelectorAll('.job-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
  });
}

function buildJobCard(j) {
  const expClass = (j.experience_level || '').toLowerCase().replace(/[^a-z]/g, '');
  return `
    <div class="job-card">
      <div class="job-header">
        <a href="${esc(j.url)}" class="job-link job-title">${esc(j.standardTitle || j.title)}</a>
        ${j.experience_level ? `<span class="exp-badge exp-${expClass}">${esc(j.experience_level)}</span>` : ''}
      </div>
      <div class="job-company">${esc(j.company || 'Unknown')}</div>
      <div class="job-meta">
        ${j.locationType ? `<span class="meta-tag loc-tag">${esc(j.locationType)}</span>` : ''}
        ${j.industry ? `<span class="meta-tag ind-tag">${esc(j.industry)}</span>` : ''}
        ${j.jobType ? `<span class="meta-tag type-tag">${esc(j.jobType)}</span>` : ''}
        ${j.salary ? `<span class="meta-tag sal-tag">${esc(j.salary)}</span>` : ''}
      </div>
      ${j.description ? `<div class="job-desc">${esc(j.description.substring(0, 200))}\u2026</div>` : ''}
      <div class="job-footer">
        ${j.datePosted ? `<span class="job-date">Posted: ${esc(j.datePosted)}</span>` : ''}
        ${j.applyLink ? `<a href="${esc(j.applyLink)}" class="job-link apply-link">Apply \u2192</a>` : ''}
      </div>
    </div>
  `;
}

/* ── Export Tab ────────────────────────────────────────────── */

function wireExportTab() {
  $('#btnExport').addEventListener('click', exportJobs);
  $('#exportFormat').addEventListener('change', updateExportStats);
  $('#exportFilter').addEventListener('change', updateExportStats);
  $('#btnClassify').addEventListener('click', runAIClassification);
  $('#btnClearAll').addEventListener('click', async () => {
    if (!confirm('Delete ALL scraped jobs? This cannot be undone.')) return;
    await msg({ type: 'CLEAR_JOBS' });
    refreshDashboard();
    refreshJobsList();
    updateExportStats();
  });
}

async function updateExportStats() {
  const f = $('#exportFilter').value;
  const filters = {};
  if (f === 'remote') filters.locationType = 'Remote';
  else if (f === 'hybrid') filters.locationType = 'Hybrid';
  const res = await msg({ type: 'GET_JOBS', filters });
  $('#exportStats').textContent = `${(res?.jobs || []).length} jobs will be exported`;
}

async function exportJobs() {
  const format = $('#exportFormat').value;
  const filter = $('#exportFilter').value;
  const filters = {};
  if (filter === 'remote') filters.locationType = 'Remote';
  else if (filter === 'hybrid') filters.locationType = 'Hybrid';

  const res = await msg({ type: 'GET_JOBS', filters });
  const jobs = (res?.jobs || []).map(j => ({
    title: j.standardTitle || j.title,
    company: j.company,
    location: j.locationType || j.location,
    industry: j.industry,
    experience_level: j.experience_level,
    description: j.description || '',
    apply_link: j.applyLink || j.url,
    date_posted: j.datePosted || '',
    salary: j.salary || '',
    job_type: j.jobType || '',
    category: j.category || j.categorySlug,
    remote_type: j.remoteType,
    date_scraped: j.dateScraped,
  }));

  let content, ext;
  if (format === 'csv') {
    content = toCSV(jobs);
    ext = 'csv';
  } else {
    content = JSON.stringify(jobs, null, 2);
    ext = 'json';
  }

  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  chrome.downloads.download({
    url,
    filename: `remote-co-jobs-${date}.${ext}`,
    saveAs: true,
  });
}

function toCSV(arr) {
  if (!arr.length) return '';
  const headers = Object.keys(arr[0]);
  const rows = arr.map(obj => headers.map(h => {
    const v = (obj[h] ?? '').toString().replace(/"/g, '""');
    return `"${v}"`;
  }).join(','));
  return [headers.join(','), ...rows].join('\n');
}

async function runAIClassification() {
  const btn = $('#btnClassify');
  const status = $('#classifyStatus');
  btn.disabled = true;
  btn.textContent = 'Classifying\u2026';
  status.classList.remove('hidden');
  status.textContent = 'Running AI classification\u2026';
  status.className = 'classify-status';

  try {
    const cfg = await chrome.storage.sync.get(['githubToken', 'aiModel']);
    if (!cfg.githubToken) {
      status.textContent = 'Set your GitHub token in Settings first.';
      status.classList.add('error');
      return;
    }

    const res = await msg({
      type: 'CLASSIFY_JOBS',
      token: cfg.githubToken,
      model: cfg.aiModel || 'gpt-4o',
    });

    if (res?.error) {
      status.textContent = `Error: ${res.error}`;
      status.classList.add('error');
    } else {
      status.textContent = `Done! ${res.classified} jobs classified with AI.`;
      status.classList.add('success');
      refreshDashboard();
      refreshJobsList();
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.classList.add('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run AI Classification';
  }
}

/* ── Helpers ──────────────────────────────────────────────── */

function msg(data) {
  return new Promise(resolve => chrome.runtime.sendMessage(data, resolve));
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
