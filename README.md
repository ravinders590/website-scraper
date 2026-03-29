# Remote.co Job Scraper

Chrome extension to scrape, classify, and export Remote.co job listings with NLP-powered categorization.

## Features

- **Automated Scraping** — Bulk scrape 40+ Remote.co job categories with pagination support
- **Manual Extraction** — Floating "Scrape Jobs" button when browsing Remote.co
- **Local NLP Classification** — Instant keyword-based classification for:
  - **Industry**: IT, Marketing, Healthcare, Finance, Legal, Design, Education, Sales, HR, Customer Service, etc.
  - **Experience Level**: Entry-level, Mid-level, Senior (inferred from title/description keywords)
  - **Location Type**: Remote, Hybrid, On-site with region qualifiers
  - **Title Standardization**: Normalizes variations (e.g., "Dev" → "Software Developer")
- **AI Enhancement** — Optional GitHub Models AI for more accurate classification
- **Deduplication** — Prevents duplicate jobs by checking URL/title+company
- **Export** — Download as JSON or CSV with standardized fields
- **Dashboard** — Visual stats with bar charts for industry, experience, and location breakdowns

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `remoteCoScraper` folder

## Usage

1. Click the extension icon to open the popup
2. Go to **Scrape** tab → select categories → click **Start Scrape**
3. Browse results in the **Jobs** tab with search and filters
4. Export data from the **Export** tab as JSON or CSV

### Manual Scraping
When visiting any Remote.co page, click the floating blue **Scrape Jobs** button to extract jobs from the current page.

### AI Classification
1. Go to Settings → enter your GitHub token
2. In the Export tab → click **Run AI Classification** for enhanced NLP

## Output Format

```json
[
  {
    "title": "Frontend Developer",
    "company": "ABC Tech",
    "location": "Remote - US",
    "industry": "IT",
    "experience_level": "Mid-level",
    "description": "We are seeking a frontend developer...",
    "apply_link": "https://remote.co/job-details/...",
    "date_posted": "2026-03-20",
    "salary": "$120,000 - $150,000 Annually",
    "job_type": "Full-Time",
    "category": "Developer",
    "remote_type": "Remote",
    "date_scraped": "2026-03-23T10:30:00.000Z"
  }
]
```

## Permissions

- `tabs` / `scripting` — Required to open category pages and extract DOM content
- `storage` — Store scraped jobs and settings
- `downloads` — Export JSON/CSV files
- `https://remote.co/*` — Access Remote.co pages for scraping
- `https://models.inference.ai.azure.com/*` — Optional AI classification
