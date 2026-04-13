const YEAR_OPTIONS = ["First Year", "Second Year", "Third Year", "Fourth Year", "Graduate"];

let appState = {
  user: null,
  events: [],
  officers: [],
  leaderboard: [],
  liveCheckinEvent: null,
  adminLiveCheckinEvent: null,
  checkinMessage: ""
};
let deferredPrompt;
let pendingCheckinToken = new URLSearchParams(window.location.search).get("checkin") || "";

const authScreen = document.getElementById("authScreen");
const dashboard = document.getElementById("dashboard");
const checkinPrompt = document.getElementById("checkinPrompt");
const checkinPromptEvent = document.getElementById("checkinPromptEvent");
const checkinStatusBanner = document.getElementById("checkinStatusBanner");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginNote = document.getElementById("loginNote");
const signupNote = document.getElementById("signupNote");
const profileForm = document.getElementById("profileForm");
const profileNote = document.getElementById("profileNote");
const liveCheckinForm = document.getElementById("liveCheckinForm");
const liveCheckinCodeInput = document.getElementById("liveCheckinCodeInput");
const liveCheckinPanel = document.getElementById("liveCheckinPanel");
const liveCheckinNote = document.getElementById("liveCheckinNote");
const adminEventForm = document.getElementById("adminEventForm");
const adminNote = document.getElementById("adminNote");
const upcomingEventsGrid = document.getElementById("upcomingEventsGrid");
const completedEventsGrid = document.getElementById("completedEventsGrid");
const officerGrid = document.getElementById("officerGrid");
const leaderboardList = document.getElementById("leaderboardList");
const podium = document.getElementById("podium");
const adminEventList = document.getElementById("adminEventList");
const adminCheckinLinkBox = document.getElementById("adminCheckinLinkBox");
const adminAttendanceCode = document.getElementById("adminAttendanceCode");
const adminAttendanceEvent = document.getElementById("adminAttendanceEvent");
const installButton = document.getElementById("installButton");
const adminTabButton = document.getElementById("adminTabButton");
const adminView = document.getElementById("adminView");
const logoutButton = document.getElementById("logoutButton");
const welcomeMessage = document.getElementById("welcomeMessage");
const welcomeSubtext = document.getElementById("welcomeSubtext");
const profileStars = document.getElementById("profileStars");
const profileInterestedCount = document.getElementById("profileInterestedCount");
const profileRsvpCount = document.getElementById("profileRsvpCount");
const profileNameInput = document.getElementById("profileNameInput");
const profileMajorInput = document.getElementById("profileMajorInput");
const profileYearInput = document.getElementById("profileYearInput");
const profileStarsInput = document.getElementById("profileStarsInput");
const profilePositionField = document.getElementById("profilePositionField");
const profilePositionInput = document.getElementById("profilePositionInput");
const profileBioField = document.getElementById("profileBioField");
const profileBioInput = document.getElementById("profileBioInput");
const profileEmail = document.getElementById("profileEmail");
const profileRole = document.getElementById("profileRole");
const profileEligibility = document.getElementById("profileEligibility");
const homeNextEvent = document.getElementById("homeNextEvent");
const authTabButtons = document.querySelectorAll("[data-auth-view]");
const navButtons = document.querySelectorAll("[data-tab-target]");
const views = document.querySelectorAll(".view");

function apiFetch(url, options = {}) {
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin",
    ...options
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }
    return data;
  });
}

function createEmptyState(message) {
  const stateNode = document.createElement("div");
  stateNode.className = "empty-state";
  stateNode.textContent = message;
  return stateNode;
}

function clearCheckinQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkin");
  window.history.replaceState({}, "", url);
}

function setBanner(message) {
  appState.checkinMessage = message || "";
  checkinStatusBanner.textContent = appState.checkinMessage;
  checkinStatusBanner.classList.toggle("hidden", !appState.checkinMessage);
}

function showAuthView(target) {
  authTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authView === target);
  });
  loginForm.classList.toggle("hidden", target !== "login");
  signupForm.classList.toggle("hidden", target !== "signup");
  loginNote.textContent = "";
  signupNote.textContent = "";
}

async function loadCheckinPrompt() {
  if (!pendingCheckinToken || appState.user) {
    checkinPrompt.classList.add("hidden");
    return;
  }

  try {
    const data = await apiFetch(`/api/checkin/${pendingCheckinToken}`);
    checkinPromptEvent.textContent = data.event.title;
    checkinPrompt.classList.remove("hidden");
  } catch (error) {
    checkinPrompt.classList.remove("hidden");
    checkinPrompt.innerHTML = `<strong>Check-in link:</strong> ${error.message}`;
  }
}

async function claimPendingCheckin() {
  if (!pendingCheckinToken || !appState.user) {
    return;
  }

  try {
    const data = await apiFetch(`/api/checkin/${pendingCheckinToken}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    appState = data;
    setBanner(data.checkinMessage || "Attendance confirmed.");
  } catch (error) {
    setBanner(error.message);
  } finally {
    pendingCheckinToken = "";
    clearCheckinQuery();
  }
}

authTabButtons.forEach((button) => {
  button.addEventListener("click", () => showAuthView(button.dataset.authView));
});

navButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    if (button.tagName === "A") {
      event.preventDefault();
    }
    showTab(button.dataset.tabTarget);
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginNote.textContent = "";
  const formData = new FormData(loginForm);

  try {
    appState = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || "")
      })
    });
    loginForm.reset();
    await claimPendingCheckin();
    renderApp();
  } catch (error) {
    loginNote.textContent = error.message;
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signupNote.textContent = "";
  const formData = new FormData(signupForm);

  try {
    appState = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        major: String(formData.get("major") || "").trim(),
        year: String(formData.get("year") || ""),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || "member"),
        officerInviteCode: String(formData.get("officerInviteCode") || "").trim(),
        position: String(formData.get("position") || "").trim(),
        bio: String(formData.get("bio") || "").trim()
      })
    });
    signupForm.reset();
    await claimPendingCheckin();
    renderApp();
  } catch (error) {
    signupNote.textContent = error.message;
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileNote.textContent = "";

  try {
    appState = await apiFetch("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: profileNameInput.value.trim(),
        major: profileMajorInput.value.trim(),
        year: profileYearInput.value,
        position: profilePositionInput ? profilePositionInput.value.trim() : "",
        bio: profileBioInput ? profileBioInput.value.trim() : ""
      })
    });
    profileNote.textContent = "Your profile has been updated.";
    renderDashboard();
  } catch (error) {
    profileNote.textContent = error.message;
  }
});

liveCheckinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  liveCheckinNote.textContent = "";

  try {
    appState = await apiFetch("/api/live-checkin", {
      method: "POST",
      body: JSON.stringify({
        attendanceCode: liveCheckinCodeInput.value.trim().toUpperCase()
      })
    });
    liveCheckinCodeInput.value = "";
    liveCheckinNote.textContent = appState.checkinMessage || "Attendance confirmed.";
    renderDashboard();
    setBanner(appState.checkinMessage || "Attendance confirmed.");
  } catch (error) {
    liveCheckinNote.textContent = error.message;
  }
});

adminEventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminNote.textContent = "";
  const formData = new FormData(adminEventForm);

  try {
    appState = await apiFetch("/api/admin/events", {
      method: "POST",
      body: JSON.stringify({
        title: String(formData.get("title") || "").trim(),
        type: String(formData.get("type") || ""),
        status: String(formData.get("status") || "upcoming"),
        date: String(formData.get("date") || "").trim(),
        time: String(formData.get("time") || "").trim(),
        location: String(formData.get("location") || "").trim(),
        stars: Number(formData.get("stars") || 0),
        description: String(formData.get("description") || "").trim()
      })
    });
    adminEventForm.reset();
    adminNote.textContent = "Event added to the lineup.";
    renderDashboard();
  } catch (error) {
    adminNote.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  appState = {
    user: null,
    events: [],
    officers: [],
    leaderboard: [],
    liveCheckinEvent: null,
    adminLiveCheckinEvent: null,
    checkinMessage: ""
  };
  profileNote.textContent = "";
  adminNote.textContent = "";
  liveCheckinNote.textContent = "";
  renderApp();
  await loadCheckinPrompt();
});

function showTab(viewName) {
  if (viewName === "admin" && appState.user?.role !== "officer") {
    viewName = "home";
  }

  views.forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  document.querySelectorAll(".nav-pill").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === viewName);
  });
}

async function toggleInterest(eventId) {
  try {
    appState = await apiFetch(`/api/events/${eventId}/interest`, {
      method: "POST",
      body: JSON.stringify({})
    });
    renderDashboard();
  } catch (error) {
    profileNote.textContent = error.message;
  }
}

async function toggleRsvp(eventId) {
  try {
    appState = await apiFetch(`/api/events/${eventId}/rsvp`, {
      method: "POST",
      body: JSON.stringify({})
    });
    renderDashboard();
  } catch (error) {
    profileNote.textContent = error.message;
  }
}

async function deleteEvent(eventId) {
  try {
    appState = await apiFetch(`/api/admin/events/${eventId}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    renderDashboard();
  } catch (error) {
    adminNote.textContent = error.message;
  }
}

async function startCheckin(eventId) {
  try {
    appState = await apiFetch(`/api/admin/events/${eventId}/checkin/start`, {
      method: "POST",
      body: JSON.stringify({})
    });
    adminNote.textContent = "Live attendance started. Members can scan the permanent SASE QR and enter the code shown here.";
    renderDashboard();
  } catch (error) {
    adminNote.textContent = error.message;
  }
}

async function stopCheckin(eventId) {
  try {
    appState = await apiFetch(`/api/admin/events/${eventId}/checkin/stop`, {
      method: "POST",
      body: JSON.stringify({})
    });
    adminNote.textContent = "Live attendance stopped for this event.";
    renderDashboard();
  } catch (error) {
    adminNote.textContent = error.message;
  }
}

function renderEventCard(eventRecord) {
  const card = document.createElement("article");
  card.className = `event-card ${eventRecord.status === "completed" ? "completed-card" : ""}`;
  card.innerHTML = `
    <span class="event-type-badge">${eventRecord.type} - ${eventRecord.stars} stars</span>
    <span class="event-status-badge">${eventRecord.status === "completed" ? "Completed" : "Upcoming"}</span>
    <h3>${eventRecord.title}</h3>
    <time>${eventRecord.date} - ${eventRecord.time}</time>
    <div class="event-meta">
      <span>${eventRecord.location}</span>
    </div>
    <p>${eventRecord.description}</p>
    <div class="event-counts">
      <span>${eventRecord.interestedCount} interested</span>
      <span>${eventRecord.rsvpCount} RSVP'd</span>
      <span>${eventRecord.attendanceCount} attended</span>
    </div>
  `;

  const info = document.createElement("p");
  info.className = "muted-text";
  if (eventRecord.isAttended) {
    info.textContent = `Attendance confirmed. ${eventRecord.stars} stars earned.`;
  } else if (appState.liveCheckinEvent && appState.liveCheckinEvent.id === eventRecord.id) {
    info.textContent = "This event is live now. Scan the club QR, log in, and enter the attendance code shown at the event.";
  } else if (eventRecord.status !== "completed") {
    info.textContent = "RSVP saves your spot. Stars are awarded only after you attend and enter the live event code.";
  } else {
    info.textContent = "This event is completed. Stars are only awarded to members who checked in during attendance.";
  }
  card.appendChild(info);

  if (eventRecord.status !== "completed") {
    const actionRow = document.createElement("div");
    actionRow.className = "event-actions";
    actionRow.innerHTML = `
      <button class="button ${eventRecord.isInterested ? "button-soft" : "button-secondary"}" type="button">
        ${eventRecord.isInterested ? "Interested" : "I'm Interested"}
      </button>
      <button class="button ${eventRecord.isRsvped ? "button-primary" : "button-ghost"}" type="button">
        ${eventRecord.isRsvped ? "RSVP'd" : "RSVP"}
      </button>
    `;
    const buttons = actionRow.querySelectorAll("button");
    buttons[0].addEventListener("click", () => toggleInterest(eventRecord.id));
    buttons[1].addEventListener("click", () => toggleRsvp(eventRecord.id));
    card.appendChild(actionRow);
  }

  return card;
}

function renderEvents() {
  const upcomingEvents = appState.events.filter((eventRecord) => eventRecord.status !== "completed");
  const completedEvents = appState.events.filter((eventRecord) => eventRecord.status === "completed");

  upcomingEventsGrid.innerHTML = "";
  completedEventsGrid.innerHTML = "";

  if (upcomingEvents.length === 0) {
    upcomingEventsGrid.appendChild(createEmptyState("No upcoming events yet."));
  } else {
    upcomingEvents.forEach((eventRecord) => {
      upcomingEventsGrid.appendChild(renderEventCard(eventRecord));
    });
  }

  if (completedEvents.length === 0) {
    completedEventsGrid.appendChild(createEmptyState("No completed events yet."));
  } else {
    completedEvents.forEach((eventRecord) => {
      completedEventsGrid.appendChild(renderEventCard(eventRecord));
    });
  }
}

function renderOfficers() {
  officerGrid.innerHTML = "";
  if (!appState.officers.length) {
    officerGrid.appendChild(createEmptyState("Officer accounts will show up here once they are created."));
    return;
  }

  appState.officers.forEach((officer) => {
    const card = document.createElement("article");
    card.className = "officer-card";
    card.innerHTML = `
      <div class="officer-avatar" aria-hidden="true">${officer.initials}</div>
      <h3>${officer.name}</h3>
      <p class="officer-role">${officer.role}</p>
      <p>${officer.major}</p>
      <p>${officer.bio}</p>
    `;
    officerGrid.appendChild(card);
  });
}

function renderLeaderboard() {
  leaderboardList.innerHTML = "";
  podium.innerHTML = "";

  if (!appState.leaderboard.length) {
    leaderboardList.appendChild(createEmptyState("Once members attend events and check in, the leaderboard will show up here."));
    podium.appendChild(createEmptyState("No ranked members yet."));
    return;
  }

  [appState.leaderboard[1], appState.leaderboard[0], appState.leaderboard[2]]
    .filter(Boolean)
    .forEach((member, index) => {
      const classes = ["second", "first", "third"];
      const place = document.createElement("div");
      place.className = `podium-place ${classes[index]}`;
      place.innerHTML = `
        <div class="podium-label">
          <strong>${member.name}</strong>
          <div>${member.major}</div>
          <div>${member.year}</div>
          <div>${member.stars} stars</div>
        </div>
        <div class="podium-pillar"></div>
      `;
      podium.appendChild(place);
    });

  appState.leaderboard.forEach((member, index) => {
    const row = document.createElement("article");
    row.className = "leaderboard-row";
    row.innerHTML = `
      <div class="rank-badge">${index + 1}</div>
      <div>
        <div class="leaderboard-name">${member.name}</div>
        <span>${member.major} - ${member.year}</span>
      </div>
      <div class="leaderboard-stars">${member.stars}</div>
    `;
    leaderboardList.appendChild(row);
  });
}

function renderAdmin() {
  const isOfficer = appState.user?.role === "officer";
  adminTabButton.classList.toggle("hidden", !isOfficer);
  adminView.classList.toggle("hidden", !isOfficer);

  if (!isOfficer) {
    adminCheckinLinkBox.classList.add("hidden");
    if (document.querySelector(".view.active")?.dataset.view === "admin") {
      showTab("home");
    }
    return;
  }

  const activeEvent = appState.adminLiveCheckinEvent;
  adminCheckinLinkBox.classList.toggle("hidden", !activeEvent);
  adminAttendanceCode.textContent = activeEvent?.attendanceCode || "";
  adminAttendanceEvent.textContent = activeEvent
    ? `${activeEvent.title} - ${activeEvent.date} - ${activeEvent.time}`
    : "";

  adminEventList.innerHTML = "";
  appState.events.forEach((eventRecord) => {
    const row = document.createElement("article");
    row.className = "admin-event-row";
    row.innerHTML = `
      <strong>${eventRecord.title}</strong>
      <div class="admin-event-meta">${eventRecord.status} - ${eventRecord.type} - ${eventRecord.date} - ${eventRecord.time}</div>
      <div class="admin-event-meta">${eventRecord.location} - ${eventRecord.stars} stars - ${eventRecord.attendanceCount} attended</div>
      <div class="admin-event-actions">
        <button class="button button-ghost" type="button">${eventRecord.checkinActive ? "Attendance Live" : "Start Attendance"}</button>
        <button class="button button-secondary" type="button">Stop Attendance</button>
        <button class="button button-danger" type="button">Delete Event</button>
      </div>
    `;
    const buttons = row.querySelectorAll("button");
    buttons[0].addEventListener("click", () => startCheckin(eventRecord.id));
    buttons[1].addEventListener("click", () => stopCheckin(eventRecord.id));
    buttons[2].addEventListener("click", () => deleteEvent(eventRecord.id));
    buttons[1].disabled = !eventRecord.checkinActive;
    adminEventList.appendChild(row);
  });
}

function renderLiveCheckin() {
  const liveEvent = appState.liveCheckinEvent;
  liveCheckinNote.textContent = "";

  if (!liveEvent) {
    liveCheckinPanel.innerHTML = "<strong>No live attendance right now.</strong><p>When an officer starts event attendance, enter the code shown at the event here.</p>";
    liveCheckinForm.classList.add("hidden");
    return;
  }

  liveCheckinPanel.innerHTML = `
    <strong>${liveEvent.title}</strong>
    <p>${liveEvent.date} - ${liveEvent.time}</p>
    <p>${liveEvent.location}</p>
    <p>Enter the attendance code shown by an officer to earn ${liveEvent.stars} stars.</p>
  `;
  liveCheckinForm.classList.remove("hidden");

  const liveEventRecord = appState.events.find((eventRecord) => eventRecord.id === liveEvent.id);
  if (liveEventRecord?.isAttended) {
    liveCheckinNote.textContent = `You are already checked in for ${liveEvent.title}.`;
  }
}

function renderHome() {
  const user = appState.user;
  if (!user) {
    return;
  }

  const nextEvent = appState.events.find((eventRecord) => eventRecord.status !== "completed") || null;
  const latestEvent = [...appState.events]
    .filter((eventRecord) => eventRecord.isAttended)
    .at(-1) || null;

  welcomeMessage.textContent = `Hello, ${user.name.split(" ")[0]}!`;
  welcomeSubtext.textContent = latestEvent
    ? `Welcome back. Your latest attended event earned ${latestEvent.stars} stars from ${latestEvent.title}.`
    : "Welcome back. RSVP to events, then scan the SASE QR at the event and enter the live attendance code to earn stars.";

  profileStars.textContent = `${user.stars}`;
  profileInterestedCount.textContent = `${appState.events.filter((eventRecord) => eventRecord.isInterested).length}`;
  profileRsvpCount.textContent = `${appState.events.filter((eventRecord) => eventRecord.isRsvped).length}`;
  profileNameInput.value = user.name;
  profileMajorInput.value = user.major;
  profileYearInput.value = YEAR_OPTIONS.includes(user.year) ? user.year : YEAR_OPTIONS[0];
  profileStarsInput.value = `${user.stars} stars`;
  profilePositionInput.value = user.position || "";
  profileBioInput.value = user.bio || "";
  profilePositionField.classList.toggle("hidden", user.role !== "officer");
  profileBioField.classList.toggle("hidden", user.role !== "officer");
  profileEmail.textContent = user.email;
  profileRole.textContent = user.role === "officer" ? "Officer" : "Member";
  profileEligibility.textContent = user.eligibleForLeaderboard ? "Eligible" : "Officer excluded from prizes";

  if (nextEvent) {
    homeNextEvent.innerHTML = `
      <strong>${nextEvent.title}</strong>
      <p>${nextEvent.date} - ${nextEvent.time}</p>
      <p>${nextEvent.location}</p>
      <p>${nextEvent.type} event worth ${nextEvent.stars} stars after live attendance check-in.</p>
    `;
  } else {
    homeNextEvent.innerHTML = "<strong>No upcoming events yet.</strong>";
  }

  renderLiveCheckin();
}

function renderDashboard() {
  renderHome();
  renderEvents();
  renderLeaderboard();
  renderOfficers();
  renderAdmin();
}

function renderApp() {
  const currentUser = appState.user;
  authScreen.classList.toggle("hidden", Boolean(currentUser));
  dashboard.classList.toggle("hidden", !currentUser);
  setBanner(appState.checkinMessage);

  if (currentUser) {
    loginNote.textContent = "";
    signupNote.textContent = "";
    checkinPrompt.classList.add("hidden");
    renderDashboard();
    showTab("home");
  } else {
    showAuthView("login");
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredPrompt) {
    return;
  }

  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  deferredPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

apiFetch("/api/bootstrap")
  .then(async (data) => {
    appState = data;
    renderApp();
    await loadCheckinPrompt();
    if (appState.user) {
      await claimPendingCheckin();
      renderApp();
    }
  })
  .catch((error) => {
    loginNote.textContent = error.message;
    renderApp();
  });