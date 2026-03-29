/* ================================================================
   Remote.co Job Scraper — Background Service Worker
   Handles: Scraping orchestration, NLP classification, storage
   ================================================================ */

const AI_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';

const ALL_CATEGORIES = {
  'accounting': 'Accounting',
  'administrative': 'Administrative',
  'analyst': 'Analyst',
  'back-end-developer': 'Back End Developer',
  'banking': 'Banking',
  'bookkeeping': 'Bookkeeping',
  'business-development': 'Business Development',
  'call-center': 'Call Center',
  'consulting-coaching': 'Consulting',
  'content-writer': 'Content Writer',
  'copywriting': 'Copywriting',
  'customer-service': 'Customer Service',
  'cyber-security': 'Cyber Security',
  'online-data-entry': 'Data Entry',
  'data-science': 'Data Science',
  'design': 'Design',
  'developer': 'Developer',
  'online-editing': 'Editing',
  'education': 'Education & Training',
  'engineering': 'Engineering',
  'front-end-developer': 'Front End Developer',
  'full-stack-developer': 'Full Stack Developer',
  'graphic-design': 'Graphic Design',
  'healthcare': 'Healthcare',
  'recruiter': 'HR & Recruiting',
  'insurance': 'Insurance',
  'international': 'International',
  'it': 'IT',
  'legal': 'Legal',
  'marketing': 'Marketing',
  'nursing': 'Nursing',
  'operations': 'Operations',
  'product-manager': 'Product Manager',
  'programming': 'Programming',
  'project-manager': 'Project Manager',
  'qa': 'QA',
  'sales': 'Sales',
  'social-media': 'Social Media',
  'software-engineer': 'Software Engineer',
  'online-teaching': 'Teaching',
  'online-technical-support': 'Tech Support',
  'transcription': 'Transcription',
  'ui-ux-design': 'UI/UX Design',
  'virtual-assistant': 'Virtual Assistant',
  'web-developer': 'Web Developer',
  'writing': 'Writing',
};

const INDUSTRY_MAP = {
  IT: ['developer', 'software-engineer', 'programming', 'it', 'cyber-security', 'data-science', 'back-end-developer', 'front-end-developer', 'full-stack-developer', 'web-developer', 'qa', 'online-technical-support', 'ui-ux-design'],
  Marketing: ['marketing', 'social-media', 'advertising-pr', 'online-advertising', 'copywriting', 'content-writer'],
  Healthcare: ['healthcare', 'nursing', 'pharmaceutical', 'medical-billing', 'medical-coding', 'dental'],
  Finance: ['accounting', 'banking', 'bookkeeping', 'insurance', 'insurance-underwriting'],
  Design: ['design', 'graphic-design'],
  Education: ['education', 'online-teaching', 'online-tutoring'],
  Legal: ['legal'],
  Sales: ['sales', 'business-development', 'account-manager'],
  HR: ['recruiter'],
  'Customer Service': ['customer-service', 'call-center', 'virtual-assistant'],
  Operations: ['operations', 'project-manager', 'product-manager', 'administrative'],
  Writing: ['writing', 'online-editing', 'content-writer', 'copywriting', 'proofreading'],
  Engineering: ['engineering'],
  Research: ['research-development', 'analyst'],
};

/* ── State ────────────────────────────────────────────────── */

let scrapeState = {
  active: false,
  currentCategory: '',
  currentPage: 0,
  totalCategories: 0,
  completedCategories: 0,
  jobsFound: 0,
  errors: [],
  tabId: null,
};

/* ── Message Handler ──────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }

  const handlers = {
    START_SCRAPE:    () => startScrape(msg.categories, msg.maxPages, msg.scrapeDetails),
    STOP_SCRAPE:     () => stopScrape(),
    GET_PROGRESS:    () => Promise.resolve({ ...scrapeState }),
    GET_JOBS:        () => getJobs(msg.filters),
    GET_STATS:       () => getStats(),
    CLASSIFY_JOBS:   () => classifyJobsBatch(msg.token, msg.model),
    CLEAR_JOBS:      () => clearJobs(),
    DELETE_JOB:      () => deleteJob(msg.jobUrl),
    SCRAPE_CURRENT:  () => scrapeCurrentTab(sender.tab),
    JOBS_FROM_PAGE:  () => handlePageJobs(msg.jobs, msg.pageUrl),
    GET_CATEGORIES:  () => Promise.resolve({ categories: ALL_CATEGORIES }),
  };

  const fn = handlers[msg.type];
  if (fn) {
    fn().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

/* ── Scraping Orchestration ──────────────────────────────── */

async function startScrape(categories, maxPages, scrapeDetails) {
  if (scrapeState.active) throw new Error('Scrape already in progress');

  scrapeState = {
    active: true,
    currentCategory: '',
    currentPage: 0,
    totalCategories: categories.length,
    completedCategories: 0,
    jobsFound: 0,
    errors: [],
    tabId: null,
  };

  try {
    for (const cat of categories) {
      if (!scrapeState.active) break;
      scrapeState.currentCategory = ALL_CATEGORIES[cat] || cat;

      for (let page = 1; page <= maxPages; page++) {
        if (!scrapeState.active) break;
        scrapeState.currentPage = page;

        try {
          const url = `https://remote.co/remote-jobs/${cat}${page > 1 ? '?page=' + page : ''}`;
          const jobs = await scrapePageViaTab(url);

          if (!jobs || jobs.length === 0) break;

          for (const j of jobs) {
            j.categorySlug = j.categorySlug || cat;
            j.category = ALL_CATEGORIES[cat] || cat;
          }

          if (scrapeDetails) {
            for (const j of jobs) {
              if (!scrapeState.active) break;
              if (j.url && !j.description) {
                try {
                  const detail = await scrapePageViaTab(j.url);
                  if (detail && detail[0]) {
                    const saved = { categorySlug: j.categorySlug, category: j.category };
                    Object.assign(j, detail[0], saved);
                  }
                } catch { /* skip detail errors */ }
              }
            }
          }

          const classified = jobs.map(j => ({ ...j, ...classifyLocal(j) }));
          const stored = await storeJobs(classified);
          scrapeState.jobsFound += stored;
        } catch (err) {
          scrapeState.errors.push(`${cat} p${page}: ${err.message}`);
        }
      }
      scrapeState.completedCategories++;
    }
  } finally {
    scrapeState.active = false;
    if (scrapeState.tabId) {
      try { await chrome.tabs.remove(scrapeState.tabId); } catch {}
      scrapeState.tabId = null;
    }
  }

  return { ...scrapeState };
}

function stopScrape() {
  scrapeState.active = false;
  if (scrapeState.tabId) {
    chrome.tabs.remove(scrapeState.tabId).catch(() => {});
    scrapeState.tabId = null;
  }
  return Promise.resolve({ stopped: true });
}

async function scrapePageViaTab(url) {
  if (scrapeState.tabId) {
    try {
      await chrome.tabs.update(scrapeState.tabId, { url });
    } catch {
      const tab = await chrome.tabs.create({ url, active: false });
      scrapeState.tabId = tab.id;
    }
  } else {
    const tab = await chrome.tabs.create({ url, active: false });
    scrapeState.tabId = tab.id;
  }

  await waitForTabLoad(scrapeState.tabId);
  await sleep(1000);

  const results = await chrome.scripting.executeScript({
    target: { tabId: scrapeState.tabId },
    func: extractJobsFromDOM,
  });

  return results[0]?.result || [];
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);

    // Check if already complete
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        resolve();
        return;
      }
    });

    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── DOM Extraction (injected into page via executeScript) ── */

function extractJobsFromDOM() {
  const url = location.href;
  const isDetail = url.includes('/job-details/');

  if (isDetail) return extractDetail();
  return extractListing();

  function extractListing() {
    const jobs = [];
    const links = document.querySelectorAll('a[href*="/job-details/"]');
    const seen = new Set();

    for (const link of links) {
      const href = link.href;
      if (seen.has(href)) continue;
      seen.add(href);

      let title = link.textContent.trim()
        .replace(/^new!?\s*/i, '').replace(/^today\s*/i, '').trim();
      if (!title || title.length < 3) continue;

      // Walk up to find card container
      let card = link.closest('article')
        || link.closest('[class*="job"]')
        || link.closest('[class*="listing"]')
        || link.closest('li')
        || link.closest('.card')
        || walkUp(link, 6);
      if (!card) card = link.parentElement;

      const text = card ? card.textContent : '';

      // Company
      let company = '';
      if (card) {
        const compEl = card.querySelector('h3, h4, [class*="company"], [class*="employer"]');
        if (compEl && !compEl.querySelector('a[href*="/job-details/"]')) {
          company = compEl.textContent.trim();
        }
      }

      // Remote type
      let remoteType = 'Unknown';
      if (/100%\s*Remote/i.test(text)) remoteType = 'Remote';
      else if (/Hybrid\s*Remote/i.test(text)) remoteType = 'Hybrid';
      else if (/No\s*Remote/i.test(text)) remoteType = 'On-site';
      else if (/Remote/i.test(text)) remoteType = 'Remote';

      // Location
      let loc = '';
      const locPatterns = [
        /(?:Remote,?\s+)(US\s+National)/i,
        /(?:Hybrid\s+)?Remote\s+(?:in|from)\s+([^\n.]+)/i,
        /(?:Remote\s+from\s+)(Anywhere)/i,
      ];
      for (const p of locPatterns) {
        const m = text.match(p);
        if (m) { loc = m[1].trim().replace(/\s+See\s+All.*/i, ''); break; }
      }

      // Salary
      const salMatch = text.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?\s*(?:Annually|Hourly|Monthly)/i);
      const salary = salMatch ? salMatch[0].trim() : '';

      // Job type
      let jobType = '';
      if (/Full-Time\/Part-Time/i.test(text)) jobType = 'Full-Time/Part-Time';
      else if (/Full-Time/i.test(text)) jobType = 'Full-Time';
      else if (/Part-Time/i.test(text)) jobType = 'Part-Time';
      else if (/Contract/i.test(text)) jobType = 'Contract';
      else if (/Freelance/i.test(text)) jobType = 'Freelance';

      // Date
      const isNew = /new!?\s*today/i.test(text) || /new!/i.test(text);
      const datePosted = isNew ? new Date().toISOString().slice(0, 10) : '';

      // Category from URL
      const catMatch = location.pathname.match(/\/remote-jobs\/([^/?]+)/);
      const categorySlug = catMatch ? catMatch[1] : '';

      jobs.push({
        title, company, url: href, remoteType, location: loc,
        salary, jobType, datePosted, categorySlug,
        dateScraped: new Date().toISOString(),
        source: 'listing',
      });
    }
    return jobs;
  }

  function extractDetail() {
    const job = {};

    const h1 = document.querySelector('h1');
    job.title = h1 ? h1.textContent.trim() : '';

    const h2 = document.querySelector('h2');
    job.company = h2 ? h2.textContent.trim() : '';

    job.url = location.href;

    // Apply link
    const applyEl = document.querySelector(
      'a[href*="greenhouse.io"], a[href*="lever.co"], a[href*="workday"], '
      + 'a[href*="myworkdayjobs"], a[href*="jobs."], a.apply-button, a[class*="apply"]'
    );
    if (applyEl) {
      job.applyLink = applyEl.href;
    } else {
      const allLinks = document.querySelectorAll('a');
      for (const a of allLinks) {
        if (/^apply$/i.test(a.textContent.trim())) {
          job.applyLink = a.href;
          break;
        }
      }
    }

    const pageText = document.body.textContent;

    // Remote type
    if (/100%\s*Remote/i.test(pageText)) job.remoteType = 'Remote';
    else if (/Hybrid\s*Remote/i.test(pageText)) job.remoteType = 'Hybrid';
    else job.remoteType = 'Unknown';

    // Location
    const locMatch = pageText.match(/(?:Remote,?\s+)(US\s+National)/i)
      || pageText.match(/(?:Hybrid\s+)?Remote\s+(?:in|from)\s+([^\n.]+)/i);
    job.location = locMatch ? locMatch[1].trim() : '';

    // Salary
    const salMatch = pageText.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?\s*(?:Annually|Hourly|Monthly)/i);
    job.salary = salMatch ? salMatch[0].trim() : '';

    // Job type
    if (/Full-Time\/Part-Time/i.test(pageText)) job.jobType = 'Full-Time/Part-Time';
    else if (/Full-Time/i.test(pageText)) job.jobType = 'Full-Time';
    else if (/Part-Time/i.test(pageText)) job.jobType = 'Part-Time';

    // Description
    const descSection = document.querySelector('[class*="description"], [class*="about"], [class*="content"], article');
    if (descSection) {
      job.description = descSection.textContent.trim().substring(0, 3000);
    } else {
      const aboutIdx = pageText.indexOf('About the Role');
      const faqIdx = pageText.indexOf('FAQs About');
      if (aboutIdx > -1) {
        const end = faqIdx > aboutIdx ? faqIdx : aboutIdx + 3000;
        job.description = pageText.substring(aboutIdx, end).trim().substring(0, 3000);
      }
    }

    // Categories from links
    const catLinks = document.querySelectorAll('a[href*="/remote-jobs/"]');
    const cats = [];
    catLinks.forEach(a => {
      const m = a.href.match(/\/remote-jobs\/([^/?]+)/);
      if (m && m[1] !== 'categories' && !cats.includes(m[1])) cats.push(m[1]);
    });
    job.categorySlugs = cats;
    job.categorySlug = cats[0] || '';

    // Date
    const headerText = pageText.substring(0, 500);
    if (/today/i.test(headerText) || /new!/i.test(headerText)) {
      job.datePosted = new Date().toISOString().slice(0, 10);
    }

    job.dateScraped = new Date().toISOString();
    job.source = 'detail';

    return [job];
  }

  function walkUp(el, maxLevels) {
    let node = el;
    for (let i = 0; i < maxLevels; i++) {
      node = node.parentElement;
      if (!node) return null;
      if (node.tagName === 'ARTICLE' || node.tagName === 'LI'
        || (node.className && /job|card|listing|item/i.test(node.className))) {
        return node;
      }
    }
    return node;
  }
}

/* ── NLP Classification (local keyword-based) ────────────── */

function classifyLocal(job) {
  return {
    industry: mapIndustry(job.categorySlug, job.title),
    experience_level: inferExperience(job.title, job.description || ''),
    locationType: classifyLocation(job.remoteType, job.location),
    standardTitle: standardizeTitle(job.title),
  };
}

function mapIndustry(slug, title) {
  for (const [industry, slugs] of Object.entries(INDUSTRY_MAP)) {
    if (slugs.includes(slug)) return industry;
  }
  const t = (title || '').toLowerCase();
  if (/develop|engineer|software|program|devops|cloud|data\s*(?:base|engineer)/i.test(t)) return 'IT';
  if (/market|seo|social\s*media|brand|content/i.test(t)) return 'Marketing';
  if (/nurse|health|medical|clinical|pharma/i.test(t)) return 'Healthcare';
  if (/legal|attorney|paralegal|compliance/i.test(t)) return 'Legal';
  if (/account|financ|audit|tax|book\s*keep/i.test(t)) return 'Finance';
  if (/design|graphic|ux|ui/i.test(t)) return 'Design';
  if (/teach|tutor|train|educ|instruct/i.test(t)) return 'Education';
  if (/sales|business\s*dev|account\s*exec/i.test(t)) return 'Sales';
  if (/writ|edit|copy|journal/i.test(t)) return 'Writing';
  if (/recruit|hr|human\s*resource/i.test(t)) return 'HR';
  if (/customer|support|service|call\s*center/i.test(t)) return 'Customer Service';
  if (/project\s*manag|product\s*manag|operat|admin/i.test(t)) return 'Operations';
  return 'Other';
}

function inferExperience(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  if (/\b(director|vp|vice\s*president|head\s+of|chief|c-level|cto|cfo|ceo|principal|staff)\b/.test(text)) return 'Senior';
  if (/\b(senior|sr\.?|lead|architect|manager)\b/.test(text)) return 'Senior';
  if (/\b(10\+|8\+|7\+|6\+)\s*years/.test(text)) return 'Senior';
  if (/\b(junior|jr\.?|entry[\s-]*level|intern|trainee|associate|graduate)\b/.test(text)) return 'Entry-level';
  if (/\b(0-[12]|1-2|1\+)\s*years/.test(text)) return 'Entry-level';
  if (/\b(mid[\s-]*level|intermediate)\b/.test(text)) return 'Mid-level';
  if (/\b(3-5|2-5|3\+|4\+|5\+)\s*years/.test(text)) return 'Mid-level';
  return 'Mid-level';
}

function classifyLocation(remoteType, location) {
  if (remoteType === 'Remote' || /100%\s*remote/i.test(remoteType || '')) {
    if (/anywhere/i.test(location || '')) return 'Remote - Worldwide';
    if (/US\s*National/i.test(location || '')) return 'Remote - US';
    if (location) return `Remote - ${location}`;
    return 'Remote';
  }
  if (remoteType === 'Hybrid' || /hybrid/i.test(remoteType || '')) {
    return location ? `Hybrid - ${location}` : 'Hybrid';
  }
  if (remoteType === 'On-site') return location ? `On-site - ${location}` : 'On-site';
  return location || 'Unknown';
}

function standardizeTitle(title) {
  if (!title) return title;
  const maps = [
    [/\bfront[\s-]*end\s*(develop|engineer)/i, 'Frontend Developer'],
    [/\bback[\s-]*end\s*(develop|engineer)/i, 'Backend Developer'],
    [/\bfull[\s-]*stack\s*(develop|engineer)/i, 'Full Stack Developer'],
    [/\bdata\s*scien/i, 'Data Scientist'],
    [/\bdata\s*engineer/i, 'Data Engineer'],
    [/\bdata\s*analy/i, 'Data Analyst'],
    [/\bdevops/i, 'DevOps Engineer'],
    [/\bUX\s*(design|research)/i, 'UX Designer'],
    [/\bUI\s*design/i, 'UI Designer'],
    [/\bUI\s*\/?\s*UX/i, 'UI/UX Designer'],
    [/\bproject\s*manag/i, 'Project Manager'],
    [/\bproduct\s*manag/i, 'Product Manager'],
    [/\bcustomer\s*(service|success|support)\s*(rep|specialist|agent|manager)?/i, 'Customer Service Specialist'],
    [/\bdigital\s*market/i, 'Digital Marketing Specialist'],
    [/\bcontent\s*writ/i, 'Content Writer'],
    [/\bcopy\s*writ/i, 'Copywriter'],
    [/\bsoftware\s*engineer/i, 'Software Engineer'],
  ];
  for (const [regex, std] of maps) {
    if (regex.test(title)) return std;
  }
  return title;
}

/* ── AI Classification ───────────────────────────────────── */

async function classifyJobsBatch(token, model) {
  if (!token) throw new Error('GitHub token required. Set it in Settings.');

  const data = await chrome.storage.local.get({ rjs_jobs: [] });
  const jobs = data.rjs_jobs;
  const unclassified = jobs.filter(j => !j.aiClassified);

  if (unclassified.length === 0) return { classified: 0, total: jobs.length };

  const batchSize = 10;
  let classified = 0;

  for (let i = 0; i < unclassified.length; i += batchSize) {
    const batch = unclassified.slice(i, i + batchSize);
    const summaries = batch.map((j, idx) =>
      `[${idx}] Title: "${j.title}" | Company: "${j.company}" | Location: "${j.location}" | Remote: "${j.remoteType}" | Category: "${j.category || j.categorySlug}"`
    ).join('\n');

    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a job classification AI. For each job, return a JSON array with objects containing:
- index: the job index number
- industry: one of [IT, Marketing, Healthcare, Finance, Legal, Design, Education, Sales, HR, Customer Service, Operations, Writing, Engineering, Research, Other]
- experience_level: one of [Entry-level, Mid-level, Senior]
- standardTitle: a standardized/normalized job title
- locationType: classified as "Remote", "Hybrid", "On-site", or with region qualifier like "Remote - US"
Return ONLY valid JSON array, no other text.`,
            },
            { role: 'user', content: `Classify these jobs:\n${summaries}` },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!res.ok) continue;
      const aiData = await res.json();
      const content = aiData.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          const job = batch[c.index];
          if (job) {
            if (c.industry) job.industry = c.industry;
            if (c.experience_level) job.experience_level = c.experience_level;
            if (c.standardTitle) job.standardTitle = c.standardTitle;
            if (c.locationType) job.locationType = c.locationType;
            job.aiClassified = true;
            classified++;
          }
        }
      }
    } catch { /* keep local classification on AI error */ }
  }

  await chrome.storage.local.set({ rjs_jobs: jobs });
  return { classified, total: jobs.length };
}

/* ── Storage Management ──────────────────────────────────── */

async function storeJobs(newJobs) {
  const data = await chrome.storage.local.get({ rjs_jobs: [], rjs_urls: [] });
  const jobs = data.rjs_jobs;
  const urls = new Set(data.rjs_urls);
  let added = 0;

  for (const j of newJobs) {
    const key = j.url || `${j.title}|${j.company}`;
    if (urls.has(key)) continue;
    urls.add(key);
    jobs.push(j);
    added++;
  }

  await chrome.storage.local.set({
    rjs_jobs: jobs,
    rjs_urls: Array.from(urls),
  });

  return added;
}

async function getJobs(filters) {
  const data = await chrome.storage.local.get({ rjs_jobs: [] });
  let jobs = data.rjs_jobs;

  if (filters) {
    if (filters.search) {
      const s = filters.search.toLowerCase();
      jobs = jobs.filter(j =>
        (j.title || '').toLowerCase().includes(s)
        || (j.company || '').toLowerCase().includes(s)
        || (j.description || '').toLowerCase().includes(s)
      );
    }
    if (filters.industry && filters.industry !== 'all') {
      jobs = jobs.filter(j => j.industry === filters.industry);
    }
    if (filters.experience && filters.experience !== 'all') {
      jobs = jobs.filter(j => j.experience_level === filters.experience);
    }
    if (filters.locationType && filters.locationType !== 'all') {
      jobs = jobs.filter(j => (j.locationType || '').includes(filters.locationType));
    }
    if (filters.category && filters.category !== 'all') {
      jobs = jobs.filter(j => j.categorySlug === filters.category || j.category === filters.category);
    }
  }

  return { jobs, total: data.rjs_jobs.length };
}

async function getStats() {
  const data = await chrome.storage.local.get({ rjs_jobs: [] });
  const jobs = data.rjs_jobs;
  const industries = {};
  const locations = {};
  const experiences = {};
  const categories = {};

  for (const j of jobs) {
    const ind = j.industry || 'Other';
    const loc = j.locationType || 'Unknown';
    const exp = j.experience_level || 'Unknown';
    const cat = j.category || j.categorySlug || 'Unknown';
    industries[ind] = (industries[ind] || 0) + 1;
    locations[loc] = (locations[loc] || 0) + 1;
    experiences[exp] = (experiences[exp] || 0) + 1;
    categories[cat] = (categories[cat] || 0) + 1;
  }

  return {
    total: jobs.length,
    industries,
    locations,
    experiences,
    categories,
    lastScrape: jobs.length > 0 ? jobs[jobs.length - 1].dateScraped : null,
  };
}

async function clearJobs() {
  await chrome.storage.local.remove(['rjs_jobs', 'rjs_urls']);
  return { cleared: true };
}

async function deleteJob(jobUrl) {
  const data = await chrome.storage.local.get({ rjs_jobs: [], rjs_urls: [] });
  const jobs = data.rjs_jobs.filter(j => j.url !== jobUrl);
  const urls = data.rjs_urls.filter(u => u !== jobUrl);
  await chrome.storage.local.set({ rjs_jobs: jobs, rjs_urls: urls });
  return { deleted: true };
}

async function handlePageJobs(jobs, _pageUrl) {
  if (!jobs || !jobs.length) return { stored: 0 };
  const classified = jobs.map(j => ({ ...j, ...classifyLocal(j) }));
  const stored = await storeJobs(classified);
  return { stored };
}

async function scrapeCurrentTab(tab) {
  if (!tab?.id) throw new Error('No active tab');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractJobsFromDOM,
  });
  const jobs = results[0]?.result || [];
  const classified = jobs.map(j => ({ ...j, ...classifyLocal(j) }));
  const stored = await storeJobs(classified);
  return { found: jobs.length, stored };
}
