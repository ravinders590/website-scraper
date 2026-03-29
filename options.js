const $ = id => document.getElementById(id);

const GH_API = 'https://api.github.com';

async function loadSettings() {
  const data = await chrome.storage.sync.get(['githubToken', 'aiModel']);
  if (data.githubToken) $('githubToken').value = data.githubToken || '';
  if (data.aiModel) $('aiModel').value = data.aiModel;
}

async function saveSettings(e) {
  e.preventDefault();
  const token = $('githubToken').value.trim();
  const model = $('aiModel').value;

  await chrome.storage.sync.set({ githubToken: token, aiModel: model });
  showSaveStatus('Settings saved.');
}

async function testConnection() {
  const token = $('githubToken').value.trim();
  if (!token) {
    showTestStatus('Please enter a token first.', false);
    return;
  }

  const btn = $('btnTestToken');
  btn.textContent = 'Testing\u2026';
  btn.disabled = true;

  try {
    const res = await fetch(`${GH_API}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });

    if (res.status === 200) {
      const user = await res.json();
      showTestStatus(`Connected as @${user.login} (${user.name || 'Unknown'})`, true);
    } else if (res.status === 401) {
      showTestStatus('Invalid or expired token.', false);
    } else {
      showTestStatus(`Unexpected status ${res.status}.`, false);
    }
  } catch {
    showTestStatus('Network error. Check your connection.', false);
  } finally {
    btn.textContent = 'Test Connection';
    btn.disabled = false;
  }
}

function toggleTokenVisibility() {
  const input = $('githubToken');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showTestStatus(msg, ok) {
  const el = $('testStatus');
  el.textContent = msg;
  el.className = `test-status ${ok ? 'success' : 'error'}`;
  el.classList.remove('hidden');
}

function showSaveStatus(msg, isError = false) {
  const el = $('saveStatus');
  el.textContent = msg;
  el.className = `save-status${isError ? ' error' : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  $('settingsForm').addEventListener('submit', saveSettings);
  $('btnTestToken').addEventListener('click', testConnection);
});
