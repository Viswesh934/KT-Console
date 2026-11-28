import { flagsmithClient } from "./flagsmith-client.js";

const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
let activeProject = null;
let activeMaterials = [];
let activeLevel = "all";

function learnerId() {
  const key = "kt-console-learner-id";
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

async function loadProjects() {
  const list = $("#project-list");
  try {
    const { projects } = await api("/api/projects");
    if (!projects.length) {
      list.innerHTML = `<div class="empty-card"><div class="empty-copy"><strong>Your learning space is being prepared</strong><p>Your connected agent will prepare and publish project material here. There is nothing to fill in to get started.</p></div><span class="project-tag">PREPARING</span></div>`;
      return;
    }
    list.innerHTML = projects.map((project) => `<button class="project-card" data-project="${escapeHtml(project.id)}" type="button"><div class="project-top"><div class="project-initial">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</div><span class="project-tag">READY TO LEARN</span></div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.gist)}</p><div class="project-meta"><span>${escapeHtml(project.source_label || "Team project")}</span><span>Open learning space →</span></div></button>`).join("");
    list.querySelectorAll("[data-project]").forEach((card) => card.addEventListener("click", () => openProject(card.dataset.project)));
  } catch (error) { list.innerHTML = `<div class="loading-card">${escapeHtml(error.message)} The learning space is temporarily unavailable.</div>`; }
}

async function openProject(projectId) {
  try {
    const { project, materials } = await api(`/api/projects/${encodeURIComponent(projectId)}/materials`);
    activeProject = project; activeMaterials = materials; activeLevel = "all";
    $("#dashboard").hidden = true; $("#project-view").hidden = false;
    $("#project-name").textContent = project.name;
    $("#project-gist").textContent = project.gist;
    $("#project-source").textContent = project.source_label || "Prepared from the connected workspace";
    history.replaceState(null, "", `#project/${encodeURIComponent(projectId)}`);
    renderMaterials(); window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) { showToast(error.message); }
}

function renderMaterials() {
  const roleTracks = document.documentElement.dataset.roleTracks === "true";
  const guidedSessions = document.documentElement.dataset.guidedSessions === "true";
  const level = roleTracks ? activeLevel : "all";
  const visible = activeMaterials.filter((item) => (item.level === "all" || item.level === level) && (guidedSessions || item.kind !== "thinking"));
  $("#level-filter").hidden = !roleTracks;
  $("#level-filter").querySelectorAll("[data-level]").forEach((button) => button.classList.toggle("active", button.dataset.level === activeLevel));
  const labels = { guide: "Guide", edge_case: "Edge case", thinking: "Thinking", quiz: "Quiz" };
  $("#material-list").innerHTML = visible.length ? visible.map((item) => `<button class="material-row" data-material="${escapeHtml(item.id)}" type="button"><span class="material-kind">${labels[item.kind] || "Learning"}</span><span class="material-title">${escapeHtml(item.title)}</span><span class="material-level">${item.level === "all" ? "Everyone" : escapeHtml(item.level)}</span><span class="material-arrow" aria-hidden="true">→</span></button>`).join("") : `<div class="material-empty">No material is available for this track yet.</div>`;
  $("#material-list").querySelectorAll("[data-material]").forEach((button) => button.addEventListener("click", () => openMaterial(button.dataset.material)));
  $("#material-content").hidden = true; $("#quiz-feedback").hidden = true;
}

function openMaterial(id) {
  const material = activeMaterials.find((item) => item.id === id);
  if (!material) return;
  $("#material-content").hidden = false; $("#quiz-feedback").hidden = true;
  $("#material-title").textContent = material.title;
  $("#material-kind").textContent = material.kind.replaceAll("_", " ");
  if (material.kind === "quiz") renderQuiz(material);
  else $("#material-body").innerHTML = `<pre class="material-prose">${escapeHtml(material.body)}</pre>`;
  $("#material-content").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuiz(material) {
  const quiz = JSON.parse(material.body);
  $("#material-body").innerHTML = `<form class="quiz-form" id="quiz-form">${quiz.questions.map((question, i) => `<fieldset class="quiz-question"><legend><span class="question-number">${String(i + 1).padStart(2, "0")}</span>${escapeHtml(question.prompt)}</legend><div class="quiz-options">${question.options.map((option, n) => `<label class="quiz-option"><input type="radio" name="question-${i}" value="${n}" required /><span>${escapeHtml(option)}</span></label>`).join("")}</div></fieldset>`).join("")}<button class="button button-primary" type="submit">Check answers <span aria-hidden="true">→</span></button></form>`;
  $("#quiz-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const answers = quiz.questions.map((_, i) => Number(formData.get(`question-${i}`)));
    try {
      const result = await api(`/api/projects/${encodeURIComponent(activeProject.id)}/attempts`, { method: "POST", body: JSON.stringify({ learnerId: learnerId(), materialId: material.id, answers }) });
      renderFeedback(result);
    } catch (error) { showToast(error.message); }
  });
}

function renderFeedback(result) {
  const showExplanations = document.documentElement.dataset.quizFeedback === "true";
  $("#quiz-feedback").hidden = false;
  $("#quiz-feedback").innerHTML = `<div class="score-card"><div><p class="eyebrow">YOUR RESULT</p><strong>${result.score} <span>/ ${result.total}</span></strong></div><p>${result.score === result.total ? "Excellent work. You have this down." : "Good practice. Review the material and try again."}</p></div>${showExplanations ? `<div class="feedback-list">${result.feedback.map((item, index) => `<article class="feedback-item ${item.correct ? "correct" : "review"}"><strong>Question ${index + 1}: ${item.correct ? "Correct" : "Review"}</strong><p>${escapeHtml(item.explanation || "Keep exploring this part of the project.")}</p></article>`).join("")}</div>` : ""}`;
}

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

$("#back-to-projects").addEventListener("click", () => { activeProject = null; $("#project-view").hidden = true; $("#dashboard").hidden = false; history.replaceState(null, "", "#home"); window.scrollTo({ top: 0, behavior: "smooth" }); });
$("#level-filter").querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => { activeLevel = button.dataset.level; renderMaterials(); }));

async function initializeFlags() {
  try {
    const { flagsmithEnvironmentId } = await api("/api/config");
    if (!flagsmithClient.init(flagsmithEnvironmentId)) return;
    const update = () => {
      document.documentElement.dataset.roleTracks = String(flagsmithClient.hasFeature("role_tracks"));
      document.documentElement.dataset.guidedSessions = String(flagsmithClient.hasFeature("guided_sessions"));
      document.documentElement.dataset.quizFeedback = String(flagsmithClient.hasFeature("quiz_feedback"));
      document.documentElement.dataset.agentQa = String(flagsmithClient.hasFeature("agent_qa"));
      if (activeProject) renderMaterials();
    };
    flagsmithClient.subscribe(update); update();
  } catch { /* Features keep safe defaults until Flagsmith is reachable. */ }
}

loadProjects();
initializeFlags();
