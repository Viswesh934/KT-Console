import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try { loadEnvFile(resolve(projectRoot, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }

const apiBase = (process.env.KT_CONSOLE_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const apiToken = process.env.KT_CONSOLE_MCP_TOKEN;

async function callApi(path, options = {}) {
  if (!apiToken) throw new Error("Set KT_CONSOLE_MCP_TOKEN in the MCP host environment.");
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `KT Console API returned HTTP ${response.status}.`);
  return data;
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function createServer() {
  const server = new McpServer({ name: "kt-console", version: "0.1.0" });

  server.registerTool("list_projects", {
    title: "List KT projects",
    description: "List projects created by this KT Console MCP connection, including unpublished drafts.",
    inputSchema: z.object({}),
  }, async () => textResult(await callApi("/api/mcp/projects")));

  server.registerTool("get_project", {
    title: "Get KT project details",
    description: "Read the project gist and publication state for a KT project.",
    inputSchema: z.object({ projectId: z.string().uuid() }),
  }, async ({ projectId }) => textResult(await callApi(`/api/mcp/projects/${projectId}`)));

  server.registerTool("create_project", {
    title: "Create a KT project",
    description: "Create a private KT project from the connected workspace gist. Infer the project name and overview from context; do not ask the user to fill a setup form. This creates an unpublished learner space.",
    inputSchema: z.object({
      name: z.string().min(2).max(100),
      gist: z.string().min(20).max(6000),
      sourceLabel: z.string().max(120).optional(),
    }),
  }, async ({ name, gist, sourceLabel }) => textResult(await callApi("/api/mcp/projects", {
    method: "POST",
    body: JSON.stringify({ name, gist, sourceLabel }),
  })));

  server.registerTool("add_learning_material", {
    title: "Add KT learning material",
    description: "Save a guide, edge case, thinking session, or quiz to an unpublished KT project. Use only the approved project gist and relevant workspace context. For quiz content, provide JSON: {\"questions\":[{\"prompt\":\"...\",\"options\":[\"...\",\"...\"],\"correctIndex\":0,\"explanation\":\"...\"}]}. Correct answers are withheld from learners until they submit.",
    inputSchema: z.object({
      projectId: z.string().uuid(),
      kind: z.enum(["guide", "edge_case", "thinking", "quiz"]),
      level: z.enum(["all", "junior", "mid", "senior"]),
      title: z.string().min(3).max(160),
      content: z.string().min(10).max(18000),
    }),
  }, async ({ projectId, kind, level, title, content }) => textResult(await callApi(`/api/mcp/projects/${projectId}/materials`, {
    method: "POST",
    body: JSON.stringify({ kind, level, title, content }),
  })));

  server.registerTool("publish_project", {
    title: "Publish KT project",
    description: "Publish a prepared KT project to its learner view. The project must have at least one guide or edge case and at least one quiz. Publishing does not create invitations or claim codes.",
    inputSchema: z.object({ projectId: z.string().uuid() }),
  }, async ({ projectId }) => textResult(await callApi(`/api/mcp/projects/${projectId}/publish`, { method: "POST", body: "{}" })));

  server.registerTool("get_project_scores", {
    title: "Review KT learner scores",
    description: "Return quiz scores by anonymous learner ID for a project. No names or workspace data are included.",
    inputSchema: z.object({ projectId: z.string().uuid() }),
  }, async ({ projectId }) => textResult(await callApi(`/api/mcp/projects/${projectId}/scores`)));

  return server;
}

serveStdio(createServer);
