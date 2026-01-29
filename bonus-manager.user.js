// ==UserScript==
// @name         IAI Bonus Manager (v11.3 Stability Fix)
// @namespace    http://tampermonkey.net/
// @version      11.3
// @description  Monitor + Detektyw + Notatki + Statystyki + Naprawa Resetowania
// @author       Grzegorz Maciejczak
// @match        https://*.iai-system.com/panel/tickets.php*
// @match        https://*.idosell.com/panel/tickets.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/dizzeeyy/iai-bonus/main/bonus-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/dizzeeyy/iai-bonus/main/bonus-manager.user.js
// ==/UserScript==

(function () {
  "use strict";

  // --- CONFIG ---
  let CONFIG = {
    listUrl: "/panel/tickets.php?action=searchm&textType=open",
    ticketUrlBase: "/panel/tickets.php?action=ins&ticketId=",
    interval: 3 * 60 * 1000,
    myName: GM_getValue("config_name", ""),
    dailyGoal: GM_getValue("config_goal", 35),
    notePrefix: "Notatka z rozmowy",
    nonBonusPhrases: [
      "Internal Support",
      "Escalation",
      "Improvement",
      "New feature suggestion",
    ],
  };

  if (!CONFIG.myName) {
    const inputName = prompt(
      "[IAI Bonus Manager]\nWitaj! Podaj swoje Imię i Nazwisko:",
    );
    if (inputName) {
      CONFIG.myName = inputName.trim();
      GM_setValue("config_name", CONFIG.myName);
      const inputGoal = prompt("Podaj dzienny cel:", "35");
      if (inputGoal) {
        CONFIG.dailyGoal = parseInt(inputGoal) || 35;
        GM_setValue("config_goal", CONFIG.dailyGoal);
      }
    }
  }

  const HOLIDAYS = {
    "2026-01-01": "Nowy Rok",
    "2026-01-06": "Trzech Króli",
    "2026-04-05": "Wielkanoc",
    "2026-04-06": "Poniedziałek Wielkanocny",
    "2026-05-01": "Święto Pracy",
    "2026-05-03": "Święto Konstytucji 3 Maja",
    "2026-06-04": "Boże Ciało",
    "2026-08-15": "Wniebowzięcie NMP",
    "2026-11-01": "Wszystkich Świętych",
    "2026-11-11": "Święto Niepodległości",
    "2026-12-24": "Wigilia Bożego Narodzenia",
    "2026-12-25": "Boże Narodzenie",
    "2026-12-26": "Drugi dzień świąt",
  };

  const KEY = {
    daily: "iai_bonus_daily_v9",
    history: "iai_bonus_history_v9",
    stats: "iai_bonus_stats_db",
    lastScanIds: "iai_last_scan_ids",
  };

  function safeParse(jsonString, fallback) {
    if (!jsonString || jsonString === "undefined" || jsonString === "null")
      return fallback;
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      return fallback;
    }
  }

  const href = window.location.href;
  const isListPage = href.includes("action=searchm");
  const isTicketPage = href.includes("action=ins");
  let hudEl = null,
    logEl = null,
    modalEl = null;

  function getTodayKey() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // --- KLUCZOWA POPRAWKA: BEZPIECZNE POBIERANIE STANU ---
  function getAndEnsureDailyStats() {
    const raw = GM_getValue(KEY.daily);
    let stats = safeParse(raw, null); // Domyślnie null, żeby wiedzieć czy odczyt się udał
    const today = getTodayKey();

    // 1. Jeśli odczyt całkowicie padł (null) lub brak daty -> spróbuj odtworzyć z historii
    if (!stats || !stats.date) {
      console.warn(
        "[IAI Bonus] Brak danych dziennych! Próba odtworzenia z historii...",
      );
      const history = safeParse(GM_getValue(KEY.history), []);
      // Filtrujemy historię tylko z dzisiaj
      const todayIds = history
        .filter((entry) => entry.date.startsWith(today))
        .map((entry) => entry.id);

      // Tworzymy nowy obiekt na bazie historii
      stats = {
        date: today,
        count: todayIds.length,
        ids: todayIds, // Unikamy duplikatów: [...new Set(todayIds)]
      };

      // Zapisujemy naprawiony stan
      GM_setValue(KEY.daily, JSON.stringify(stats));
      return stats;
    }

    // 2. Jeśli data się zgadza -> zwracamy to co jest
    if (stats.date === today) {
      if (!Array.isArray(stats.ids)) stats.ids = []; // Mała naprawa struktury
      return stats;
    }

    // 3. Jeśli data jest inna (faktycznie nowy dzień) -> Resetujemy
    console.log(
      `[IAI Bonus] Zmiana daty: ${stats.date} -> ${today}. Resetuję licznik.`,
    );
    stats = { date: today, count: 0, ids: [] };
    GM_setValue(KEY.daily, JSON.stringify(stats));
    return stats;
  }

  function isNonBonusTicket(textContext) {
    if (!textContext) return false;
    return CONFIG.nonBonusPhrases.some((phrase) =>
      textContext.includes(phrase),
    );
  }

  // --- SETTINGS ---
  function openSettings() {
    const newName = prompt("Zmień Imię i Nazwisko:", CONFIG.myName);
    if (newName !== null) {
      CONFIG.myName = newName.trim();
      GM_setValue("config_name", CONFIG.myName);
    }
    const newGoal = prompt("Zmień Cel Dzienny:", CONFIG.dailyGoal);
    if (newGoal !== null) {
      CONFIG.dailyGoal = parseInt(newGoal) || 35;
      GM_setValue("config_goal", CONFIG.dailyGoal);
    }
    alert("Zapisano zmiany. Odśwież stronę.");
    location.reload();
  }

  // 1. NOTATKI
  if (isTicketPage) {
    setTimeout(() => {
      if (!CONFIG.myName) return;
      const h1El = document.querySelector("h1");
      if (h1El && isNonBonusTicket(h1El.innerText)) {
        console.log("Skip Non-Bonus");
        return;
      }
      let title = "";
      if (h1El) title = h1El.textContent.trim();
      if (!title) {
        const selectors = [".ticket-title", 'input[name="title"]'];
        for (let s of selectors) {
          const el = document.querySelector(s);
          if (el) {
            title = (el.value || el.textContent).trim();
            if (title) break;
          }
        }
      }
      if (title && title.includes(CONFIG.notePrefix)) {
        const rows = document.querySelectorAll("td.row1, td.row2");
        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          const headText = lastRow.textContent;
          const d = new Date();
          const todayStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
          if (headText.includes(CONFIG.myName) && headText.includes(todayStr)) {
            const tid = new URLSearchParams(window.location.search).get(
              "ticketId",
            );
            // Ważne: addPoint sam pobierze i naprawi stan
            if (addPoint(tid, title, "NOTE"))
              GM_notification({ text: "Zaliczono notatkę!", timeout: 2000 });
          }
        }
      }
    }, 1500);
    return;
  }

  // 2. LISTA (UI)
  if (!isListPage) return;

  GM_addStyle(`
        #iai-hud { position: fixed; bottom: 20px; right: 20px; width: 250px; background: #1e1f22; color: #dcddde; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; z-index: 99990; box-shadow: 0 8px 24px rgba(0,0,0,0.4); border: 1px solid #2e3035; overflow: hidden; }
        .hud-header { padding: 12px 16px; background: #2b2d31; border-bottom: 1px solid #1e1f22; display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
        .hud-body { padding: 12px 16px; }
        .hud-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .hud-val { font-weight: 600; color: #fff; }
        .hud-log { max-height: 80px; overflow-y: auto; color: #72767d; margin-top: 10px; border-top: 1px solid #2f3136; padding-top: 8px; font-size: 10px; font-family: monospace; }
        .hud-log::-webkit-scrollbar { width: 4px; } .hud-log::-webkit-scrollbar-thumb { background: #40444b; border-radius: 2px; }
        .hud-btn-group { display: flex; gap: 6px; margin-top: 12px; }
        .hud-btn { flex: 1; background: #36393f; border: 1px solid #202225; color: #b9bbbe; padding: 6px 4px; cursor: pointer; border-radius: 4px; font-size: 11px; text-align: center; font-weight: 500; }
        .hud-btn:hover { background: #40444b; color: #fff; }
        .hud-btn-icon { width: 25px; flex: none; font-size: 14px; padding: 2px; }
        #iai-stats-modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 340px; background: #1e1f22; border: 1px solid #2e3035; z-index: 99999; padding: 24px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); color: #dcddde; }
        .stat-h { font-size: 18px; font-weight: 700; margin-bottom: 20px; border-bottom: 2px solid #2b2d31; color: #5865f2; }
        .stat-row { display: flex; justify-content: space-between; margin-bottom: 10px; } .stat-row b { color: #fff; }
        .stat-big { font-size: 32px; font-weight: 800; text-align: center; margin: 20px 0; color: #fff; }
        .stat-close { position: absolute; top: 16px; right: 16px; cursor: pointer; }
        .btn-save-day { width: 100%; padding: 12px; background: #23a559; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; text-transform: uppercase; }
        tr.iai-done { background-color: #f2f3f5 !important; opacity: 0.6; filter: grayscale(100%); }
        .iai-badge { display: inline-block; padding: 2px 6px; background: #23a559; color: white; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 6px; }
        #iai-top-bar { position: relative; background: #fff; margin: 10px auto; width: 300px; border: 1px solid #e3e5e8; border-radius: 6px; overflow: hidden; transition: border-left 0.4s ease; }
        #iai-progress { position: absolute; top: 0; left: 0; height: 100%; background: linear-gradient(90deg, #ed4245, #f04747); transition: width 0.5s ease; z-index: 1; opacity: 0.15; }
        #iai-top-content { position: relative; z-index: 2; padding: 12px 16px; display: flex; justify-content: space-between; font-size: 13px; color: #2e3338; font-weight: 500; }
        #iai-top-bar.progress-complete { border-left: 4px solid #23a559; } #iai-top-bar.progress-complete #iai-progress { background: linear-gradient(90deg, #23a559, #2ecc71); opacity: 0.25; }
    `);

  function initUI() {
    if (document.getElementById("iai-hud")) return;
    if (!CONFIG.myName) return;

    hudEl = document.createElement("div");
    hudEl.id = "iai-hud";
    hudEl.innerHTML = `
            <div class="hud-header">
                <span>${CONFIG.myName} v11.3</span>
                <span id="iai-score" style="color:#23a559">0 / ${CONFIG.dailyGoal}</span>
            </div>
            <div class="hud-body">
                <div class="hud-row"><span>Zaliczone:</span> <span id="iai-tickets" class="hud-val">0</span></div>
                <div class="hud-row"><span>Do zrobienia:</span> <span id="iai-alerts" class="hud-val">0</span></div>
                <div id="iai-log" class="hud-log">Gotowy.</div>
                <div class="hud-btn-group">
                    <button id="btn-check" class="hud-btn">Skanuj</button>
                    <button id="btn-stats" class="hud-btn hud-btn-stat">Raport</button>
                    <button id="btn-settings" class="hud-btn hud-btn-icon" title="Ustawienia">⚙️</button>
                </div>
            </div>
        `;
    document.body.appendChild(hudEl);
    logEl = hudEl.querySelector("#iai-log");
    modalEl = document.createElement("div");
    modalEl.id = "iai-stats-modal";
    modalEl.innerHTML = `<div class="stat-close" id="btn-close-stats">✕</div><div class="stat-h">Raport Miesięczny</div><div class="stat-row"><span>Dziś:</span> <b id="stat-today">0</b></div><div class="stat-row"><span>Dni robocze:</span> <b id="stat-days">0</b></div><div id="stat-holiday-msg" style="color:red;font-size:10px"></div><div class="stat-row"><span>Cel:</span> <b id="stat-required">0</b></div><div class="stat-row"><span>Wykonano:</span> <b id="stat-total">0</b></div><div class="stat-big" id="stat-avg">0.0</div><div class="stat-desc">Średnia</div><div class="stat-row" style="border-top:1px solid #333;padding-top:10px"><span>Bilans:</span> <b id="stat-balance">0</b></div><br><button id="btn-save-db" class="btn-save-day">ZAPISZ DZIŚ</button>`;
    document.body.appendChild(modalEl);

    setTimeout(() => {
      document.getElementById("btn-check").onclick = () => {
        addLog("Skanowanie...");
        runScan(true);
      };
      document.getElementById("btn-stats").onclick = openStats;
      document.getElementById("btn-settings").onclick = openSettings;
      document.getElementById("btn-close-stats").onclick = () =>
        (modalEl.style.display = "none");
      document.getElementById("btn-save-db").onclick = saveDailyToDb;
    }, 500);

    refreshStatsUI();
    injectTopBar();
  }

  function addLog(msg) {
    if (logEl) {
      const l = document.createElement("div");
      l.innerText = `> ${msg}`;
      logEl.prepend(l);
    }
  }

  // --- FUNKCJE DANYCH ---
  function getCleanHistory() {
    let r = GM_getValue(KEY.history);
    return Array.isArray(safeParse(r)) ? safeParse(r) : [];
  }

  function addPoint(id, title, method) {
    if (!id) return false;

    let stats = getAndEnsureDailyStats(); // Używa pancernej wersji
    if (stats.ids.includes(id)) return false;

    const hist = getCleanHistory();
    // Sprawdź w historii
    if (hist.some((e) => e.id === id && e.date.startsWith(getTodayKey()))) {
      // Jeśli jest w historii a nie w daily, to dodaj do daily ale nie podbijaj licznika (auto-fix)
      if (!stats.ids.includes(id)) {
        stats.ids.push(id);
        GM_setValue(KEY.daily, JSON.stringify(stats));
      }
      return false;
    }

    stats.ids.push(id);
    stats.count++;
    GM_setValue(KEY.daily, JSON.stringify(stats));

    hist.push({
      date: new Date().toISOString(),
      id: id,
      title: title || "?",
      method: method,
    });
    GM_setValue(KEY.history, JSON.stringify(hist));

    if (hudEl) refreshStatsUI();
    if (document.getElementById("iai-top-bar")) updateTopBar();
    return true;
  }

  function isWorkingDay(date) {
    const d = date.getDay();
    if (d === 0 || d === 6) return false;
    const s = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return !HOLIDAYS[s];
  }
  function getBusinessDaysInMonth(y, m) {
    const n = new Date();
    const lim =
      y === n.getFullYear() && m === n.getMonth()
        ? n.getDate()
        : new Date(y, m + 1, 0).getDate();
    let c = 0;
    for (let d = 1; d <= lim; d++) if (isWorkingDay(new Date(y, m, d))) c++;
    return c;
  }

  function saveDailyToDb() {
    const d = getAndEnsureDailyStats();
    const db = safeParse(GM_getValue(KEY.stats), {});
    db[getTodayKey()] = d.count;
    GM_setValue(KEY.stats, JSON.stringify(db));
    alert(`Zapisano wynik: ${d.count}`);
    openStats();
  }

  function openStats() {
    const db = safeParse(GM_getValue(KEY.stats), {});
    const now = new Date();
    const bd = getBusinessDaysInMonth(now.getFullYear(), now.getMonth());
    let tot = 0;
    const live = getAndEnsureDailyStats();
    const mp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    for (let d = 1; d <= now.getDate(); d++) {
      const k = `${mp}-${String(d).padStart(2, "0")}`;
      tot +=
        k === getTodayKey() ? Math.max(db[k] || 0, live.count) : db[k] || 0;
    }
    const req = bd * CONFIG.dailyGoal;
    document.getElementById("stat-today").innerText = live.count;
    document.getElementById("stat-days").innerText = bd;
    document.getElementById("stat-required").innerText = req;
    document.getElementById("stat-total").innerText = tot;
    document.getElementById("stat-avg").innerText = (
      bd > 0 ? tot / bd : 0
    ).toFixed(2);
    const bal = tot - req;
    const be = document.getElementById("stat-balance");
    be.innerText = (bal > 0 ? "+" : "") + bal;
    be.style.color = bal >= 0 ? "#23a559" : "#ed4245";
    document.getElementById("stat-holiday-msg").innerText = HOLIDAYS[
      getTodayKey()
    ]
      ? `Wolne: ${HOLIDAYS[getTodayKey()]}`
      : "";
    modalEl.style.display = "block";
  }

  function refreshStatsUI() {
    if (!hudEl) return;
    const s = getAndEnsureDailyStats();
    document.getElementById("iai-score").innerText =
      `${s.count} / ${CONFIG.dailyGoal}`;
    document.getElementById("iai-tickets").innerText = s.count;
    document.getElementById("iai-alerts").innerText = document.querySelectorAll(
      ".ticket-table .divTableRow:not(.iai-done)",
    ).length;
  }
  function injectTopBar() {
    if (document.getElementById("iai-top-bar")) return;
    const b = document.createElement("div");
    b.id = "iai-top-bar";
    b.innerHTML =
      '<div id="iai-progress"></div><div id="iai-top-content"></div>';
    const c =
      document.querySelector(".ticket-container") ||
      document.querySelector(".ticket-table");
    if (c && c.parentNode) c.parentNode.insertBefore(b, c);
    updateTopBar();
  }

  function updateTopBar() {
    const b = document.getElementById("iai-top-bar");
    if (!b) return;
    const s = getAndEnsureDailyStats();
    const al = document.querySelectorAll(
      ".ticket-table .divTableRow:not(.iai-done)",
    ).length;
    const p = Math.min(100, (s.count / CONFIG.dailyGoal) * 100);
    document.getElementById("iai-top-content").innerHTML =
      `<div>Do zrobienia: <b>${al}</b></div><div>Wynik: <b>${s.count} / ${CONFIG.dailyGoal}</b> (${p.toFixed(0)}%)</div>`;
    document.getElementById("iai-progress").style.width = `${p}%`;
    b.className = "";
    if (p >= 100) b.classList.add("progress-complete");
    else if (p >= 80) b.classList.add("progress-high");
    else if (p >= 50) b.classList.add("progress-medium");
    else b.classList.add("progress-low");
  }

  function markAsDoneVisuals() {
    const ids = getAndEnsureDailyStats().ids;
    document.querySelectorAll(".ticket-table .divTableRow").forEach((r) => {
      const l = r.querySelector(".divTableCell6 a");
      if (l && ids.includes(l.href.split("ticketId=")[1])) {
        if (!r.classList.contains("iai-done")) {
          r.classList.add("iai-done");
          const c = r.querySelector(".divTableCell1");
          if (c) {
            const sp = document.createElement("span");
            sp.className = "iai-badge";
            sp.innerText = "✓ DONE";
            c.prepend(sp);
          }
        }
      }
    });
    updateTopBar();
    refreshStatsUI();
  }

  function runScan(force) {
    if (!CONFIG.myName) return;
    const rows = document.querySelectorAll(".ticket-table .divTableRow");
    const cIds = [];
    let nf = 0;
    rows.forEach((r) => {
      const l = r.querySelector(".divTableCell6 a");
      if (!l) return;
      const id = l.href.split("ticketId=")[1];
      cIds.push(id);
      const rc = r.querySelector(".divTableCell2");
      if (isNonBonusTicket(r.textContent)) return;

      if (rc) {
        const t = rc.textContent;
        const d = new Date();
        const ts = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
        if (t.includes(CONFIG.myName) && t.includes(ts)) {
          if (addPoint(id, "List Scan", "LIST")) {
            addLog(`+ List: #${id}`);
            nf++;
          }
        }
      }
    });
    const lIds = safeParse(sessionStorage.getItem(KEY.lastScanIds), []);
    const lost = lIds.filter((x) => !cIds.includes(x));
    if (lost.length > 0) {
      addLog(`Zniknęło: ${lost.length}`);
      lost.forEach((id) => verifyLostTicket(id));
    } else if (force && nf === 0) addLog("Brak zmian.");
    sessionStorage.setItem(KEY.lastScanIds, JSON.stringify(cIds));
    markAsDoneVisuals();
  }

  function verifyLostTicket(id) {
    GM_xmlhttpRequest({
      method: "GET",
      url: window.location.origin + CONFIG.ticketUrlBase + id,
      onload: function (res) {
        if (res.status === 200) {
          const h = res.responseText;
          const p = new DOMParser();
          const d = p.parseFromString(h, "text/html");
          const h1 = d.querySelector("h1");
          if (h1 && isNonBonusTicket(h1.innerText)) {
            addLog(`(Skip) Typ Non-Bonus: #${id}`);
            return;
          }
          const i = h.lastIndexOf("Created by:");
          if (i > -1) {
            const s = h.substring(i, i + 500);
            const n = new Date();
            const ts = `${String(n.getDate()).padStart(2, "0")}.${String(n.getMonth() + 1).padStart(2, "0")}.${n.getFullYear()}`;
            if (s.includes(CONFIG.myName) && s.includes(ts)) {
              if (addPoint(id, "Detective", "DETECTIVE")) {
                addLog(`+ Detektyw: #${id}`);
                GM_notification({ text: `Zaliczono #${id}` });
              }
            }
          }
        }
      },
    });
  }

  initUI();
  markAsDoneVisuals();
  setTimeout(() => runScan(false), 2000);
  setInterval(() => runScan(false), CONFIG.interval);
})();
