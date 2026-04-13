const YEAR_OPTIONS = ["First Year", "Second Year", "Third Year", "Fourth Year", "Graduate"];

let appState = {
  user: null,
  events: [],
  officers: [],
  leaderboard: [],
  checkinMessage: ""
};
let deferredPrompt;
let pendingCheckinToken = new URLSearchParams(window.location.search).get("checkin") || "";
let activeCheckinUrl = "";

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
const adminEventForm = document.getElementById("adminEventForm");
const adminNote = document.getElementById("adminNote");
const upcomingEventsGrid = document.getElementById("upcomingEventsGrid");
const completedEventsGrid = document.getElementById("completedEventsGrid");
const officerGrid = document.getElementById("officerGrid");
const leaderboardList = document.getElementById("leaderboardList");
const podium = document.getElementById("podium");
const adminEventList = document.getElementById("adminEventList");
const adminCheckinLinkBox = document.getElementById("adminCheckinLinkBox");
const adminCheckinLink = document.getElementById("adminCheckinLink");
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
        officerInviteCode: String(formData.get("officerInviteCode") || "").trim()
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
        year: profileYearInput.value
      })
    });
    profileNote.textContent = "Your profile has been updated.";
    renderDashboard();
  } catch (error) {
    profileNote.textContent = error.message;
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
  appState = { user: null, events: [], officers: [], leaderboard: [], checkinMessage: "" };
  profileNote.textContent = "";
  adminNote.textContent = "";
  activeCheckinUrl = "";
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
    const data = await apiFetch(`/api/admin/events/${eventId}/checkin/start`, {
      method: "POST",
      body: JSON.stringify({})
    });
    appState = data;
    activeCheckinUrl = `${window.location.origin}${data.checkinLink}`;
    adminNote.textContent = "Check-in is live for this event.";
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
    activeCheckinUrl = "";
    adminNote.textContent = "Check-in stopped for this event.";
    renderDashboard();
  } catch (error) {
    adminNote.textContent = error.message;
  }
}

async function copyCheckinLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    adminNote.textContent = "Check-in link copied. Use it to generate your event QR code.";
  } catch (error) {
    adminNote.textContent = "Copy failed. You can still open the link below manually.";
  }
}

function renderEventCard(eventRecord) {
  const card = document.createElement("article");
  card.className = `event-card ${eventRecord.status === "completed" ? "completed-card" : ""}`;
  card.innerHTML = `
    <span class="event-type-badge">${eventRecord.type} � ${eventRecord.stars} stars</span>
    <span class="event-status-badge">${eventRecord.status === "completed" ? "Completed" : "Upcoming"}</span>
    <h3>${eventRecord.title}</h3>
    <time>${eventRecord.date} � ${eventRecord.time}</time>
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
  } else if (eventRecord.status !== "completed") {
    info.textContent = "RSVP saves your spot. Stars are awarded only after you scan the live event check-in QR code.";
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
        <span>${member.major} � ${member.year}</span>
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
  adminCheckinLinkBox.classList.toggle("hidden", !activeCheckinUrl);
  if (activeCheckinUrl) {
    adminCheckinLink.href = activeCheckinUrl;
    adminCheckinLink.textContent = activeCheckinUrl;
  }

  if (!isOfficer) {
    if (document.querySelector(".view.active")?.dataset.view === "admin") {
      showTab("home");
    }
    return;
  }

  adminEventList.innerHTML = "";
  appState.events.forEach((eventRecord) => {
    const row = document.createElement("article");
    row.className = "admin-event-row";
    row.innerHTML = `
      <strong>${eventRecord.title}</strong>
      <div class="admin-event-meta">${eventRecord.status} � ${eventRecord.type} � ${eventRecord.date} � ${eventRecord.time}</div>
      <div class="admin-event-meta">${eventRecord.location} � ${eventRecord.stars} stars � ${eventRecord.attendanceCount} attended</div>
      <div class="admin-event-actions">
        <button class="button button-ghost" type="button">${eventRecord.checkinActive ? "Check-in Live" : "Start Check-in"}</button>
        <button class="button button-secondary" type="button">Copy Link</button>
        <button class="button button-secondary" type="button">Stop Check-in</button>
        <button class="button button-danger" type="button">Delete Event</button>
      </div>
    `;
    const buttons = row.querySelectorAll("button");
    buttons[0].addEventListener("click", () => startCheckin(eventRecord.id));
    buttons[1].addEventListener("click", async () => {
      const url = `${window.location.origin}/?checkin=${eventRecord.checkinToken}`;
      if (!eventRecord.checkinToken) {
        await startCheckin(eventRecord.id);
        if (activeCheckinUrl) {
          await copyCheckinLink(activeCheckinUrl);
        }
      } else {
        await copyCheckinLink(url);
      }
    });
    buttons[2].addEventListener("click", () => stopCheckin(eventRecord.id));
    buttons[3].addEventListener("click", () => deleteEvent(eventRecord.id));
    buttons[2].disabled = !eventRecord.checkinActive;
    adminEventList.appendChild(row);
  });
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
    : "Welcome back. RSVP to events, then scan the live event QR code when you attend to earn SASE stars.";

  profileStars.textContent = `${user.stars}`;
  profileInterestedCount.textContent = `${appState.events.filter((eventRecord) => eventRecord.isInterested).length}`;
  profileRsvpCount.textContent = `${appState.events.filter((eventRecord) => eventRecord.isRsvped).length}`;
  profileNameInput.value = user.name;
  profileMajorInput.value = user.major;
  profileYearInput.value = YEAR_OPTIONS.includes(user.year) ? user.year : YEAR_OPTIONS[0];
  profileStarsInput.value = `${user.stars} stars`;
  profileEmail.textContent = user.email;
  profileRole.textContent = user.role === "officer" ? "Officer" : "Member";
  profileEligibility.textContent = user.eligibleForLeaderboard ? "Eligible" : "Officer excluded from prizes";

  if (nextEvent) {
    homeNextEvent.innerHTML = `
      <strong>${nextEvent.title}</strong>
      <p>${nextEvent.date} � ${nextEvent.time}</p>
      <p>${nextEvent.location}</p>
      <p>${nextEvent.type} event worth ${nextEvent.stars} stars after check-in.</p>
    `;
  } else {
    homeNextEvent.innerHTML = "<strong>No upcoming events yet.</strong>";
  }
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
