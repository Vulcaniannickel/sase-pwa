const YEAR_OPTIONS = ["First Year", "Second Year", "Third Year", "Fourth Year", "Graduate"];

let appState = {
  user: null,
  events: [],
  officers: [],
  leaderboard: [],
  liveCheckinEvent: null,
  adminLiveCheckinEvent: null,
  adminData: null,
  notifications: {
    supported: false,
    publicKey: ""
  },
  checkinMessage: ""
};
let deferredPrompt;
let pendingCheckinToken = new URLSearchParams(window.location.search).get("checkin") || "";
let pendingProfileImage = "";
let shouldPromptNotificationsAfterSignup = false;

const authScreen = document.getElementById("authScreen");
const dashboard = document.getElementById("dashboard");
const checkinPrompt = document.getElementById("checkinPrompt");
const checkinPromptEvent = document.getElementById("checkinPromptEvent");
const checkinStatusBanner = document.getElementById("checkinStatusBanner");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const signupRoleSelect = document.getElementById("signupRoleSelect");
const signupOfficerInviteField = document.getElementById("signupOfficerInviteField");
const signupOfficerInviteInput = document.getElementById("signupOfficerInviteInput");
const signupOfficerPositionField = document.getElementById("signupOfficerPositionField");
const signupOfficerPositionInput = document.getElementById("signupOfficerPositionInput");
const signupOfficerBioField = document.getElementById("signupOfficerBioField");
const signupOfficerBioInput = document.getElementById("signupOfficerBioInput");
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
const adminNotificationForm = document.getElementById("adminNotificationForm");
const adminNotificationNote = document.getElementById("adminNotificationNote");
const notificationEventId = document.getElementById("notificationEventId");
const enableNotificationsButton = document.getElementById("enableNotificationsButton");
const disableNotificationsButton = document.getElementById("disableNotificationsButton");
const notificationNote = document.getElementById("notificationNote");
const notificationSupportNote = document.getElementById("notificationSupportNote");
const notificationPromptModal = document.getElementById("notificationPromptModal");
const notificationPromptEnable = document.getElementById("notificationPromptEnable");
const notificationPromptLater = document.getElementById("notificationPromptLater");
const upcomingEventsGrid = document.getElementById("upcomingEventsGrid");
const completedEventsGrid = document.getElementById("completedEventsGrid");
const officerGrid = document.getElementById("officerGrid");
const leaderboardList = document.getElementById("leaderboardList");
const podium = document.getElementById("podium");
const adminEventList = document.getElementById("adminEventList");
const adminCheckinLinkBox = document.getElementById("adminCheckinLinkBox");
const adminAttendanceCode = document.getElementById("adminAttendanceCode");
const adminAttendanceEvent = document.getElementById("adminAttendanceEvent");
const adminDataStats = document.getElementById("adminDataStats");
const adminDataUsers = document.getElementById("adminDataUsers");
const completedAdminEvents = document.getElementById("completedAdminEvents");
const completedEventsFilter = document.getElementById("completedEventsFilter");
const installButton = document.getElementById("installButton");
const adminTabButton = document.getElementById("adminTabButton");
const dataTabButton = document.getElementById("dataTabButton");
const adminView = document.getElementById("adminView");
const dataView = document.getElementById("dataView");
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
const profilePhotoField = document.getElementById("profilePhotoField");
const profilePhotoInput = document.getElementById("profilePhotoInput");
const profilePhotoPreview = document.getElementById("profilePhotoPreview");
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

function formatCheckinTime(isoString) {
  if (!isoString) {
    return "";
  }

  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getCompletedEventsFilterValue() {
  return (completedEventsFilter?.value || "").trim().toLowerCase();
}

function renderOfficerPhotoPreview(imageUrl, fallbackText = "Officer photo preview") {
  if (!profilePhotoPreview) {
    return;
  }

  profilePhotoPreview.classList.toggle("hidden", !imageUrl);
  profilePhotoPreview.innerHTML = imageUrl
    ? `<img src="${imageUrl}" alt="${fallbackText}">`
    : "";
}

function setNotificationPromptVisibility(visible) {
  notificationPromptModal?.classList.toggle("hidden", !visible);
}

async function getCurrentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
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
  updateSignupRoleFields();
}

function updateSignupRoleFields() {
  const isOfficer = signupRoleSelect?.value === "officer";
  signupOfficerInviteField?.classList.toggle("hidden", !isOfficer);
  signupOfficerPositionField?.classList.toggle("hidden", !isOfficer);
  signupOfficerBioField?.classList.toggle("hidden", !isOfficer);

  if (signupOfficerInviteInput) {
    signupOfficerInviteInput.disabled = !isOfficer;
    if (!isOfficer) {
      signupOfficerInviteInput.value = "";
    }
  }

  if (signupOfficerPositionInput) {
    signupOfficerPositionInput.disabled = !isOfficer;
    if (!isOfficer) {
      signupOfficerPositionInput.value = "";
    }
  }

  if (signupOfficerBioInput) {
    signupOfficerBioInput.disabled = !isOfficer;
    if (!isOfficer) {
      signupOfficerBioInput.value = "";
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
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

async function syncNotificationButtonState() {
  const supported = appState.notifications?.supported && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  enableNotificationsButton.classList.toggle("hidden", !appState.user || !supported);
  disableNotificationsButton.classList.toggle("hidden", true);

  if (!appState.user) {
    notificationSupportNote.textContent = "Notifications: log in and install the PWA to enable event reminders and updates.";
    notificationNote.textContent = "";
    setNotificationPromptVisibility(false);
    return;
  }

  if (!supported) {
    notificationSupportNote.textContent = "Notifications: this browser or deployment does not have push notifications ready yet.";
    notificationNote.textContent = "";
    setNotificationPromptVisibility(false);
    return;
  }

  notificationSupportNote.textContent = "Notifications: install the PWA and allow notifications to get event reminders, location changes, attendance alerts, and updates.";

  const permission = Notification.permission;
  const subscription = await getCurrentPushSubscription();
  const subscribed = Boolean(subscription);
  if (permission === "granted" && subscribed) {
    enableNotificationsButton.textContent = "Notifications Enabled";
    enableNotificationsButton.disabled = true;
    disableNotificationsButton.classList.remove("hidden");
    disableNotificationsButton.disabled = false;
    notificationNote.textContent = "This device is ready to receive SASE notifications.";
  } else if (permission === "denied") {
    enableNotificationsButton.textContent = "Notifications Blocked";
    enableNotificationsButton.disabled = true;
    notificationNote.textContent = "Notifications are blocked in this browser. You can re-enable them in browser settings.";
  } else {
    enableNotificationsButton.textContent = "Enable Notifications";
    enableNotificationsButton.disabled = false;
    notificationNote.textContent = "Allow notifications so officers can send you event reminders and updates.";
  }
}

async function enableNotifications() {
  const supported = appState.notifications?.supported && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) {
    notificationNote.textContent = "Push notifications are not available here yet.";
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notificationNote.textContent = "Notification permission was not granted.";
      await syncNotificationButtonState();
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(appState.notifications.publicKey)
      });
    }

    await apiFetch("/api/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON())
    });
    notificationNote.textContent = "Notifications enabled for this device.";
  } catch (error) {
    notificationNote.textContent = error.message;
  }

  await syncNotificationButtonState();
}

async function disableNotifications() {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    notificationNote.textContent = "Notifications are already off for this device.";
    await syncNotificationButtonState();
    return;
  }

  try {
    await apiFetch("/api/notifications/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    await subscription.unsubscribe();
    notificationNote.textContent = "Notifications turned off for this device.";
  } catch (error) {
    notificationNote.textContent = error.message;
  }

  await syncNotificationButtonState();
}

authTabButtons.forEach((button) => {
  button.addEventListener("click", () => showAuthView(button.dataset.authView));
});

signupRoleSelect?.addEventListener("change", updateSignupRoleFields);

navButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    if (button.tagName === "A") {
      event.preventDefault();
    }
    showTab(button.dataset.tabTarget);
  });
});

enableNotificationsButton.addEventListener("click", async () => {
  await enableNotifications();
});

disableNotificationsButton.addEventListener("click", async () => {
  await disableNotifications();
});

notificationPromptEnable?.addEventListener("click", async () => {
  setNotificationPromptVisibility(false);
  await enableNotifications();
});

notificationPromptLater?.addEventListener("click", () => {
  setNotificationPromptVisibility(false);
  notificationNote.textContent = "You can enable notifications anytime from the Home tab.";
});

completedEventsFilter?.addEventListener("input", () => {
  if (appState.user?.role === "officer") {
    renderData();
  }
});

profilePhotoInput?.addEventListener("change", () => {
  const [file] = profilePhotoInput.files || [];
  if (!file) {
    pendingProfileImage = appState.user?.profileImage || "";
    renderOfficerPhotoPreview(pendingProfileImage, `${appState.user?.name || "Officer"} profile photo`);
    return;
  }

  if (!file.type.startsWith("image/")) {
    profileNote.textContent = "Please choose an image file.";
    profilePhotoInput.value = "";
    return;
  }

  if (file.size > 5_000_000) {
    profileNote.textContent = "Please choose an image under 5 MB.";
    profilePhotoInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingProfileImage = typeof reader.result === "string" ? reader.result : "";
    profileNote.textContent = "";
    renderOfficerPhotoPreview(pendingProfileImage, `${appState.user?.name || "Officer"} profile photo`);
  };
  reader.onerror = () => {
    profileNote.textContent = "We couldn't read that image. Please try a different file.";
  };
  reader.readAsDataURL(file);
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
    await syncNotificationButtonState();
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
    updateSignupRoleFields();
    await claimPendingCheckin();
    shouldPromptNotificationsAfterSignup = true;
    renderApp();
    await syncNotificationButtonState();
    if (shouldPromptNotificationsAfterSignup && Notification.permission === "default") {
      setNotificationPromptVisibility(true);
      shouldPromptNotificationsAfterSignup = false;
    }
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
        bio: profileBioInput ? profileBioInput.value.trim() : "",
        profileImage: profilePhotoField && !profilePhotoField.classList.contains("hidden") ? pendingProfileImage : ""
      })
    });
    profileNote.textContent = "Your profile has been updated.";
    pendingProfileImage = appState.user?.profileImage || "";
    if (profilePhotoInput) {
      profilePhotoInput.value = "";
    }
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

adminNotificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminNotificationNote.textContent = "";
  const formData = new FormData(adminNotificationForm);
  const eventId = String(formData.get("eventId") || "");

  try {
    const data = await apiFetch(`/api/admin/events/${eventId}/notify`, {
      method: "POST",
      body: JSON.stringify({
        type: String(formData.get("type") || "reminder"),
        audience: String(formData.get("audience") || "rsvp"),
        message: String(formData.get("message") || "").trim()
      })
    });
    appState = data;
    const summary = data.notificationSummary;
    adminNotificationNote.textContent = `Notification sent to ${summary.sent} members${summary.failed ? `, with ${summary.failed} failed device(s)` : ""}.`;
    renderDashboard();
  } catch (error) {
    adminNotificationNote.textContent = error.message;
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
    adminData: null,
    notifications: { supported: false, publicKey: "" },
    checkinMessage: ""
  };
  profileNote.textContent = "";
  adminNote.textContent = "";
  adminNotificationNote.textContent = "";
  liveCheckinNote.textContent = "";
  pendingProfileImage = "";
  shouldPromptNotificationsAfterSignup = false;
  if (profilePhotoInput) {
    profilePhotoInput.value = "";
  }
  renderOfficerPhotoPreview("");
  setNotificationPromptVisibility(false);
  renderApp();
  await loadCheckinPrompt();
  await syncNotificationButtonState();
});

function showTab(viewName) {
  if ((viewName === "admin" || viewName === "data") && appState.user?.role !== "officer") {
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

async function completeEvent(eventId) {
  try {
    appState = await apiFetch(`/api/admin/events/${eventId}/complete`, {
      method: "POST",
      body: JSON.stringify({})
    });
    adminNote.textContent = "Event marked as completed.";
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
      ${officer.profileImage ? `<img class="officer-photo" src="${officer.profileImage}" alt="${officer.name} portrait">` : `<div class="officer-avatar" aria-hidden="true">${officer.initials}</div>`}
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

  [
    { member: appState.leaderboard[1], placeClass: "second" },
    { member: appState.leaderboard[0], placeClass: "first" },
    { member: appState.leaderboard[2], placeClass: "third" }
  ]
    .filter((entry) => Boolean(entry.member))
    .forEach((entry) => {
      const { member, placeClass } = entry;
      const place = document.createElement("div");
      place.className = `podium-place ${placeClass}`;
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
    row.className = `leaderboard-row${index < 3 ? ` top-${index + 1}` : ""}`;
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

function renderNotificationEventOptions() {
  if (!notificationEventId) {
    return;
  }

  const events = appState.events.filter((eventRecord) => eventRecord.status !== "completed");
  notificationEventId.innerHTML = "";
  if (!events.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No upcoming events";
    notificationEventId.appendChild(option);
    return;
  }

  events.forEach((eventRecord) => {
    const option = document.createElement("option");
    option.value = `${eventRecord.id}`;
    option.textContent = `${eventRecord.title} - ${eventRecord.date}`;
    notificationEventId.appendChild(option);
  });
}

function renderAdminData() {
  adminDataStats.innerHTML = "";
  adminDataUsers.innerHTML = "";
  completedAdminEvents.innerHTML = "";

  if (!appState.adminData) {
    adminDataUsers.appendChild(createEmptyState("Backend data will appear here for officer accounts."));
    completedAdminEvents.appendChild(createEmptyState("Completed events will appear here for officer accounts."));
    return;
  }

  const stats = appState.adminData.stats;
  [
    ["Users", stats.users],
    ["Officers", stats.officers],
    ["Events", stats.events],
    ["RSVPs", stats.rsvps],
    ["Attendance", stats.attendance],
    ["Subscriptions", stats.subscriptions]
  ].forEach(([label, value]) => {
    const article = document.createElement("article");
    article.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    adminDataStats.appendChild(article);
  });

  appState.adminData.users.slice(0, 12).forEach((user) => {
    const row = document.createElement("article");
    row.className = "admin-event-row";
    row.innerHTML = `
      <strong>${user.name}</strong>
      <div class="admin-event-meta">${user.email}</div>
      <div class="admin-event-meta">${user.role}${user.position ? ` - ${user.position}` : ""} - ${user.major} - ${user.year}</div>
      <div class="admin-event-meta">${user.stars} stars</div>
    `;
    adminDataUsers.appendChild(row);
  });

  const completedEvents = appState.adminData.events.filter((eventRecord) => eventRecord.status === "completed");
  const filterValue = getCompletedEventsFilterValue();
  const filteredCompletedEvents = completedEvents.filter((eventRecord) => {
    if (!filterValue) {
      return true;
    }

    const attendeeText = (eventRecord.attendees || [])
      .map((attendee) => [attendee.name, attendee.email, attendee.major, attendee.year].join(" "))
      .join(" ")
      .toLowerCase();

    const eventText = [
      eventRecord.title,
      eventRecord.type,
      eventRecord.date,
      eventRecord.time,
      eventRecord.location
    ].join(" ").toLowerCase();

    return eventText.includes(filterValue) || attendeeText.includes(filterValue);
  });

  if (!filteredCompletedEvents.length) {
    completedAdminEvents.appendChild(
      createEmptyState(filterValue ? "No completed events or attendees match that search yet." : "Completed events will appear here once officers mark them finished.")
    );
    return;
  }

  if (!completedEvents.length) {
    completedAdminEvents.appendChild(createEmptyState("Completed events will appear here once officers mark them finished."));
    return;
  }

  filteredCompletedEvents.forEach((eventRecord) => {
    const wrapper = document.createElement("details");
    wrapper.className = "completed-event-card";

    const attendees = eventRecord.attendees || [];
    const filteredAttendees = attendees.filter((attendee) => {
      if (!filterValue) {
        return true;
      }

      return [attendee.name, attendee.email, attendee.major, attendee.year]
        .join(" ")
        .toLowerCase()
        .includes(filterValue);
    });
    const attendeeMarkup = filteredAttendees.length
      ? filteredAttendees.map((attendee) => `
          <article class="attendee-row">
            <div>
              <strong>${attendee.name}</strong>
              <div class="admin-event-meta">${attendee.major} - ${attendee.year}</div>
            </div>
            <div class="attendee-side">
              <div class="admin-event-meta">${attendee.email}</div>
              <div class="admin-event-meta">${formatCheckinTime(attendee.checkedInAt)}</div>
            </div>
          </article>
        `).join("")
      : `<div class="empty-state">${attendees.length ? "No attendees in this event match the current search." : "No member check-ins were recorded for this event."}</div>`;

    wrapper.innerHTML = `
      <summary class="completed-event-summary">
        <div>
          <strong>${eventRecord.title}</strong>
          <div class="admin-event-meta">${eventRecord.type} - ${eventRecord.date} - ${eventRecord.time}</div>
          <div class="admin-event-meta">${eventRecord.location}</div>
        </div>
        <div class="completed-event-stats">
          <span>${eventRecord.attendanceCount} attended</span>
          <span>${eventRecord.rsvpCount} RSVP'd</span>
          <span>${eventRecord.stars} stars</span>
        </div>
      </summary>
      <div class="attendee-list">
        ${attendeeMarkup}
      </div>
    `;

    completedAdminEvents.appendChild(wrapper);
  });
}

function renderAdmin() {
  const isOfficer = appState.user?.role === "officer";
  adminTabButton.classList.toggle("hidden", !isOfficer);
  adminView.classList.toggle("hidden", !isOfficer);
  adminNotificationForm.classList.toggle("hidden", !isOfficer || !appState.notifications?.supported);

  if (!isOfficer) {
    adminCheckinLinkBox.classList.add("hidden");
    if (document.querySelector(".view.active")?.dataset.view === "admin") {
      showTab("home");
    }
    return;
  }

  renderNotificationEventOptions();

  const activeEvent = appState.adminLiveCheckinEvent;
  adminCheckinLinkBox.classList.toggle("hidden", !activeEvent);
  adminAttendanceCode.textContent = activeEvent?.attendanceCode || "";
  adminAttendanceEvent.textContent = activeEvent
    ? `${activeEvent.title} - ${activeEvent.date} - ${activeEvent.time}`
    : "";

  adminEventList.innerHTML = "";
  const activeEvents = appState.events.filter((eventRecord) => eventRecord.status !== "completed");
  if (!activeEvents.length) {
    adminEventList.appendChild(createEmptyState("No active events right now. Add a new one to get started."));
    return;
  }

  activeEvents.forEach((eventRecord) => {
    const row = document.createElement("article");
    row.className = "admin-event-row";
    row.innerHTML = `
      <strong>${eventRecord.title}</strong>
      <div class="admin-event-meta">${eventRecord.status} - ${eventRecord.type} - ${eventRecord.date} - ${eventRecord.time}</div>
      <div class="admin-event-meta">${eventRecord.location} - ${eventRecord.stars} stars - ${eventRecord.attendanceCount} attended</div>
      <div class="admin-event-actions">
        <button class="button button-ghost" type="button">${eventRecord.checkinActive ? "Attendance Live" : "Start Attendance"}</button>
        <button class="button button-secondary" type="button">Stop Attendance</button>
        <button class="button button-danger" type="button">Complete Event</button>
      </div>
    `;
    const buttons = row.querySelectorAll("button");
    buttons[0].addEventListener("click", () => startCheckin(eventRecord.id));
    buttons[1].addEventListener("click", () => stopCheckin(eventRecord.id));
    buttons[2].addEventListener("click", () => completeEvent(eventRecord.id));
    buttons[0].disabled = eventRecord.status === "completed" || eventRecord.checkinActive;
    buttons[1].disabled = !eventRecord.checkinActive;
    buttons[2].disabled = eventRecord.status === "completed";
    adminEventList.appendChild(row);
  });
}

function renderData() {
  const isOfficer = appState.user?.role === "officer";
  dataTabButton.classList.toggle("hidden", !isOfficer);
  dataView.classList.toggle("hidden", !isOfficer);

  if (!isOfficer) {
    adminDataStats.innerHTML = "";
    adminDataUsers.innerHTML = "";
    if (document.querySelector(".view.active")?.dataset.view === "data") {
      showTab("home");
    }
    return;
  }

  renderAdminData();
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
  pendingProfileImage = user.profileImage || "";
  profilePositionField.classList.toggle("hidden", user.role !== "officer");
  profilePhotoField.classList.toggle("hidden", user.role !== "officer");
  profileBioField.classList.toggle("hidden", user.role !== "officer");
  renderOfficerPhotoPreview(user.profileImage || "", `${user.name} profile photo`);
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
  renderData();
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
    updateSignupRoleFields();
    await syncNotificationButtonState();
  })
  .catch((error) => {
    loginNote.textContent = error.message;
    renderApp();
  });
