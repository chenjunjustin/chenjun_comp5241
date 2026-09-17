/* ==========================================================================
   COMP5241 Study Hub - vanilla JS, no build step.
   Data lives in localStorage; nothing leaves the browser.
   ========================================================================== */

const STORAGE_KEY = "comp5241-study-hub:v1";
const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;
const DAY_MS = 86400000;

const PRIORITY_LABEL = { low: "低", medium: "中", high: "高" };

const state = {
  tasks: [],
  focusMinutes: {}, // "YYYY-MM-DD" -> minutes
  pomodoros: {}, // "YYYY-MM-DD" -> completed focus sessions
  filter: "all",
  theme: "light",
  timer: {
    mode: "focus",
    remaining: FOCUS_MINUTES * 60,
    running: false,
    tickId: null,
  },
};

const el = {
  todayLabel: document.getElementById("today-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  themeLabel: document.getElementById("theme-toggle-label"),

  statOpen: document.getElementById("stat-open"),
  statDone: document.getElementById("stat-done"),
  statFocus: document.getElementById("stat-focus"),
  statStreak: document.getElementById("stat-streak"),
  progressRing: document.getElementById("progress-ring"),
  progressBar: document.getElementById("progress-bar"),
  progressValue: document.getElementById("progress-value"),
  progressCopy: document.getElementById("progress-copy"),

  form: document.getElementById("task-form"),
  formErrors: document.getElementById("form-errors"),
  formErrorsList: document.getElementById("form-errors-list"),
  titleInput: document.getElementById("task-title"),
  titleError: document.getElementById("task-title-error"),
  courseInput: document.getElementById("task-course"),
  courseError: document.getElementById("task-course-error"),
  dueInput: document.getElementById("task-due"),
  dueError: document.getElementById("task-due-error"),
  priorityInput: document.getElementById("task-priority"),

  taskList: document.getElementById("task-list"),
  taskCount: document.getElementById("task-count"),
  taskEmpty: document.getElementById("task-empty"),
  emptyTitle: document.getElementById("empty-title"),
  emptyText: document.getElementById("empty-text"),
  filterStatus: document.getElementById("filter-status"),
  chips: Array.from(document.querySelectorAll(".chip[data-filter]")),

  timer: document.querySelector(".panel--timer .timer"),
  timerBar: document.getElementById("timer-bar"),
  timerTime: document.getElementById("timer-time"),
  timerMode: document.getElementById("timer-mode"),
  timerStatus: document.getElementById("timer-status"),
  timerToggle: document.getElementById("timer-toggle"),
  timerToggleIcon: document.getElementById("timer-toggle-icon"),
  timerToggleLabel: document.getElementById("timer-toggle-label"),
  timerReset: document.getElementById("timer-reset"),
  timerSessions: document.getElementById("timer-sessions"),
  timerWeek: document.getElementById("timer-week"),

  chart: document.getElementById("chart"),
  toastRegion: document.getElementById("toast-region"),
};

/* ------------------------------------------------------------ date utils */

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todayKey = () => dayKey(new Date());

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function parseDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(aKey, bKey) {
  return Math.round((startOfDay(parseDayKey(bKey)) - startOfDay(parseDayKey(aKey))) / DAY_MS);
}

function formatDueLabel(dueKey) {
  if (!dueKey) return null;
  const diff = daysBetween(todayKey(), dueKey);
  if (diff === 0) return "今天到期";
  if (diff === 1) return "明天到期";
  if (diff === -1) return "昨天到期";
  if (diff < 0) return `逾期 ${Math.abs(diff)} 天`;
  if (diff <= 7) return `${diff} 天后到期`;
  return `${parseDayKey(dueKey).getMonth() + 1} 月 ${parseDayKey(dueKey).getDate()} 日`;
}

/* -------------------------------------------------------------- storage */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.tasks)) state.tasks = saved.tasks;
    if (saved.focusMinutes && typeof saved.focusMinutes === "object") state.focusMinutes = saved.focusMinutes;
    if (saved.pomodoros && typeof saved.pomodoros === "object") state.pomodoros = saved.pomodoros;
    if (saved.filter) state.filter = saved.filter;
    if (saved.theme === "dark" || saved.theme === "light") state.theme = saved.theme;
  } catch (error) {
    console.warn("无法读取本地数据，将从空看板开始。", error);
  }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tasks: state.tasks,
        focusMinutes: state.focusMinutes,
        pomodoros: state.pomodoros,
        filter: state.filter,
        theme: state.theme,
      })
    );
  } catch (error) {
    console.warn("无法保存到 localStorage。", error);
  }
}

/* --------------------------------------------------------------- toasts */

function toast(message, options = {}) {
  const node = document.createElement("div");
  node.className = "toast" + (options.tone === "error" ? " toast--error" : "");
  node.setAttribute("role", options.action ? "group" : "status");

  const text = document.createElement("span");
  text.textContent = message;
  node.appendChild(text);

  let timerId = null;
  const dismiss = () => {
    if (timerId) clearTimeout(timerId);
    node.remove();
  };

  if (options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast__action";
    button.textContent = options.action.label;
    button.addEventListener("click", () => {
      options.action.run();
      dismiss();
    });
    node.appendChild(button);
  }

  el.toastRegion.appendChild(node);
  timerId = setTimeout(dismiss, options.action ? 8000 : 4000);
}

/* --------------------------------------------------------------- theme */

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const dark = state.theme === "dark";
  el.themeIcon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
  el.themeToggle.setAttribute("aria-pressed", String(dark));
  el.themeLabel.textContent = dark ? "切换到浅色模式" : "切换到深色模式";
}

/* --------------------------------------------------------------- stats */

function completedToday() {
  const key = todayKey();
  return state.tasks.filter((task) => task.done && task.completedOn === key).length;
}

function streakDays() {
  let streak = 0;
  const cursor = new Date();
  // A day counts when it has focus minutes; today is allowed to be empty.
  for (let i = 0; i < 365; i += 1) {
    const key = dayKey(cursor);
    const minutes = state.focusMinutes[key] || 0;
    if (minutes > 0) {
      streak += 1;
    } else if (i > 0) {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function weekMinuteTotal() {
  let total = 0;
  const cursor = new Date();
  for (let i = 0; i < 7; i += 1) {
    total += state.focusMinutes[dayKey(cursor)] || 0;
    cursor.setDate(cursor.getDate() - 1);
  }
  return total;
}

function renderStats() {
  const done = state.tasks.filter((task) => task.done).length;
  const open = state.tasks.length - done;
  const key = todayKey();
  const minutesToday = state.focusMinutes[key] || 0;

  el.statOpen.textContent = String(open);
  el.statDone.textContent = String(done);
  el.statFocus.innerHTML = `${minutesToday}<span class="stat__unit">分钟</span>`;
  el.statStreak.innerHTML = `${streakDays()}<span class="stat__unit">天</span>`;

  const rate = state.tasks.length === 0 ? 0 : Math.round((done / state.tasks.length) * 100);
  const circumference = 2 * Math.PI * 50;
  el.progressBar.style.strokeDashoffset = String(circumference * (1 - rate / 100));
  el.progressValue.textContent = `${rate}%`;
  el.progressRing.setAttribute("aria-label", `任务完成率 ${rate}%`);

  if (state.tasks.length === 0) {
    el.progressCopy.textContent = "还没有任务，先添加一个吧。";
  } else if (rate === 100) {
    el.progressCopy.textContent = `全部 ${state.tasks.length} 个任务都完成了，今天收工前可以放松一下。`;
  } else {
    el.progressCopy.textContent = `已完成 ${done} / ${state.tasks.length}，还有 ${open} 个任务在等你。`;
  }
}

/* --------------------------------------------------------------- tasks */

function visibleTasks() {
  const key = todayKey();
  const tasks = state.tasks.slice();

  const filtered = tasks.filter((task) => {
    switch (state.filter) {
      case "open":
        return !task.done;
      case "done":
        return task.done;
      case "today":
        return !task.done && task.due === key;
      case "overdue":
        return !task.done && !!task.due && task.due < key;
      default:
        return true;
    }
  });

  return filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return b.createdAt - a.createdAt;
  });
}

function tag(className, iconId, text) {
  const node = document.createElement("span");
  node.className = `tag ${className}`.trim();
  if (iconId) {
    node.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#${iconId}"></use></svg>`;
  }
  node.appendChild(document.createTextNode(text));
  return node;
}

function renderTasks() {
  const key = todayKey();
  const tasks = visibleTasks();

  el.taskList.textContent = "";

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task" + (task.done ? " is-done" : "");
    item.dataset.priority = task.priority;
    if (!task.done && task.due && task.due < key) item.classList.add("is-overdue");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "task__toggle";
    toggle.setAttribute("aria-pressed", String(task.done));
    toggle.setAttribute("aria-label", `${task.done ? "标记为未完成" : "标记为已完成"}：${task.title}`);
    toggle.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"></use></svg>';
    toggle.addEventListener("click", () => toggleTask(task.id));

    const body = document.createElement("div");
    body.className = "task__body";

    const title = document.createElement("p");
    title.className = "task__title";
    title.textContent = task.title;
    body.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "task__meta";
    if (task.course) meta.appendChild(tag("", "#i-book", task.course));
    if (task.due) {
      const overdue = !task.done && task.due < key;
      const soon = !task.done && !overdue && daysBetween(key, task.due) <= 1;
      meta.appendChild(
        tag(overdue ? "tag--overdue" : soon ? "tag--due-soon" : "", "#i-calendar", formatDueLabel(task.due))
      );
    }
    meta.appendChild(tag(`tag--${task.priority}`, null, `优先级 ${PRIORITY_LABEL[task.priority]}`));
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "task__actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn";
    remove.setAttribute("aria-label", `删除任务：${task.title}`);
    remove.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"></use></svg>';
    remove.addEventListener("click", () => deleteTask(task.id));
    actions.appendChild(remove);

    item.append(toggle, body, actions);
    el.taskList.appendChild(item);
  });

  const openCount = state.tasks.filter((task) => !task.done).length;
  el.taskCount.textContent =
    state.tasks.length === 0 ? "还没有任务" : `共 ${state.tasks.length} 个 · 待完成 ${openCount} 个`;

  const filtering = state.filter !== "all";
  el.taskEmpty.hidden = tasks.length > 0;
  if (tasks.length === 0) {
    el.emptyTitle.textContent = filtering ? "这个筛选下没有任务" : "还没有任务";
    el.emptyText.textContent = filtering
      ? "换个筛选条件，或者清空筛选查看全部任务。"
      : "在上面的表单里添加第一个任务，看板会自动统计进度。";
  }
}

function renderChart() {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  const days = [];
  const cursor = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - i);
    days.push({ key: dayKey(date), date, minutes: state.focusMinutes[dayKey(date)] || 0 });
  }

  const max = Math.max(30, ...days.map((day) => day.minutes));
  el.chart.textContent = "";

  const plot = document.createElement("div");
  plot.className = "chart__plot";
  plot.setAttribute("role", "img");
  plot.setAttribute(
    "aria-label",
    `最近 7 天专注时长：${days
      .map((day) => `${day.date.getMonth() + 1} 月 ${day.date.getDate()} 日 ${day.minutes} 分钟`)
      .join("，")}`
  );

  days.forEach((day) => {
    const col = document.createElement("div");
    col.className = "chart__col";
    col.dataset.today = String(day.key === todayKey());

    const value = document.createElement("span");
    value.className = "chart__value";
    value.textContent = day.minutes > 0 ? String(day.minutes) : "";

    const bar = document.createElement("div");
    bar.className = "chart__bar";
    bar.style.height = `${Math.round((day.minutes / max) * 100)}%`;

    col.append(value, bar);
    plot.appendChild(col);
  });

  const axis = document.createElement("div");
  axis.className = "chart__axis";
  days.forEach((day) => {
    const label = document.createElement("span");
    const isToday = day.key === todayKey();
    label.dataset.today = String(isToday);
    // Today is marked with a word, not only with colour.
    label.textContent = isToday ? "今天" : labels[day.date.getDay()];
    axis.appendChild(label);
  });

  el.chart.append(plot, axis);

  const weekTotal = days.reduce((sum, day) => sum + day.minutes, 0);
  if (weekTotal === 0) {
    const hint = document.createElement("p");
    hint.className = "chart__empty";
    hint.textContent = "最近 7 天还没有专注记录，跑完一个番茄钟就会出现在这里。";
    el.chart.appendChild(hint);
  }
}

function renderTimer() {
  const { mode, remaining, running } = state.timer;
  const total = (mode === "focus" ? FOCUS_MINUTES : BREAK_MINUTES) * 60;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  el.timerTime.textContent = `${pad(minutes)}:${pad(seconds)}`;
  el.timerMode.textContent = mode === "focus" ? "专注中" : "休息中";
  el.timer.classList.toggle("is-break", mode === "break");

  const circumference = 2 * Math.PI * 68;
  const progress = 1 - remaining / total;
  el.timerBar.style.strokeDashoffset = String(circumference * (1 - progress));
  // A zero-length dash with a round cap still paints a dot; hide it instead.
  el.timerBar.dataset.idle = String(progress <= 0);

  el.timerToggleIcon.setAttribute("href", running ? "#i-pause" : "#i-play");
  el.timerToggleLabel.textContent = running ? "暂停" : remaining === total ? "开始" : "继续";

  el.timerSessions.textContent = String(state.pomodoros[todayKey()] || 0);
  el.timerWeek.textContent = `${weekMinuteTotal()} 分钟`;
}

function renderAll() {
  renderStats();
  renderTasks();
  renderChart();
  renderTimer();
}

function addTask(task) {
  state.tasks.push(task);
  save();
  renderAll();
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  task.completedOn = task.done ? todayKey() : null;
  save();
  renderAll();
  if (task.done) {
    toast(`已完成「${task.title}」`);
  }
}

function deleteTask(id) {
  const index = state.tasks.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [removed] = state.tasks.splice(index, 1);
  save();
  renderAll();
  toast(`已删除「${removed.title}」`, {
    action: {
      label: "撤销",
      run() {
        state.tasks.splice(index, 0, removed);
        save();
        renderAll();
        toast("已恢复任务");
      },
    },
  });
}

/* --------------------------------------------------------- form handling */

function clearErrors() {
  el.formErrors.hidden = true;
  el.formErrorsList.textContent = "";
  [
    [el.titleInput, el.titleError],
    [el.courseInput, el.courseError],
    [el.dueInput, el.dueError],
  ].forEach(([input, error]) => {
    input.removeAttribute("aria-invalid");
    error.hidden = true;
    error.textContent = "";
  });
}

function setFieldError(input, errorNode, message) {
  input.setAttribute("aria-invalid", "true");
  errorNode.hidden = false;
  errorNode.innerHTML = `<svg class="ico ico--sm" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-alert"></use></svg>`;
  errorNode.appendChild(document.createTextNode(message));
}

function validate() {
  clearErrors();
  const problems = [];
  const title = el.titleInput.value.trim();
  const course = el.courseInput.value.trim();
  const due = el.dueInput.value;

  if (!title) {
    setFieldError(el.titleInput, el.titleError, "请填写任务名称。");
    problems.push({ id: "task-title", message: "请填写任务名称。" });
  } else if (title.length < 2) {
    setFieldError(el.titleInput, el.titleError, "任务名称至少 2 个字符。");
    problems.push({ id: "task-title", message: "任务名称至少 2 个字符。" });
  }

  if (course.length > 24) {
    setFieldError(el.courseInput, el.courseError, "分类请控制在 24 个字符以内。");
    problems.push({ id: "task-course", message: "分类请控制在 24 个字符以内。" });
  }

  if (due && Number.isNaN(parseDayKey(due).getTime())) {
    setFieldError(el.dueInput, el.dueError, "请选择一个有效的日期。");
    problems.push({ id: "task-due", message: "请选择一个有效的日期。" });
  }

  return problems;
}

function handleSubmit(event) {
  event.preventDefault();
  const problems = validate();

  if (problems.length > 0) {
    el.formErrorsList.textContent = "";
    problems.forEach((problem) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${problem.id}`;
      link.textContent = problem.message;
      link.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        document.getElementById(problem.id).focus();
      });
      item.appendChild(link);
      el.formErrorsList.appendChild(item);
    });
    el.formErrors.hidden = false;
    el.formErrors.focus();
    return;
  }

  addTask({
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: el.titleInput.value.trim(),
    course: el.courseInput.value.trim(),
    due: el.dueInput.value || null,
    priority: el.priorityInput.value,
    done: false,
    completedOn: null,
    createdAt: Date.now(),
  });

  el.form.reset();
  el.priorityInput.value = "medium";
  clearErrors();
  el.titleInput.focus();
  toast("任务已添加");
}

/* ---------------------------------------------------------------- timer */

function timerTotal() {
  return (state.timer.mode === "focus" ? FOCUS_MINUTES : BREAK_MINUTES) * 60;
}

function switchMode(mode, message) {
  state.timer.mode = mode;
  state.timer.remaining = (mode === "focus" ? FOCUS_MINUTES : BREAK_MINUTES) * 60;
  state.timer.running = false;
  el.timerStatus.textContent = message;
  renderTimer();
}

function tick() {
  state.timer.remaining -= 1;

  if (state.timer.remaining <= 0) {
    finishSession();
    return;
  }
  renderTimer();
}

function finishSession() {
  clearInterval(state.timer.tickId);
  state.timer.tickId = null;
  state.timer.running = false;

  if (state.timer.mode === "focus") {
    const key = todayKey();
    state.focusMinutes[key] = (state.focusMinutes[key] || 0) + FOCUS_MINUTES;
    state.pomodoros[key] = (state.pomodoros[key] || 0) + 1;
    save();
    switchMode("break", `专注 ${FOCUS_MINUTES} 分钟已完成，休息 ${BREAK_MINUTES} 分钟。`);
    renderAll();
    toast(`完成一个番茄钟，已记入今日专注 ${FOCUS_MINUTES} 分钟`);
  } else {
    switchMode("focus", "休息结束，开始下一个番茄钟。");
    toast("休息结束，继续加油");
  }
}

function toggleTimer() {
  if (state.timer.running) {
    clearInterval(state.timer.tickId);
    state.timer.tickId = null;
    state.timer.running = false;
    el.timerStatus.textContent = "已暂停，随时可以继续。";
    renderTimer();
    return;
  }

  state.timer.running = true;
  state.timer.tickId = setInterval(tick, 1000);
  el.timerStatus.textContent =
    state.timer.mode === "focus" ? "专注中，把手机放到一边。" : "休息中，起来走两步。";
  renderTimer();
}

function resetTimer() {
  clearInterval(state.timer.tickId);
  state.timer.tickId = null;
  state.timer.running = false;
  state.timer.remaining = timerTotal();
  el.timerStatus.textContent = "计时已重置。";
  renderTimer();
}

/* ----------------------------------------------------------------- init */

function initShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable);
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "/") {
      event.preventDefault();
      el.titleInput.focus();
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTimer();
    }
  });
}

function init() {
  load();

  if (!localStorage.getItem(STORAGE_KEY)) {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    state.theme = prefersDark ? "dark" : "light";
  }
  applyTheme();

  el.todayLabel.textContent = new Intl.DateTimeFormat("zh-Hans", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  el.form.addEventListener("submit", handleSubmit);
  el.titleInput.addEventListener("input", () => {
    if (el.titleInput.getAttribute("aria-invalid") === "true") clearErrors();
  });

  el.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      el.chips.forEach((other) => {
        const active = other === chip;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      el.filterStatus.textContent = `已筛选：${chip.textContent}`;
      save();
      renderTasks();
    });
  });
  const activeChip = el.chips.find((chip) => chip.dataset.filter === state.filter);
  if (activeChip && state.filter !== "all") {
    el.chips.forEach((chip) => {
      const active = chip === activeChip;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  }

  el.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    save();
  });

  el.timerToggle.addEventListener("click", toggleTimer);
  el.timerReset.addEventListener("click", resetTimer);

  document.addEventListener("visibilitychange", () => {
    // The interval keeps its own count; nothing extra needed, but restoring
    // focus avoids a stale "running" label after a long background tab.
    renderTimer();
  });

  initShortcuts();
  renderAll();
}

init();
