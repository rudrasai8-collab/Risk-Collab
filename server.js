const http = require('http');
const fs = require('fs');
const path = require('path');

const root = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const port = Number(process.env.PORT || 3000);
const mimeTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };

function sendJson(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function safePath(urlPath) { const decoded = decodeURIComponent(urlPath.split('?')[0]); const target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`); return target.startsWith(root) ? target : null; }

async function handleAgent(req, res) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) return sendJson(res, 413, {error:'Message is too large.'}); }
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, {error:'Invalid request.'}); }
  const message = String(body.message || '').trim().slice(0, 4000);
  const region = String(body.region || 'Northeast').slice(0, 40);
  if (!message) return sendJson(res, 400, {error:'A message is required.'});
  if (!process.env.OPENAI_API_KEY) return sendJson(res, 503, {error:'AI agent is not configured. Add OPENAI_API_KEY to your environment.'});
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({ model:process.env.AGENT_MODEL || 'gpt-5-mini', instructions:`You are Rudra AI, a concise regional preparedness assistant. The user selected ${region}. Give practical, calm guidance about weather, hazards, roads, and preparation. Never claim access to official live emergency alerts. Encourage checking local emergency management and transportation authorities for time-sensitive decisions.`, input:message })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'The model request failed.');
    sendJson(res, 200, {reply:data.output_text || 'I could not generate a response. Please try again.'});
  } catch (error) { sendJson(res, 502, {error:error.message || 'Unable to reach the AI service.'}); }
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/agent') return handleAgent(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, {error:'Method not allowed.'});
  const file = safePath(req.url);
  if (!file) return sendJson(res, 403, {error:'Forbidden.'});
  fs.readFile(file, (error, content) => {
    if (error) return sendJson(res, error.code === 'ENOENT' ? 404 : 500, {error:'File not found.'});
    res.writeHead(200, {'Content-Type':mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}).listen(port, () => console.log(`Rudra AI is running at http://localhost:${port}`));
