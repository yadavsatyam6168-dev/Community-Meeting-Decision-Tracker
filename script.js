const STORAGE_KEY = "communityMeetingTracker.v1";
const DEFAULT_COUNTRY_CODE = "91";            // added to 10-digit phone numbers for WhatsApp links
const ORG_NAME = "Community Decision Tracker"; // shown in reminder messages
const LOW_ATTENDANCE = 75;                     // % below which a member is highlighted

let data = loadData();
let toastTimer;
let sheet = null; // open roll-call: { meetingId, draft: { memberId: "P" | "L" | "A" } }


/* ====================== Demo role-based login ====================== */
// Change these demo credentials before presenting. This frontend-only login is NOT secure.
const DEMO_USERS = {
  admin: { password: "Admin@123", role: "Admin" },
  head: { password: "Head@123", role: "Head of Society" },
  viewer: { password: "View@123", role: "Viewer" }
};
let currentUser = null;
function canEdit() { return !!currentUser && ["Admin", "Head of Society"].includes(currentUser.role); }
function requireEditor() {
  if (canEdit()) return true;
  showToast("View-only access: only Admin or Head of Society can make changes.");
  return false;
}
function applyRoleUI() {
  document.body.classList.add("authenticated");
  document.getElementById("current-user-label").textContent = `${currentUser.username} · ${currentUser.role}`;
  document.querySelectorAll("#header-add-meeting, #add-meeting, #add-member, #add-task, #mark-all-present, #mark-all-absent, #save-attendance, #enable-notify").forEach(el => el.classList.toggle("hidden-by-role", !canEdit()));
  document.querySelectorAll("[data-delete-meeting], [data-delete-task], [data-edit-member], [data-delete-member], [data-attendance]").forEach(el => el.classList.toggle("hidden-by-role", !canEdit()));
  renderAll();
}
document.getElementById("login-form").addEventListener("submit", event => {
  event.preventDefault();
  const username = document.getElementById("login-username").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  const account = DEMO_USERS[username];
  if (!account || account.password !== password) {
    document.getElementById("login-error").textContent = "Incorrect username or password.";
    return;
  }
  currentUser = { username, role: account.role };
  document.getElementById("login-error").textContent = "";
  applyRoleUI();
});
document.getElementById("logout-button").addEventListener("click", () => {
  currentUser = null; document.body.classList.remove("authenticated");
  document.getElementById("login-form").reset();
});
// Block write actions even if a viewer manually triggers a hidden control.
document.addEventListener("click", event => {
  if (canEdit()) return;
  const blocked = event.target.closest("#header-add-meeting, #add-meeting, #add-member, #add-task, #mark-all-present, #mark-all-absent, #save-attendance, #enable-notify, [data-delete-meeting], [data-delete-task], [data-edit-member], [data-delete-member], [data-attendance], [data-mark], [data-reminded], [data-copy-reminder]");
  if (blocked) { event.preventDefault(); event.stopImmediatePropagation(); requireEditor(); }
}, true);
document.addEventListener("submit", event => {
  if (!canEdit() && ["meeting-form", "task-form", "member-form"].includes(event.target.id)) {
    event.preventDefault(); event.stopImmediatePropagation(); requireEditor();
  }
}, true);
document.addEventListener("change", event => {
  if (!canEdit() && (event.target.matches("[data-status-id]") || event.target.id === "remind-days")) {
    event.preventDefault(); event.stopImmediatePropagation(); renderAll(); requireEditor();
  }
}, true);

/* ====================== Data ====================== */
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.meetings) && Array.isArray(saved.tasks)) return migrate(saved);
  } catch (error) { console.warn("Could not read saved data:", error); }
  return migrate({ meetings: [], tasks: [] });
}
// Upgrades older saved data (including the first attendance version) to the new structure.
function migrate(d) {
  d.members = Array.isArray(d.members) ? d.members : [];
  d.settings = Object.assign({ remindDays: 2 }, d.settings || {});
  d.meetings.forEach(m => {
    if (Array.isArray(m.attendance)) {
      const map = {};
      m.attendance.forEach(a => {
        let mem = d.members.find(x => x.name.toLowerCase() === String(a.name).toLowerCase());
        if (!mem) { mem = { id: a.id || uid(), roll: nextRoll(d.members), name: a.name, contact: "" }; d.members.push(mem); }
        map[mem.id] = a.present ? "P" : "A";
      });
      m.attendance = map;
      m.attendanceTaken = true;
    } else if (!m.attendance) { m.attendance = {}; m.attendanceTaken = false; }
  });
  return d;
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function saveData() { persist(); renderAll(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function nextRoll(list) { return Math.max(0, ...list.map(m => Number(m.roll) || 0)) + 1; }

/* ====================== Helpers ====================== */
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function formatDate(value) {
  if (!value) return "No date";
  return new Date(value + "T00:00:00").toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"});
}
function formatShort(value) {
  return new Date(value + "T00:00:00").toLocaleDateString(undefined, {day:"numeric",month:"short"});
}
function statusClass(status) { return status.toLowerCase().replaceAll(" ", "-"); }
function todayStr() { // local date (not UTC) so deadlines flip at local midnight
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function daysUntil(dateStr) {
  return Math.round((new Date(dateStr + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000);
}
function dueLabel(task) {
  const n = daysUntil(task.deadline);
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? "" : "s"}`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  return `Due in ${n} days`;
}
function isOverdue(task) { return task.status !== "Completed" && task.deadline && task.deadline < todayStr(); }
function showToast(message) {
  const el = document.getElementById("toast");
  el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function openDialog(id) { document.getElementById(id).showModal(); }
function closeDialog(id) { document.getElementById(id).close(); }
function sortedMembers() { return [...data.members].sort((a,b) => Number(a.roll) - Number(b.roll)); }
function findMember(name) {
  const key = String(name).trim().toLowerCase();
  return data.members.find(m => m.name.trim().toLowerCase() === key);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  }
}

/* ====================== Attendance maths ====================== */
function meetingStats(m) {
  const v = Object.values(m.attendance || {});
  const p = v.filter(x => x === "P").length, l = v.filter(x => x === "L").length, a = v.filter(x => x === "A").length;
  const total = p + l + a;
  return { p, l, a, total, attended: p + l, percent: total ? Math.round((p + l) / total * 100) : 0 };
}
function memberStats(member) {
  let attended = 0, total = 0;
  data.meetings.forEach(m => {
    if (!m.attendanceTaken) return;
    const v = (m.attendance || {})[member.id];
    if (!v) return;
    total++; if (v !== "A") attended++;
  });
  return { attended, total, percent: total ? Math.round(attended / total * 100) : null };
}

/* ====================== Reminder logic ====================== */
function dueSoonTasks() {
  return data.tasks.filter(t => t.status !== "Completed" && t.deadline && daysUntil(t.deadline) <= data.settings.remindDays);
}
function reminderGroups(tasks) {
  const map = new Map();
  tasks.forEach(t => {
    const key = t.assignee.trim().toLowerCase();
    if (!map.has(key)) map.set(key, { key, name: t.assignee.trim(), tasks: [] });
    map.get(key).tasks.push(t);
  });
  return [...map.values()].map(g => {
    g.member = findMember(g.name);
    g.contact = (g.member && g.member.contact) || (g.tasks.find(t => t.contact) || {}).contact || "";
    g.tasks.sort((a,b) => a.deadline.localeCompare(b.deadline));
    return g;
  }).sort((a,b) => a.tasks[0].deadline.localeCompare(b.tasks[0].deadline));
}
function groupFromTaskIds(ids) {
  return reminderGroups(data.tasks.filter(t => ids.includes(t.id)))[0];
}
function reminderMessage(g) {
  const lines = g.tasks.map((t, i) => {
    const mt = data.meetings.find(m => m.id === t.meetingId);
    return `${i + 1}. ${t.title}${mt ? ` (from "${mt.title}")` : ""} – due ${formatDate(t.deadline)} [${dueLabel(t)}]`;
  });
  const many = g.tasks.length > 1;
  return `Hello ${g.name},\n\nThis is a friendly reminder from the ${ORG_NAME}. You have ${g.tasks.length} pending action item${many ? "s" : ""}:\n\n${lines.join("\n")}\n\nPlease complete ${many ? "them" : "it"} by the deadline and let the secretary know once done.\n\nThank you!`;
}
function contactKind(c) {
  if (!c) return "none";
  if (c.includes("@")) return "email";
  return c.replace(/\D/g, "").length >= 7 ? "phone" : "none";
}
function whatsappLink(contact, msg) {
  let d = contact.replace(/\D/g, "");
  if (d.length === 10) d = DEFAULT_COUNTRY_CODE + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
}
function mailLink(contact, msg) {
  return `mailto:${contact.trim()}?subject=${encodeURIComponent("Reminder: pending action items")}&body=${encodeURIComponent(msg)}`;
}
function dueBadge(t) {
  const n = daysUntil(t.deadline);
  const cls = n < 0 ? "overdue" : n <= 1 ? "pending" : "in-progress";
  return `<span class="status ${cls}">${dueLabel(t)}</span>`;
}
function reminderCardHTML(g) {
  const msg = reminderMessage(g);
  const kind = contactKind(g.contact);
  const ids = g.tasks.map(t => t.id).join(",");
  const last = g.tasks.map(t => t.lastReminded).filter(Boolean).sort().pop();
  let buttons = "";
  if (kind === "email") buttons += `<a class="small-btn accent" href="${escapeHTML(mailLink(g.contact, msg))}" data-reminded="${ids}">✉ Email</a>`;
  if (kind === "phone") buttons += `<a class="small-btn accent" href="${escapeHTML(whatsappLink(g.contact, msg))}" target="_blank" rel="noopener" data-reminded="${ids}">💬 WhatsApp</a>`;
  buttons += `<button class="small-btn" data-copy-reminder="${ids}">Copy message</button>`;
  const contactLine = kind === "none"
    ? '<small class="warn">No contact saved – add one to the member profile or the task</small>'
    : `<small>${escapeHTML(g.contact)}</small>`;
  return `<article class="reminder-card">
    <div class="reminder-head"><div><strong>${escapeHTML(g.name)}</strong>${g.member ? `<span class="roll-tag">Roll ${escapeHTML(g.member.roll)}</span>` : ""}${contactLine}</div><span class="count-pill">${g.tasks.length} task${g.tasks.length > 1 ? "s" : ""}</span></div>
    <ul class="reminder-tasks">${g.tasks.map(t => {
      const mt = data.meetings.find(m => m.id === t.meetingId);
      return `<li><span>${escapeHTML(t.title)}<small>${escapeHTML(mt ? mt.title : "Meeting deleted")} · ${formatDate(t.deadline)}</small></span>${dueBadge(t)}</li>`;
    }).join("")}</ul>
    <div class="reminder-foot"><small>${last ? "Last reminded: " + formatDate(last) : "Not reminded yet"}</small><div class="inline-actions">${buttons}</div></div>
  </article>`;
}
function markReminded(ids) {
  ids.forEach(id => {
    const t = data.tasks.find(x => x.id === id);
    if (t) { t.lastReminded = todayStr(); t.reminderCount = (t.reminderCount || 0) + 1; }
  });
  saveData(); showToast("Marked as reminded.");
}
function updateNotifyStatus() {
  const status = document.getElementById("notify-status");
  const btn = document.getElementById("enable-notify");
  if (!("Notification" in window)) { status.textContent = "Browser alerts are not supported in this browser."; btn.classList.add("hidden"); return; }
  const p = Notification.permission;
  btn.classList.toggle("hidden", p === "granted");
  status.textContent = p === "granted" ? "Browser alerts are on – you get one alert a day while this page is open."
    : p === "denied" ? "Alerts are blocked in your browser settings." : "";
}
function notifyDue() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const tasks = dueSoonTasks();
  if (!tasks.length || data.settings.lastNotified === todayStr()) return;
  data.settings.lastNotified = todayStr(); persist();
  new Notification("Task reminders", { body: `${tasks.length} task(s) are overdue or due within ${data.settings.remindDays} day(s). Open the Reminders page to notify the owners.` });
}

/* ====================== Rendering ====================== */
const PAGE_TITLES = { dashboard:"Dashboard", meetings:"Meetings", attendance:"Attendance", tasks:"Action tracker", reminders:"Reminders" };
function navigate(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === `${page}-page`));
  document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  document.getElementById("page-title").textContent = PAGE_TITLES[page] || page;
}
function statusBadge(task) {
  if (isOverdue(task)) return '<span class="status overdue">Overdue</span>';
  return `<span class="status ${statusClass(task.status)}">${escapeHTML(task.status)}</span>`;
}
function renderDashboard() {
  document.getElementById("stat-meetings").textContent = data.meetings.length;
  document.getElementById("stat-open").textContent = data.tasks.filter(t => t.status !== "Completed").length;
  document.getElementById("stat-completed").textContent = data.tasks.filter(t => t.status === "Completed").length;
  document.getElementById("stat-overdue").textContent = data.tasks.filter(isOverdue).length;

  let attended = 0, total = 0;
  data.meetings.forEach(m => { if (m.attendanceTaken) { const s = meetingStats(m); attended += s.attended; total += s.total; } });
  document.getElementById("stat-attendance").textContent = total ? Math.round(attended / total * 100) + "%" : "–";

  const groups = reminderGroups(dueSoonTasks());
  const banner = document.getElementById("reminder-banner");
  banner.classList.toggle("hidden", !groups.length);
  const taskCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  banner.innerHTML = groups.length ? `<span>⏰ <strong>${groups.length}</strong> ${groups.length > 1 ? "people have" : "person has"} <strong>${taskCount}</strong> task(s) overdue or due soon.</span><button class="small-btn accent" data-go="reminders">Send reminders</button>` : "";

  const recent = [...data.meetings].sort((a,b) => b.date.localeCompare(a.date)).slice(0,4);
  document.getElementById("recent-meetings").innerHTML = recent.length ? recent.map(m => {
    const s = meetingStats(m);
    const att = m.attendanceTaken ? ` · ${s.attended}/${s.total} attended` : "";
    return `<div class="list-row"><div><strong>${escapeHTML(m.title)}</strong><small>${formatDate(m.date)} · ${escapeHTML(m.location)}${att}</small></div><button class="text-btn" data-details="${m.id}">Open</button></div>`;
  }).join("") : '<div class="empty-state">No meetings recorded yet. Add your first meeting.</div>';

  const attention = data.tasks.filter(t => t.status !== "Completed").sort((a,b) => a.deadline.localeCompare(b.deadline)).slice(0,4);
  document.getElementById("attention-tasks").innerHTML = attention.length ? attention.map(t =>
    `<div class="list-row"><div><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.assignee)} · Due ${formatDate(t.deadline)}</small></div>${statusBadge(t)}</div>`
  ).join("") : '<div class="empty-state">No open tasks. Great work!</div>';
}
function renderMeetings() {
  const root = document.getElementById("meetings-list");
  const meetings = [...data.meetings].sort((a,b) => b.date.localeCompare(a.date));
  root.innerHTML = meetings.length ? meetings.map(m => {
    const taskCount = data.tasks.filter(t => t.meetingId === m.id).length;
    const s = meetingStats(m);
    const attText = m.attendanceTaken ? `${s.attended}/${s.total} attended · ${s.a} absent` : "Attendance not taken";
    return `<article class="meeting-card"><h3>${escapeHTML(m.title)}</h3><div class="meeting-meta"><span>▣ ${formatDate(m.date)}</span><span>⌖ ${escapeHTML(m.location)}</span><span>☑ ${taskCount} task(s)</span><span>✔ ${attText}</span></div><p>${escapeHTML(m.agenda || "No agenda added.")}</p><div class="card-actions">${canEdit() ? `<button class="small-btn accent" data-attendance="${m.id}">${m.attendanceTaken ? "Edit attendance" : "Take attendance"}</button>` : ""}<button class="small-btn" data-details="${m.id}">View details</button>${canEdit() ? `<button class="small-btn" data-delete-meeting="${m.id}">Delete</button>` : ""}</div></article>`;
  }).join("") : '<div class="panel empty-state">No meetings yet. Select “Add meeting” to create your first record.</div>';
}
function renderRegister() {
  const table = document.getElementById("register-table");
  const members = sortedMembers();
  const taken = data.meetings.filter(m => m.attendanceTaken).sort((a,b) => a.date.localeCompare(b.date));
  document.getElementById("empty-register").classList.toggle("hidden", members.length > 0);
  document.getElementById("register-hint").classList.toggle("hidden", !members.length || taken.length > 0);
  if (!members.length) { table.innerHTML = ""; return; }
  const head = `<thead><tr><th>Member</th>${taken.map(m => `<th class="reg-col">${canEdit() ? `<button class="reg-head" data-attendance="${m.id}" title="Edit attendance for ${escapeHTML(m.title)}">${formatShort(m.date)}<small>${escapeHTML(m.title)}</small></button>` : `${formatShort(m.date)}<small>${escapeHTML(m.title)}</small>`}</th>`).join("")}<th>Attended</th><th>%</th>${canEdit() ? "<th>Manage</th>" : ""}</tr></thead>`;
  const rows = members.map(mem => {
    const st = memberStats(mem);
    const low = st.percent !== null && st.percent < LOW_ATTENDANCE;
    const cells = taken.map(m => {
      const v = (m.attendance || {})[mem.id];
      return `<td class="reg-cell ${v ? v.toLowerCase() : "none"}">${v || "–"}</td>`;
    }).join("");
    return `<tr><td class="member-cell"><span class="roll">${escapeHTML(mem.roll)}</span>${escapeHTML(mem.name)}</td>${cells}<td>${st.total ? st.attended + "/" + st.total : "–"}</td><td>${st.total ? `<span class="status ${low ? "absent" : "present"}">${st.percent}%</span>` : "–"}</td>${canEdit() ? `<td><button class="table-action" data-edit-member="${mem.id}">Edit</button> <button class="table-action" data-delete-member="${mem.id}">Delete</button></td>` : ""}</tr>`;
  }).join("");
  table.innerHTML = head + `<tbody>${rows}</tbody>`;
}
function renderTasks() {
  const query = document.getElementById("task-search").value.toLowerCase();
  const filter = document.getElementById("task-filter").value;
  const tasks = data.tasks.filter(t => {
    const meeting = data.meetings.find(m => m.id === t.meetingId);
    const matches = `${t.title} ${t.assignee} ${meeting?.title || ""}`.toLowerCase().includes(query);
    return matches && (filter === "all" || t.status === filter);
  }).sort((a,b) => a.deadline.localeCompare(b.deadline));
  document.getElementById("tasks-table").innerHTML = tasks.map(t => {
    const meeting = data.meetings.find(m => m.id === t.meetingId);
    const remind = t.status !== "Completed" ? `<button class="table-action" data-remind-task="${t.id}">⏰ Remind</button> ` : "";
    return `<tr><td>${escapeHTML(t.title)}</td><td>${escapeHTML(meeting?.title || "Meeting deleted")}</td><td>${escapeHTML(t.assignee)}</td><td>${formatDate(t.deadline)}</td><td>${statusBadge(t)}</td><td>${canEdit() ? `<select class="inline-status" data-status-id="${t.id}" aria-label="Change task status"><option ${t.status==="Pending"?"selected":""}>Pending</option><option ${t.status==="In Progress"?"selected":""}>In Progress</option><option ${t.status==="Completed"?"selected":""}>Completed</option></select> ${remind}<button class="table-action" data-delete-task="${t.id}">Delete</button>` : "View only"}</td></tr>`;
  }).join("");
  document.getElementById("empty-tasks").classList.toggle("hidden", tasks.length > 0);
}
function renderReminders() {
  const groups = reminderGroups(dueSoonTasks());
  document.getElementById("reminder-list").innerHTML = groups.length
    ? groups.map(reminderCardHTML).join("")
    : '<div class="panel empty-state">🎉 Nothing to chase right now. No tasks are overdue or due within the selected window.</div>';
  document.getElementById("remind-days").value = String(data.settings.remindDays);
  const badge = document.getElementById("reminder-badge");
  badge.textContent = groups.length; badge.classList.toggle("hidden", !groups.length);
  updateNotifyStatus();
}
function renderTaskMeetingOptions() {
  const select = document.getElementById("task-meeting");
  select.innerHTML = data.meetings.length ? data.meetings.map(m => `<option value="${m.id}">${escapeHTML(m.title)}</option>`).join("") : '<option value="">Create a meeting first</option>';
  document.getElementById("add-task").disabled = data.meetings.length === 0;
  document.getElementById("member-list").innerHTML = sortedMembers().map(m => `<option value="${escapeHTML(m.name)}"></option>`).join("");
}
function renderAll() {
  renderDashboard(); renderMeetings(); renderRegister(); renderTasks(); renderReminders(); renderTaskMeetingOptions();
}

/* ====================== Roll call ====================== */
function openSheet(id) {
  const m = data.meetings.find(x => x.id === id);
  if (!m) return;
  if (!data.members.length) { showToast("Add your members first, then take attendance."); navigate("attendance"); return; }
  const draft = {};
  data.members.forEach(mem => { draft[mem.id] = (m.attendance || {})[mem.id] || "P"; });
  sheet = { meetingId: id, draft };
  renderSheet(); openDialog("attendance-dialog");
}
function renderSheet() {
  if (!sheet) return;
  const m = data.meetings.find(x => x.id === sheet.meetingId);
  const members = sortedMembers();
  const vals = members.map(mem => sheet.draft[mem.id]);
  const p = vals.filter(v => v === "P").length, l = vals.filter(v => v === "L").length, a = vals.filter(v => v === "A").length;
  const pct = members.length ? Math.round((p + l) / members.length * 100) : 0;
  document.getElementById("attendance-title").textContent = m.title;
  document.getElementById("attendance-summary").innerHTML = `<div class="att-summary"><div class="att-summary-top"><span>${formatDate(m.date)} · ${escapeHTML(m.location)}</span><span><strong>${p}</strong> present · <strong>${l}</strong> late · <strong>${a}</strong> absent · ${pct}%</span></div><div class="att-bar"><span style="width:${pct}%"></span></div></div>`;
  const list = document.getElementById("attendance-list");
  const scroll = list.scrollTop;
  list.innerHTML = members.map(mem => {
    const v = sheet.draft[mem.id];
    const btn = (val, label) => `<button type="button" class="seg-btn ${v === val ? "on " + val.toLowerCase() : ""}" data-mark="${mem.id}" data-val="${val}" title="${label}" aria-label="${label}: ${escapeHTML(mem.name)}" aria-pressed="${v === val}">${val}</button>`;
    return `<div class="att-row"><span class="att-name"><span class="roll">${escapeHTML(mem.roll)}</span>${escapeHTML(mem.name)}</span><div class="seg">${btn("P","Present")}${btn("L","Late")}${btn("A","Absent")}</div></div>`;
  }).join("");
  list.scrollTop = scroll;
}
function setAll(val) {
  if (!sheet) return;
  data.members.forEach(mem => { sheet.draft[mem.id] = val; });
  renderSheet();
}

/* ====================== Dialogs ====================== */
function showMeetingDetails(id) {
  const m = data.meetings.find(item => item.id === id);
  if (!m) return;
  const related = data.tasks.filter(t => t.meetingId === id);
  const s = meetingStats(m);
  const icons = { P: "✔", L: "◔", A: "✘" }, names = { P: "Present", L: "Late", A: "Absent" };
  const attLines = sortedMembers().filter(mem => (m.attendance || {})[mem.id]).map(mem => {
    const v = m.attendance[mem.id];
    return `${icons[v]} ${escapeHTML(mem.roll)}. ${escapeHTML(mem.name)} — ${names[v]}`;
  });
  const attText = m.attendanceTaken && attLines.length ? attLines.join("\n") : "Attendance not taken yet.";
  document.getElementById("meeting-details").innerHTML = `
    <div class="modal-heading"><div><p class="eyebrow">MEETING DETAILS</p><h2>${escapeHTML(m.title)}</h2></div><button type="button" class="close-btn" data-close="details-dialog" aria-label="Close">×</button></div>
    <div class="meeting-meta"><span>▣ ${formatDate(m.date)}</span><span>⌖ ${escapeHTML(m.location)}</span></div>
    <div class="details-block"><h4>Agenda</h4><p>${escapeHTML(m.agenda || "No agenda recorded.")}</p></div>
    <div class="details-block"><h4>Attendance${m.attendanceTaken ? ` (${s.p} present, ${s.l} late, ${s.a} absent)` : ""}</h4><p>${attText}</p></div>
    <div class="details-block"><h4>Meeting minutes</h4><p>${escapeHTML(m.minutes || "No minutes recorded.")}</p></div>
    <div class="details-block"><h4>Action items (${related.length})</h4><p>${related.length ? related.map(t => `• ${escapeHTML(t.title)} — ${escapeHTML(t.assignee)} — ${escapeHTML(t.status)} (Due ${formatDate(t.deadline)})`).join("\n") : "No action items linked to this meeting."}</p></div>`;
  openDialog("details-dialog");
}
function openMemberDialog(id) {
  const form = document.getElementById("member-form");
  form.reset();
  const mem = id && data.members.find(m => m.id === id);
  document.getElementById("member-dialog-title").textContent = mem ? "Edit member" : "Add a member";
  form.elements.memberId.value = mem ? mem.id : "";
  form.elements.roll.value = mem ? mem.roll : nextRoll(data.members);
  form.elements.name.value = mem ? mem.name : "";
  form.elements.contact.value = mem ? mem.contact || "" : "";
  openDialog("member-dialog");
}
function openReminderFor(taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;
  document.getElementById("reminder-dialog-body").innerHTML = reminderCardHTML(reminderGroups([task])[0]);
  openDialog("reminder-dialog");
}

/* ====================== Events ====================== */
document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.page)));
document.getElementById("header-add-meeting").addEventListener("click", () => { if (requireEditor()) openDialog("meeting-dialog"); });
document.getElementById("add-meeting").addEventListener("click", () => { if (requireEditor()) openDialog("meeting-dialog"); });
document.getElementById("add-member").addEventListener("click", () => { if (requireEditor()) openMemberDialog(); });
document.getElementById("add-task").addEventListener("click", () => {
  if (!requireEditor()) return;
  if (!data.meetings.length) return showToast("Create a meeting before adding a task.");
  openDialog("task-dialog");
});

document.getElementById("meeting-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!requireEditor()) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  data.meetings.push({ id: uid(), ...values, attendance: {}, attendanceTaken: false, createdAt: new Date().toISOString() });
  saveData(); form.reset(); closeDialog("meeting-dialog"); navigate("meetings"); showToast("Meeting saved.");
});
document.getElementById("task-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!requireEditor()) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.meetingId) return showToast("Please select a meeting.");
  data.tasks.push({ id: uid(), ...values });
  saveData(); form.reset(); closeDialog("task-dialog"); navigate("tasks"); showToast("Task saved.");
});
document.querySelector('#task-form [name="assignee"]').addEventListener("input", e => {
  const mem = findMember(e.target.value);
  if (mem && mem.contact) document.querySelector('#task-form [name="contact"]').value = mem.contact;
});
document.getElementById("member-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!requireEditor()) return;
  const form = event.currentTarget;
  const v = Object.fromEntries(new FormData(form).entries());
  const roll = Number(v.roll), name = v.name.trim();
  if (data.members.some(m => Number(m.roll) === roll && m.id !== v.memberId)) return showToast("That roll number is already used.");
  if (data.members.some(m => m.name.trim().toLowerCase() === name.toLowerCase() && m.id !== v.memberId)) return showToast("A member with this name already exists.");
  if (v.memberId) {
    const mem = data.members.find(m => m.id === v.memberId);
    data.tasks.forEach(t => { if (t.assignee.trim().toLowerCase() === mem.name.trim().toLowerCase()) t.assignee = name; });
    Object.assign(mem, { roll, name, contact: v.contact.trim() });
  } else {
    data.members.push({ id: uid(), roll, name, contact: v.contact.trim() });
  }
  saveData(); closeDialog("member-dialog"); showToast("Member saved.");
});

document.getElementById("mark-all-present").addEventListener("click", () => setAll("P"));
document.getElementById("mark-all-absent").addEventListener("click", () => setAll("A"));
document.getElementById("save-attendance").addEventListener("click", () => {
  if (!sheet) return;
  const m = data.meetings.find(x => x.id === sheet.meetingId);
  if (!m) return;
  m.attendance = { ...sheet.draft }; m.attendanceTaken = true;
  saveData(); closeDialog("attendance-dialog"); showToast("Attendance saved.");
});
document.getElementById("attendance-dialog").addEventListener("close", () => { sheet = null; });

document.getElementById("remind-days").addEventListener("change", e => { data.settings.remindDays = Number(e.target.value); saveData(); });
document.getElementById("enable-notify").addEventListener("click", () => {
  if (!("Notification" in window)) return;
  Notification.requestPermission().then(() => { updateNotifyStatus(); notifyDue(); });
});
document.getElementById("task-search").addEventListener("input", renderTasks);
document.getElementById("task-filter").addEventListener("change", renderTasks);

document.addEventListener("click", event => {
  const t = event.target;
  const closer = t.closest("[data-close]");   if (closer) closeDialog(closer.dataset.close);
  const go = t.closest("[data-go]");          if (go) navigate(go.dataset.go);
  const details = t.closest("[data-details]"); if (details) showMeetingDetails(details.dataset.details);
  const att = t.closest("[data-attendance]");  if (att) openSheet(att.dataset.attendance);

  const mark = t.closest("[data-mark]");
  if (mark && sheet) { sheet.draft[mark.dataset.mark] = mark.dataset.val; renderSheet(); }

  const editMember = t.closest("[data-edit-member]");  if (editMember) openMemberDialog(editMember.dataset.editMember);
  const delMember = t.closest("[data-delete-member]");
  if (delMember) {
    const id = delMember.dataset.deleteMember;
    if (!confirm("Remove this member and their attendance records?")) return;
    data.members = data.members.filter(m => m.id !== id);
    data.meetings.forEach(m => { if (m.attendance) delete m.attendance[id]; });
    saveData(); showToast("Member removed.");
  }

  const remindTask = t.closest("[data-remind-task]"); if (remindTask) openReminderFor(remindTask.dataset.remindTask);
  const reminded = t.closest("[data-reminded]");
  if (reminded) { const ids = reminded.dataset.reminded.split(","); setTimeout(() => markReminded(ids), 400); } // let the mail/WhatsApp link open first
  const copy = t.closest("[data-copy-reminder]");
  if (copy) {
    const ids = copy.dataset.copyReminder.split(",");
    const g = groupFromTaskIds(ids);
    if (g) copyText(reminderMessage(g)).then(ok => { if (ok) { markReminded(ids); showToast("Reminder message copied."); } else showToast("Could not copy – please copy it manually."); });
  }

  const delMeeting = t.closest("[data-delete-meeting]");
  if (delMeeting) {
    const id = delMeeting.dataset.deleteMeeting;
    if (!confirm("Delete this meeting and all tasks linked to it?")) return;
    data.meetings = data.meetings.filter(m => m.id !== id);
    data.tasks = data.tasks.filter(x => x.meetingId !== id);
    saveData(); showToast("Meeting deleted.");
  }
  const delTask = t.closest("[data-delete-task]");
  if (delTask) {
    if (!confirm("Delete this task?")) return;
    data.tasks = data.tasks.filter(x => x.id !== delTask.dataset.deleteTask);
    saveData(); showToast("Task deleted.");
  }
});
document.addEventListener("change", event => {
  if (event.target.matches("[data-status-id]")) {
    const task = data.tasks.find(t => t.id === event.target.dataset.statusId);
    if (task) { task.status = event.target.value; saveData(); showToast("Task status updated."); }
  }
});

document.getElementById("today-label").textContent = new Date().toLocaleDateString(undefined, {weekday:"long",day:"numeric",month:"long",year:"numeric"});
renderAll();
notifyDue();
setInterval(() => { renderAll(); notifyDue(); }, 60 * 60 * 1000); // refresh hourly if the page stays open
