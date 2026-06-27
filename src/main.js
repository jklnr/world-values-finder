import "./style.css";
import { QUESTIONS } from "./survey.js";
import { rankCountries, SOURCE } from "./match.js";
import data from "./data/wvs.json" with { type: "json" };
import {
  h,
  buildIntro,
  buildQuestionCard,
  createLeaderboard,
  buildResults,
} from "./ui.js";
import { encodeProgress, decodeProgress } from "./url-state.js";

const PARAM = "a";

function syncUrl() {
  const code = encodeProgress(state.answers, state.skipped);
  const url = new URL(window.location.href);
  if (code) url.searchParams.set(PARAM, code);
  else url.searchParams.delete(PARAM);
  history.replaceState(null, "", url);
}

const SCALE = new Map(data.questions.map((q) => [q.code, q]));
const TOTAL = QUESTIONS.length;
const app = document.getElementById("app");

const state = {
  index: 0,
  answers: new Map(), // code -> raw value
  skipped: new Set(), // code
};

let leaderboard = null;
let oppositeBoard = null;
let questionMount = null;

function showIntro() {
  state.answers = new Map();
  state.skipped = new Set();
  state.index = 0;
  syncUrl();
  app.replaceChildren(
    buildIntro({ total: TOTAL, source: SOURCE, onStart: startSurvey })
  );
}

function startSurvey() {
  state.index = 0;
  state.answers = new Map();
  state.skipped = new Set();
  syncUrl();
  buildSurveyLayout();
  renderQuestion();
  refreshBoard();
}

function resumeSurvey({ answers, skipped }) {
  state.answers = answers;
  state.skipped = skipped;
  syncUrl();
  // Pick up at the first question that has not been answered or skipped.
  const firstIncomplete = QUESTIONS.findIndex(
    (q) => !answers.has(q.code) && !skipped.has(q.code)
  );
  if (firstIncomplete < 0) {
    showResults();
    return;
  }
  state.index = firstIncomplete;
  buildSurveyLayout();
  renderQuestion();
  refreshBoard();
}

function buildSurveyLayout() {
  questionMount = h("div", { class: "question-panel" });
  const boardMount = h(
    "aside",
    { class: "board-panel" },
    h("h3", { class: "board-title" }, "Best matches so far"),
    h("div", { class: "board-mount best" }),
    h("h3", { class: "board-title sep" }, "Most different from you"),
    h("div", { class: "board-mount diff" })
  );
  const layout = h("div", { class: "screen layout" }, questionMount, boardMount);
  app.replaceChildren(layout);
  leaderboard = createLeaderboard(boardMount.querySelector(".board-mount.best"), {
    topN: 5,
  });
  oppositeBoard = createLeaderboard(boardMount.querySelector(".board-mount.diff"), {
    topN: 5,
    emptyText: "Your opposites will appear here.",
  });
}

function renderQuestion() {
  const question = QUESTIONS[state.index];
  const card = buildQuestionCard({
    question,
    index: state.index,
    total: TOTAL,
    current: state.answers,
    completed: state.answers.size + state.skipped.size,
    scale: SCALE.get(question.code),
    onAnswer: handleAnswer,
    onBack: goBack,
    onNext: goNext,
    onSkip: skipQuestion,
  });
  card.classList.add("enter");
  questionMount.replaceChildren(card);
  requestAnimationFrame(() => {
    card.classList.remove("enter");
  });
}

function handleSurveyKeyboard(e) {
  const target = e.target;
  if (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
  ) {
    return;
  }

  const card = questionMount?.isConnected
    ? questionMount.querySelector(".question-card")
    : null;
  if (!card) return;

  if (e.key === "Enter") {
    const nextBtn = card.querySelector(".btn.next:not([disabled])");
    if (!nextBtn) return;
    e.preventDefault();
    nextBtn.click();
    return;
  }

  if (!/^[0-9]$/.test(e.key)) return;
  const answerIndex = e.key === "0" ? 9 : Number(e.key) - 1;
  const answer = card.querySelectorAll(".option, .pip")[answerIndex];
  if (!answer) return;
  e.preventDefault();
  answer.click();
  answer.blur();
}

function refreshBoard() {
  const ranked = rankCountries(state.answers);
  if (leaderboard) leaderboard.update(ranked);
  if (oppositeBoard) oppositeBoard.update([...ranked].reverse());
}

function handleAnswer(code, value) {
  // Record the answer and refresh the board. Progression is explicit (the
  // Next button), so the leaderboard only ever changes in response to a
  // deliberate answer on the question currently shown.
  state.answers.set(code, value);
  state.skipped.delete(code);
  syncUrl();
  refreshBoard();
}

function skipQuestion() {
  state.skipped.add(QUESTIONS[state.index].code);
  syncUrl();
  goNext();
}

function goNext() {
  if (state.index >= TOTAL - 1) {
    showResults();
    return;
  }
  state.index += 1;
  renderQuestion();
}

function goBack() {
  if (state.index === 0) return;
  state.index -= 1;
  renderQuestion();
}

function showResults() {
  const ranked = rankCountries(state.answers);
  app.replaceChildren(
    buildResults({
      ranked,
      total: TOTAL,
      answered: state.answers.size,
      source: SOURCE,
    })
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const restored = decodeProgress(
  new URL(window.location.href).searchParams.get(PARAM)
);
document.addEventListener("keydown", handleSurveyKeyboard);
if (restored.answers.size > 0 || restored.skipped.size > 0) resumeSurvey(restored);
else showIntro();
