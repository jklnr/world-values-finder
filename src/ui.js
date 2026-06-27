// View layer: small DOM helpers plus builders for each screen and an
// animated, self-reordering country leaderboard.

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (key === "class") node.className = val;
    else if (key === "html") node.innerHTML = val;
    else if (key.startsWith("on") && typeof val === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (val !== null && val !== undefined && val !== false) {
      node.setAttribute(key, val);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child))
    );
  }
  return node;
}

export function matchColor(match) {
  // Keep scores visually meaningful without introducing a separate rainbow.
  const lightness = Math.round(42 + (match / 100) * 24);
  return `hsl(216 72% ${lightness}%)`;
}

function buildCredit() {
  return h(
    "a",
    {
      class: "built-by",
      href: "https://github.com/jklnr",
      target: "_blank",
      rel: "noopener",
    },
    "Tool built by ",
    h("img", {
      src: "https://github.githubassets.com/favicons/favicon.svg",
      alt: "GitHub",
      width: "14",
      height: "14",
      loading: "lazy",
    }),
    "@jklnr"
  );
}

function buildMethodology(source) {
  return h(
    "details",
    { class: "methodology" },
    h("summary", {}, "Methodology"),
    h(
      "div",
      { class: "methodology-body" },
      h(
        "p",
        {},
        `The data comes from ${source.survey}, using national averages from 66 countries. `,
        h("a", { href: source.url, target: "_blank", rel: "noopener" }, "Learn more at WVS.")
      ),
      h(
        "p",
        {},
        "The 50-question length was chosen somewhat arbitrarily after running experiments included in this repo on simulated random respondents and how many questions are needed to match a country. Real users are less random and will probably require fewer questions. You can always skip through if you get bored."
      ),
      h(
        "p",
        {},
        "The question selection itself was a bit more judgment-based. The goal was to build a tool that helps people find countries whose peoples' values align with their own. WVS has more than 200 questions, and many felt unuseful for that purpose. For example, 'how frequent violence is in your neighborhood' is not really a value the way I think of values. More subtly, a question like how concerned you are about civil war may say more about a country's social or economic state than its people's values, so I omitted questions like that. Other questions were omitted because they were impossible to calculate MSE on because the answers were not ordinal."
      ),
      h(
        "p",
        {},
        "(If you dislike that fuzzy selection process, the data and code are open source if you want to try other approaches)"
      ),
      h(
        "p",
        {},
        "Alignment is calculated by using simple mean squared error over your answered questions. Someone smarter than me might choose a different function, but MSE seemed reasonable for a toy like this."
      )
    )
  );
}

function displayOptions(options) {
  const labels = options.map((opt) => opt.label.toLowerCase());
  const startsAgree = labels[0] === "agree strongly" || labels[0] === "strongly agree";
  const endsDisagree = labels[labels.length - 1] === "strongly disagree";
  return startsAgree && endsDisagree ? [...options].reverse() : options;
}

// ---------------------------------------------------------------------------
// Intro screen
// ---------------------------------------------------------------------------
export function buildIntro({ total, source, onStart }) {
  return h(
    "div",
    { class: "screen intro" },
    h(
      "div",
      { class: "intro-card" },
      h("div", { class: "brand" }, h("span", { class: "brand-dot" }), "World Values"),
      h("h1", {}, "Which countries share your values?"),
      h(
        "ul",
        { class: "intro-points" },
        h("li", {}, "WVS Wave 7 data from 66 countries"),
        h("li", {}, "Your match updates with every answer"),
        h("li", {}, "No cookies, no tracking, etc - works offline")
      ),
      h("button", { class: "btn primary big", onClick: onStart }, "Begin"),
      h(
        "div",
        { class: "fineprint" },
        h(
          "p",
          {},
          `Data from ${source.survey}. `,
          h("a", { href: source.url, target: "_blank", rel: "noopener" }, "worldvaluessurvey.org")
        ),
        h(
          "div",
          { class: "credit-row" },
          buildCredit(),
          h("span", { class: "credit-sep" }, "·"),
          buildMethodology(source)
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Question card
// ---------------------------------------------------------------------------
export function buildQuestionCard({
  question,
  index,
  total,
  current,
  completed,
  scale,
  onAnswer,
  onBack,
  onNext,
  onSkip,
}) {
  const card = h("div", { class: "question-card" });
  const isLast = index === total - 1;
  // Built below; referenced by the answer handlers to enable progression.
  const nextBtn = h(
    "button",
    { class: "btn primary next", onClick: onNext },
    isLast ? "See results" : "Next"
  );

  function markAnswered() {
    nextBtn.disabled = false;
    nextBtn.classList.add("ready");
  }

  card.appendChild(
    h(
      "div",
      { class: "q-head" },
      h("span", { class: "q-category" }, question.category),
      h("span", { class: "q-count" }, `Question ${index + 1} of ${total}`)
    )
  );

  // Progress bar.
  const answered = completed ?? current.size;
  card.appendChild(
    h(
      "div",
      { class: "progress" },
      h("div", {
        class: "progress-fill",
        style: `width:${(answered / total) * 100}%`,
      })
    )
  );

  card.appendChild(h("h2", { class: "q-text" }, question.text));

  const existing = current.get(question.code);

  if (question.type === "choice") {
    const list = h("div", { class: "options choice" });
    for (const opt of displayOptions(question.options)) {
      list.appendChild(
        h(
          "button",
          {
            class: "option" + (existing === opt.value ? " selected" : ""),
            onClick: (e) => {
              card
                .querySelectorAll(".option")
                .forEach((b) => b.classList.remove("selected"));
              e.currentTarget.classList.add("selected");
              onAnswer(question.code, opt.value);
              markAnswered();
            },
          },
          opt.label
        )
      );
    }
    card.appendChild(list);
  } else {
    // Scale question: numbered buttons with end labels.
    const min = scale.min;
    const max = scale.max;
    const row = h("div", { class: "options scale" });
    for (let v = min; v <= max; v++) {
      row.appendChild(
        h(
          "button",
          {
            class: "pip" + (existing === v ? " selected" : ""),
            onClick: (e) => {
              row.querySelectorAll(".pip").forEach((b) => b.classList.remove("selected"));
              e.currentTarget.classList.add("selected");
              onAnswer(question.code, v);
              markAnswered();
            },
          },
          String(v)
        )
      );
    }
    card.appendChild(
      h(
        "div",
        { class: "scale-wrap" },
        h(
          "div",
          { class: "scale-labels" },
          h("span", {}, question.lowLabel),
          h("span", {}, question.highLabel)
        ),
        row
      )
    );
  }

  if (existing === undefined) nextBtn.disabled = true;
  else nextBtn.classList.add("ready");

  card.appendChild(
    h(
      "div",
      { class: "q-nav" },
      h(
        "button",
        { class: "btn ghost", disabled: index === 0 ? "" : null, onClick: onBack },
        "Back"
      ),
      h(
        "div",
        { class: "q-nav-right" },
        h("button", { class: "btn link", onClick: onSkip }, "Skip"),
        nextBtn
      )
    )
  );

  return card;
}

// ---------------------------------------------------------------------------
// Animated leaderboard
// ---------------------------------------------------------------------------
export function createLeaderboard(
  mount,
  { topN = 8, emptyText = "Answer a question to reveal your matches." } = {}
) {
  const rows = new Map(); // iso3 -> { el, bar, match, rankLabel }
  const ROW_H = 56;
  const board = h("div", { class: "board-list", style: `height:${topN * ROW_H}px` });
  mount.appendChild(board);

  const empty = h("p", { class: "board-empty" }, emptyText);
  mount.appendChild(empty);

  function ensureRow(country) {
    let r = rows.get(country.iso3);
    if (r) return r;
    const bar = h("div", { class: "bar-fill" });
    const matchEl = h("span", { class: "row-match" });
    const rankEl = h("span", { class: "row-rank" });
    const el = h(
      "div",
      { class: "board-row" },
      rankEl,
      h("span", { class: "row-flag" }, country.flag),
      h(
        "div",
        { class: "row-body" },
        h(
          "div",
          { class: "row-top" },
          h("span", { class: "row-name" }, country.name),
          matchEl
        ),
        h("div", { class: "bar-track" }, bar)
      )
    );
    board.appendChild(el);
    r = { el, bar, matchEl, rankEl };
    rows.set(country.iso3, r);
    return r;
  }

  function update(ranked) {
    if (ranked.length === 0) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    const visible = ranked.slice(0, topN);
    const visibleSet = new Set(visible.map((c) => c.iso3));

    visible.forEach((country, i) => {
      const r = ensureRow(country);
      r.el.classList.add("visible");
      r.el.style.transform = `translateY(${i * ROW_H}px)`;
      r.el.style.opacity = "1";
      r.el.style.zIndex = String(topN - i);
      r.bar.style.width = `${country.match}%`;
      r.bar.style.background = matchColor(country.match);
      r.matchEl.textContent = `${Math.round(country.match)}%`;
      r.matchEl.style.color = matchColor(country.match);
      r.rankEl.textContent = String(i + 1);
    });

    // Fade out rows that dropped off the visible list.
    for (const [iso3, r] of rows) {
      if (!visibleSet.has(iso3)) {
        r.el.classList.remove("visible");
        r.el.style.opacity = "0";
        r.el.style.transform = `translateY(${topN * ROW_H}px)`;
      }
    }
  }

  return { update };
}

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
function buildFlagBurst(flag) {
  const flags = Array.from({ length: 34 }, (_, i) => {
    const x = Math.round((Math.random() - 0.5) * 620);
    const y = Math.round((Math.random() - 0.35) * 420);
    const rotation = Math.round((Math.random() - 0.5) * 720);
    const scale = (0.75 + Math.random() * 0.9).toFixed(2);
    const delay = Math.round(Math.random() * 180);
    return h(
      "span",
      {
        class: "flag-confetti",
        style: `--x:${x}px;--y:${y}px;--r:${rotation}deg;--s:${scale};--delay:${delay}ms`,
        "aria-hidden": "true",
      },
      flag
    );
  });
  return h("div", { class: "flag-burst", "aria-hidden": "true" }, flags);
}

export function buildResults({ ranked, total, answered, source }) {
  const top = ranked[0];
  const screen = h("div", { class: "screen results" });

  function shareText() {
    const url = new URL(window.location.href);
    url.search = "";
    const lines = [
      "🌍 World Values Finder",
      "My top matches:",
      ...ranked.slice(0, 3).map(
        (c, i) => `${i + 1}. ${c.flag} ${c.name} ${Math.round(c.match)}%`
      ),
      url.href,
    ];
    return lines.filter((line) => line !== false && line !== undefined).join("\n");
  }

  async function copyToClipboard(text, button, copiedText = "Copied!") {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = h("textarea", { class: "clipboard-fallback" }, text);
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      button.textContent = copiedText;
    } catch {
      button.textContent = "Copy failed";
    }
  }

  async function copyShareText(button) {
    await copyToClipboard(shareText(), button);
  }

  screen.appendChild(
    h(
      "div",
      { class: "results-head" },
      h("p", { class: "eyebrow" }, `Based on ${answered} of ${total} answers`),
      h("h1", {}, "Your closest match!"),
      top &&
        h(
          "div",
          { class: "champion", style: `--accent:${matchColor(top.match)}` },
          buildFlagBurst(top.flag),
          h("div", { class: "champion-flag" }, top.flag),
          h(
            "div",
            { class: "champion-copy" },
            h("div", { class: "champion-name" }, top.name),
            h(
              "div",
              { class: "champion-match" },
              `${Math.round(top.match)}% alignment`
            )
          )
        ),
      h(
        "div",
        { class: "result-actions" },
        h(
          "button",
          {
            class: "btn primary",
            onClick: (e) => copyShareText(e.currentTarget),
          },
          "Share"
        ),
        h(
          "button",
          {
            class: "btn permalink",
            onClick: (e) =>
              copyToClipboard(
                window.location.href,
                e.currentTarget,
                "📋 Permalink copied!"
              ),
          },
          "📋 Permalink to your results"
        )
      )
    )
  );

  function resultRow(c, rank) {
    return h(
      "div",
      { class: "result-row" },
      h("span", { class: "row-rank" }, String(rank)),
      h("span", { class: "row-flag" }, c.flag),
      h(
        "div",
        { class: "row-body" },
        h(
          "div",
          { class: "row-top" },
          h("span", { class: "row-name" }, c.name),
          h("span", { class: "row-match", style: `color:${matchColor(c.match)}` }, `${Math.round(c.match)}%`)
        ),
        h(
          "div",
          { class: "bar-track" },
          h("div", {
            class: "bar-fill",
            style: `width:${c.match}%;background:${matchColor(c.match)}`,
          })
        )
      )
    );
  }

  screen.appendChild(h("h3", { class: "list-heading" }, "Closest to your values"));
  const list = h("div", { class: "results-list" });
  ranked.slice(0, 10).forEach((c, i) => list.appendChild(resultRow(c, i + 1)));
  screen.appendChild(list);

  const furthest = ranked.slice(-5).reverse();
  if (furthest.length) {
    screen.appendChild(h("h3", { class: "list-heading" }, "Furthest from your values"));
    const flist = h("div", { class: "results-list" });
    furthest.forEach((c) => {
      const rank = ranked.indexOf(c) + 1;
      flist.appendChild(resultRow(c, rank));
    });
    screen.appendChild(flist);
  }

  return screen;
}
