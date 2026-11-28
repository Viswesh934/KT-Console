import { flagsmithClient } from "./flagsmith-client.js";

const api = async (path, options) => {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};

const projectDialog = document.querySelector("#project-dialog");
const joinDialog = document.querySelector("#join-dialog");
const successDialog = document.querySelector("#success-dialog");
const authDialog = document.querySelector("#auth-dialog");
const accessDialog = document.querySelector("#access-dialog");
const homeView = document.querySelector("#home-view");
const projectView = document.querySelector("#project-view");
const toast = (message) => {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
};

let currentUser = null;
let authMode = "login";
let activeProject = null;
let activeTab = "overview";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === mode);
  });
  const isRegister = mode === "register";
  const nameField = document.querySelector("#auth-name-field");
  const nameInput = nameField.querySelector("input");
  nameField.hidden = !isRegister;
  nameInput.required = isRegister;
  document.querySelector("#auth-title").textContent = isRegister ? "Create your account" : "Sign in to KT Console";
  document.querySelector("#auth-submit").innerHTML = isRegister ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  document.querySelector("#auth-error").textContent = "";
}

function openAuthDialog(mode = "login") {
  setAuthMode(mode);
  authDialog.showModal();
}

function renderAuthUI() {
  const avatar = document.querySelector("#profile-avatar");
  const name = document.querySelector("#profile-name");
  const email = document.querySelector("#profile-email");
  const actionBtn = document.querySelector("#auth-action");
  const welcomeTitle = document.querySelector("#welcome-title");

  if (currentUser) {
    const firstName = currentUser.display_name.split(/\s+/)[0] || currentUser.display_name;
    avatar.textContent = currentUser.display_name.slice(0, 1).toUpperCase();
    name.textContent = currentUser.display_name;
    email.textContent = currentUser.email;
    actionBtn.textContent = "Sign out";
    welcomeTitle.textContent = `Good morning, ${firstName}`;
    const joinNameInput = document.querySelector("#join-form input[name='displayName']");
    if (joinNameInput && !joinNameInput.value) joinNameInput.value = currentUser.display_name;
  } else {
    avatar.textContent = "?";
    name.textContent = "Not signed in";
    email.textContent = "Sign in to continue";
    actionBtn.textContent = "Sign in";
    welcomeTitle.textContent = "Welcome to KT Console";
  }
}

async function loadSession() {
  try {
    const { user } = await api("/api/auth/me");
    currentUser = user;
  } catch {
    currentUser = null;
  }
  renderAuthUI();
}

function requireSignedIn(callback) {
  if (!currentUser) {
    openAuthDialog("login");
    toast("Sign in to continue.");
    return;
  }
  callback();
}

document.querySelector("#auth-action").addEventListener("click", async () => {
  if (!currentUser) {
    openAuthDialog("login");
    return;
  }
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  activeProject = null;
  location.hash = "home";
  renderAuthUI();
  await handleRoute();
  toast("Signed out.");
});

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
});

document.querySelectorAll("#new-project,#hero-create").forEach((button) => {
  button.addEventListener("click", () => requireSignedIn(() => projectDialog.showModal()));
});

document.querySelector("#join-project").addEventListener("click", () => {
  requireSignedIn(() => {
    const joinNameInput = document.querySelector("#join-form input[name='displayName']");
    if (joinNameInput && currentUser) joinNameInput.value = currentUser.display_name;
    joinDialog.showModal();
  });
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

async function loadProjects() {
  const list = document.querySelector("#project-list");
  if (!currentUser) {
    list.innerHTML = `<div class="empty-card"><div class="empty-copy"><strong>Sign in to view your projects</strong><p>Create a workspace or join your team using a claim code.</p></div><button class="button button-primary" id="empty-signin">Sign in <span>→</span></button></div>`;
    document.querySelector("#empty-signin").addEventListener("click", () => openAuthDialog("login"));
    return;
  }

  try {
    const { projects } = await api("/api/projects");
    if (!projects.length) {
      list.innerHTML = `<div class="empty-card"><div class="empty-copy"><strong>Your first project starts here</strong><p>Create a space for your team to learn the project together.</p></div><button class="button button-primary" id="empty-create">Create a project <span>→</span></button></div>`;
      document.querySelector("#empty-create").addEventListener("click", () => projectDialog.showModal());
      return;
    }

    list.innerHTML = projects.map((project) => {
      const tag = project.my_role === "owner" ? "YOUR PROJECT" : "TEAM MEMBER";
      const seats = `${project.member_count ?? 1} / ${project.seat_limit} team seats`;
      return `<article class="project-card" data-project="${project.id}"><div class="project-top"><div class="project-initial">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</div><span class="project-tag">${tag}</span></div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.gist || "Add a project overview to help your team get oriented.")}</p><div class="project-meta"><span>${seats}</span><span>Open project →</span></div></article>`;
    }).join("");

    list.querySelectorAll("[data-project]").forEach((card) => {
      card.addEventListener("click", () => {
        location.hash = `project/${card.dataset.project}`;
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="loading-card">${escapeHtml(error.message)} Check that the local D1 database is configured.</div>`;
  }
}

function setActivePvTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll(".pv-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.pvTab === tabName);
  });
  document.querySelectorAll(".pv-panel").forEach((panel) => {
    panel.hidden = panel.dataset.pvPanel !== tabName;
  });
}

document.querySelectorAll(".pv-tab").forEach((tab) => {
  tab.addEventListener("click", () => setActivePvTab(tab.dataset.pvTab));
});

async function openProjectView(projectId) {
  if (!currentUser) {
    homeView.hidden = false;
    projectView.hidden = true;
    await loadProjects();
    openAuthDialog("login");
    return;
  }

  homeView.hidden = true;
  projectView.hidden = false;

  try {
    const { project } = await api(`/api/projects/${projectId}`);
    activeProject = project;
    const isOwner = project.my_role === "owner";

    document.querySelector("#pv-title").textContent = project.name;
    document.querySelector("#pv-role-badge").textContent = isOwner ? "YOUR PROJECT" : "TEAM MEMBER";
    document.querySelector("#pv-seat-badge").textContent = `${project.member_count} / ${project.seat_limit} team seats`;
    document.querySelector("#pv-gist-text").textContent = project.gist || "No project gist added yet.";

    document.querySelector("#pv-settings-tab").hidden = !isOwner;
    document.querySelector("#pv-overview-form").hidden = !isOwner;
    document.querySelector("#pv-material-form").hidden = !isOwner;

    if (isOwner) {
      const ovForm = document.querySelector("#pv-overview-form");
      ovForm.elements.name.value = project.name;
      ovForm.elements.gist.value = project.gist || "";
      ovForm.elements.seatLimit.value = project.seat_limit;

      document.querySelector("#pv-qa-enabled-input").checked = Boolean(project.agent_qa_enabled);
      document.querySelector("#pv-qa-scope-select").value = project.agent_qa_scope || "gist_and_materials";
    }

    const levelSelect = document.querySelector("#pv-level-select");
    levelSelect.value = project.my_experience_level || "mid";
    identifyFlagsmithUser(levelSelect.value);

    document.querySelector("#pv-qa-status-text").textContent = project.agent_qa_enabled
      ? "Agent Q&A is enabled for this project"
      : "Agent Q&A is currently disabled by the project owner";
    document.querySelector("#pv-qa-scope-pill").textContent = project.agent_qa_scope || "gist_and_materials";
    document.querySelector("#pv-qa-result").hidden = true;
    document.querySelector("#pv-device-output").hidden = true;

    setActivePvTab(activeTab === "settings" && !isOwner ? "overview" : activeTab);
    await Promise.all([loadMaterials(), loadAgentConnections()]);
  } catch (error) {
    toast(error.message);
    location.hash = "home";
  }
}

function identifyFlagsmithUser(level) {
  if (!currentUser) return;
  try {
    flagsmithClient.identify(currentUser.id, { experience_level: level });
  } catch {
    /* Flagsmith may not be initialized when env key is absent */
  }
}

async function loadMaterials() {
  if (!activeProject) return;
  const list = document.querySelector("#pv-materials-list");
  list.innerHTML = `<div class="loading-card">Loading learning materials…</div>`;
  try {
    const { materials } = await api(`/api/materials?projectId=${encodeURIComponent(activeProject.id)}`);
    const selectedLevel = document.querySelector("#pv-level-select").value;
    const showAll = document.querySelector("#pv-show-all-levels").checked;

    const completedCount = materials.filter((m) => m.progress_status === "completed").length;
    document.querySelector("#pv-progress-summary").textContent = `${completedCount} of ${materials.length} completed`;

    const visible = showAll
      ? materials
      : materials.filter((m) => m.level === "all" || m.level === selectedLevel);

    if (!visible.length) {
      list.innerHTML = `<div class="empty-card"><div class="empty-copy"><strong>No learning materials for this track yet</strong><p>Switch to "Show all levels" or add a guide, edge case, or quiz below.</p></div></div>`;
      return;
    }

    const isOwner = activeProject.my_role === "owner";
    list.innerHTML = visible.map((m) => {
      const done = m.progress_status === "completed";
      const deleteBtn = isOwner
        ? `<button class="button-danger-text" type="button" data-delete-material="${m.id}">Delete</button>`
        : "";
      const answerBlock = done && m.answer_key
        ? `<div class="pv-answer-key"><strong>Answer / Rubric:</strong> ${escapeHtml(m.answer_key)}</div>`
        : "";
      const sourceBlock = m.source_note
        ? `<div class="pv-material-source">Source: ${escapeHtml(m.source_note)}</div>`
        : "";
      return `<article class="pv-material-card" data-material="${m.id}">
        <div class="pv-material-top">
          <div class="pv-material-badges">
            <span class="role-pill">${escapeHtml(m.kind.replace("_", " "))}</span>
            <span class="role-pill">${escapeHtml(m.level)}</span>
            ${done ? `<span class="project-tag">✓ COMPLETED</span>` : ""}
          </div>
          ${deleteBtn}
        </div>
        <h3>${escapeHtml(m.title)}</h3>
        <p class="pv-material-body">${escapeHtml(m.body)}</p>
        ${sourceBlock}
        ${answerBlock}
        <div class="pv-progress-row">
          <input type="text" data-response-input="${m.id}" value="${escapeHtml(m.my_response || "")}" placeholder="${m.kind === "quiz" || m.kind === "guided_session" ? "Write your answer or notes..." : "Optional reflection notes..."}" />
          <button class="button button-outline" type="button" data-complete-material="${m.id}">${done ? "Update response" : "Mark complete"}</button>
        </div>
      </article>`;
    }).join("");

    list.querySelectorAll("[data-complete-material]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const materialId = btn.dataset.completeMaterial;
        const input = list.querySelector(`[data-response-input="${materialId}"]`);
        try {
          await api(`/api/projects/${activeProject.id}/progress`, {
            method: "POST",
            body: JSON.stringify({ materialId, responseText: input ? input.value : "" }),
          });
          toast("Progress saved.");
          await loadMaterials();
        } catch (cause) {
          toast(cause.message);
        }
      });
    });

    list.querySelectorAll("[data-delete-material]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/materials/${btn.dataset.deleteMaterial}`, { method: "DELETE" });
          toast("Material deleted.");
          await loadMaterials();
        } catch (cause) {
          toast(cause.message);
        }
      });
    });
  } catch (cause) {
    list.innerHTML = `<div class="form-error">${escapeHtml(cause.message)}</div>`;
  }
}

async function loadAgentConnections() {
  if (!activeProject) return;
  const connList = document.querySelector("#pv-connections-list");
  const logsList = document.querySelector("#pv-qa-logs-list");
  try {
    const { connections, logs } = await api(`/api/projects/${activeProject.id}/agent-connections`);
    connList.innerHTML = connections.length
      ? connections.map((c) => {
        const revokeBtn = c.status !== "revoked"
          ? `<button class="button-danger-text" type="button" data-revoke-conn="${c.id}">Revoke</button>`
          : "";
        return `<div class="access-member-row"><div><strong>${escapeHtml(c.label)} (${escapeHtml(c.user_code || "")})</strong><span>${escapeHtml(c.member_name)} · ${escapeHtml(c.status)}</span></div><div class="access-member-right"><span class="role-pill">${escapeHtml(c.status)}</span>${revokeBtn}</div></div>`;
      }).join("")
      : `<div class="loading-card">No agent connections yet.</div>`;

    connList.querySelectorAll("[data-revoke-conn]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/projects/${activeProject.id}/agent-connections/${btn.dataset.revokeConn}`, { method: "DELETE" });
          toast("Agent connection revoked.");
          await loadAgentConnections();
        } catch (cause) {
          toast(cause.message);
        }
      });
    });

    if (logsList && activeProject.my_role === "owner") {
      logsList.innerHTML = logs.length
        ? logs.map((l) => `<div class="access-member-row"><div><strong>${escapeHtml(l.question)}</strong><span>${escapeHtml(l.member_name)} · scope: ${escapeHtml(l.scope_used)}</span></div></div>`).join("")
        : `<div class="loading-card">No Agent Q&amp;A questions recorded yet.</div>`;
    }
  } catch (cause) {
    connList.innerHTML = `<div class="form-error">${escapeHtml(cause.message)}</div>`;
  }
}

document.querySelector("#pv-level-select").addEventListener("change", async (event) => {
  if (!activeProject) return;
  const level = event.target.value;
  try {
    await api(`/api/projects/${activeProject.id}/my-level`, {
      method: "PATCH",
      body: JSON.stringify({ level }),
    });
    activeProject.my_experience_level = level;
    identifyFlagsmithUser(level);
    toast(`Track switched to ${level}.`);
    await loadMaterials();
  } catch (cause) {
    toast(cause.message);
  }
});

document.querySelector("#pv-show-all-levels").addEventListener("change", () => loadMaterials());

document.querySelector("#pv-overview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const err = document.querySelector("#pv-overview-error");
  err.textContent = "";
  try {
    await api(`/api/projects/${activeProject.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: data.name, gist: data.gist, seatLimit: Number(data.seatLimit) }),
    });
    toast("Project overview updated.");
    await openProjectView(activeProject.id);
  } catch (cause) {
    err.textContent = cause.message;
  }
});

document.querySelector("#pv-material-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) return;
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const err = document.querySelector("#pv-material-error");
  err.textContent = "";
  try {
    await api("/api/materials", {
      method: "POST",
      body: JSON.stringify({ projectId: activeProject.id, ...data }),
    });
    form.reset();
    toast("Learning material added.");
    await loadMaterials();
  } catch (cause) {
    err.textContent = cause.message;
  }
});

document.querySelector("#pv-qa-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const err = document.querySelector("#pv-qa-error");
  err.textContent = "";
  try {
    const result = await api(`/api/projects/${activeProject.id}/agent-qa`, {
      method: "POST",
      body: JSON.stringify({ question: data.question }),
    });
    document.querySelector("#pv-qa-result").hidden = false;
    document.querySelector("#pv-qa-answer").textContent = result.answer;
    document.querySelector("#pv-qa-sources").innerHTML = (result.sources || [])
      .map((s) => `<span class="role-pill">${escapeHtml(s.type)}: ${escapeHtml(s.title)}</span>`)
      .join("");
    await loadAgentConnections();
  } catch (cause) {
    err.textContent = cause.message;
  }
});

document.querySelector("#pv-device-start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await api("/api/agent/device/start", {
      method: "POST",
      body: JSON.stringify({ projectId: activeProject.id, label: data.label }),
    });
    document.querySelector("#pv-device-output").hidden = false;
    document.querySelector("#pv-user-code").textContent = result.userCode;
    document.querySelector("#pv-device-code").textContent = result.deviceCode;
    await loadAgentConnections();
    toast("Device code generated. Approve it using the user code.");
  } catch (cause) {
    toast(cause.message);
  }
});

document.querySelector("#pv-device-approve-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/api/agent/device/approve", {
      method: "POST",
      body: JSON.stringify({ userCode: data.userCode }),
    });
    form.reset();
    toast("Agent device approved.");
    await loadAgentConnections();
  } catch (cause) {
    toast(cause.message);
  }
});

document.querySelector("#pv-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) return;
  const err = document.querySelector("#pv-settings-error");
  err.textContent = "";
  try {
    await api(`/api/projects/${activeProject.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        agentQaEnabled: document.querySelector("#pv-qa-enabled-input").checked,
        agentQaScope: document.querySelector("#pv-qa-scope-select").value,
      }),
    });
    toast("Owner settings saved.");
    await openProjectView(activeProject.id);
  } catch (cause) {
    err.textContent = cause.message;
  }
});

document.querySelector("#pv-manage-access").addEventListener("click", () => {
  if (activeProject) openAccessDialog(activeProject);
});

async function openAccessDialog(project) {
  document.querySelector("#access-title").textContent = project.name;
  document.querySelector("#access-gist").textContent = project.gist || "No project gist added yet.";

  const ownerBox = document.querySelector("#access-owner-box");
  if (project.my_role === "owner" && project.claim_code) {
    ownerBox.hidden = false;
    document.querySelector("#access-claim-code").textContent = project.claim_code;
    document.querySelector("#access-copy-code").dataset.code = project.claim_code;
    document.querySelector("#access-expiry").textContent = project.claim_code_expires_at
      ? `Expires ${new Date(project.claim_code_expires_at).toLocaleDateString()}`
      : "Active claim code";
  } else {
    ownerBox.hidden = true;
  }

  accessDialog.showModal();
  await loadProjectMembers(project);
}

async function loadProjectMembers(project) {
  const membersList = document.querySelector("#access-members-list");
  membersList.innerHTML = `<div class="loading-card">Loading members…</div>`;
  try {
    const { members, my_role } = await api(`/api/projects/${project.id}/members`);
    document.querySelector("#access-seat-count").textContent = `${members.length} of ${project.seat_limit} seats`;
    membersList.innerHTML = members.map((member) => {
      const removeButton = my_role === "owner" && member.role !== "owner"
        ? `<button class="button-danger-text" type="button" data-remove-member="${member.id}">Remove</button>`
        : "";
      return `<div class="access-member-row"><div><strong>${escapeHtml(member.display_name)}</strong><span>${escapeHtml(member.email || "Team member")} · ${escapeHtml(member.experience_level || "mid")}</span></div><div class="access-member-right"><span class="role-pill">${escapeHtml(member.role)}</span>${removeButton}</div></div>`;
    }).join("");

    membersList.querySelectorAll("[data-remove-member]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await api(`/api/projects/${project.id}/members/${button.dataset.removeMember}`, { method: "DELETE" });
          toast("Member removed.");
          await loadProjectMembers(project);
          if (activeProject && activeProject.id === project.id) await openProjectView(project.id);
        } catch (cause) {
          toast(cause.message);
        }
      });
    });
  } catch (cause) {
    membersList.innerHTML = `<div class="form-error">${escapeHtml(cause.message)}</div>`;
  }
}

document.querySelector("#access-copy-code").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(event.currentTarget.dataset.code || "");
  toast("Claim code copied.");
});

document.querySelector("#access-rotate-code").addEventListener("click", async () => {
  if (!activeProject) return;
  try {
    const result = await api(`/api/projects/${activeProject.id}/rotate-code`, { method: "POST" });
    activeProject.claim_code = result.claim_code;
    activeProject.claim_code_expires_at = result.claim_code_expires_at;
    document.querySelector("#access-claim-code").textContent = result.claim_code;
    document.querySelector("#access-copy-code").dataset.code = result.claim_code;
    document.querySelector("#access-expiry").textContent = `Expires ${new Date(result.claim_code_expires_at).toLocaleDateString()}`;
    toast("New claim code generated.");
  } catch (cause) {
    toast(cause.message);
  }
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#auth-error");
  error.textContent = "";
  try {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(data) });
    currentUser = result.user;
    authDialog.close();
    form.reset();
    renderAuthUI();
    await handleRoute();
    toast(`Signed in as ${currentUser.display_name}.`);
  } catch (cause) {
    error.textContent = cause.message;
  }
});

document.querySelector("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#form-error");
  error.textContent = "";
  try {
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: data.name, gist: data.gist, seatLimit: Number(data.seatLimit) }),
    });
    projectDialog.close();
    form.reset();
    document.querySelector("#success-title").textContent = `${result.project.name} is ready`;
    document.querySelector("#claim-code").textContent = result.project.claim_code;
    document.querySelector("#copy-code").dataset.code = result.project.claim_code;
    successDialog.showModal();
    await loadProjects();
  } catch (cause) {
    error.textContent = cause.message;
  }
});

document.querySelector("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const error = document.querySelector("#join-error");
  error.textContent = "";
  try {
    const result = await api("/api/join", { method: "POST", body: JSON.stringify(data) });
    joinDialog.close();
    form.reset();
    toast(`You joined ${result.project.name}.`);
    await loadProjects();
  } catch (cause) {
    error.textContent = cause.message;
  }
});

document.querySelector("#copy-code").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(event.currentTarget.dataset.code || "");
  toast("Claim code copied.");
});

async function handleRoute() {
  const match = location.hash.match(/^#project\/([^/]+)$/);
  if (match) {
    await openProjectView(match[1]);
  } else {
    activeProject = null;
    homeView.hidden = false;
    projectView.hidden = true;
    await loadProjects();
  }
}

window.addEventListener("hashchange", handleRoute);

async function initFlags() {
  try {
    const { flagsmithEnvironmentId } = await api("/api/config");
    if (!flagsmithClient.init(flagsmithEnvironmentId)) return;
    const applyFlags = () => {
      document.documentElement.dataset.flagsReady = "true";
      document.documentElement.dataset.agentQa = String(flagsmithClient.hasFeature("agent_qa"));
      document.documentElement.dataset.roleTracks = String(flagsmithClient.hasFeature("role_tracks"));
      document.documentElement.dataset.guidedSessions = String(flagsmithClient.hasFeature("guided_sessions"));
    };
    flagsmithClient.subscribe(applyFlags);
    applyFlags();
  } catch {
    /* Flags have safe UI defaults until the Flagsmith key is configured. */
  }
}

await loadSession();
await handleRoute();
initFlags();
