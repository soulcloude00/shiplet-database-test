import http from "node:http";
import { Pool } from "pg";

const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Attach a database in Shiplet before deploying.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS shiplet_notes (
    id BIGSERIAL PRIMARY KEY,
    body TEXT NOT NULL CHECK (char_length(body) <= 280),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      return sendJson(response, 200, { ok: true, database: "connected" });
    }

    if (request.method === "GET" && url.pathname === "/api/notes") {
      const result = await pool.query(
        "SELECT id, body, created_at FROM shiplet_notes ORDER BY created_at DESC LIMIT 50",
      );
      return sendJson(response, 200, { notes: result.rows });
    }

    if (request.method === "POST" && url.pathname === "/api/notes") {
      const input = await readJson(request);
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 280) {
        return sendJson(response, 400, { error: "Write between 1 and 280 characters." });
      }
      const result = await pool.query(
        "INSERT INTO shiplet_notes (body) VALUES ($1) RETURNING id, body, created_at",
        [body],
      );
      return sendJson(response, 201, { note: result.rows[0] });
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return response.end(page);
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "The database request failed." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Shiplet database test is listening on ${port}`);
});

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shiplet Notes</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f7faf6;color:#172019;font:16px/1.5 system-ui,sans-serif}
    main{width:min(680px,calc(100% - 32px));margin:64px auto}small{color:#19874d;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    h1{max-width:560px;margin:12px 0 8px;font-size:clamp(42px,8vw,72px);line-height:.95;letter-spacing:-.065em}p{color:#667068}
    form{display:flex;gap:10px;margin:38px 0}input{flex:1;padding:16px 18px;border:1px solid #d8e1da;border-radius:16px;background:#fff;font:inherit}
    button{padding:14px 22px;border:1px solid #0fa958;border-radius:16px;background:#31e77f;color:#102317;font-weight:800;font-size:15px;cursor:pointer}
    #state{min-height:24px}.note{padding:20px 0;border-top:1px solid #dce4dd}.note p{margin:0;color:#172019}.note time{color:#8a938c;font-size:12px}
  </style>
</head>
<body>
  <main>
    <small>Postgres is connected</small>
    <h1>Notes that survive a redeploy.</h1>
    <p>This deliberately tiny app proves Shiplet can provision data, inject DATABASE_URL, and preserve real writes.</p>
    <form id="form"><input id="body" maxlength="280" placeholder="Write a test note…" required><button>Save note</button></form>
    <p id="state">Loading notes…</p><section id="notes"></section>
  </main>
  <script>
    const form=document.querySelector('#form'),input=document.querySelector('#body'),state=document.querySelector('#state'),notes=document.querySelector('#notes');
    const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    const apiBase=location.pathname.replace(/\\/$/,'')+'/api/notes';
    async function load(){const response=await fetch(apiBase);const data=await response.json();state.textContent=data.notes.length?'':'No notes yet.';notes.innerHTML=data.notes.map(note=>'<article class="note"><p>'+escapeHtml(note.body)+'</p><time>'+new Date(note.created_at).toLocaleString()+'</time></article>').join('')}
    form.addEventListener('submit',async event=>{event.preventDefault();state.textContent='Saving…';const response=await fetch(apiBase,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:input.value})});if(response.ok){input.value='';await load()}else{const data=await response.json();state.textContent=data.error||'Could not save.'}});
    load().catch(()=>state.textContent='Database connection failed.');
  </script>
</body>
</html>`;
