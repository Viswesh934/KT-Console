const SESSION_COOKIE = "kt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100000;
const VALID_LEVELS = new Set(["all", "junior", "mid", "senior"]);
const VALID_MEMBER_LEVELS = new Set(["junior", "mid", "senior"]);
const VALID_KINDS = new Set(["guide", "edge_case", "quiz", "guided_session"]);
const VALID_SCOPES = new Set(["gist_only", "gist_and_materials"]);

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  },
});

const newId = () => crypto.randomUUID();
const newClaimCode = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
const newUserCode = () => {
  const raw = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
}

async function derivePbkdf2Hex(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await derivePbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!iterations || !saltHex || !expectedHex) return false;
  const derivedHex = await derivePbkdf2Hex(password, fromHex(saltHex), iterations);
  return constantTimeEqual(derivedHex, expectedHex);
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

function buildSessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const isHttps = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

async function createSession(env, userId, request) {
  const rawToken = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(newId(), userId, tokenHash, expiresAt).run();
  return buildSessionCookie(rawToken, request);
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

async function getMembership(env, projectId, userId) {
  return env.DB.prepare(
    "SELECT id, role, display_name, experience_level FROM members WHERE project_id = ? AND user_id = ?",
  ).bind(projectId, userId).first();
}

function claimCodeExpiryIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildScopedQaAnswer(project, materials, question, experienceLevel) {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);

  const sources = [];
  if (project.gist) {
    sources.push({ type: "gist", title: "Approved project gist" });
  }

  const scored = materials
    .filter((item) => item.level === "all" || item.level === experienceLevel)
    .map((item) => {
      const haystack = `${item.title} ${item.body} ${item.source_note || ""}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  const relevant = scored.slice(0, 3).map((entry) => entry.item);
  for (const item of relevant) {
    sources.push({ type: item.kind, title: item.title, level: item.level });
  }

  const parts = [];
  if (project.gist) {
    parts.push(`Project overview: ${project.gist}`);
  } else {
    parts.push("No approved project gist has been added yet.");
  }

  if (project.agent_qa_scope === "gist_and_materials" && relevant.length) {
    const snippets = relevant.map((m) => `- [${m.kind}/${m.level}] ${m.title}: ${m.body.slice(0, 260)}`);
    parts.push(`Relevant approved learning material (${experienceLevel} track):\n${snippets.join("\n")}`);
  }

  return {
    answer: parts.join("\n\n"),
    sources,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({ flagsmithEnvironmentId: env.FLAGSMITH_ENVIRONMENT_ID || "" });
      }

      if (url.pathname.startsWith("/api/mcp/")) {
        const expectedToken = env.KT_CONSOLE_MCP_TOKEN;
        const authHeader = request.headers.get("authorization") || "";
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!expectedToken || !constantTimeEqual(bearer, expectedToken)) {
          return json({ error: "Unauthorized MCP token." }, 401);
        }

        if (url.pathname === "/api/mcp/projects" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id, name, gist, source_label, published, created_at FROM projects ORDER BY created_at DESC LIMIT 50",
          ).all();
          return json({ projects: results });
        }

        if (url.pathname === "/api/mcp/projects" && request.method === "POST") {
          const body = await request.json();
          const name = String(body.name || "").trim().slice(0, 100);
          const gist = String(body.gist || "").trim().slice(0, 6000);
          const sourceLabel = String(body.sourceLabel || "").trim().slice(0, 120);
          if (name.length < 2 || gist.length < 20) {
            return json({ error: "Project name and gist are required." }, 400);
          }
          const id = newId();
          const code = newClaimCode();
          await env.DB.prepare(
            "INSERT INTO projects (id, name, gist, source_label, claim_code, claim_code_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(id, name, gist, sourceLabel, code, claimCodeExpiryIso(7)).run();
          return json({ project: { id, name, gist, source_label: sourceLabel, published: 0 } }, 201);
        }

        const mcpProjMatch = url.pathname.match(/^\/api\/mcp\/projects\/([^/]+)$/);
        if (mcpProjMatch && request.method === "GET") {
          const project = await env.DB.prepare(
            "SELECT id, name, gist, source_label, published, created_at FROM projects WHERE id = ?",
          ).bind(mcpProjMatch[1]).first();
          if (!project) return json({ error: "Project not found." }, 404);
          return json({ project });
        }

        const mcpMatsMatch = url.pathname.match(/^\/api\/mcp\/projects\/([^/]+)\/materials$/);
        if (mcpMatsMatch && request.method === "POST") {
          const projectId = mcpMatsMatch[1];
          const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
          if (!project) return json({ error: "Project not found." }, 404);
          const body = await request.json();
          const kind = String(body.kind || "").trim().toLowerCase();
          const level = String(body.level || "all").trim().toLowerCase();
          const title = String(body.title || "").trim().slice(0, 160);
          const content = String(body.content || "").trim().slice(0, 18000);
          if (!title || !content) return json({ error: "Title and content are required." }, 400);
          const id = newId();
          await env.DB.prepare(
            "INSERT INTO learning_materials (id, project_id, kind, level, title, body) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(id, projectId, kind, level, title, content).run();
          return json({ material: { id, project_id: projectId, kind, level, title } }, 201);
        }

        const mcpPubMatch = url.pathname.match(/^\/api\/mcp\/projects\/([^/]+)\/publish$/);
        if (mcpPubMatch && request.method === "POST") {
          const projectId = mcpPubMatch[1];
          const counts = await env.DB.prepare(
            `SELECT
               SUM(CASE WHEN kind IN ('guide', 'edge_case') THEN 1 ELSE 0 END) AS guides,
               SUM(CASE WHEN kind = 'quiz' THEN 1 ELSE 0 END) AS quizzes
             FROM learning_materials WHERE project_id = ?`,
          ).bind(projectId).first();
          if (!counts?.guides || !counts?.quizzes) {
            return json({ error: "Add at least one guide/edge case and one quiz before publishing." }, 400);
          }
          await env.DB.prepare("UPDATE projects SET published = 1 WHERE id = ?").bind(projectId).run();
          return json({ ok: true, published: 1 });
        }

        const mcpScoresMatch = url.pathname.match(/^\/api\/mcp\/projects\/([^/]+)\/scores$/);
        if (mcpScoresMatch && request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT learner_id, material_id, score, total, completed_at FROM quiz_attempts WHERE project_id = ? ORDER BY completed_at DESC LIMIT 100",
          ).bind(mcpScoresMatch[1]).all();
          return json({ scores: results });
        }

        return json({ error: "Not found." }, 404);
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        return json({ user });
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
        const displayName = String(body.displayName || "").trim().slice(0, 80);
        const password = String(body.password || "");
        if (!email || !email.includes("@")) return json({ error: "Enter a valid email address." }, 400);
        if (!displayName) return json({ error: "Enter your display name." }, 400);
        if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (existing) return json({ error: "An account with that email already exists." }, 409);

        const user = { id: newId(), email, display_name: displayName };
        const passwordHash = await hashPassword(password);
        await env.DB.prepare(
          "INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)",
        ).bind(user.id, email, displayName, passwordHash).run();

        const cookie = await createSession(env, user.id, request);
        return json({ user }, 201, { "set-cookie": cookie });
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) return json({ error: "Enter your email and password." }, 400);

        const row = await env.DB.prepare(
          "SELECT id, email, display_name, password_hash FROM users WHERE email = ?",
        ).bind(email).first();
        if (!row || !(await verifyPassword(password, row.password_hash))) {
          return json({ error: "Invalid email or password." }, 401);
        }

        const cookie = await createSession(env, row.id, request);
        return json(
          { user: { id: row.id, email: row.email, display_name: row.display_name } },
          200,
          { "set-cookie": cookie },
        );
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const cookies = parseCookies(request);
        const rawToken = cookies[SESSION_COOKIE];
        if (rawToken) {
          const tokenHash = await sha256Hex(rawToken);
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
        }
        return json({ ok: true }, 200, { "set-cookie": buildSessionCookie("", request, 0) });
      }

      // Device-code authenticated Agent Q&A (allows headless CLI/IDE agent calls without browser cookie)
      const qaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent-qa$/);
      if (qaMatch && request.method === "POST") {
        const projectId = qaMatch[1];
        const body = await request.json();
        const question = String(body.question || "").trim().slice(0, 1000);
        if (!question) return json({ error: "Enter a question to ask." }, 400);

        let membership = null;
        const deviceCode = request.headers.get("x-agent-device-code")?.trim();
        if (deviceCode) {
          const deviceHash = await sha256Hex(deviceCode);
          const conn = await env.DB.prepare(
            `SELECT ac.id AS conn_id, m.id, m.role, m.display_name, m.experience_level
             FROM agent_connections ac
             JOIN members m ON m.id = ac.member_id
             WHERE ac.project_id = ? AND ac.device_code_hash = ? AND ac.status = 'active'`,
          ).bind(projectId, deviceHash).first();
          if (!conn) return json({ error: "Invalid or revoked agent device code." }, 401);
          membership = conn;
          await env.DB.prepare("UPDATE agent_connections SET last_used_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), conn.conn_id).run();
        } else {
          const user = await getSessionUser(request, env);
          if (!user) return json({ error: "Sign in to continue." }, 401);
          membership = await getMembership(env, projectId, user.id);
        }

        if (!membership) return json({ error: "Project not found." }, 404);

        const project = await env.DB.prepare(
          "SELECT id, name, gist, agent_qa_enabled, agent_qa_scope FROM projects WHERE id = ?",
        ).bind(projectId).first();
        if (!project) return json({ error: "Project not found." }, 404);
        if (!project.agent_qa_enabled) {
          return json({ error: "Agent Q&A is disabled by the project owner." }, 403);
        }

        let materials = [];
        if (project.agent_qa_scope === "gist_and_materials") {
          const matRes = await env.DB.prepare(
            "SELECT id, kind, level, title, body, source_note FROM learning_materials WHERE project_id = ? ORDER BY created_at DESC",
          ).bind(projectId).all();
          materials = matRes.results;
        }

        const { answer, sources } = buildScopedQaAnswer(
          project,
          materials,
          question,
          membership.experience_level || "mid",
        );

        await env.DB.prepare(
          "INSERT INTO agent_qa_logs (id, project_id, member_id, question, answer, scope_used) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(newId(), projectId, membership.id, question, answer, project.agent_qa_scope).run();

        return json({ answer, sources, scope_used: project.agent_qa_scope });
      }

      const user = await getSessionUser(request, env);
      if (!user) return json({ error: "Sign in to continue." }, 401);

      if (url.pathname === "/api/projects" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT p.id, p.name, p.gist, p.seat_limit, p.agent_qa_enabled, p.agent_qa_scope, p.created_at,
                  m.role AS my_role, m.experience_level AS my_experience_level,
                  CASE WHEN m.role = 'owner' THEN p.claim_code ELSE NULL END AS claim_code,
                  CASE WHEN m.role = 'owner' THEN p.claim_code_expires_at ELSE NULL END AS claim_code_expires_at,
                  (SELECT COUNT(*) FROM members m2 WHERE m2.project_id = p.id) AS member_count
           FROM projects p
           JOIN members m ON m.project_id = p.id
           WHERE m.user_id = ?
           ORDER BY p.created_at DESC
           LIMIT 20`,
        ).bind(user.id).all();
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
        const expiresAt = claimCodeExpiryIso(7);

        await env.DB.prepare(
          "INSERT INTO projects (id, name, gist, seat_limit, claim_code, claim_code_expires_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, name, gist, seatLimit, code, expiresAt, user.id).run();

        await env.DB.prepare(
          "INSERT INTO members (id, project_id, user_id, display_name, role, experience_level) VALUES (?, ?, ?, ?, 'owner', 'senior')",
        ).bind(newId(), id, user.id, user.display_name).run();

        return json({
          project: {
            id,
            name,
            gist,
            seat_limit: seatLimit,
            claim_code: code,
            claim_code_expires_at: expiresAt,
            agent_qa_enabled: 0,
            agent_qa_scope: "gist_and_materials",
            my_role: "owner",
            my_experience_level: "senior",
            member_count: 1,
          },
        }, 201);
      }

      if (url.pathname === "/api/join" && request.method === "POST") {
        const body = await request.json();
        const code = String(body.code || "").trim().toUpperCase();
        const displayName = String(body.displayName || user.display_name || "").trim().slice(0, 80);
        if (!code || !displayName) return json({ error: "Enter your name and team claim code." }, 400);

        const project = await env.DB.prepare("SELECT * FROM projects WHERE claim_code = ?").bind(code).first();
        if (!project) return json({ error: "That claim code was not found." }, 404);

        if (project.claim_code_expires_at && project.claim_code_expires_at <= new Date().toISOString()) {
          return json({ error: "This claim code has expired. Ask the project owner for a new one." }, 410);
        }

        const existingMember = await getMembership(env, project.id, user.id);
        if (existingMember) return json({ error: "You are already a member of this project." }, 409);

        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM members WHERE project_id = ?").bind(project.id).first();
        if (count.count >= project.seat_limit) return json({ error: "This project has reached its seat limit." }, 409);

        const member = { id: newId(), project_id: project.id, user_id: user.id, display_name: displayName, role: "member", experience_level: "mid" };
        await env.DB.prepare(
          "INSERT INTO members (id, project_id, user_id, display_name, role, experience_level) VALUES (?, ?, ?, ?, 'member', 'mid')",
        ).bind(member.id, project.id, user.id, displayName).run();

        return json({ project: { id: project.id, name: project.name, gist: project.gist }, member }, 201);
      }

      const projectDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectDetailMatch && request.method === "GET") {
        const projectId = projectDetailMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const project = await env.DB.prepare(
          `SELECT id, name, gist, seat_limit, agent_qa_enabled, agent_qa_scope, created_at,
                  CASE WHEN ? = 'owner' THEN claim_code ELSE NULL END AS claim_code,
                  CASE WHEN ? = 'owner' THEN claim_code_expires_at ELSE NULL END AS claim_code_expires_at,
                  (SELECT COUNT(*) FROM members WHERE project_id = projects.id) AS member_count
           FROM projects WHERE id = ?`,
        ).bind(membership.role, membership.role, projectId).first();
        if (!project) return json({ error: "Project not found." }, 404);

        return json({
          project: {
            ...project,
            my_role: membership.role,
            my_experience_level: membership.experience_level || "mid",
          },
        });
      }

      if (projectDetailMatch && request.method === "PATCH") {
        const projectId = projectDetailMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);
        if (membership.role !== "owner") return json({ error: "Only the project owner can update project settings." }, 403);

        const existing = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
        if (!existing) return json({ error: "Project not found." }, 404);

        const body = await request.json();
        const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : existing.name;
        const gist = body.gist !== undefined ? String(body.gist).trim().slice(0, 4000) : existing.gist;
        const seatLimit = body.seatLimit !== undefined ? Math.max(1, Math.min(100, Number(body.seatLimit) || existing.seat_limit)) : existing.seat_limit;
        const agentQaEnabled = body.agentQaEnabled !== undefined ? (body.agentQaEnabled ? 1 : 0) : existing.agent_qa_enabled;
        const agentQaScope = body.agentQaScope !== undefined && VALID_SCOPES.has(body.agentQaScope) ? body.agentQaScope : (existing.agent_qa_scope || "gist_and_materials");

        if (!name) return json({ error: "Project name cannot be empty." }, 400);

        await env.DB.prepare(
          "UPDATE projects SET name = ?, gist = ?, seat_limit = ?, agent_qa_enabled = ?, agent_qa_scope = ? WHERE id = ?",
        ).bind(name, gist, seatLimit, agentQaEnabled, agentQaScope, projectId).run();

        return json({
          project: {
            id: projectId,
            name,
            gist,
            seat_limit: seatLimit,
            agent_qa_enabled: agentQaEnabled,
            agent_qa_scope: agentQaScope,
          },
        });
      }

      const myLevelMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/my-level$/);
      if (myLevelMatch && request.method === "PATCH") {
        const projectId = myLevelMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const body = await request.json();
        const level = String(body.level || "").trim().toLowerCase();
        if (!VALID_MEMBER_LEVELS.has(level)) return json({ error: "Choose junior, mid, or senior." }, 400);

        await env.DB.prepare("UPDATE members SET experience_level = ? WHERE id = ?").bind(level, membership.id).run();
        return json({ level });
      }

      const rotateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/rotate-code$/);
      if (rotateMatch && request.method === "POST") {
        const projectId = rotateMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);
        if (membership.role !== "owner") return json({ error: "Only the project owner can rotate the claim code." }, 403);

        const code = newClaimCode();
        const expiresAt = claimCodeExpiryIso(7);
        await env.DB.prepare(
          "UPDATE projects SET claim_code = ?, claim_code_expires_at = ? WHERE id = ?",
        ).bind(code, expiresAt, projectId).run();

        return json({ claim_code: code, claim_code_expires_at: expiresAt });
      }

      const membersMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/members$/);
      if (membersMatch && request.method === "GET") {
        const projectId = membersMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const { results } = await env.DB.prepare(
          `SELECT m.id, m.display_name, m.role, m.experience_level, m.joined_at, u.email
           FROM members m
           LEFT JOIN users u ON u.id = m.user_id
           WHERE m.project_id = ?
           ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.joined_at ASC`,
        ).bind(projectId).all();

        return json({ members: results, my_role: membership.role });
      }

      const memberDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)$/);
      if (memberDeleteMatch && request.method === "DELETE") {
        const [, projectId, memberId] = memberDeleteMatch;
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);
        if (membership.role !== "owner") return json({ error: "Only the project owner can remove members." }, 403);

        const target = await env.DB.prepare(
          "SELECT id, role FROM members WHERE id = ? AND project_id = ?",
        ).bind(memberId, projectId).first();
        if (!target) return json({ error: "Member not found." }, 404);
        if (target.role === "owner") return json({ error: "Project owner cannot be removed." }, 400);

        await env.DB.prepare("DELETE FROM members WHERE id = ? AND project_id = ?").bind(memberId, projectId).run();
        return json({ ok: true });
      }

      const projectMatsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/materials$/);
      if (projectMatsMatch && request.method === "GET") {
        const projectId = projectMatsMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const project = await env.DB.prepare(
          "SELECT id, name, gist, source_label, published FROM projects WHERE id = ?",
        ).bind(projectId).first();
        if (!project) return json({ error: "Project not found." }, 404);

        const { results } = await env.DB.prepare(
          "SELECT id, kind, level, title, body, answer_key, source_note, created_at FROM learning_materials WHERE project_id = ? ORDER BY created_at DESC",
        ).bind(projectId).all();
        return json({ project, materials: results });
      }

      const attemptsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/attempts$/);
      if (attemptsMatch && request.method === "POST") {
        const projectId = attemptsMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const body = await request.json();
        const materialId = String(body.materialId || "").trim();
        const answers = Array.isArray(body.answers) ? body.answers : [];
        const material = await env.DB.prepare(
          "SELECT id, body FROM learning_materials WHERE id = ? AND project_id = ?",
        ).bind(materialId, projectId).first();
        if (!material) return json({ error: "Quiz not found." }, 404);

        const quiz = JSON.parse(material.body);
        const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
        let score = 0;
        const feedback = questions.map((q, i) => {
          const correct = Number(answers[i]) === Number(q.correctIndex);
          if (correct) score += 1;
          return { correct, explanation: q.explanation || "" };
        });

        await env.DB.prepare(
          "INSERT INTO quiz_attempts (id, project_id, material_id, learner_id, score, total, answers_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(newId(), projectId, materialId, membership.id, score, questions.length, JSON.stringify(answers)).run();

        return json({ score, total: questions.length, feedback });
      }

      if (url.pathname === "/api/materials" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return json({ error: "projectId is required." }, 400);
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const { results } = await env.DB.prepare(
          `SELECT lm.id, lm.kind, lm.level, lm.title, lm.body, lm.answer_key, lm.source_note, lm.created_at,
                  lp.status AS progress_status, lp.response_text AS my_response, lp.completed_at
           FROM learning_materials lm
           LEFT JOIN learning_progress lp ON lp.material_id = lm.id AND lp.member_id = ?
           WHERE lm.project_id = ?
           ORDER BY lm.created_at DESC`,
        ).bind(membership.id, projectId).all();
        return json({ materials: results });
      }

      if (url.pathname === "/api/materials" && request.method === "POST") {
        const body = await request.json();
        const projectId = String(body.projectId || "").trim();
        const kind = String(body.kind || "guide").trim().toLowerCase();
        const level = String(body.level || "all").trim().toLowerCase();
        const title = String(body.title || "").trim().slice(0, 140);
        const content = String(body.body || "").trim().slice(0, 8000);
        const answerKey = String(body.answerKey || "").trim().slice(0, 2000);
        const sourceNote = String(body.sourceNote || "").trim().slice(0, 300);

        if (!projectId) return json({ error: "projectId is required." }, 400);
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);
        if (membership.role !== "owner") return json({ error: "Only the project owner can add learning materials." }, 403);
        if (!VALID_KINDS.has(kind)) return json({ error: "Invalid material kind." }, 400);
        if (!VALID_LEVELS.has(level)) return json({ error: "Invalid material level." }, 400);
        if (!title || !content) return json({ error: "Title and content are required." }, 400);

        const id = newId();
        await env.DB.prepare(
          "INSERT INTO learning_materials (id, project_id, kind, level, title, body, answer_key, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, projectId, kind, level, title, content, answerKey, sourceNote).run();

        return json({
          material: { id, project_id: projectId, kind, level, title, body: content, answer_key: answerKey, source_note: sourceNote },
        }, 201);
      }

      const materialMatch = url.pathname.match(/^\/api\/materials\/([^/]+)$/);
      if (materialMatch && request.method === "PATCH") {
        const materialId = materialMatch[1];
        const material = await env.DB.prepare("SELECT * FROM learning_materials WHERE id = ?").bind(materialId).first();
        if (!material) return json({ error: "Material not found." }, 404);
        const membership = await getMembership(env, material.project_id, user.id);
        if (!membership || membership.role !== "owner") return json({ error: "Only the project owner can edit materials." }, 403);

        const body = await request.json();
        const kind = body.kind !== undefined ? String(body.kind).trim().toLowerCase() : material.kind;
        const level = body.level !== undefined ? String(body.level).trim().toLowerCase() : material.level;
        const title = body.title !== undefined ? String(body.title).trim().slice(0, 140) : material.title;
        const content = body.body !== undefined ? String(body.body).trim().slice(0, 8000) : material.body;
        const answerKey = body.answerKey !== undefined ? String(body.answerKey).trim().slice(0, 2000) : material.answer_key;
        const sourceNote = body.sourceNote !== undefined ? String(body.sourceNote).trim().slice(0, 300) : material.source_note;

        if (!VALID_KINDS.has(kind)) return json({ error: "Invalid material kind." }, 400);
        if (!VALID_LEVELS.has(level)) return json({ error: "Invalid material level." }, 400);
        if (!title || !content) return json({ error: "Title and content are required." }, 400);

        await env.DB.prepare(
          "UPDATE learning_materials SET kind = ?, level = ?, title = ?, body = ?, answer_key = ?, source_note = ? WHERE id = ?",
        ).bind(kind, level, title, content, answerKey, sourceNote, materialId).run();

        return json({
          material: { id: materialId, project_id: material.project_id, kind, level, title, body: content, answer_key: answerKey, source_note: sourceNote },
        });
      }

      if (materialMatch && request.method === "DELETE") {
        const materialId = materialMatch[1];
        const material = await env.DB.prepare("SELECT id, project_id FROM learning_materials WHERE id = ?").bind(materialId).first();
        if (!material) return json({ error: "Material not found." }, 404);
        const membership = await getMembership(env, material.project_id, user.id);
        if (!membership || membership.role !== "owner") return json({ error: "Only the project owner can remove materials." }, 403);

        await env.DB.prepare("DELETE FROM learning_materials WHERE id = ?").bind(materialId).run();
        return json({ ok: true });
      }

      const progressMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/progress$/);
      if (progressMatch && request.method === "POST") {
        const projectId = progressMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const body = await request.json();
        const materialId = String(body.materialId || "").trim();
        const responseText = String(body.responseText || "").trim().slice(0, 4000);
        if (!materialId) return json({ error: "materialId is required." }, 400);

        const mat = await env.DB.prepare("SELECT id FROM learning_materials WHERE id = ? AND project_id = ?").bind(materialId, projectId).first();
        if (!mat) return json({ error: "Learning material not found." }, 404);

        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO learning_progress (id, project_id, member_id, material_id, status, response_text, completed_at)
           VALUES (?, ?, ?, ?, 'completed', ?, ?)
           ON CONFLICT(member_id, material_id) DO UPDATE SET response_text = excluded.response_text, completed_at = excluded.completed_at`,
        ).bind(newId(), projectId, membership.id, materialId, responseText, now).run();

        return json({ ok: true, completed_at: now });
      }

      if (url.pathname === "/api/agent/device/start" && request.method === "POST") {
        const body = await request.json();
        const projectId = String(body.projectId || "").trim();
        const label = String(body.label || "Local Agent").trim().slice(0, 60) || "Local Agent";
        if (!projectId) return json({ error: "projectId is required." }, 400);

        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const deviceCode = toHex(crypto.getRandomValues(new Uint8Array(24)));
        const deviceCodeHash = await sha256Hex(deviceCode);
        const userCode = newUserCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const id = newId();

        await env.DB.prepare(
          "INSERT INTO agent_connections (id, project_id, member_id, device_code_hash, status, expires_at, label, user_code) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
        ).bind(id, projectId, membership.id, deviceCodeHash, expiresAt, label, userCode).run();

        return json({ connectionId: id, userCode, deviceCode, expiresAt }, 201);
      }

      if (url.pathname === "/api/agent/device/approve" && request.method === "POST") {
        const body = await request.json();
        const userCode = String(body.userCode || "").trim().toUpperCase();
        if (!userCode) return json({ error: "Enter the device user code." }, 400);

        const conn = await env.DB.prepare(
          "SELECT id, project_id, member_id, status, expires_at FROM agent_connections WHERE user_code = ? AND status = 'pending'",
        ).bind(userCode).first();
        if (!conn) return json({ error: "Pending device code not found." }, 404);
        if (conn.expires_at <= new Date().toISOString()) {
          return json({ error: "This device code has expired. Start a new connection." }, 410);
        }

        const membership = await getMembership(env, conn.project_id, user.id);
        if (!membership || (membership.id !== conn.member_id && membership.role !== "owner")) {
          return json({ error: "You are not authorized to approve this device code." }, 403);
        }

        await env.DB.prepare("UPDATE agent_connections SET status = 'active' WHERE id = ?").bind(conn.id).run();
        return json({ ok: true, connectionId: conn.id });
      }

      const agentConnsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent-connections$/);
      if (agentConnsMatch && request.method === "GET") {
        const projectId = agentConnsMatch[1];
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const connQuery = membership.role === "owner"
          ? `SELECT ac.id, ac.label, ac.user_code, ac.status, ac.expires_at, ac.last_used_at, ac.created_at, m.display_name AS member_name
             FROM agent_connections ac JOIN members m ON m.id = ac.member_id
             WHERE ac.project_id = ? ORDER BY ac.created_at DESC`
          : `SELECT ac.id, ac.label, ac.user_code, ac.status, ac.expires_at, ac.last_used_at, ac.created_at, m.display_name AS member_name
             FROM agent_connections ac JOIN members m ON m.id = ac.member_id
             WHERE ac.project_id = ? AND ac.member_id = ? ORDER BY ac.created_at DESC`;

        const conns = membership.role === "owner"
          ? await env.DB.prepare(connQuery).bind(projectId).all()
          : await env.DB.prepare(connQuery).bind(projectId, membership.id).all();

        let logs = [];
        if (membership.role === "owner") {
          const logRes = await env.DB.prepare(
            `SELECT l.id, l.question, l.scope_used, l.created_at, m.display_name AS member_name
             FROM agent_qa_logs l JOIN members m ON m.id = l.member_id
             WHERE l.project_id = ? ORDER BY l.created_at DESC LIMIT 20`,
          ).bind(projectId).all();
          logs = logRes.results;
        }

        return json({ connections: conns.results, logs, my_role: membership.role });
      }

      const agentConnDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent-connections\/([^/]+)$/);
      if (agentConnDeleteMatch && request.method === "DELETE") {
        const [, projectId, connId] = agentConnDeleteMatch;
        const membership = await getMembership(env, projectId, user.id);
        if (!membership) return json({ error: "Project not found." }, 404);

        const conn = await env.DB.prepare(
          "SELECT id, member_id FROM agent_connections WHERE id = ? AND project_id = ?",
        ).bind(connId, projectId).first();
        if (!conn) return json({ error: "Connection not found." }, 404);
        if (membership.role !== "owner" && conn.member_id !== membership.id) {
          return json({ error: "Not authorized to revoke this connection." }, 403);
        }

        await env.DB.prepare("UPDATE agent_connections SET status = 'revoked' WHERE id = ?").bind(connId).run();
        return json({ ok: true });
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error("API request failed", error);
      return json({ error: "The request could not be completed." }, 500);
    }
  },
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-agent-device-code",
  };
}
