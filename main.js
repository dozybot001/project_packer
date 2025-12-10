// ================= 全局配置 =================
const CONFIG = {
    // 忽略的目录
    IGNORE_DIRS: [
        '.git', '.svn', '.hg', '.idea', '.vscode', '.settings',
        'node_modules', 'bower_components', 'build', 'dist', 'out', 'target',
        '__pycache__', '.venv', 'venv', 'env', '.pytest_cache',
        '.dart_tool', '.pub-cache', 'bin', 'obj', '.gradle', 'vendor',
        'tmp', 'temp', 'logs', 'coverage', '.next', '.nuxt',
        'ios', 'android'
    ],
    // 忽略的文件后缀
    IGNORE_EXTS: [
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.mp4', '.mp3', '.wav',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.7z', '.rar',
        '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.db', '.sqlite', '.sqlite3',
        '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
    ]
};

// 全局状态
let globalFiles = [];
let finalOutput = "";

// ================= Tab 切换 =================
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'pack') {
        btns[0].classList.add('active');
        document.getElementById('packSection').classList.add('active');
    } else {
        btns[1].classList.add('active');
        document.getElementById('unpackSection').classList.add('active');
    }
}

// ================= 逻辑 A: Packer (打包) =================

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    resetUI();
    setStatus('processing', '正在分析文件结构...');
    
    // 稍微延迟一下以显示动画，增加“处理感”
    await new Promise(r => setTimeout(r, 400));
    
    globalFiles = [];

    for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (shouldIgnore(path)) continue;

        try {
            const text = await readFileAsText(file);
            globalFiles.push({ file, path, content: text, selected: true });
        } catch (err) { console.warn(`Skipped binary: ${path}`); }
    }

    if (globalFiles.length === 0) {
        setStatus('error', '未找到有效代码文件 (全部被过滤)');
        return;
    }

    renderFileList();
    generateOutput();
});

function shouldIgnore(path) {
    path = path.replace(/\\/g, '/'); // 标准化路径
    const parts = path.split('/');
    if (parts.some(p => CONFIG.IGNORE_DIRS.includes(p))) return true;
    if (CONFIG.IGNORE_EXTS.some(ext => path.toLowerCase().endsWith(ext))) return true;
    return false;
}

function renderFileList() {
    const container = document.getElementById('fileList');
    document.getElementById('fileListContainer').style.display = 'block';
    container.innerHTML = '';

    globalFiles.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        // 简单的文件图标逻辑
        const icon = item.path.includes('/') ? '📄' : '📝';
        
        div.innerHTML = `
            <input type="checkbox" id="f_${index}" ${item.selected ? 'checked' : ''}>
            <span style="margin-right:8px; opacity:0.7">${icon}</span>
            <label for="f_${index}" style="cursor:pointer; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${item.path}
            </label>
        `;
        div.querySelector('input').addEventListener('change', (e) => {
            globalFiles[index].selected = e.target.checked;
            e.target.checked ? div.classList.remove('ignored') : div.classList.add('ignored');
            generateOutput();
        });
        container.appendChild(div);
    });
}

function toggleAllFiles() {
    const hasUnchecked = globalFiles.some(f => !f.selected);
    globalFiles.forEach(f => f.selected = hasUnchecked);
    renderFileList();
    generateOutput();
}

function generateOutput() {
    const activeFiles = globalFiles.filter(f => f.selected);
    
    // 生成树结构
    const paths = activeFiles.map(f => f.path);
    let result = "Project Structure:\n" + generateTree(paths) + "\n\n================================================\n\n";

    // 拼接内容
    activeFiles.forEach(f => {
        const cleanPath = f.path.replace(/\\/g, '/');
        result += `=== File: ${cleanPath} ===\n${f.content}\n\n`;
    });

    finalOutput = result;
    
    // UI 更新
    document.getElementById('dashboard').style.display = 'grid';
    document.getElementById('previewContainer').style.display = 'block';
    
    const previewText = finalOutput.length > 3000 ? finalOutput.substring(0, 3000) + "\n... (内容过长，仅显示预览)" : finalOutput;
    document.getElementById('previewArea').innerText = previewText;
    
    // 更新统计数据
    const tokenEst = Math.ceil(finalOutput.length / 4).toLocaleString();
    animateValue('fileCountVal', 0, activeFiles.length, 500);
    document.getElementById('tokenVal').innerText = `~${tokenEst}`;
    
    setStatus('success', `✅ 已成功打包 ${activeFiles.length} 个文件`);
}

// ================= 逻辑 B: Unpacker =================

document.getElementById('txtInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('pasteArea').value = await readFileAsText(file);
        showToast("文件已读取", "success");
    }
});

function copyPromptHint() {
    const text = "请修改代码，并以 Project Packer 格式（包含 Project Structure 和 === File: path === 标记）输出完整的修改后文件内容，不要省略。";
    navigator.clipboard.writeText(text);
    showToast("Prompt 已复制！", "success");
}

async function unpackToZip() {
    const content = document.getElementById('pasteArea').value;
    if (!content.trim()) { 
        showToast("内容为空，请先粘贴代码", "error"); 
        return; 
    }

    const btn = document.querySelector('.large-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="status-icon">⏳</span> 解析中...';

    const zip = new JSZip();
    let fileCount = 0;

    // --- 核心解析逻辑 ---
    const markerRegex = /(?:\r?\n|^)=== File: (.*?) ===(?:\r?\n|$)/g;
    
    let match;
    let matches = [];

    while ((match = markerRegex.exec(content)) !== null) {
        matches.push({
            path: match[1].trim(),
            startIndex: match.index,
            endIndex: match.index + match[0].length
        });
    }

    if (matches.length === 0) {
        alert("未找到有效的文件标记！格式应为：=== File: path/to/file.ext ===");
        btn.innerHTML = originalText;
        return;
    }

    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const contentStart = current.endIndex;
        const contentEnd = next ? next.startIndex : content.length;

        let rawContent = content.substring(contentStart, contentEnd);
        let cleanPath = current.path.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');

        if (!cleanPath || cleanPath.endsWith('/')) continue;

        rawContent = rawContent.replace(/^\s*[\r\n]/, '').replace(/[\r\n]\s*$/, '');
        zip.file(cleanPath, rawContent);
        fileCount++;
    }

    if (fileCount > 0) {
        try {
            const blob = await zip.generateAsync({type:"blob"});
            saveAs(blob, "project_unpacked.zip");
            showToast(`成功还原 ${fileCount} 个文件`, "success");
        } catch (e) {
            console.error(e);
            showToast("Zip 生成失败: " + e.message, "error");
        }
    } else {
        showToast("未提取到任何有效文件", "error");
    }
    
    btn.innerHTML = originalText;
}

// ================= UI 工具函数 =================

function resetUI() {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('previewContainer').style.display = 'none';
    document.getElementById('fileListContainer').style.display = 'none';
    finalOutput = "";
    // 重置状态栏
    const cap = document.getElementById('statusCapsule');
    cap.className = 'status-capsule idle';
    document.getElementById('statusText').innerText = '准备就绪';
}

function setStatus(type, msg) {
    const cap = document.getElementById('statusCapsule');
    const txt = document.getElementById('statusText');
    const icon = cap.querySelector('.status-icon');
    
    cap.className = 'status-capsule ' + type;
    txt.innerText = msg;
    
    if(type === 'processing') icon.innerText = '⏳';
    else if(type === 'success') icon.innerText = '🎉';
    else if(type === 'error') icon.innerText = '❌';
    else icon.innerText = '✨';
}

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = type === 'success' ? `<span>✅</span> ${msg}` : (type === 'error' ? `<span>⚠️</span> ${msg}` : msg);
    
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// 数字滚动动画
function animateValue(id, start, end, duration) {
    if (start === end) return;
    const range = end - start;
    let current = start;
    const increment = end > start ? 1 : -1;
    const stepTime = Math.abs(Math.floor(duration / range));
    const obj = document.getElementById(id);
    
    const timer = setInterval(function() {
        current += increment;
        obj.innerHTML = current;
        if (current == end) {
            clearInterval(timer);
        }
    }, Math.max(stepTime, 20)); // 最快20ms一帧
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function downloadFile() {
    const blob = new Blob([finalOutput], { type: 'text/plain' });
    saveAs(blob, "project_context.txt");
    showToast("文件下载已开始", "success");
}

async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(finalOutput);
        showToast("已复制到剪贴板！", "success");
    } catch (e) { showToast('复制失败，请尝试下载文件', 'error'); }
}

function generateTree(paths) {
    let tree = {};
    paths.forEach(path => {
        path.replace(/\\/g, '/').split('/').reduce((r, k) => r[k] = r[k] || {}, tree);
    });
    
    function print(node, prefix = "") {
        let keys = Object.keys(node);
        return keys.map((key, i) => {
            let last = i === keys.length - 1;
            let str = prefix + (last ? "└── " : "├── ") + key + "\n";
            if (Object.keys(node[key]).length) str += print(node[key], prefix + (last ? "    " : "│   "));
            return str;
        }).join('');
    }
    return Object.keys(tree).length ? (paths.length > 1 ? "Root/\n" : "") + print(tree) : "";
}

// ================= Sidebar & README 逻辑 =================

let readmeLoaded = false;
// 使用本地路径，并添加时间戳以避免缓存问题
const REPO_README_URL = "./README.md";

async function toggleSidebar() {
    const body = document.body;
    const isOpen = body.classList.contains('sidebar-open');
    
    if (isOpen) {
        // 关闭
        body.classList.remove('sidebar-open');
        // 允许主界面点击
        document.getElementById('mainContainer').onclick = null;
    } else {
        // 打开
        body.classList.add('sidebar-open');
        
        // 点击主界面也可以关闭
        setTimeout(() => {
            document.getElementById('mainContainer').onclick = toggleSidebar;
        }, 100);

        // 如果还没加载过，去获取内容
        if (!readmeLoaded) {
            await fetchAndRenderReadme();
        }
    }
}

async function fetchAndRenderReadme() {
    const contentDiv = document.getElementById('readmeContent');
    
    try {
        // 添加时间戳参数 '?t=' + Date.now() 强制刷新缓存
        const response = await fetch(REPO_README_URL + '?t=' + Date.now());
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} (Check file path)`);
        }
        
        const markdownText = await response.text();
        
        // 使用 marked 解析 (需要在 index.html 引入 marked.js)
        if (typeof marked !== 'undefined') {
            // 配置 marked 以允许 GFM (GitHub Flavored Markdown)
            contentDiv.innerHTML = marked.parse(markdownText);
            readmeLoaded = true;
        } else {
            contentDiv.innerHTML = "<p style='color:red'>Marked.js library not loaded.</p>";
        }
        
    } catch (error) {
        console.error("README Load Error:", error);
        contentDiv.innerHTML = `
            <div style="text-align:center; padding-top:50px; color:var(--text-secondary)">
                <p>⚠️ 无法加载 README</p>
                <p style="font-size:0.8rem; opacity:0.7">${error.message}</p>
                <p style="font-size:0.8rem; color:#666">请确保 README.md 文件与 index.html 在同一目录下。</p>
                <button class="btn btn-secondary" onclick="fetchAndRenderReadme()" style="margin:20px auto">重试</button>
            </div>
        `;
    }
}