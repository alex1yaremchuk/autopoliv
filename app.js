(function () {
    const CONFIG = window.AUTOPOLIV_CONFIG || {};
    const recordsCacheKey = "autopoliv.studentsCache.v1";
    const debugPrefix = "[autopoliv-map]";
    const perfMarks = {
        appStart: performance.now(),
        yandexLoadStart: null,
        yandexReadyEnd: null,
        csvFetchStart: null,
        csvFetchEnd: null,
        firstRenderStart: null,
        firstRenderEnd: null
    };

    function setStatus(text, hidden) {
        void text;
        void hidden;
    }

    function debugLog(message, payload) {
        if (payload === undefined) {
            console.log(`${debugPrefix} ${message}`);
            return;
        }
        console.log(`${debugPrefix} ${message}`, payload);
    }

    function perfNow() {
        return performance.now();
    }

    function perfDuration(start, end) {
        if (start === null || start === undefined || end === null || end === undefined) return null;
        return Math.round((end - start) * 10) / 10;
    }

    function logPerfSummary(extra) {
        debugLog("timing summary", {
            yandexApiMs: perfDuration(perfMarks.yandexLoadStart, perfMarks.yandexReadyEnd),
            csvFetchMs: perfDuration(perfMarks.csvFetchStart, perfMarks.csvFetchEnd),
            firstRenderMs: perfDuration(perfMarks.firstRenderStart, perfMarks.firstRenderEnd),
            appReadyMs: perfDuration(perfMarks.appStart, perfMarks.firstRenderEnd),
            ...extra
        });
    }

    function cleanText(value) {
        return String(value ?? "").trim();
    }

    function escapeHtml(value) {
        return cleanText(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function toNumber(value) {
        const normalized = cleanText(value).replace(",", ".");
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function parseCoords(value) {
        const text = cleanText(value);
        if (!text) return null;

        const parts = text.split(",").map((item) => cleanText(item));
        if (parts.length < 2) return null;

        const lat = toNumber(parts[0]);
        const lng = toNumber(parts[1]);
        if (lat === null || lng === null) return null;

        return [lat, lng];
    }

    function normalizePhoneHref(value) {
        const text = cleanText(value);
        if (!text) return "";
        return `tel:${text.replace(/[^\d+]/g, "")}`;
    }

    function formatPhoneLabel(value) {
        const text = cleanText(value);
        if (!text) return "";
        return text.startsWith("+") ? text : `+${text}`;
    }

    function formatTs(ts) {
        if (ts === null || ts === undefined) return null;
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return String(ts);
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function parseSheetDate(value) {
        const text = cleanText(value);
        if (!text) return null;

        let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
        if (match) {
            const [, mm, dd, yyyy, hh = "0", min = "0", ss = "0"] = match;
            const date = new Date(
                Number(yyyy),
                Number(mm) - 1,
                Number(dd),
                Number(hh),
                Number(min),
                Number(ss)
            );
            const ts = date.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (match) {
            const [, dd, mm, yyyy] = match;
            const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0);
            const ts = date.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
        if (match) {
            const [, dd, mm, yyyy, hh, min, ss] = match;
            const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
            const ts = date.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
            const [, yyyy, mm, dd] = match;
            const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0);
            const ts = date.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        return null;
    }

    function parseCsv(text) {
        const rows = [];
        let currentRow = [];
        let currentCell = "";
        let inQuotes = false;

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const nextChar = text[index + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentCell += '"';
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === "," && !inQuotes) {
                currentRow.push(currentCell);
                currentCell = "";
                continue;
            }

            if ((char === "\n" || char === "\r") && !inQuotes) {
                if (char === "\r" && nextChar === "\n") {
                    index += 1;
                }
                currentRow.push(currentCell);
                if (currentRow.some((cell) => cleanText(cell) !== "")) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = "";
                continue;
            }

            currentCell += char;
        }

        if (currentCell.length > 0 || currentRow.length > 0) {
            currentRow.push(currentCell);
            if (currentRow.some((cell) => cleanText(cell) !== "")) {
                rows.push(currentRow);
            }
        }

        if (!rows.length) {
            return { rows: [], maxUpdatedTs: null };
        }

        let maxUpdatedTs = null;
        rows.forEach((row) => {
            const firstCell = cleanText(row[0]).toLowerCase();
            if (firstCell !== "изменено:" && firstCell !== "изменено") return;
            const updatedTs = parseSheetDate(row[1]);
            if (updatedTs !== null) {
                maxUpdatedTs = updatedTs;
            }
        });

        const headerIndex = rows.findIndex((row) => {
            const normalized = row.map((cell) => cleanText(cell).toLowerCase());
            return normalized.includes("id") && normalized.includes("name");
        });

        if (headerIndex === -1) {
            return { rows: [], maxUpdatedTs };
        }

        const headers = rows[headerIndex].map((header) => cleanText(header));
        const dataRows = rows.slice(headerIndex + 1);

        return {
            maxUpdatedTs,
            rows: dataRows.map((row) => {
            const entry = {};
            headers.forEach((header, columnIndex) => {
                entry[header] = cleanText(row[columnIndex] ?? "");
            });
            return entry;
            })
        };
    }

    function normalizeRecord(raw, index) {
        const coords = parseCoords(raw.coords);
        if (!coords) return null;

        return {
            id: cleanText(raw.id) || `student-${index + 1}`,
            name: cleanText(raw.name) || `Ученик ${index + 1}`,
            city: cleanText(raw.city) || "Без города",
            course: cleanText(raw.course) || "Программа школы",
            stage: cleanText(raw.stage) || "В работе",
            description: cleanText(raw.description) || "Карточка ученика.",
            photo: cleanText(raw.photo) || "./assets/photos/student-portrait-01.svg",
            phone: cleanText(raw.phone),
            email: cleanText(raw.email),
            coords
        };
    }

    async function fetchCsv(url) {
        perfMarks.csvFetchStart = perfNow();
        const cacheBreaker = url.includes("?") ? "&" : "?";
        const response = await fetch(`${url}${cacheBreaker}cb=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        perfMarks.csvFetchEnd = perfNow();
        debugLog("csv fetch timing", {
            url,
            csvFetchMs: perfDuration(perfMarks.csvFetchStart, perfMarks.csvFetchEnd),
            bytes: text.length
        });
        return text;
    }

    function normalizeParsedResult(parsed) {
        return {
            maxUpdatedTs: parsed.maxUpdatedTs ?? null,
            records: (parsed.rows || []).map(normalizeRecord).filter(Boolean)
        };
    }

    function makeRecordsSignature(records) {
        return JSON.stringify(
            (records || []).map((record) => [
                record.id,
                record.name,
                record.city,
                record.coords ? record.coords.join(",") : "",
                record.photo,
                record.phone,
                record.email,
                record.course,
                record.stage,
                record.description
            ])
        );
    }

    function readCachedRecords() {
        try {
            const raw = localStorage.getItem(recordsCacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.records)) return null;
            return {
                maxUpdatedTs: parsed.maxUpdatedTs ?? null,
                records: parsed.records,
                signature: parsed.signature ?? makeRecordsSignature(parsed.records)
            };
        } catch (error) {
            return null;
        }
    }

    function writeCachedRecords(result) {
        try {
            localStorage.setItem(recordsCacheKey, JSON.stringify({
                maxUpdatedTs: result.maxUpdatedTs ?? null,
                records: result.records,
                signature: result.signature ?? makeRecordsSignature(result.records)
            }));
        } catch (error) {
            void error;
        }
    }

    function chooseLatestData(fetched, cached) {
        if (fetched && !cached) return fetched;
        if (!fetched && cached) return cached;
        if (!fetched && !cached) return { records: [], maxUpdatedTs: null };

        const fetchedTs = fetched.maxUpdatedTs;
        const cachedTs = cached.maxUpdatedTs;

        if (fetchedTs === null && cachedTs === null) return fetched;
        if (fetchedTs === null && cachedTs !== null) return cached;
        if (fetchedTs !== null && cachedTs === null) return fetched;
        return fetchedTs >= cachedTs ? fetched : cached;
    }

    function toResultEnvelope(result, source) {
        return {
            maxUpdatedTs: result.maxUpdatedTs ?? null,
            records: result.records ?? [],
            signature: result.signature ?? makeRecordsSignature(result.records ?? []),
            source
        };
    }

    async function loadRecords() {
        const dataCfg = CONFIG.data || {};
        const googleUrl = cleanText(dataCfg.googleSheetsCsvUrl);
        const fallbackUrl = cleanText(dataCfg.fallbackCsvUrl) || "./data/students-demo.csv";

        if (googleUrl) {
            const cached = readCachedRecords();
            let fetched = null;

            try {
                fetched = toResultEnvelope(normalizeParsedResult(parseCsv(await fetchCsv(googleUrl))), "fetched");
                debugLog("google fetched", {
                    records: fetched.records.length,
                    fetchedTs: formatTs(fetched.maxUpdatedTs),
                    signature: fetched.signature.slice(0, 80)
                });
            } catch (error) {
                console.warn("Google Sheets fetch failed, using cached or fallback CSV.", error);
            }

            const cachedEnvelope = cached ? toResultEnvelope(cached, "cached") : null;
            if (cachedEnvelope) {
                debugLog("cache loaded", {
                    records: cachedEnvelope.records.length,
                    cachedTs: formatTs(cachedEnvelope.maxUpdatedTs),
                    signature: cachedEnvelope.signature.slice(0, 80)
                });
            }

            const chosen = chooseLatestData(fetched, cachedEnvelope);
            debugLog("choose latest", {
                chosen: chosen ? chosen.source : null,
                fetchedTs: formatTs(fetched ? fetched.maxUpdatedTs : null),
                cachedTs: formatTs(cachedEnvelope ? cachedEnvelope.maxUpdatedTs : null)
            });

            if (chosen === fetched && fetched) {
                writeCachedRecords(fetched);
                debugLog("cache updated", {
                    records: fetched.records.length,
                    maxUpdatedTs: formatTs(fetched.maxUpdatedTs)
                });
            }
            if (chosen && chosen.records.length) {
                return chosen;
            }
        }

        const fallback = toResultEnvelope(normalizeParsedResult(parseCsv(await fetchCsv(fallbackUrl))), "fallback");
        debugLog("fallback loaded", {
            records: fallback.records.length,
            fallbackTs: formatTs(fallback.maxUpdatedTs),
            signature: fallback.signature.slice(0, 80)
        });
        return fallback;
    }

    function loadYandexMaps() {
        const yandexCfg = CONFIG.yandexMaps || {};
        const apiKey = cleanText(yandexCfg.apiKey);
        const lang = cleanText(yandexCfg.lang) || "ru_RU";

        if (!apiKey) {
            return Promise.reject(new Error("Yandex Maps API key is missing"));
        }

        if (window.ymaps) {
            perfMarks.yandexLoadStart = perfMarks.yandexLoadStart ?? perfNow();
            perfMarks.yandexReadyEnd = perfNow();
            debugLog("yandex api timing", {
                yandexApiMs: perfDuration(perfMarks.yandexLoadStart, perfMarks.yandexReadyEnd),
                cached: true
            });
            return Promise.resolve(window.ymaps);
        }

        return new Promise((resolve, reject) => {
            perfMarks.yandexLoadStart = perfNow();
            const script = document.createElement("script");
            script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=${encodeURIComponent(lang)}`;
            script.async = true;
            script.onload = () => {
                perfMarks.yandexReadyEnd = perfNow();
                debugLog("yandex api timing", {
                    yandexApiMs: perfDuration(perfMarks.yandexLoadStart, perfMarks.yandexReadyEnd),
                    cached: false
                });
                resolve(window.ymaps);
            };
            script.onerror = () => reject(new Error("Failed to load Yandex Maps API"));
            document.head.appendChild(script);
        });
    }

    function buildLinks(record) {
        const links = [];
        const phoneHref = normalizePhoneHref(record.phone);
        const phoneLabel = formatPhoneLabel(record.phone);

        if (phoneHref && phoneLabel) {
            links.push(`<a href="${escapeHtml(phoneHref)}">${escapeHtml(phoneLabel)}</a>`);
        }
        if (record.email) {
            links.push(`<a href="mailto:${escapeHtml(record.email)}">Email</a>`);
        }

        return links.join("");
    }

    function buildBalloonHtml(record) {
        return `
            <article class="student-balloon">
                <img class="student-balloon__photo" src="${escapeHtml(record.photo)}" alt="${escapeHtml(record.name)}">
                <div class="student-balloon__body">
                    <p class="student-balloon__city">${escapeHtml(record.city)}</p>
                    <h3 class="student-balloon__title">${escapeHtml(record.name)}</h3>
                    <p class="student-balloon__meta">${escapeHtml(record.course)} · ${escapeHtml(record.stage)}</p>
                    <p class="student-balloon__text">${escapeHtml(record.description)}</p>
                    <div class="student-balloon__links">${buildLinks(record)}</div>
                </div>
            </article>
        `;
    }

    function renderObjects(map, ymaps, records, fitBounds) {
        map.geoObjects.removeAll();

        const markerLayout = ymaps.templateLayoutFactory.createClass(
            '<div class="student-marker"></div>'
        );

        const objects = records.map((record) => new ymaps.Placemark(record.coords, {
            balloonContentBody: buildBalloonHtml(record),
            hintContent: `${record.name}, ${record.city}`
        }, {
            iconLayout: markerLayout,
            iconShape: {
                type: "Circle",
                coordinates: [11, 11],
                radius: 14
            },
            hideIconOnBalloonOpen: false
        }));

        objects.forEach((placemark) => map.geoObjects.add(placemark));

        if (!fitBounds) return;

        if (records.length > 1) {
            const bounds = ymaps.geoQuery(objects).getBounds();
            if (bounds) {
                map.setBounds(bounds, {
                    checkZoomRange: true,
                    zoomMargin: 40
                });
            }
        } else if (records[0]) {
            map.setCenter(records[0].coords, 7, { duration: 250 });
        }
    }

    function initMap(ymaps, records) {
        perfMarks.firstRenderStart = perfMarks.firstRenderStart ?? perfNow();
        const mapCfg = CONFIG.map || {};
        const map = new ymaps.Map("map", {
            center: mapCfg.center || [55.76, 37.64],
            zoom: mapCfg.zoom ?? 4,
            controls: ["zoomControl"]
        }, {
            minZoom: mapCfg.minZoom ?? 3,
            maxZoom: mapCfg.maxZoom ?? 16
        });

        renderObjects(map, ymaps, records, true);
        perfMarks.firstRenderEnd = perfNow();
        debugLog("first render timing", {
            records: records.length,
            firstRenderMs: perfDuration(perfMarks.firstRenderStart, perfMarks.firstRenderEnd)
        });

        return map;
    }

    function shouldApplyUpdate(currentData, nextData) {
        if (!currentData) return true;
        if (nextData.maxUpdatedTs !== null && currentData.maxUpdatedTs !== null) {
            if (nextData.maxUpdatedTs > currentData.maxUpdatedTs) return true;
            if (nextData.maxUpdatedTs < currentData.maxUpdatedTs) return false;
        } else if (nextData.maxUpdatedTs !== null && currentData.maxUpdatedTs === null) {
            return true;
        } else if (nextData.maxUpdatedTs === null && currentData.maxUpdatedTs !== null) {
            return false;
        }

        return nextData.signature !== currentData.signature;
    }

    function startAutoRefresh(appState) {
        const intervalMs = Number(CONFIG.data && CONFIG.data.refreshIntervalMs) || 30000;
        if (intervalMs < 5000) return;

        window.setInterval(async () => {
            try {
                debugLog("poll started", {
                    displayedTs: formatTs(appState.currentData ? appState.currentData.maxUpdatedTs : null),
                    displayedSignature: appState.currentData ? appState.currentData.signature.slice(0, 80) : null
                });

                const nextData = await loadRecords();
                debugLog("poll received", {
                    source: nextData.source,
                    records: nextData.records.length,
                    nextTs: formatTs(nextData.maxUpdatedTs),
                    nextSignature: nextData.signature.slice(0, 80)
                });

                if (!nextData.records.length) {
                    debugLog("poll skipped: no records");
                    return;
                }

                if (!shouldApplyUpdate(appState.currentData, nextData)) {
                    debugLog("poll skipped: displayed data is already current");
                    return;
                }

                renderObjects(appState.map, appState.ymaps, nextData.records, false);
                appState.currentData = nextData;
                debugLog("poll applied update", {
                    source: nextData.source,
                    records: nextData.records.length,
                    appliedTs: formatTs(nextData.maxUpdatedTs)
                });
            } catch (error) {
                console.error(`${debugPrefix} poll failed`, error);
            }
        }, intervalMs);
    }

    async function init() {
        try {
            setStatus("Загрузка данных...", false);
            const [ymaps, initialData] = await Promise.all([
                loadYandexMaps(),
                loadRecords()
            ]);

            if (!initialData.records.length) {
                throw new Error("No valid records found");
            }

            await new Promise((resolve) => ymaps.ready(resolve));
            const map = initMap(ymaps, initialData.records);
            const appState = {
                ymaps,
                map,
                currentData: initialData
            };

            debugLog("initial render", {
                source: initialData.source,
                records: initialData.records.length,
                displayedTs: formatTs(initialData.maxUpdatedTs),
                displayedSignature: initialData.signature.slice(0, 80)
            });
            logPerfSummary({
                source: initialData.source,
                records: initialData.records.length
            });

            startAutoRefresh(appState);
            setStatus("", true);
        } catch (error) {
            console.error(error);

            if (/api key/i.test(String(error.message))) {
                setStatus("Укажите ключ Яндекс.Карт в config.js -> yandexMaps.apiKey", false);
                return;
            }

            setStatus("Не удалось загрузить карту или CSV-данные.", false);
        }
    }

    init();
}());
