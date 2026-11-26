const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const newId = () => crypto.randomUUID();
const materialKinds = new Set(["guide", "edge_case", "thinking", "quiz"]);
const levels = new Set(["all", "junior", "mid", "senior"]);

function authorized(request, env) {
  const expected = env.KT_CONSOLE_MCP_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

async function requireOwner(request, env) {
  return authorized(request, env) ? null : json({ error: "MCP authorization required." }, 401);
}

function learnerMaterial(row) {
  if (row.kind !== "quiz") return { ...row };
  let quiz;
  try { quiz = JSON.parse(row.body); } catch { return { ...row, body: "{}" }; }
  return {
    ...row,
    body: JSON.stringify({ questions: (quiz.questions || []).map(({ prompt, options }) => ({ prompt, options })) }),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/learning.html", url), request));
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({ flagsmithEnvironmentId: env.FLAGSMITH_ENVIRONMENT_ID || "" });
      }

      if (url.pathname === "/api/projects" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id,name,gist,source_label,created_at FROM projects WHERE published=1 ORDER BY created_at DESC LIMIT 50",
        ).all();
        return json({ projects: results });
      }

      if (url.pathname === "/api/mcp/projects" && request.method === "POST") {
        const denied = await requireOwner(request, env);
        if (denied) return denied;
        const body = await request.json();
        const name = String(body.name || "").trim().slice(0, 100);
        const gist = String(body.gist || "").trim().slice(0, 6000);
        const sourceLabel = String(body.sourceLabel || "Connected workspace").trim().slice(0, 120);
        if (name.length < 2 || gist.length < 20) return json({ error: "Project name and a useful project gist are required." }, 400);
        const id = newId();
        await env.DB.prepare("INSERT INTO projects (id,name,gist,source_label,published) VALUES (?,?,?,?,0)")
          .bind(id, name, gist, sourceLabel).run();
        return json({ project: { id, name, gist, source_label: sourceLabel, published: false } }, 201);
      }

      if (url.pathname === "/api/mcp/projects" && request.method === "GET") {
        const denied = await requireOwner(request, env);
        if (denied) return denied;
        const { results } = await env.DB.prepare(
          "SELECT id,name,gist,source_label,published,created_at FROM projects ORDER BY created_at DESC LIMIT 100",
        ).all();
        return json({ projects: results });
      }

      const ownerScores = url.pathname.match(/^\/api\/mcp\/projects\/([0-9a-f-]+)\/scores$/i);
      if (ownerScores && request.method === "GET") {
        const denied = await requireOwner(request, env);
        if (denied) return denied;
        const { results } = await env.DB.prepare(
          "SELECT learner_id,score,total,completed_at FROM quiz_attempts WHERE project_id=? ORDER BY completed_at DESC LIMIT 500",
        ).bind(ownerScores[1]).all();
        return json({ attempts: results });
      }

      const mcpProject = url.pathname.match(/^\/api\/mcp\/projects\/([0-9a-f-]+)(?:\/(materials|publish))?$/i);
      if (mcpProject) {
        const denied = await requireOwner(request, env);
        if (denied) return denied;
        const projectId = mcpProject[1];
        const action = mcpProject[2] || "project";

        const project = await env.DB.prepare("SELECT id,name,gist,source_label,published FROM projects WHERE id=?").bind(projectId).first();
        if (!project) return json({ error: "Project not found." }, 404);
        if (action === "project" && request.method === "GET") return json({ project });

        if (action === "materials" && request.method === "POST") {
          const body = await request.json();
          const kind = String(body.kind || "");
          const level = String(body.level || "all");
          const title = String(body.title || "").trim().slice(0, 160);
          const content = String(body.content || "").trim();
          if (!materialKinds.has(kind) || !levels.has(level) || title.length < 3 || content.length < 10 || content.length > 18000) {
            return json({ error: "Material kind, level, title, or content is invalid." }, 400);
          }
          if (kind === "quiz") {
            let quiz;
            try { quiz = JSON.parse(content); } catch { return json({ error: "Quiz content must be valid JSON." }, 400); }
            if (!Array.isArray(quiz.questions) || quiz.questions.length < 1 || quiz.questions.length > 20) {
              return json({ error: "A quiz needs between 1 and 20 questions." }, 400);
            }
            const valid = quiz.questions.every((question) => Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 6 &&
              typeof question.prompt === "string" && question.prompt.length <= 1000 && Number.isInteger(question.correctIndex) &&
              question.correctIndex >= 0 && question.correctIndex < question.options.length && question.options.every((option) => typeof option === "string" && option.length <= 500));
            if (!valid) return json({ error: "Each quiz question needs a prompt, 2–6 options, and a valid correctIndex." }, 400);
          }
          const id = newId();
          await env.DB.prepare("INSERT INTO learning_materials (id,project_id,kind,level,title,body) VALUES (?,?,?,?,?,?)")
            .bind(id, projectId, kind, level, title, content).run();
          return json({ material: { id, project_id: projectId, kind, level, title } }, 201);
        }

        if (action === "publish" && request.method === "POST") {
          const { results } = await env.DB.prepare("SELECT kind FROM learning_materials WHERE project_id=?").bind(projectId).all();
          const hasGuide = results.some((item) => item.kind === "guide" || item.kind === "edge_case");
          const hasQuiz = results.some((item) => item.kind === "quiz");
          if (!hasGuide || !hasQuiz) return json({ error: "Add at least one project guide or edge case and one quiz before publishing." }, 409);
          await env.DB.prepare("UPDATE projects SET published=1 WHERE id=?").bind(projectId).run();
          return json({ project: { ...project, published: true } });
        }
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)(?:\/(materials|attempts))?$/i);
      if (projectMatch) {
        const projectId = projectMatch[1];
        const action = projectMatch[2] || "project";
        const project = await env.DB.prepare("SELECT id,name,gist,source_label,created_at FROM projects WHERE id=? AND published=1").bind(projectId).first();
        if (!project) return json({ error: "Project not found." }, 404);
        if (action === "project" && request.method === "GET") return json({ project });

        if (action === "materials" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id,kind,level,title,body,created_at FROM learning_materials WHERE project_id=? ORDER BY CASE kind WHEN 'guide' THEN 1 WHEN 'edge_case' THEN 2 WHEN 'thinking' THEN 3 ELSE 4 END, created_at",
          ).bind(projectId).all();
          return json({ project, materials: results.map(learnerMaterial) });
        }

        if (action === "attempts" && request.method === "POST") {
          const body = await request.json();
          const learnerId = String(body.learnerId || "");
          const materialId = String(body.materialId || "");
          const answers = body.answers;
          if (!/^[A-Za-z0-9_-]{12,80}$/.test(learnerId) || !Array.isArray(answers) || answers.length > 20) {
            return json({ error: "Learner session or submitted answers are invalid." }, 400);
          }
          const material = await env.DB.prepare("SELECT id,body FROM learning_materials WHERE id=? AND project_id=? AND kind='quiz'")
            .bind(materialId, projectId).first();
          if (!material) return json({ error: "Quiz not found." }, 404);
          const quiz = JSON.parse(material.body);
          if (answers.length !== quiz.questions.length || answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 5)) {
            return json({ error: "Answer one option for every quiz question." }, 400);
          }
          const score = quiz.questions.reduce((sum, question, index) => sum + (answers[index] === question.correctIndex ? 1 : 0), 0);
          const id = newId();
          await env.DB.prepare("INSERT INTO quiz_attempts (id,project_id,material_id,learner_id,score,total,answers_json) VALUES (?,?,?,?,?,?,?)")
            .bind(id, projectId, materialId, learnerId, score, quiz.questions.length, JSON.stringify(answers)).run();
          return json({ attemptId: id, score, total: quiz.questions.length, feedback: quiz.questions.map((question, index) => ({
            correct: answers[index] === question.correctIndex,
            correctIndex: question.correctIndex,
            explanation: question.explanation || "",
          })) }, 201);
        }
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error("API request failed", error);
      return json({ error: "The request could not be completed." }, 500);
    }
  },
};

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" };
}
