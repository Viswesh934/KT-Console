const api = async (path, options) => {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const projectDialog = document.querySelector("#project-dialog");
const joinDialog = document.querySelector("#join-dialog");
const successDialog = document.querySelector("#success-dialog");
const toast = (message) => { const el = document.querySelector("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2400); };

document.querySelectorAll("#new-project,#hero-create").forEach((button) => button.addEventListener("click", () => projectDialog.showModal()));
document.querySelector("#join-project").addEventListener("click", () => joinDialog.showModal());
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));

async function loadProjects() {
  const list = document.querySelector("#project-list");
  try {
    const { projects } = await api("/api/projects");
    if (!projects.length) {
      list.innerHTML = `<div class="empty-card"><div class="empty-copy"><strong>Your first project starts here</strong><p>Create a space for your team to learn the project together.</p></div><button class="button button-primary" id="empty-create">Create a project <span>→</span></button></div>`;
      document.querySelector("#empty-create").addEventListener("click", () => projectDialog.showModal());
      return;
    }
    list.innerHTML = projects.map((project) => `<article class="project-card" data-project="${project.id}"><div class="project-top"><div class="project-initial">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</div><span class="project-tag">YOUR PROJECT</span></div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.gist || "Add a project overview to help your team get oriented.")}</p><div class="project-meta"><span>${project.seat_limit} team seats</span><span>Open project →</span></div></article>`).join("");
    list.querySelectorAll("[data-project]").forEach((card) => card.addEventListener("click", () => { location.hash = `project/${card.dataset.project}`; toast("Project view is coming in the next slice."); }));
  } catch (error) { list.innerHTML = `<div class="loading-card">${escapeHtml(error.message)} Check that the local D1 database is configured.</div>`; }
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }

document.querySelector("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#form-error");
  error.textContent = "";
  try {
    const result = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: data.name, gist: data.gist, seatLimit: Number(data.seatLimit) }) });
    projectDialog.close(); form.reset();
    document.querySelector("#success-title").textContent = `${result.project.name} is ready`;
    document.querySelector("#claim-code").textContent = result.project.claim_code;
    document.querySelector("#copy-code").dataset.code = result.project.claim_code;
    successDialog.showModal(); await loadProjects();
  } catch (cause) { error.textContent = cause.message; }
});

document.querySelector("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  try { const result = await api("/api/join", { method: "POST", body: JSON.stringify(data) }); joinDialog.close(); form.reset(); toast(`You joined ${result.project.name}.`); await loadProjects(); }
  catch (cause) { document.querySelector("#join-error").textContent = cause.message; }
});

document.querySelector("#copy-code").addEventListener("click", async (event) => { await navigator.clipboard.writeText(event.currentTarget.dataset.code); toast("Claim code copied."); });

async function initFlags() {
  try {
    const { flagsmithEnvironmentId } = await api("/api/config");
    if (!flagsmithEnvironmentId || !window.flagsmith) return;
    window.flagsmith.init({ environmentID: flagsmithEnvironmentId, onChange: () => {
      document.documentElement.dataset.flagsReady = "true";
      document.documentElement.dataset.agentQa = String(window.flagsmith.hasFeature("agent_qa"));
      document.documentElement.dataset.roleTracks = String(window.flagsmith.hasFeature("role_tracks"));
      document.documentElement.dataset.guidedSessions = String(window.flagsmith.hasFeature("guided_sessions"));
    } });
  } catch { /* Flags have safe UI defaults until the Flagsmith key is configured. */ }
}

loadProjects();
initFlags();
