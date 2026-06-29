/* global io */
(function () {
  "use strict";

  let token = "";
  let socket = null;
  let bees = [];
  let tasks = [];

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const tokenInput = $("#token-input");
  const connectBtn = $("#connect-btn");
  const connStatus = $("#conn-status");
  const connMsg = $("#conn-msg");
  const beesTbody = $("#bees-table tbody");
  const tasksTbody = $("#tasks-table tbody");
  const taskDetail = $("#task-detail");
  const filterStatus = $("#filter-status");
  const filterBee = $("#filter-bee");
  const createBee = $("#create-bee");
  const createForm = $("#create-task-form");
  const createResult = $("#create-result");
  const conflictList = $("#conflict-list");

  function apiBase() {
    const loc = window.location;
    return loc.protocol + "//" + loc.host + "/api/orchestrator";
  }

  // ── API helper ──
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(apiBase() + path, { ...opts, headers });
    return res;
  }

  // ── Login / Connect ──
  connectBtn.addEventListener("click", doConnect);
  tokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doConnect(); });

  async function doConnect() {
    token = tokenInput.value.trim();
    if (!token) { setStatus("error", "Ingresa un token"); return; }
    setStatus("connecting", "Conectando...");

    if (socket) socket.disconnect();

    socket = io({ auth: { token } });
    socket.on("connect", () => { setStatus("connected", ""); loadAll(); });
    socket.on("connect_error", () => setStatus("error", "Token inválido o servidor no disponible"));
    socket.on("disconnect", () => setStatus("disconnected", ""));

    registerSocketHandlers();
  }

  function setStatus(s, msg) {
    connStatus.className = "status-dot " + s;
    connMsg.textContent = msg || "";
  }

  // ── WebSocket handlers ──
  function registerSocketHandlers() {
    socket.on("bee:registered", () => loadBees());
    socket.on("bee:heartbeat", () => loadBees());
    socket.on("bee:offline", () => loadBees());

    socket.on("task:created", () => loadTasks());
    socket.on("task:status_changed", () => loadTasks());

    socket.on("integration:conflict", (e) => addConflict("integration:conflict", e));
    socket.on("reconcile:conflict", (e) => addConflict("reconcile:conflict", e));
    socket.on("update:conflict", (e) => addConflict("update:conflict", e));
  }

  function addConflict(type, data) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${esc(type)}</strong> <span class="time">${esc(new Date().toLocaleTimeString())}</span><br>${esc(JSON.stringify(data))}`;
    conflictList.prepend(li);
  }

  // ── Load all data ──
  async function loadAll() {
    await Promise.all([loadBees(), loadTasks(), loadCreateBeeOptions()]);
  }

  // ── Bees panel ──
  async function loadBees() {
    try {
      const res = await api("/bees");
      if (!res.ok) return;
      bees = await res.json();
      renderBees();
      populateBeeFilter();
      populateCreateBee();
    } catch {}
  }

  function renderBees() {
    beesTbody.innerHTML = bees.map((b) =>
      `<tr>
        <td>${esc(b.name)}</td>
        <td>${esc(b.engine)}</td>
        <td><span class="status-badge ${esc(b.status)}">${esc(b.status)}</span></td>
        <td>${b.last_heartbeat_at ? esc(new Date(b.last_heartbeat_at + "Z").toLocaleTimeString()) : "—"}</td>
        <td>${b.current_task_code ? esc(b.current_task_code) : "—"}</td>
      </tr>`
    ).join("");
  }

  // ── Tasks panel ──
  async function loadTasks() {
    try {
      const params = new URLSearchParams();
      const fs = filterStatus.value;
      if (fs) params.set("status", fs);
      const fb = filterBee.value;
      if (fb) params.set("assigned_to", fb);
      const res = await api("/tasks?" + params.toString());
      if (!res.ok) return;
      tasks = await res.json();
      renderTasks();
    } catch {}
  }

  function renderTasks() {
    if (!tasks.length) { tasksTbody.innerHTML = "<tr><td colspan='5'>Sin tareas</td></tr>"; return; }
    tasksTbody.innerHTML = tasks.map((t) =>
      `<tr class="clickable" data-code="${esc(t.code)}">
        <td>${esc(t.code)}</td>
        <td>${esc(t.slug)}</td>
        <td><span class="status-badge ${esc(t.status)}">${esc(t.status)}</span></td>
        <td>${esc(t.assigned_to_name || t.assigned_to)}</td>
        <td>${esc(t.priority)}</td>
      </tr>`
    ).join("");

    tasksTbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => showTaskDetail(tr.dataset.code));
    });
  }

  async function showTaskDetail(code) {
    try {
      const res = await api("/tasks/" + encodeURIComponent(code));
      if (!res.ok) { taskDetail.innerHTML = "<p class='hint'>Error al cargar detalle</p>"; return; }
      const t = await res.json();

      const resRes = await api("/tasks/" + encodeURIComponent(code) + "/results");
      const results = resRes.ok ? await resRes.json() : [];

      const depsRes = await api("/tasks/" + encodeURIComponent(code) + "/dependencies");
      const deps = depsRes.ok ? await depsRes.json() : [];

      let html = `<h3>${esc(t.code)} — ${esc(t.slug)}</h3>
        <dl>
          <dt>Estado</dt><dd><span class="status-badge ${esc(t.status)}">${esc(t.status)}</span></dd>
          <dt>Prioridad</dt><dd>${esc(t.priority)}</dd>
          <dt>Bee asignado</dt><dd>${esc(t.assigned_to_name || t.assigned_to)}</dd>
          <dt>Descripción</dt><dd>${esc(t.description || "—")}</dd>`;
      if (t.acceptance_criteria) html += `<dt>Criterios de aceptación</dt><dd>${esc(t.acceptance_criteria)}</dd>`;
      if (t.block_reason) html += `<dt>Block reason</dt><dd>${esc(t.block_reason)}</dd>`;
      if (t.locked_by) html += `<dt>Locked by</dt><dd>bee #${t.locked_by} (${esc(t.locked_by_instance || "?")})</dd>`;
      if (t.lease_expires_at) html += `<dt>Lease expires</dt><dd>${esc(t.lease_expires_at)}</dd>`;
      html += `<dt>Revisiones</dt><dd>rev ${t.rev}, attempts ${t.attempts}/${t.max_attempts}</dd>`;

      if (deps.length) {
        html += `<dt>Dependencias</dt><dd>${deps.map((d) => esc(d.depends_on_task_code || d.depends_on_task_id)).join(", ")}</dd>`;
      }

      if (results.length) {
        html += `<dt>Resultados</dt>`;
        for (const r of results) {
          html += `<dd style="margin-top:0.3rem;padding:0.3rem;background:var(--bg);border-radius:4px;">
            <strong>${esc(r.outcome)}</strong> (intento ${r.attempt})<br>
            <span style="font-size:0.75rem;color:var(--muted)">key: ${esc(r.idempotency_key)}</span>`;
          if (r.files_changed) html += `<br>files: ${esc(JSON.stringify(r.files_changed))}`;
          if (r.decisions) html += `<br>decisions: ${esc(r.decisions)}`;
          if (r.blockers) html += `<br>blockers: ${esc(r.blockers)}`;
          if (r.notes) html += `<br>notes: ${esc(r.notes)}`;
          html += `</dd>`;
        }
      }
      html += `</dl>`;
      taskDetail.innerHTML = html;
    } catch {
      taskDetail.innerHTML = "<p class='hint'>Error al cargar detalle</p>";
    }
  }

  // ── Filters ──
  filterStatus.addEventListener("change", loadTasks);
  filterBee.addEventListener("change", loadTasks);

  function populateBeeFilter() {
    const current = filterBee.value;
    filterBee.innerHTML = "<option value=''>Todos</option>" +
      bees.map((b) => `<option value="${esc(b.name)}" ${b.name === current ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  }

  // ── Create task ──
  function populateCreateBee() {
    const current = createBee.value;
    createBee.innerHTML = bees.map((b) => `<option value="${esc(b.name)}" ${b.name === current ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  }

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    createResult.textContent = "";
    createResult.className = "";

    const body = {
      assigned_to: $("#create-bee").value,
      description: $("#create-desc").value.trim(),
      priority: $("#create-priority").value,
      slug: $("#create-slug").value.trim(),
      depends_on: $("#create-deps").value.trim() ? $("#create-deps").value.trim().split(",").map((s) => s.trim()) : [],
      max_attempts: parseInt($("#create-max-attempts").value, 10),
    };
    if (!body.description || !body.slug) {
      createResult.textContent = "Descripción y slug son requeridos";
      createResult.className = "error";
      return;
    }

    try {
      const res = await api("/tasks", { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        createResult.textContent = "Error: " + (data.error || JSON.stringify(data));
        createResult.className = "error";
      } else {
        createResult.textContent = "Creada " + data.code;
        createResult.className = "ok";
        $("#create-desc").value = "";
        $("#create-slug").value = "";
        $("#create-deps").value = "";
        loadTasks();
      }
    } catch {
      createResult.textContent = "Error de red";
      createResult.className = "error";
    }
  });

  // ── Tab switching ──
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ── Escaping ──
  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
