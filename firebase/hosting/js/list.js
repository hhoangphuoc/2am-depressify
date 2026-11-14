// The live Patient list, laid out as the design's roster (design/clinician/src/App.jsx): connection
// freshness, one red banner per Patient with an open red flag, search, filter buttons with counts,
// the table (avatar, name and first reason, Attention level word, 14-day sleep sparkline, last
// Check-in, phone last seen) and the count line.
//
// The data comes from the design data layer: `subscribeRoster` (js/lib/design-live.js) runs the
// Patients query with the sharing filter the rules require, listens to each listed Patient's visible
// flags, latest daily records and latest Check-in, and reports red flags that are new since the last
// update; `rosterView` (js/lib/design-model.js) orders, counts, filters and builds the banner. The
// banner is built from every listed Patient before any filter applies, so search and the filters
// never hide it, and it stays until the flag is cleared.
import { rosterView } from "./lib/design-model.js";
import { FILTER_LABELS, connectionText, rosterCountText, sparkline } from "./lib/design-view.js";
import { patientHref } from "./lib/route.js";
import { drawSparkline } from "./views/sparkline.js";
import { blankState as blank, flagChip } from "./views/ui.js";

const COPY = {
  loading: "Loading Patients…",
  review: "Review Patient",
  needsAttention: (/** @type {string} */ name) => `${name} needs attention`,
  more: (/** @type {number} */ n) => `And ${n} more red ${n === 1 ? "flag" : "flags"}.`,
  workQueue: "Each red flag stays here until it is cleared after follow-up. Search and filters never hide it.",
  open: "Open",
  noSleep: "No sleep data",
  checkIn: (/** @type {string} */ c, /** @type {string} */ p) => `Check-in ${c} · Phone ${p}`,
  reasons: (/** @type {number} */ n) => `${n} open reasons`,
  empty: ["No Patients linked yet", "Patients appear here once they choose to share their progress with you."],
  noMatch: "No matching Patients",
  clear: "Clear search and filters",
  denied: ["You don't have access to these Patients", "No Patient data is shown. Check that you signed in with the Clinician account, or sign out."],
  expired: ["Your sign-in has ended", "Sign in again to continue. No Patient data is shown."],
  error: ["Could not load the Patient list", "Check the connection, then reload the page to try again."],
  reload: "Reload",
};

/**
 * @param {string} tag
 * @param {Record<string, string | undefined>} [attrs]
 * @param {(Node | string | null | undefined | false)[]} children
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, value);
  node.append(.../** @type {(Node | string)[]} */ (children.filter((c) => c !== null && c !== undefined && c !== false)));
  return node;
}

/**
 * @typedef {object} ListElements
 * @property {HTMLElement} body
 * @property {HTMLElement} tableWrap
 * @property {HTMLElement} status
 * @property {HTMLElement} state
 * @property {HTMLElement} banner
 * @property {HTMLElement} controls
 * @property {HTMLInputElement} search
 * @property {HTMLElement} filters
 * @property {HTMLElement} freshness
 * @property {HTMLElement} offline
 * @property {HTMLElement} navCount
 */

/**
 * @param {ReturnType<typeof import("./data/design-data.js").designData>} data
 * @param {ListElements} elements
 * @param {{ clinicianEmail: string, timeZone: string, onNewRed?: (flags: { patientId: string, displayName: string, reason: string }[]) => void }} options
 * @returns {() => void} stops listening
 */
export function createPatientList(data, elements, { clinicianEmail, timeZone, onNewRed = () => {} }) {
  const { body, tableWrap, status, state, banner, controls, search, filters, freshness, offline, navCount } = elements;
  /** @type {import("./lib/design-live.js").RosterState} */
  let roster = { status: "loading", fromCache: false, patients: [], newRed: [], updatedAtMillis: Date.now() };
  /** @type {"all" | "red" | "amber" | "unknown" | "green" | "hidden"} */
  let filter = "all";
  search.value = "";

  function renderBanner(model) {
    banner.hidden = model === null;
    if (model === null) {
      banner.replaceChildren();
      return;
    }
    const sections = model.items.map((item, i) => {
      const headingId = `banner-${i}`;
      const reason = el("p", {}, item.reason, item.more ? el("span", { class: "banner-more" }, ` ${COPY.more(item.more)}`) : null);
      const link = el("a", { class: "button-link primary", href: item.href }, COPY.review, el("span", { class: "visually-hidden" }, `: ${item.displayName}`));
      return el("section", { class: "red-banner", "aria-labelledby": headingId }, el("div", {}, el("strong", { id: headingId }, COPY.needsAttention(item.displayName)), reason), link);
    });
    banner.replaceChildren(...sections, el("p", { class: "banner-note small muted" }, COPY.workQueue));
  }

  function renderFilters(view) {
    const focused = filters.contains(document.activeElement) ? document.activeElement?.getAttribute("data-filter") : null;
    filters.replaceChildren(
      ...view.filters.map((/** @type {string} */ value) => {
        const button = el(
          "button",
          { type: "button", "data-filter": value, "aria-pressed": String(filter === value) },
          FILTER_LABELS[/** @type {keyof typeof FILTER_LABELS} */ (value)] ?? value,
          el("span", {}, String(view.counts[value] ?? 0)),
        );
        button.addEventListener("click", () => {
          filter = /** @type {any} */ (value);
          render();
        });
        return button;
      }),
    );
    if (focused) /** @type {HTMLElement | null} */ (filters.querySelector(`[data-filter="${focused}"]`))?.focus();
  }

  /** @param {ReturnType<typeof import("./lib/design-model.js").designPatient>} p */
  function row(p) {
    const active = p.sharing === "active";
    const href = patientHref(p.id);
    const subtitle = el("small", {}, active ? p.note ?? "" : p.note ?? "");
    const mobile = active ? el("small", { class: "patient-mobile-meta" }, COPY.checkIn(p.checkIn ?? "—", p.lastPhone ?? "—")) : null;
    const name = el("th", { scope: "row" }, el("a", { class: "patient-name", href }, el("span", { class: "avatar", "aria-hidden": "true" }, p.initials), el("span", {}, el("strong", {}, p.name), subtitle, mobile)));
    const level = el("td", {}, flagChip(p.level, p.levelWord), p.activeFlags.length > 1 ? el("small", { class: "flag-count" }, COPY.reasons(p.activeFlags.length)) : null);
    const model = active ? sparkline(p.daily) : null;
    const sleep = el("td", { class: "desktop-column" }, model ? drawSparkline(model) : active ? COPY.noSleep : "Hidden");
    const checkIn = el("td", { class: "desktop-column" }, active ? p.checkIn ?? "—" : "Hidden");
    const phone = el("td", { class: `desktop-column${p.freshness?.stale ? " stale" : ""}` }, active ? p.lastPhone ?? "—" : "Hidden");
    const open = el("td", {}, el("a", { class: "text-button open-patient", href, "aria-label": `Open ${p.name}` }, COPY.open));
    return el("tr", { "data-level": p.level }, name, level, sleep, checkIn, phone, open);
  }

  function clearFilters() {
    search.value = "";
    filter = "all";
    render();
    search.focus();
  }

  function render() {
    const fresh = connectionText(roster, timeZone);
    freshness.textContent = fresh.text;
    offline.hidden = !(roster.status === "ok" && roster.fromCache);

    if (roster.status !== "ok") {
      renderBanner(null);
      controls.hidden = true;
      tableWrap.hidden = true;
      status.textContent = "";
      navCount.textContent = "";
      if (roster.status === "loading") {
        state.replaceChildren(el("div", { class: "loading-view", role: "status", "aria-busy": "true" }, el("p", {}, COPY.loading), el("div", { class: "skeleton" }), el("div", { class: "skeleton" }), el("div", { class: "skeleton" })));
      } else {
        const [title, text] = COPY[/** @type {"denied" | "expired" | "error"} */ (roster.status)] ?? COPY.error;
        const reload = el("button", { type: "button" }, COPY.reload);
        reload.addEventListener("click", () => window.location.reload());
        state.replaceChildren(blank(title, text, roster.status === "error" ? reload : null));
      }
      return;
    }

    const view = rosterView(roster, { search: search.value, filter });
    navCount.textContent = String(view.counts.all);
    renderBanner(view.banner);
    controls.hidden = view.all.length === 0;
    if (!view.filters.includes(filter)) filter = "all";
    renderFilters(view);

    if (view.all.length === 0) {
      state.replaceChildren(blank(COPY.empty[0], COPY.empty[1]));
    } else if (view.patients.length === 0) {
      const action = el("button", { type: "button" }, COPY.clear);
      action.addEventListener("click", clearFilters);
      state.replaceChildren(blank(COPY.noMatch, view.message.text, action));
    } else {
      state.replaceChildren();
    }
    tableWrap.hidden = view.patients.length === 0;
    body.replaceChildren(...view.patients.map(row));
    status.textContent = view.all.length ? rosterCountText(view.patients.length, view.all.length) : "";
  }

  search.addEventListener("input", render);
  render();

  const stop = data.subscribeRoster(
    { clinicianEmail, clock: () => ({ nowMillis: Date.now(), timeZone }) },
    (next) => {
      roster = next;
      if (next.newRed.length) onNewRed(next.newRed);
      render();
    },
  );

  return () => {
    stop();
    search.removeEventListener("input", render);
    renderBanner(null);
    body.replaceChildren();
    state.replaceChildren();
  };
}
