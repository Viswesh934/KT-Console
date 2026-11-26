const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const newId = () => crypto.randomUUID();
const newClaimCode = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
      try {
        if (url.pathname === "/api/config" && request.method === "GET") {
          return json({ flagsmithEnvironmentId: env.FLAGSMITH_ENVIRONMENT_ID || "" });
        }
        if (url.pathname === "/api/projects" && request.method === "GET") {
          const { results } = await env.DB.prepare("SELECT id,name,gist,seat_limit,claim_code,agent_qa_enabled,created_at FROM projects ORDER BY created_at DESC LIMIT 20").all();
          return json({ projects: results });
        }
        if (url.pathname === "/api/projects" && request.method === "POST") {
          const body = await request.json();
          const name = String(body.name || "").trim().slice(0, 80);
          const gist = String(body.gist || "").trim().slice(0, 4000);
          const seatLimit = Math.max(1, Math.min(100, Number(body.seatLimit) || 5));
          if (!name) return json({ error: "Add a project name to continue." }, 400);
          const id = newId();
          const code = newClaimCode();
          await env.DB.prepare("INSERT INTO projects (id,name,gist,seat_limit,claim_code) VALUES (?,?,?,?,?)").bind(id, name, gist, seatLimit, code).run();
          return json({ project: { id, name, gist, seat_limit: seatLimit, claim_code: code, agent_qa_enabled: 0 } }, 201);
        }
        if (url.pathname === "/api/join" && request.method === "POST") {
          const body = await request.json();
          const code = String(body.code || "").trim().toUpperCase();
          const displayName = String(body.displayName || "").trim().slice(0, 80);
          if (!code || !displayName) return json({ error: "Enter your name and team claim code." }, 400);
          const project = await env.DB.prepare("SELECT * FROM projects WHERE claim_code = ?").bind(code).first();
          if (!project) return json({ error: "That claim code was not found." }, 404);
          const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM members WHERE project_id = ?").bind(project.id).first();
          if (count.count >= project.seat_limit) return json({ error: "This project has reached its seat limit." }, 409);
          const member = { id: newId(), project_id: project.id, display_name: displayName, role: "member" };
          await env.DB.prepare("INSERT INTO members (id,project_id,display_name) VALUES (?,?,?)").bind(member.id, project.id, displayName).run();
          return json({ project: { id: project.id, name: project.name, gist: project.gist }, member }, 201);
        }
        if (url.pathname === "/api/materials" && request.method === "GET") {
          const projectId = url.searchParams.get("projectId");
          if (!projectId) return json({ error: "projectId is required." }, 400);
          const { results } = await env.DB.prepare("SELECT id,kind,level,title,body,created_at FROM learning_materials WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all();
          return json({ materials: results });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        console.error("API request failed", error);
        return json({ error: "The request could not be completed." }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
}
