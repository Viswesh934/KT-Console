import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const environmentKey = process.env.FLAGSMITH_ENVIRONMENT_ID?.trim();
if (!environmentKey) {
  console.error("FLAGSMITH_ENVIRONMENT_ID is missing. Add it to .env and retry.");
  process.exit(1);
}

try {
  const response = await fetch("https://edge.api.flagsmith.com/api/v1/flags/", {
    headers: { "X-Environment-Key": environmentKey, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    console.error(`Flagsmith connection failed (HTTP ${response.status}). Check the Environment API Key and try again.`);
    process.exit(1);
  }

  const flags = await response.json();
  const count = Array.isArray(flags) ? flags.length : 0;
  console.log(`Flagsmith connection successful. Environment returned ${count} flag${count === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(`Could not reach Flagsmith: ${error.name}. Check network access and retry.`);
  process.exit(1);
}
