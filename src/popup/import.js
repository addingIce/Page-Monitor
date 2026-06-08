// Import page logic
const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('file-input');
const statusEl = document.getElementById('status');

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// Click to select file
dropArea.addEventListener('click', () => fileInput.click());

// File selected
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Drag and drop
dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropArea.classList.add('dragover');
});
dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('dragover');
});
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dropArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.name.endsWith('.json')) {
    showStatus('请选择 .json 格式的配置文件', 'error');
    return;
  }

  showStatus('正在读取文件...', 'info');

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.rules && !data.settings) {
      throw new Error('无效的配置文件：未找到 rules 或 settings');
    }

    const ruleCount = (data.rules || []).length;
    if (!confirm(`即将导入 ${ruleCount} 条规则和设置，是否覆盖当前配置？`)) {
      showStatus('已取消导入', 'info');
      return;
    }

    if (data.rules) await chrome.storage.local.set({ rules: data.rules });
    if (data.settings) await chrome.storage.local.set({ settings: data.settings });

    showStatus(`✅ 导入成功！共导入 ${ruleCount} 条规则。此页面可关闭。`, 'success');

    // Auto-close after 1.5 seconds
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    showStatus('导入失败: ' + err.message, 'error');
  }
}
