/* ================================================================
   Remote.co Job Scraper — Content Script
   Adds a floating "Scrape Jobs" button on Remote.co pages
   ================================================================ */

(function () {
  const url = location.href;
  if (!url.includes('remote.co/remote-jobs') && !url.includes('remote.co/job-details')) return;

  // Floating scrape button
  const btn = document.createElement('button');
  btn.id = 'rjs-scrape-btn';
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
    <span>Scrape Jobs</span>
  `;
  btn.addEventListener('click', scrapeCurrentPage);
  document.body.appendChild(btn);

  // Toast notification
  const toast = document.createElement('div');
  toast.id = 'rjs-toast';
  document.body.appendChild(toast);

  async function scrapeCurrentPage() {
    btn.classList.add('rjs-loading');
    btn.querySelector('span').textContent = 'Scraping\u2026';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'SCRAPE_CURRENT' });
      if (response?.error) {
        showToast(`Error: ${response.error}`, 'error');
      } else {
        const { found = 0, stored = 0 } = response || {};
        showToast(`Found ${found} jobs, ${stored} new saved!`, 'success');
        highlightExtractedJobs();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('rjs-loading');
      btn.querySelector('span').textContent = 'Scrape Jobs';
    }
  }

  function showToast(msg, type) {
    toast.textContent = msg;
    toast.className = `rjs-toast-visible rjs-toast-${type}`;
    setTimeout(() => { toast.className = ''; }, 4000);
  }

  function highlightExtractedJobs() {
    const links = document.querySelectorAll('a[href*="/job-details/"]');
    links.forEach(link => {
      const card = link.closest('article')
        || link.closest('[class*="job"]')
        || link.closest('li')
        || link.parentElement?.parentElement;
      if (card) card.classList.add('rjs-extracted');
    });
  }
})();
