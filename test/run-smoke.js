const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8000;

function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURI(req.url.split('?')[0]);
      let filePath = path.join(ROOT, urlPath);
      // If path is directory, serve index.html
      if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');
      if (urlPath === '/' || urlPath === '') filePath = path.join(ROOT, 'index.html');
      // Prevent path traversal
      if (!filePath.startsWith(ROOT)) {
        res.statusCode = 403; res.end('Forbidden'); return;
      }
      if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end('Not found'); return; }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); }
      const ext = path.extname(filePath).toLowerCase();
      const map = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.txt':'text/plain', '.ico':'image/x-icon' };
      const ct = map[ext] || 'application/octet-stream';
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    } catch (err) {
      res.statusCode = 500; res.end('Server error');
    }
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

(async function run() {
  console.log('Starting static server...');
  const server = await startServer();
  console.log(`Server running at http://localhost:${PORT}/`);

  // Determine executable path: prefer env var, otherwise try common Windows installs
  const findChromeExecutable = () => {
    const candidates = [];
    if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
    // Common Chrome/Edge locations on Windows
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
    candidates.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    for (const p of candidates) {
      try { if (p && fs.existsSync(p)) return p; } catch (e) {}
    }
    return null;
  };

  const execPath = findChromeExecutable();
  if (!execPath) {
    console.error('\nNo se encontró un navegador local (Chrome/Edge).');
    console.error('Establece la variable de entorno PUPPETEER_EXECUTABLE_PATH con la ruta a tu navegador, por ejemplo:');
    console.error('  C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    server.close();
    process.exit(2);
  }

  const browser = await puppeteer.launch({ headless: true, executablePath: execPath });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);

  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#prompts-grid');

    // Count existing prompt cards
    const initial = await page.$$eval('.prompt-card', els => els.length);

    // Open new prompt modal
    await page.click('header .btn-primary');
    await page.waitForSelector('#prompt-modal.open, #prompt-modal');

    // Fill and save prompt
    await page.type('#m-title', 'E2E Test Prompt');
    await page.type('#m-description', 'Prueba automatizada');
    await page.type('#m-content', 'Contenido de prueba para verificar la UI');
    await page.click('#prompt-modal .btn-save');

    // Wait until a new .prompt-card appears
    await page.waitForFunction((sel, n) => document.querySelectorAll(sel).length > n, {}, '.prompt-card', initial);

    const final = await page.$$eval('.prompt-card', els => els.length);
    console.log(`Initial cards: ${initial}, Final cards: ${final}`);
    if (final <= initial) throw new Error('Prompt was not created');

    console.log('Smoke test passed: prompt created and visible.');
    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Smoke test failed:', err);
    try { await browser.close(); } catch (e) {}
    server.close();
    process.exit(1);
  }
})();
