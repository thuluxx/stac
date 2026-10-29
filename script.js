"use strict";

/* ---------- 1. Settings ---------- */
let capacity = 8; // stack size — decided by the user (no upper limit)

const CLIMB_MS = 150; // slowest pause between two ladder rungs
const CLIMB_TOTAL_MS = 1100; // a full climb takes about this long, any size
const HOLD_MS = 550; // pause when the climber is at the top
const AUTO_HOLD_MS = 340; // shorter pause while auto-playing
const CLIMBER_H = 34; // height of the little climber (svg)

/** @type {string[]} index 0 = bottom, last index = top */
const stack = [];

const COLORS = [
  "34, 211, 238", // cyan
  "52, 211, 153", // green
  "129, 140, 248", // indigo
  "192, 132, 252", // purple
  "251, 113, 133", // rose
  "251, 191, 36", // amber
  "248, 113, 113", // red
  "232, 121, 249", // fuchsia
];

/** @type {{text: string, type: string}[]} newest first, max 8 entries */
const history = [];

let busy = false; // stops clicks while the climber is on the ladder
let autoRun = null; // "push" | "pop" | null — which auto run is going
let autoStop = false; // set true to end the current auto run

const $ = (id) => document.getElementById(id);

const stackEl = $("stack");
const sizeInputEl = $("sizeInput");
const setSizeBtn = $("setSizeBtn");
const valueFieldEl = $("valueField");
const valueInputEl = $("valueInput");
const pushBtn = $("pushBtn");
const popBtn = $("popBtn");
const peekBtn = $("peekBtn");
const autoPushBtn = $("autoPushBtn");
const autoPopBtn = $("autoPopBtn");
const messageEl = $("message");
const sizeValueEl = $("sizeValue");
const meterEl = $("meter");
const meterFillEl = $("meterFill");
const chipCapEl = $("chipCap");
const tagCapEl = $("tagCap");
const codeSizeEl = $("codeSize");
const historyEl = $("history");
const historyEmptyEl = $("historyEmpty");
const climberEl = $("climber");
const climberCarryEl = $("climberCarry");
const stackWrapEl = document.querySelector(".stack-wrap");
const codeEl = $("code");
const codeLines = Array.from(document.querySelectorAll("#code .cl"));

function setMessage(text, type) {
  messageEl.className = "message message--" + type;
  messageEl.textContent = text;
  void messageEl.offsetWidth; // restart the entrance animation
  messageEl.classList.add("is-anim");
}

function logHistory(text, type) {
  history.unshift({ text: text, type: type });
  if (history.length > 8) history.pop();
  renderHistory();
}

function renderHistory() {
  historyEl.textContent = "";
  historyEmptyEl.hidden = history.length > 0;

  for (const item of history) {
    const li = document.createElement("li");
    li.className = "is-" + item.type;

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.textContent = item.text; // textContent keeps user values safe

    li.append(dot, label);
    historyEl.append(li);
  }
}

/* ---------- 2. The C program panel ---------- */
/* lights up one line of the C listing (mode: "run" | "err") */
function hl(key, mode) {
  clearHl();
  const line = codeLines.find((l) => l.dataset.k === key);
  if (!line) return;
  line.classList.add(mode === "err" ? "is-err" : "is-hl");
}

function clearHl() {
  for (const line of codeLines) line.classList.remove("is-hl", "is-err");
}

/* ---------- 3. Rendering ---------- */
function render(enterIndex) {
  stackEl.textContent = "";

  for (let i = 0; i < capacity; i++) {
    const filled = i < stack.length;
    const rgb = COLORS[i % COLORS.length];

    // every slot is a fixed-height row, so the ladder rungs and the climber's
    // steps stay even — it is the block inside that changes size
    const row = document.createElement("li");
    row.className = "row";

    const li = document.createElement("span");
    li.className = filled ? "block" : "block is-empty";
    li.style.setProperty("--c-rgb", rgb);
    li.style.setProperty("--c", "rgb(" + rgb + ")");

    const idx = document.createElement("span");
    idx.className = "block__idx";
    idx.textContent = String(i);

    const val = document.createElement("span");
    val.className = "block__val";

    if (filled) {
      val.textContent = stack[i];
      val.title = stack[i]; // the full value, even when the block clips it
      const size = valueSize(stack[i]);
      li.style.setProperty("--w", size.width + "%");
      li.style.setProperty("--h", size.height);
      // hide the index chip when the block is too narrow to hold chip + value
      const px = ((stackEl.clientWidth || 360) * size.width) / 100;
      if (px < 72) li.classList.add("is-narrow");
      if (i === stack.length - 1) li.classList.add("is-top"); // TOP pointer
      if (i === enterIndex) li.classList.add("is-enter"); // push animation
    } else {
      val.textContent = "—";
      li.style.setProperty("--w", "100%");
      li.style.setProperty("--h", "1");
    }

    li.append(idx, val);

    if (filled && i === stack.length - 1) {
      const flag = document.createElement("span");
      flag.className = "top-flag";
      const line = document.createElement("span");
      line.className = "top-flag__line";
      const label = document.createElement("span");
      label.className = "top-flag__label";
      label.textContent = "TOP";
      flag.append(line, label);
      li.append(flag);
    }

    row.append(li);
    stackEl.append(row);
  }

  updateSize();
}

/* keeps the whole stack inside the stage: blocks shrink as the
   size grows, so 3 or 300 slots both fit and animate nicely */
function layout() {
  const budget = window.innerWidth <= 760 ? 360 : 440; // px for all rows
  const gap = capacity > 14 ? 3 : 8;
  const rowH = Math.max(4, Math.min(54, Math.floor(budget / capacity) - gap));

  stackWrapEl.style.setProperty("--row-h", rowH + "px");
  stackWrapEl.style.setProperty("--gap", gap + "px");
  stackEl.classList.toggle("is-tiny", rowH < 26);
  stackEl.classList.toggle("is-micro", rowH < 12);
}

function updateSize() {
  const n = stack.length;
  sizeValueEl.textContent = n + " / " + capacity;
  meterFillEl.style.width = (n / capacity) * 100 + "%";
  meterEl.classList.toggle("is-full", n === capacity);
}

/* One character = one rectangle, and its ASCII code decides the size.
   A flat 32 … 126 scale would make "1" and "2" differ by a hair, so the
   printable range is split into bands and each band gets a share of the
   size range: digits spread wide ("0" smallest, "9" much bigger), letters
   sit above them, punctuation stays low. Between two anchors the size grows
   in a straight line, so every neighbouring code is visibly different. */
const SIZE_ANCHORS = [
  [32, 0.0], // space   — the smallest there is
  [47, 0.08], // /       — punctuation band
  [48, 0.12], // 0
  [57, 0.52], // 9       — digits own a big slice
  [64, 0.58], // @
  [65, 0.62], // A
  [90, 0.78], // Z
  [96, 0.82], // `
  [97, 0.86], // a
  [122, 1.0], // z       — lowercase are the tallest/biggest
  [126, 1.0], // ~
];

const WIDTH_MIN = 22; // % of the stack width
const WIDTH_MAX = 100;
const HEIGHT_MIN = 0.5; // share of the row height
const HEIGHT_MAX = 1;

/* 0 … 1 for an ASCII code, walking the anchor table */
function asciiT(code) {
  const c = Math.min(Math.max(code, 32), 126);

  for (let i = 1; i < SIZE_ANCHORS.length; i++) {
    const from = SIZE_ANCHORS[i - 1];
    const to = SIZE_ANCHORS[i];
    if (c <= to[0]) return from[1] + ((c - from[0]) / (to[0] - from[0])) * (to[1] - from[1]);
  }

  return 1;
}

/* the value's character decides the rectangle — never a whole word */
function valueSize(text) {
  const chars = Array.from(String(text));
  const code = chars.length > 0 ? chars[0].codePointAt(0) : 32;
  const t = Math.min(1, Math.max(0, asciiT(code)));

  return {
    width: Math.round(WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * t),
    height: (HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * t).toFixed(3),
  };
}

/* ---------- 4. Small helpers ---------- */
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/* locks every control; the running auto button stays clickable as "Stop" */
function lockControls(on) {
  busy = on;
  setSizeBtn.disabled = on;
  pushBtn.disabled = on;
  popBtn.disabled = on;
  peekBtn.disabled = on;

  // during an auto run the running button stays enabled as "Stop"
  autoPushBtn.disabled = autoRun === null ? on : autoRun !== "push";
  autoPopBtn.disabled = autoRun === null ? on : autoRun !== "pop";
}

/* shakes the stage on overflow / underflow */
function shake() {
  if (!stackWrapEl) return;
  stackWrapEl.classList.remove("is-shake");
  void stackWrapEl.offsetWidth;
  stackWrapEl.classList.add("is-shake");
  window.setTimeout(function () {
    stackWrapEl.classList.remove("is-shake");
  }, 460);
}

/* ---------- 5. The ladder climber ---------- */
/* Height (px from the bottom of the ladder) of a rung.
   row -1 = the ground under the ladder. Measured from the real blocks,
   so it stays correct at any screen size or stack size. */
function climbY(row) {
  const first = stackEl.children[0];
  const rowH = first ? first.offsetHeight : 50;
  const total = stackEl.offsetHeight || rowH * capacity;
  const pitch = capacity > 1 ? (total - rowH) / (capacity - 1) : rowH;
  const centre = row < 0 ? rowH / 2 - pitch * 0.85 : row * pitch + rowH / 2;
  return centre - CLIMBER_H / 2;
}

let climberRow = -1; // which rung the climber is standing on

function setClimber(row) {
  climberRow = row;
  climberEl.style.setProperty("--climb", climbY(row) + "px");
}

/* shows / hides the value being carried above the climber's head */
function setCarry(text) {
  if (text === null) {
    climberEl.classList.remove("is-carrying");
  } else {
    climberCarryEl.textContent = '"' + text + '"';
    climberEl.classList.add("is-carrying");
  }
}

/* walks rung by rung from one row to the next (row -1 = ground) */
async function climb(from, to) {
  const rows = Math.abs(to - from);
  // big stacks climb faster per rung so a full climb always feels similar
  const stepMs = Math.max(8, Math.min(CLIMB_MS, Math.round(CLIMB_TOTAL_MS / Math.max(rows, 1))));
  climberEl.style.setProperty("--climb-ms", stepMs + "ms");
  climberEl.classList.add("is-moving");
  setClimber(from); // always start the walk from the right rung
  const step = to > from ? 1 : -1;
  for (let row = from; row !== to; row += step) {
    setClimber(row + step);
    await sleep(stepMs);
  }
  climberEl.classList.remove("is-moving");
}

/* ---------- 6. One animated operation ---------- */
/* carries a value up, drops it on top, climbs back down */
async function doPush(value, holdMs) {
  const target = stack.length; // the rung the value will land on

  setCarry(value);
  setMessage('🧗 Climbing up to place "' + value + '" on top …', "ok");
  await climb(-1, target);

  hl("pushline"); // <-- stack[++top] = value;
  stack.push(value); // O(1): added straight on top
  render(target);
  setCarry(null); // the climber hands the value over
  await sleep(holdMs);

  await climb(target, -1);
}

/* climbs up, grabs the top block, carries it back down */
async function doPop(holdMs) {
  const target = stack.length - 1;

  setMessage("🧗 Climbing up to take the top element …", "ok");
  await climb(-1, target);

  hl("popline"); // <-- return stack[top--];

  // the climber grabs the block: it slides off, then rides back down
  const topBlock = stackEl.querySelector(".is-top");
  if (topBlock) {
    topBlock.classList.add("is-leave");
    await sleep(260);
  }

  const removed = stack.pop(); // O(1): only the top element goes
  render();
  setCarry(removed);
  await sleep(holdMs);

  await climb(target, -1);
  setCarry(null);
  return removed;
}

/* climbs up, pulses the top block, climbs back down */
async function doPeek(holdMs) {
  const target = stack.length - 1;

  setMessage("🧗 Climbing up to read the top element …", "ok");
  await climb(-1, target);

  hl("peekline"); // <-- return stack[top];

  const topBlock = stackEl.querySelector(".is-top");
  if (topBlock) {
    topBlock.classList.remove("is-peek");
    void topBlock.offsetWidth; // restart the pulse
    topBlock.classList.add("is-peek");
  }
  await sleep(holdMs);

  await climb(target, -1);
  return stack[target];
}

function popDoneMessage(removed) {
  if (stack.length === 0) {
    setMessage('✅ Popped "' + removed + '" — the stack is now empty.', "ok");
  } else {
    setMessage(
      '✅ Popped "' + removed + '" — new top is "' + stack[stack.length - 1] + '".',
      "ok"
    );
  }
  logHistory('pop() → removed "' + removed + '"', "ok");
}

/* ---------- 7. The buttons ---------- */

/* the second input appears only once a stack size exists */
let valueFieldShown = false;

function revealValueField() {
  if (valueFieldShown) return;
  valueFieldShown = true;
  valueFieldEl.hidden = false;
  valueFieldEl.classList.add("is-in");
}

/* first user input: how many slots the stack has */
async function setSize() {
  if (busy) return;

  const raw = sizeInputEl.value.trim();
  const n = Number(raw);

  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1) {
    setMessage("⚠ Invalid input — stack size must be a whole number of 1 or more.", "warn");
    logHistory("setSize() → invalid input", "warn");
    sizeInputEl.value = String(capacity); // restore the working value
    sizeInputEl.focus();
    return;
  }

  if (n === capacity) {
    revealValueField(); // size matches — just move on to the value
    setMessage("Stack size is already " + n + " slots — type a value to push.", "warn");
    valueInputEl.focus();
    return;
  }

  lockControls(true);
  const dropped = stack.length > n ? stack.length - n : 0;
  capacity = n;
  stack.length = Math.min(stack.length, capacity); // keep what still fits

  layout();
  render();
  setClimber(-1);

  chipCapEl.textContent = String(capacity);
  tagCapEl.textContent = String(capacity);
  codeSizeEl.textContent = String(capacity);

  hl("size"); // <-- size = n;
  revealValueField(); // now you can type what to push
  setMessage(
    "✅ Stack size set to " + capacity + " — capacity is now " + capacity + " slot" +
      (capacity === 1 ? "" : "s") + (dropped ? " (" + dropped + " element" + (dropped === 1 ? "" : "s") + " removed)." : "."),
    "ok"
  );
  logHistory("setSize(" + capacity + ") → capacity " + capacity, "ok");
  await sleep(900);
  clearHl();
  lockControls(false);
  (valueFieldShown ? valueInputEl : sizeInputEl).focus();
}

async function push() {
  if (busy) return;

  const value = valueInputEl.value.trim().slice(0, 1); // exactly one character

  if (value === "") {
    setMessage("⚠ Type a value first — a number, a word or a symbol.", "warn");
    logHistory("push() → empty value", "warn");
    valueInputEl.focus();
    return;
  }

  if (stack.length >= capacity) {
    shake();
    hl("overflow", "err"); // <-- printf("Stack overflow");
    setMessage("⛔ Stack overflow — capacity is " + capacity + ". Pop a value, then push again.", "error");
    logHistory('push("' + value + '") → overflow', "error");
    await sleep(1200);
    clearHl();
    return;
  }

  lockControls(true);
  hl("isfull"); // <-- if (isFull()) {
  await sleep(240);
  await doPush(value, HOLD_MS);

  setMessage('✅ Pushed "' + value + '" — new top is "' + value + '".', "ok");
  logHistory('push("' + value + '") → size ' + stack.length, "ok");
  clearHl();
  lockControls(false);
  valueInputEl.select(); // typing again replaces the value, ready for the next push
}

async function pop() {
  if (busy) return;

  if (stack.length === 0) {
    shake();
    hl("underflow-pop", "err"); // <-- printf("Stack underflow");
    setMessage("⛔ Stack underflow — the stack is empty, nothing to pop.", "error");
    logHistory("pop() → underflow", "error");
    await sleep(1200);
    clearHl();
    return;
  }

  lockControls(true);
  hl("isempty-pop"); // <-- if (isEmpty()) {
  await sleep(240);
  const removed = await doPop(HOLD_MS);
  popDoneMessage(removed);
  clearHl();
  lockControls(false);
}

async function peek() {
  if (busy) return;

  if (stack.length === 0) {
    shake();
    hl("underflow-peek", "err"); // <-- printf("Stack underflow");
    setMessage("⛔ Stack underflow — the stack is empty, nothing to peek.", "error");
    logHistory("peek() → underflow", "error");
    await sleep(1200);
    clearHl();
    return;
  }

  lockControls(true);
  hl("isempty-peek"); // <-- if (isEmpty()) {
  await sleep(240);
  const top = await doPeek(HOLD_MS);

  setMessage('🔎 Top element is "' + top + '" — size is ' + stack.length + ".", "ok");
  logHistory('peek() → "' + top + '"', "ok");
  clearHl();
  lockControls(false);
}

/* ---------- 8. Auto runs: fill till overflow, drain till underflow ---- */
function autoButtonsStart(which) {
  autoRun = which;
  autoStop = false;
  const running = which === "push" ? autoPushBtn : autoPopBtn;
  running.classList.add("is-running");
  running.textContent = "■ Stop";
  lockControls(true); // disables the other auto button
}

function autoButtonsEnd() {
  const wasPush = autoRun === "push";
  autoRun = null;
  autoStop = false;
  const running = wasPush ? autoPushBtn : autoPopBtn;
  running.classList.remove("is-running");
  running.textContent = wasPush ? "▶ Auto Push" : "▶ Auto Pop";
  clearHl();
  lockControls(false);
}

/* pushes 1, 2, 3, ... on its own until the stack is full */
async function autoPush() {
  if (autoRun === "push") {
    autoStop = true; // the button now means Stop
    return;
  }
  if (busy) return;

  autoButtonsStart("push");

  // the character in the box, repeated; an empty box climbs 0, 1, 2 … 9, 0 …
  const typed = valueInputEl.value.trim().slice(0, 1);
  let next = 0;

  while (!autoStop && stack.length < capacity) {
    const value = typed !== "" ? typed : String(next++ % 10);
    await doPush(value, AUTO_HOLD_MS);
    logHistory('push("' + value + '") → size ' + stack.length, "ok");
    if (!autoStop && stack.length < capacity) await sleep(160);
  }

  if (autoStop) {
    setMessage("⏹ Auto Push stopped at size " + stack.length + " / " + capacity + ".", "warn");
    logHistory("auto push → stopped", "warn");
  } else {
    shake(); // this is the stack overflow the loop ran into
    hl("overflow", "err"); // <-- printf("Stack overflow");
    setMessage("⛔ Stack overflow — the stack is full (" + capacity + " / " + capacity + ").", "error");
    logHistory("auto push → overflow", "error");
    await sleep(1200);
  }

  autoButtonsEnd();
}

/* pops until the stack is empty, then shows the underflow */
async function autoPop() {
  if (autoRun === "pop") {
    autoStop = true;
    return;
  }
  if (busy) return;

  autoButtonsStart("pop");

  while (!autoStop && stack.length > 0) {
    const removed = await doPop(AUTO_HOLD_MS);
    popDoneMessage(removed);
    if (!autoStop && stack.length > 0) await sleep(160);
  }

  if (autoStop) {
    setMessage("⏹ Auto Pop stopped at size " + stack.length + " / " + capacity + ".", "warn");
    logHistory("auto pop → stopped", "warn");
  } else if (stack.length === 0) {
    shake(); // one pop too many = stack underflow
    hl("underflow-pop", "err"); // <-- printf("Stack underflow");
    setMessage("⛔ Stack underflow — the stack is empty (0 / " + capacity + ").", "error");
    logHistory("auto pop → underflow", "error");
    await sleep(1200);
  }

  autoButtonsEnd();
}

/* ---------- 9. Wire up the buttons ---------- */
setSizeBtn.addEventListener("click", setSize);
pushBtn.addEventListener("click", push);
popBtn.addEventListener("click", pop);
peekBtn.addEventListener("click", peek);
autoPushBtn.addEventListener("click", autoPush);
autoPopBtn.addEventListener("click", autoPop);

sizeInputEl.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    setSize();
  }
});

valueInputEl.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    push();
  }
});

// keep it to one character, even when something longer is pasted in
valueInputEl.addEventListener("input", function () {
  if (valueInputEl.value.length > 1) valueInputEl.value = valueInputEl.value.slice(0, 1);
});

// first paint
layout();
render();
renderHistory();
setClimber(-1); // the climber waits on the ground

// block heights can change on resize or when the size changes —
// keep the climber on the right rung (ResizeObserver also covers the
// cases where the window resize event does not fire)
window.addEventListener("resize", function () {
  layout();
  render();
  setClimber(climberRow);
});

if (typeof ResizeObserver === "function") {
  const ro = new ResizeObserver(function () {
    setClimber(climberRow);
  });
  ro.observe(stackEl);
}
