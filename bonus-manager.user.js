// ==UserScript==
// @name         IAI Bonus Manager (v11)
// @namespace    http://tampermonkey.net/
// @version      11.3
// @description  Monitor + Detektyw + Notatki + Statystyki + Auto-Reset Dnia
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
  const CONFIG = {
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

  // Sprawdzenie przy starcie czy użytkownik jest skonfigurowany
  if (!CONFIG.myName) {
    const inputName = prompt(
      "[IAI Bonus Manager]\nWitaj! To pierwsze uruchomienie.\nPodaj swoje Imię i Nazwisko (dokładnie jak w systemie):",
    );
    if (inputName) {
      CONFIG.myName = inputName.trim();
      GM_setValue("config_name", CONFIG.myName);
      const inputGoal = prompt("Podaj Twój dzienny cel (liczba):", "35");
      if (inputGoal) {
        CONFIG.dailyGoal = parseInt(inputGoal) || 35;
        GM_setValue("config_goal", CONFIG.dailyGoal);
      }
      alert("Zapisano! Odśwież stronę, aby załadować panel.");
    }
  }

  const KEY = {
    daily: "iai_bonus_daily_v9",
    history: "iai_bonus_history_v9",
    stats: "iai_bonus_stats_db",
    lastScanIds: "iai_last_scan_ids",
  };

  function safeParse(jsonString, fallback) {
    if (!jsonString || jsonString === "undefined" || jsonString === "null") {
      return fallback;
    }
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

  // --- POPRAWKA DATY (Lokalny Czas) ---
  function getTodayKey() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // --- FUNKCJA SPRAWDZAJĄCA I RESETUJĄCA LICZNIK ---
  // Wywoływana przy każdym odświeżeniu UI, żeby zawsze mieć świeże dane
  function getAndEnsureDailyStats() {
    const raw = GM_getValue(KEY.daily);
    let stats = safeParse(raw, {});
    const today = getTodayKey();

    // Upewnij się, że stats to obiekt
    if (!stats || typeof stats !== "object") stats = {};

    if (typeof stats.ids === "string") {
      try {
        stats.ids = JSON.parse(stats.ids);
      } catch (e) {
        stats.ids = [];
      }
    }

    // Pobierz zapisaną datę (bezpiecznie)
    const storedDate = (stats.date || "").substring(0, 10);

    // Jeśli data się zgadza, naprawiamy tylko ewentualne braki w strukturze
    if (storedDate === today) {
      //if (!Array.isArray(stats.ids)) stats.ids = [];
      if (typeof stats.count !== "number") stats.count = stats.ids.length; // Autokorekta licznika

      // Zapisz tylko jeśli struktura była uszkodzona, żeby nie mieli dysku
      //if (!Array.isArray(stats.ids)) {
      GM_setValue(KEY.daily, JSON.stringify(stats));
      //}

      return stats;
    }

    // Jeśli data jest inna (nowy dzień) LUB brak daty -> RESET
    console.log(
      `[IAI Bonus] Nowy dzień lub brak danych. Reset: ${storedDate} -> ${today}`,
    );
    stats = { date: today, count: 0, ids: [] };
    GM_setValue(KEY.daily, JSON.stringify(stats));
    return stats;
  }

  // --- POPRAWIONA FUNKCJA DODAWANIA PUNKTU ---
  function addPoint(id, title, method) {
    if (!id) return false;

    // 1. Pobierz aktualny stan (z ewentualnym resetem dnia)
    let stats = getAndEnsureDailyStats();

    // 2. Sprawdź duplikaty w bieżącej sesji
    if (stats.ids.includes(id)) {
      console.log(`[IAI Bonus] ID #${id} już istnieje w dzisiejszej liście.`);
      return false;
    }

    // 3. Sprawdź historię (zabezpieczenie dublowania)
    const hist = getCleanHistory();
    const alreadyInHistory = hist.some(
      (entry) => entry.id === id && entry.date.startsWith(getTodayKey()),
    );

    if (alreadyInHistory) {
      console.log(
        `[IAI Bonus] Znaleziono w historii #${id} - naprawiam listę ID (bez dodawania punktu)`,
      );
      // Naprawa spójności: jest w historii, a nie ma w ids? Dodaj do ids, ale nie zwiększaj licznika (bo już policzone)
      if (!stats.ids.includes(id)) {
        stats.ids.push(id);
        // Opcjonalnie: stats.count = stats.ids.length;
        GM_setValue(KEY.daily, JSON.stringify(stats));
      }
      return false;
    }

    // 4. To jest faktycznie nowy punkt - dodaj go
    stats.ids.push(id);
    stats.count++; // Zwiększ licznik

    // ZAPISZ STAN
    GM_setValue(KEY.daily, JSON.stringify(stats));

    // Zapisz w historii
    hist.push({
      date: new Date().toISOString(),
      id: id,
      title: title || "?",
      method: method,
    });
    GM_setValue(KEY.history, JSON.stringify(hist));

    // Odśwież UI
    if (hudEl) refreshStatsUI();
    if (document.getElementById("iai-top-bar")) updateTopBar();

    console.log(`[IAI Bonus] Dodano punkt #${id}. Nowy stan: ${stats.count}`);
    return true;
  }

  function isNonBonusTicket(textContext) {
    if (!textContext) return false;
    return CONFIG.nonBonusPhrases.some((phrase) =>
      textContext.includes(phrase),
    );
  }

  // --- LOGIKA SETTINGS ---
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
      const h1El = document.querySelector("h1");
      if (h1El && isNonBonusTicket(h1El.innerText)) {
        console.log("[IAI Bonus] Notatka w tickecie 'Non-Bonus' - pomijam.");
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
      console.log(`[IAI Bonus] Tytuł: "${title}"`);
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
            if (addPoint(tid, title, "NOTE")) {
              GM_notification({ text: "Zaliczono notatkę!", timeout: 2000 });
            }
          }
        }
      }
    }, 1500);
    return;
  }

  // 2. LISTA (UI)
  if (!isListPage) return;

  GM_addStyle(`
        /* GŁÓWNY HUD */
        #iai-hud { position: fixed; bottom: 20px; right: 20px; width: 250px; background: #1e1f22; color: #dcddde; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; z-index: 99990; box-shadow: 0 8px 24px rgba(0,0,0,0.4); border: 1px solid #2e3035; overflow: hidden; transition: opacity 0.3s; }
        .hud-header { padding: 12px 16px; background: #2b2d31; border-bottom: 1px solid #1e1f22; display: flex; justify-content: space-between; align-items: center; font-weight: 600; letter-spacing: 0.5px; }
        .hud-body { padding: 12px 16px; }
        .hud-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: #b9bbbe; }
        .hud-val { font-weight: 600; color: #fff; }
        .hud-log { max-height: 80px; overflow-y: auto; color: #72767d; margin-top: 10px; border-top: 1px solid #2f3136; padding-top: 8px; font-size: 10px; font-family: 'Consolas', 'Monaco', monospace; }
        .hud-log::-webkit-scrollbar { width: 4px; }
        .hud-log::-webkit-scrollbar-thumb { background: #40444b; border-radius: 2px; }
        .hud-log::-webkit-scrollbar-track { background: transparent; }
        .hud-btn-group { display: flex; gap: 6px; margin-top: 12px; }
        .hud-btn { flex: 1; background: #36393f; border: 1px solid #202225; color: #b9bbbe; padding: 6px 4px; cursor: pointer; border-radius: 4px; font-size: 11px; text-align: center; transition: all 0.2s ease; font-weight: 500; }
        .hud-btn:hover { background: #40444b; color: #fff; border-color: #72767d; transform: translateY(-1px); }
        .hud-btn:active { transform: translateY(0); }
        .hud-btn-stat { background: #2f3136; border-color: #202225; }
        /* MODAL */
        #iai-stats-modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 340px; background: #1e1f22; border: 1px solid #2e3035; z-index: 99999; padding: 24px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); font-family: sans-serif; color: #dcddde; }
        .stat-h { font-size: 18px; font-weight: 700; margin-bottom: 20px; padding-bottom: 8px; border-bottom: 2px solid #2b2d31; color: #5865f2; }
        .stat-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #b9bbbe; }
        .stat-row b { color: #fff; }
        .stat-big { font-size: 32px; font-weight: 800; text-align: center; margin: 20px 0 5px 0; color: #fff; letter-spacing: -1px; }
        .stat-desc { text-align: center; color: #72767d; font-size: 11px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
        .stat-close { position: absolute; top: 16px; right: 16px; cursor: pointer; color: #72767d; font-size: 18px; transition: color 0.2s; }
        .stat-close:hover { color: #fff; }
        .btn-save-day { width: 100%; padding: 12px; background: #23a559; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 13px; transition: background 0.2s; text-transform: uppercase; }
        .btn-save-day:hover { background: #1f944f; }
        .holiday-info { font-size:11px; color:#ed4245; margin-top:2px; font-style:italic; }
        /* TABELA */
        tr.iai-done { background-color: #f2f3f5 !important; opacity: 0.6; filter: grayscale(100%); transition: all 0.3s; }
        tr.iai-done:hover { opacity: 0.8; }
        tr.iai-done .ticket-title { text-decoration: line-through; color: #72767d; }
        .iai-badge { display: inline-block; padding: 2px 6px; background: #23a559; color: white; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
        /* TOP BAR */
        #iai-top-bar { position: relative; background: #fff; padding: 0; margin: 10px auto; width: 300px; border: 1px solid #e3e5e8; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: border-left 0.4s ease; }
        #iai-progress { position: absolute; top: 0; left: 0; height: 100%; background: linear-gradient(90deg, #ed4245, #f04747); transition: width 0.5s ease, background 0.4s ease; z-index: 1; opacity: 0.15; }
        #iai-top-content { position: relative; z-index: 2; padding: 12px 16px; display: flex; justify-content: space-between; font-size: 13px; font-family: sans-serif; color: #2e3338; font-weight: 500; }
        #iai-top-bar.progress-low #iai-progress { background: linear-gradient(90deg, #ed4245, #f04747); }
        #iai-top-bar.progress-medium #iai-progress { background: linear-gradient(90deg, #f57c00, #ff9800); }
        #iai-top-bar.progress-high #iai-progress { background: linear-gradient(90deg, #fbc02d, #fdd835); }
        #iai-top-bar.progress-complete #iai-progress { background: linear-gradient(90deg, #23a559, #2ecc71); opacity: 0.25; }
        #iai-top-bar.progress-low { border-left: 4px solid #ed4245; }
        #iai-top-bar.progress-medium { border-left: 4px solid #ff9800; }
        #iai-top-bar.progress-high { border-left: 4px solid #fdd835; }
        #iai-top-bar.progress-complete { border-left: 4px solid #23a559; }
    `);

  function initUI() {
    if (document.getElementById("iai-hud")) return;
    if (!CONFIG.myName) return;

    hudEl = document.createElement("div");
    hudEl.id = "iai-hud";
    hudEl.innerHTML = `
            <div class="hud-header">
                <span>${CONFIG.myName} v11</span>
                <span id="iai-score" style="color:#23a559">0 / ${CONFIG.dailyGoal}</span>
            </div>
            <div class="hud-body">
                <div class="hud-row"><span>Zaliczone:</span> <span id="iai-tickets" class="hud-val">0</span></div>
                <div class="hud-row"><span>Do zrobienia:</span> <span id="iai-alerts" class="hud-val">0</span></div>
                <div id="iai-log" class="hud-log">Gotowy.</div>
                <div class="hud-btn-group">
                    <button id="btn-check" class="hud-btn">Skanuj</button>
                    <button id="btn-export" class="hud-btn" title="Pobierz">JSON</button>
                    <button id="btn-import" class="hud-btn" style="border:1px dashed #555">Import</button>
                    <button id="btn-stats" class="hud-btn hud-btn-stat">Raport</button>
                    <button id="btn-settings" class="hud-btn hud-btn-icon" title="Ustawienia">⚙️</button>
                </div>
            </div>
        `;
    document.body.appendChild(hudEl);
    logEl = hudEl.querySelector("#iai-log");

    modalEl = document.createElement("div");
    modalEl.id = "iai-stats-modal";
    modalEl.innerHTML = `
            <div class="stat-close" id="btn-close-stats">✕</div>
            <div class="stat-h">Raport Miesięczny</div>
            <div class="stat-row"><span>Dziś:</span> <b id="stat-today">0</b></div>
            <div class="stat-row"><span>Dni robocze:</span> <b id="stat-days">0</b></div>
            <div id="stat-holiday-msg" class="holiday-info"></div>
            <div class="stat-row"><span>Cel na teraz:</span> <b id="stat-required">0</b></div>
            <div class="stat-row"><span>Wykonano (Suma):</span> <b id="stat-total">0</b></div>
            <div class="stat-big" id="stat-avg">0.0</div>
            <div class="stat-desc">Średnia dzienna</div>
            <div class="stat-row" style="border-top:1px solid #2f3136; paddingTop:15px; margin-top:15px">
                <span>Bilans:</span> <b id="stat-balance" style="color:#72767d">0</b>
            </div>
            <br>
            <button id="btn-save-db" class="btn-save-day">Zapisz Dzisiejszy Wynik</button>
            <div style="text-align:center; font-size:10px; color:#72767d; margin-top:8px">Kliknij na koniec pracy</div>
        `;
    document.body.appendChild(modalEl);

    setTimeout(() => {
      document.getElementById("btn-check").onclick = () => {
        addLog("Skanowanie...");
        runScan(true);
      };
      document.getElementById("btn-export").onclick = exportHistory;
      document.getElementById("btn-import").onclick = importHistory;
      document.getElementById("btn-stats").onclick = openStats;
      document.getElementById("btn-settings").onclick = openSettings;
      document.getElementById("btn-close-stats").onclick = closeStats;
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
    console.log(`[IAI] ${msg}`);
  }

  function getCleanHistory() {
    let raw = GM_getValue(KEY.history);
    let parsed = safeParse(raw, []);
    if (typeof parsed === "string") parsed = safeParse(parsed, []);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  }

  //   function addPoint(id, title, method) {
  //     if (!id) return false;

  //     // Zamiast czytać surowe dane, używamy funkcji, która je naprawi/zresetuje jeśli stary dzień
  //     let stats = getAndEnsureDailyStats();

  //     if (stats.ids.includes(id)) return false;
  //     const hist = getCleanHistory();
  //     const alreadyInHistory = hist.some(
  //       (entry) => entry.id === id && entry.date.startsWith(getTodayKey()),
  //     );

  //     if (alreadyInHistory) {
  //       console.log(
  //         `[IAI Bonus] Znaleziono w historii #${id} - naprawiam listę ID`,
  //       );
  //       if (!stats.ids.includes(id)) {
  //         stats.ids.push(id);
  //         GM_setValue(KEY.daily, JSON.stringify(stats));
  //       }
  //       return false;
  //     }

  //     stats.ids.push(id);
  //     stats.count++;
  //     GM_setValue(KEY.daily, JSON.stringify(stats));

  //     hist.push({
  //       date: new Date().toISOString(),
  //       id: id,
  //       title: title || "?",
  //       method: method,
  //     });
  //     GM_setValue(KEY.history, JSON.stringify(hist));

  //     if (hudEl) refreshStatsUI();
  //     if (document.getElementById("iai-top-bar")) updateTopBar();
  //     return true;
  //   }

  function exportHistory() {
    const historyLogs = getCleanHistory();
    const counterData = getAndEnsureDailyStats();
    const monthlyStats = safeParse(GM_getValue(KEY.stats), {});
    const report = {
      _generated: new Date().toISOString(),
      COUNTER_DATA: counterData,
      MONTHLY_STATS: monthlyStats,
      HISTORY_LOGS: historyLogs,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    GM_download({
      url: URL.createObjectURL(blob),
      name: `iai_bonus_FULL_${getTodayKey()}.json`,
      saveAs: true,
    });
  }

  function importHistory() {
    const input = prompt("Wklej zawartość pliku JSON:");
    if (!input) return;
    try {
      const data = JSON.parse(input);
      if (data.COUNTER_DATA && data.COUNTER_DATA.date === getTodayKey()) {
        GM_setValue(KEY.daily, JSON.stringify(data.COUNTER_DATA));
        alert("Przywrócono licznik dzienny!");
      }
      if (Array.isArray(data.HISTORY_LOGS)) {
        GM_setValue(KEY.history, JSON.stringify(data.HISTORY_LOGS));
        alert(
          "Przywrócono historię (" + data.HISTORY_LOGS.length + " wpisów).",
        );
      }
      if (data.MONTHLY_STATS) {
        GM_setValue(KEY.stats, JSON.stringify(data.MONTHLY_STATS));
        alert("Przywrócono statystyki miesięczne!");
      }
      location.reload();
    } catch (e) {
      alert("Błąd importu: Nieprawidłowy format JSON!");
      console.error(e);
    }
  }

  function isWorkingDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    if (HOLIDAYS[dateStr]) return false;
    return true;
  }

  function getBusinessDaysInMonth(year, month) {
    const now = new Date();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let count = 0;
    const limitDay =
      year === now.getFullYear() && month === now.getMonth()
        ? now.getDate()
        : daysInMonth;
    for (let d = 1; d <= limitDay; d++) {
      const date = new Date(year, month, d);
      if (isWorkingDay(date)) count++;
    }
    return count;
  }

  function saveDailyToDb() {
    const daily = getAndEnsureDailyStats();
    const db = safeParse(GM_getValue(KEY.stats), {});
    db[getTodayKey()] = daily.count;
    GM_setValue(KEY.stats, JSON.stringify(db));
    alert(`Zapisano wynik dla ${getTodayKey()}: ${daily.count}`);
    openStats();
  }

  function openStats() {
    const db = safeParse(GM_getValue(KEY.stats), {});
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
    const businessDays = getBusinessDaysInMonth(y, m);
    let myTotal = 0;
    const liveDaily = getAndEnsureDailyStats();
    for (let d = 1; d <= now.getDate(); d++) {
      const dayStr = `${monthPrefix}-${String(d).padStart(2, "0")}`;
      let count = db[dayStr] || 0;
      if (dayStr === getTodayKey()) count = Math.max(count, liveDaily.count);
      myTotal += count;
    }
    const requiredTotal = businessDays * CONFIG.dailyGoal;
    const avg = businessDays > 0 ? (myTotal / businessDays).toFixed(2) : 0;
    const balance = myTotal - requiredTotal;
    document.getElementById("stat-today").innerText = liveDaily.count;
    document.getElementById("stat-days").innerText = businessDays;
    document.getElementById("stat-required").innerText = requiredTotal;
    document.getElementById("stat-total").innerText = myTotal;
    document.getElementById("stat-avg").innerText = avg;
    const balEl = document.getElementById("stat-balance");
    balEl.innerText = (balance > 0 ? "+" : "") + balance;
    balEl.style.color = balance >= 0 ? "#23a559" : "#ed4245";
    const hMsg = document.getElementById("stat-holiday-msg");
    const todayStr = getTodayKey();
    if (HOLIDAYS[todayStr]) {
      hMsg.innerText = `Dziś wolne: ${HOLIDAYS[todayStr]}`;
    } else if (!isWorkingDay(now)) {
      hMsg.innerText = "Dziś weekend";
    } else {
      hMsg.innerText = "";
    }
    modalEl.style.display = "block";
  }

  function closeStats() {
    modalEl.style.display = "none";
  }

  function refreshStatsUI() {
    if (!hudEl) return;
    // TUTAJ ZMIANA: Zawsze pobieramy z weryfikacją daty
    const stats = getAndEnsureDailyStats();
    document.getElementById("iai-score").innerText =
      `${stats.count} / ${CONFIG.dailyGoal}`;
    document.getElementById("iai-tickets").innerText = stats.count;
    const alerts = document.querySelectorAll(
      ".ticket-table .divTableRow:not(.iai-done)",
    ).length;
    document.getElementById("iai-alerts").innerText =
      alerts - isNonBonusTicket.length;
  }

  function injectTopBar() {
    if (document.getElementById("iai-top-bar")) return;
    const bar = document.createElement("div");
    bar.id = "iai-top-bar";
    bar.innerHTML = `
            <div id="iai-progress"></div>
            <div id="iai-top-content"></div>
        `;
    const container =
      document.querySelector(".ticket-container") ||
      document.querySelector(".ticket-table");
    if (container && container.parentNode) {
      container.parentNode.insertBefore(bar, container);
    }
    updateTopBar();
  }

  function updateTopBar() {
    const bar = document.getElementById("iai-top-bar");
    if (!bar) return;

    // TUTAJ ZMIANA: Zawsze pobieramy z weryfikacją daty
    const stats = getAndEnsureDailyStats();
    const alerts = document.querySelectorAll(
      ".ticket-table .divTableRow:not(.iai-done)",
    ).length;
    const progress = Math.min(100, (stats.count / CONFIG.dailyGoal) * 100);

    const content = document.getElementById("iai-top-content");
    if (content) {
      content.innerHTML = `<div>Do zrobienia: <b>${alerts - isNonBonusTicket.length}</b></div><div>Wynik: <b>${stats.count} / ${CONFIG.dailyGoal}</b> (${progress.toFixed(0)}%)</div>`;
    }
    const progressBar = document.getElementById("iai-progress");
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
    bar.className = "";
    if (progress >= 100) bar.classList.add("progress-complete");
    else if (progress >= 80) bar.classList.add("progress-high");
    else if (progress >= 50) bar.classList.add("progress-medium");
    else bar.classList.add("progress-low");
  }

  function markAsDoneVisuals() {
    // TUTAJ ZMIANA: Zawsze pobieramy z weryfikacją daty
    const stats = getAndEnsureDailyStats();
    const ids = Array.isArray(stats.ids) ? stats.ids : [];
    const rows = document.querySelectorAll(".ticket-table .divTableRow");
    rows.forEach((row) => {
      const link = row.querySelector(".divTableCell6 a");
      if (!link) return;
      const id = link.href.split("ticketId=")[1];
      if (ids.includes(id)) {
        if (!row.classList.contains("iai-done")) {
          row.classList.add("iai-done");
          const cell = row.querySelector(".divTableCell1");
          if (cell) {
            const badge = document.createElement("span");
            badge.className = "iai-badge";
            badge.innerText = "✓ DONE";
            cell.prepend(badge);
          }
        }
      }
    });
    updateTopBar();
    refreshStatsUI();
  }

  function runScan(force) {
    const rows = document.querySelectorAll(".ticket-table .divTableRow");
    if (rows.length === 0 && force) addLog("Tabela pusta?");
    const currentIds = [];
    let newFound = 0;
    rows.forEach((row) => {
      const link = row.querySelector(".divTableCell6 a");
      if (!link) return;
      const id = link.href.split("ticketId=")[1];
      currentIds.push(id);
      const replyCell = row.querySelector(".divTableCell2");

      const rowText = row.textContent || "";
      const isNonBonus = isNonBonusTicket(rowText);

      if (replyCell) {
        const text = replyCell.textContent;
        const d = new Date();
        const todayStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

        if (text.includes(CONFIG.myName) && text.includes(todayStr)) {
          if (isNonBonus) {
            // Ignorujemy Non-Bonus
          } else {
            if (addPoint(id, "List Scan", "LIST")) {
              addLog(`+ List: #${id}`);
              newFound++;
            }
          }
        }
      }
    });
    const lastIds = safeParse(sessionStorage.getItem(KEY.lastScanIds), []);
    const lostIds = lastIds.filter((id) => !currentIds.includes(id));
    if (lostIds.length > 0) {
      addLog(`Zniknęło: ${lostIds.length}`);
      lostIds.forEach((id) => verifyLostTicket(id));
    } else if (force && newFound === 0) addLog("Brak nowych zmian.");
    sessionStorage.setItem(KEY.lastScanIds, JSON.stringify(currentIds));
    markAsDoneVisuals();
  }

  function verifyLostTicket(id) {
    GM_xmlhttpRequest({
      method: "GET",
      url: window.location.origin + CONFIG.ticketUrlBase + id,
      onload: function (res) {
        if (res.status === 200) {
          const html = res.responseText;

          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const h1 = doc.querySelector("h1");

          if (h1 && isNonBonusTicket(h1.innerText)) {
            addLog(`(Skip) Detektyw - Non-Bonus: #${id}`);
            return;
          }

          const lastIdx = html.lastIndexOf("Created by:");
          if (lastIdx > -1) {
            const snippet = html.substring(lastIdx, lastIdx + 500);
            const d = new Date();
            const todayStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
            if (snippet.includes(CONFIG.myName) && snippet.includes(todayStr)) {
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
