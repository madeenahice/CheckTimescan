(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Attendance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OFF_CODES = new Set(["X", "V", "อ", "ก", "ป", "ค"]);
  const SHIFT_RULES = {
    "ด": [{ start: 0, end: 8 }],
    "ดI": [{ start: 0, end: 8 }],
    "ช": [{ start: 8, end: 16, outWindow: [16, 26] }],
    "ชI": [{ start: 8, end: 16, outWindow: [16, 26] }],
    "ชG": [{ start: 8, end: 16, outWindow: [16, 26] }],
    "ชS": [{ start: 8, end: 16, outWindow: [16, 26] }],
    "V0.5-AM": [{ start: 12, end: 16 }],
    "V0.5-PM": [{ start: 8, end: 12 }],
    "บ": [{ start: 16, end: 24, inWindow: [0, 16] }],
    "บI": [{ start: 16, end: 24, inWindow: [0, 16] }],
    "ชบ": [{ start: 8, end: 24 }],
    "ชIบ": [{ start: 8, end: 24 }],
    "ชบI": [{ start: 8, end: 24 }],
    "ชIบI": [{ start: 8, end: 24 }],
    "ช09ช06": [{ start: 6, end: 16, outWindow: [8, 24] }],
    "ช09บ1": [{ start: 6, end: 20, inWindow: [0, 6], outWindow: [20, 24] }],
    "ชSบ": [{ start: 8, end: 24 }],
    "ชGบ": [{ start: 8, end: 24 }],
    "ดบ": [{ start: 0, end: 8, label: "ด" }, { start: 16, end: 24, label: "บ", inWindow: [0, 16] }],
    "ช06": [{ start: 8, end: 16, outWindow: [8, 24] }],
    "D": [{ start: 8, end: 20, inWindow: [0, 8], outWindow: [20, 24] }],
    "บ1": [{ start: 16, end: 20, inWindow: [0, 16], outWindow: [20, 24] }],
    "ช02": [{ start: 6, end: 14 }],
    "ช09": [{ start: 6, end: 8 }]
  };
  const STATUS_LABELS = {
    all: "ทั้งหมด",
    onTime: "ปกติ",
    late: "มาสาย",
    missingIn: "ไม่สแกนเข้า",
    missingOut: "ไม่สแกนออก",
    unknownShift: "ตรวจสอบรหัสเวร"
  };

  function clean(value) {
    return value == null ? "" : String(value).trim();
  }

  function normalizeId(value) {
    const id = clean(value);
    return /^\d+\.0+$/.test(id) ? id.replace(/\.0+$/, "") : id;
  }

  function headerKey(value) {
    return clean(value).toLowerCase().replace(/[\s_\-./()]/g, "");
  }

  function findColumn(headers, matches) {
    return headers.findIndex((value) => {
      const key = headerKey(value);
      return matches.some((match) => match(key));
    });
  }

  function isIdHeader(key) {
    return ["sap", "sapid", "personnelno", "employeeid", "empid", "empno", "รหัสพนักงาน", "รหัสบุคลากร"].includes(key) ||
      key.startsWith("sapid") || key.startsWith("personnelno") ||
      key.startsWith("รหัสพนักงาน") || key.startsWith("รหัสบุคลากร");
  }

  function isNameHeader(key) {
    return key === "name" || key === "fullname" || key.includes("ชื่อ");
  }

  function dayFromHeader(value) {
    const text = clean(value);
    const match = text.match(/^(?:(?:วันที่|day|date)\s*)?(\d{1,2})$/i);
    if (!match) return null;
    const day = Number(match[1]);
    return day >= 1 && day <= 31 ? day : null;
  }

  const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

  function rosterLayout(rows) {
    const headerIndex = rows.findIndex((row) => {
      const headers = Array.isArray(row) ? row : [];
      return headers.some((value) => isIdHeader(headerKey(value))) &&
        headers.some((value) => isNameHeader(headerKey(value)));
    });
    if (headerIndex < 0) return null;
    const headers = rows[headerIndex];
    const idColumn = findColumn(headers, [isIdHeader]);
    const nameColumn = findColumn(headers, [isNameHeader]);
    const typeColumn = findColumn(headers, [(key) => key === "type" || key === "assign"]);
    const previous = rows[headerIndex - 1] || [];
    const hasPreviousCalendar = previous.some((value, column) => column > nameColumn &&
      dayFromHeader(value) === 1 && dayFromHeader(previous[column + 1]) === 2);
    const dayHeaders = hasPreviousCalendar ? previous : headers;
    const firstDay = dayHeaders.findIndex((value, column) => column > nameColumn &&
      (dayHeaders === headers ? dayFromHeader(value) !== null : dayFromHeader(value) === 1));
    if (firstDay < 0) return null;
    // Only the consecutive calendar columns belong to the roster; totals may also be numbers.
    const dayColumns = [];
    if (dayHeaders === headers) {
      headers.forEach((value, column) => {
        const day = dayFromHeader(value);
        if (day !== null) dayColumns.push({ day, column });
      });
    } else {
      for (let column = firstDay, day = 1; column < dayHeaders.length && day <= 31; column += 1, day += 1) {
        if (dayFromHeader(dayHeaders[column]) !== day) break;
        dayColumns.push({ day, column });
      }
    }
    let period = null;
    const month = previous.findIndex((value) => MONTHS.includes(clean(value)));
    if (month >= 0) {
      const yearValue = previous.slice(month + 1, firstDay).find((value) => Number(value) >= 1900);
      if (yearValue) period = { month: MONTHS.indexOf(clean(previous[month])), year: Number(yearValue) >= 2400 ? Number(yearValue) - 543 : Number(yearValue) };
    }
    return { headerIndex, idColumn, nameColumn, typeColumn, dayColumns, period };
  }

  function rosterType(value) {
    const type = headerKey(value).replace(/^\d+/, "").replace(/^เวร(?=parttime)/, "");
    if (["เวรจริง", "เวรปกติ"].includes(type)) return "primary";
    if (type === "ot") return "ot";
    return type === "parttime" ? "extra" : "";
  }

  function mergeShift(employee, day, code) {
    const existing = employee.shifts[day];
    if (!code) return;
    if (!existing || OFF_CODES.has(String(existing).toUpperCase())) employee.shifts[day] = code;
    else if (!OFF_CODES.has(code.toUpperCase())) {
      const codes = Array.isArray(existing) ? existing : [existing];
      if (!codes.some((item) => item.toUpperCase() === code.toUpperCase())) employee.shifts[day] = [...codes, code];
    }
  }

  function parseRoster(rows) {
    const layout = rosterLayout(rows);
    if (!layout) throw new Error("ไม่พบหัวตารางเวรที่มีรหัสพนักงาน ชื่อ-สกุล และคอลัมน์วันที่ 1–31");
    const { headerIndex, idColumn, nameColumn, typeColumn, dayColumns } = layout;
    if (new Set(dayColumns.map((item) => item.day)).size !== dayColumns.length) {
      throw new Error("พบคอลัมน์วันที่ซ้ำกันในไฟล์ตารางเวร");
    }
    const employees = new Map();
    const primaryIds = new Set();
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      // A later table can contain a different historical period in the same sheet.
      if (row.some((value) => clean(value) === "เดือน") ||
          (isIdHeader(headerKey(row[idColumn])) && isNameHeader(headerKey(row[nameColumn])))) break;
      const type = typeColumn < 0 ? "" : rosterType(row[typeColumn]);
      if (typeColumn >= 0 && !type) continue;
      const id = normalizeId(row[idColumn]);
      const name = clean(row[nameColumn]);
      if (!id && !name) continue;
      if (!id || !name) throw new Error(`แถวที่ ${index + 1}: ต้องระบุทั้งรหัสพนักงานและชื่อ-สกุล`);
      if ((typeColumn < 0 || type === "primary") && primaryIds.has(id)) {
        throw new Error(`พบรหัสพนักงานซ้ำในไฟล์ตารางเวร: ${id}`);
      }
      if (typeColumn < 0 || type === "primary") primaryIds.add(id);
      if (!employees.has(id)) employees.set(id, { id, name, shifts: {} });
      const employee = employees.get(id);
      dayColumns.forEach(({ day, column }) => {
        // Refer OT rows calculate hours from Time-In/Time-Out; numbers are not duty codes.
        if (type === "ot" && /^[-+]?\d+(?:\.\d+)?$/.test(clean(row[column]))) return;
        mergeShift(employee, day, clean(row[column]));
      });
    }
    if (employees.size === 0) throw new Error("ไม่พบข้อมูลพนักงานในไฟล์ตารางเวร");
    return [...employees.values()];
  }

  function mergeEmployees(groups) {
    const employees = new Map();
    groups.forEach((group) => group.forEach((source) => {
      if (!employees.has(source.id)) employees.set(source.id, { id: source.id, name: source.name, shifts: {} });
      const employee = employees.get(source.id);
      Object.entries(source.shifts).forEach(([day, codes]) => {
        (Array.isArray(codes) ? codes : [codes]).forEach((code) => mergeShift(employee, day, code));
      });
    }));
    return [...employees.values()];
  }

  function parseRosterSheets(sheets, month, year) {
    const candidates = sheets.map((sheet) => ({ ...sheet, layout: rosterLayout(sheet.rows) }))
      .filter((sheet) => sheet.layout && !/สำเนา|copy|backup|^amb\b/i.test(sheet.name));
    const warnings = [];
    const consistent = candidates.filter((sheet) => {
      const namedMonth = sheet.name.match(/^(?:\d{2}|\d{4})-(\d{1,2})(?:RN|PN|EMT)?$/i);
      if (namedMonth && sheet.layout.period && Number(namedMonth[1]) - 1 !== sheet.layout.period.month) {
        warnings.push(`ชีต ${sheet.name}: เดือนในชื่อชีตไม่ตรงกับหัวตาราง (${MONTHS[sheet.layout.period.month]}) จึงยังไม่นำมารวม กรุณาแก้หัวตารางหรือชื่อชีต`);
        return false;
      }
      return true;
    });
    const matching = consistent.filter(({ layout }) => layout.period && layout.period.month === month && layout.period.year === year);
    const selectable = matching.length ? matching : consistent.filter(({ layout }) => !layout.period);
    if (!selectable.length) throw new Error(`ไม่พบตารางเวรเดือน${MONTHS[month]} ${year + 543} ในไฟล์ที่เลือก${warnings.length ? ` — ${warnings.join("; ")}` : ""}`);
    if (new Set(selectable.map((sheet) => sheet.name)).size !== selectable.length || (!matching.length && selectable.length > 1)) {
      throw new Error("พบตารางเวรตรงกันหลายชีต กรุณาระบุเดือนและปีในหัวตารางให้ชัดเจน");
    }
    const employees = mergeEmployees(selectable.map((sheet) => {
      try { return parseRoster(sheet.rows); }
      catch (error) { throw new Error(`ชีต ${sheet.name}: ${error.message}`); }
    }));
    return { employees, sheetName: selectable.map((sheet) => sheet.name).join(", "), warnings };
  }

  function parseRosterFiles(files, month, year) {
    const sources = files.map((file) => {
      try { return { name: file.name, ...parseRosterSheets(file.sheets, month, year) }; }
      catch (error) { throw new Error(`${file.name}: ${error.message}`); }
    });
    return {
      employees: mergeEmployees(sources.map((source) => source.employees)),
      sources: sources.map((source) => `${source.name} [${source.sheetName}]`),
      warnings: sources.flatMap((source) => source.warnings.map((warning) => `${source.name}: ${warning}`))
    };
  }

  function excelDate(value) {
    const utc = new Date(Math.round((value - 25569) * 86400000));
    let year = utc.getUTCFullYear();
    if (year >= 2400) year -= 543;
    return new Date(year, utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
  }

  function parseDateTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const date = new Date(value.getTime());
      if (date.getFullYear() >= 2400) date.setFullYear(date.getFullYear() - 543);
      return date;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return excelDate(value);
    }
    const text = clean(value);
    if (!text) return null;

    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    const match = iso || dmy;
    if (match) {
      let year;
      let month;
      let day;
      if (iso) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      } else {
        const usOrder = Boolean(match[7]) || Number(match[2]) > 12;
        month = Number(usOrder ? match[1] : match[2]);
        day = Number(usOrder ? match[2] : match[1]);
        year = Number(match[3]);
        if (year < 100) year += year < 70 ? 2000 : 1900;
      }
      if (year >= 2400) year -= 543;
      let hour = Number(match[4] || 0);
      const minute = Number(match[5] || 0);
      const second = Number(match[6] || 0);
      const meridiem = match[7] ? match[7].toUpperCase() : "";
      if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
      }
      if (month < 1 || month > 12 || day < 1 || day > 31 ||
          hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute || second))) {
        return null;
      }
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      return date;
    }
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function scanHeaderIndex(rows) {
    return rows.findIndex((row) => {
      const headers = Array.isArray(row) ? row : [];
      return headers.some((value) => {
        const key = headerKey(value);
        return ["dmy", "datetime", "timestamp", "วันที่เวลา"].includes(key) || key.startsWith("dmy");
      }) &&
        headers.some((value) => headerKey(value) === "status") &&
        headers.some((value) => isIdHeader(headerKey(value)));
    });
  }

  function parseScans(rows) {
    const headerIndex = scanHeaderIndex(rows);
    if (headerIndex < 0) {
      throw new Error("ไม่พบหัวตาราง Time Scan ที่มี DMY, STATUS และ SAP ID");
    }
    const headers = rows[headerIndex];
    const dateColumn = findColumn(headers, [(key) =>
      ["dmy", "datetime", "timestamp", "วันที่เวลา"].includes(key) || key.startsWith("dmy")
    ]);
    const statusColumn = findColumn(headers, [(key) => key === "status"]);
    const idColumn = findColumn(headers, [isIdHeader]);
    const nameColumn = findColumn(headers, [isNameHeader]);
    const departmentColumn = findColumn(headers, [(key) => key === "dep" || key === "department" || key.includes("แผนก")]);
    const namedTimeColumn = findColumn(headers, [(key) => ["time", "เวลา", "scanเวลา"].includes(key)]);
    // The supplied report leaves the time header blank between DMY and STATUS.
    const timeColumn = namedTimeColumn >= 0 ? namedTimeColumn :
      statusColumn === dateColumn + 2 && !clean(headers[dateColumn + 1]) ? dateColumn + 1 : -1;
    const scans = [];

    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const id = normalizeId(row[idColumn]);
      const status = clean(row[statusColumn]).toUpperCase();
      const date = parseDateTime(row[dateColumn]);
      if (!id && !status && !clean(row[dateColumn])) return;
      const rowNumber = headerIndex + offset + 2;
      if (!id || !status || !date) {
        throw new Error(`แถวที่ ${rowNumber}: ต้องระบุ DMY, STATUS และ SAP ID ให้ถูกต้อง`);
      }
      if (status !== "IN" && status !== "OUT") {
        throw new Error(`แถวที่ ${rowNumber}: STATUS ต้องเป็น In หรือ Out (พบ "${clean(row[statusColumn])}")`);
      }
      if (timeColumn >= 0) {
        const value = row[timeColumn];
        let seconds = null;
        if (typeof value === "number" && value >= 0 && value < 1) seconds = Math.round(value * 86400);
        else if (value instanceof Date && !Number.isNaN(value.getTime())) seconds = value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
        else {
          const match = clean(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] || 0) < 60) {
            seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
          }
        }
        if (seconds === null || seconds >= 86400) throw new Error(`แถวที่ ${rowNumber}: เวลา Time Scan ไม่ถูกต้องหรือว่าง`);
        date.setHours(0, 0, seconds, 0);
      }
      scans.push({
        id,
        status,
        date,
        name: nameColumn < 0 ? "" : clean(row[nameColumn]),
        department: departmentColumn < 0 ? "" : clean(row[departmentColumn])
      });
    });
    if (scans.length === 0) throw new Error("ไม่พบรายการสแกนในไฟล์ Time Scan");
    return scans;
  }

  function parseScanSheets(sheets) {
    const scans = [];
    const sheetNames = [];
    const seen = new Set();
    sheets.forEach(({ name, rows }) => {
      if (!rows.some((row) => row.some((value) => clean(value)))) return;
      if (scanHeaderIndex(rows) < 0) return;
      // Header-only tabs are common placeholders for the next half-month.
      if (!rows.slice(scanHeaderIndex(rows) + 1).some((row) => row.some((value) => clean(value)))) return;
      let parsed;
      try { parsed = parseScans(rows); }
      catch (error) { throw new Error(`ชีต ${name}: ${error.message}`); }
      sheetNames.push(name);
      parsed.forEach((scan) => {
        const key = `${scan.id}|${scan.status}|${scan.date.getTime()}`;
        if (!seen.has(key)) { seen.add(key); scans.push(scan); }
      });
    });
    if (!scans.length) throw new Error("ไม่พบรายการสแกนในไฟล์ Time Scan (ต้องมี DMY, STATUS และ SAP ID)");
    return { scans, sheetNames };
  }

  function makeDate(dayDate, hour) {
    const date = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0, 0);
    date.setHours(date.getHours() + hour);
    return date;
  }

  function getSegments(date, code) {
    const normalized = clean(code).toUpperCase();
    if (!normalized || OFF_CODES.has(normalized)) return [];
    const rules = SHIFT_RULES[normalized];
    if (!rules) throw new Error(`ไม่รู้จักรหัสเวร "${clean(code)}" วันที่ ${date.getDate()}`);
    return rules.map((rule, index) => ({
      code,
      label: rule.label || code,
      index,
      start: makeDate(date, rule.start),
      end: makeDate(date, rule.end),
      inWindow: rule.inWindow ? rule.inWindow.map((hour) => makeDate(date, hour)) : null,
      outWindow: rule.outWindow ? rule.outWindow.map((hour) => makeDate(date, hour)) : null,
      checkIn: null,
      checkOut: null,
      late: false
    }));
  }

  function pickPunch(punches, used, status, start, end, target, requiredAfter) {
    const candidates = punches.filter((item) =>
      !used.has(item.index) &&
      item.punch.status === status &&
      item.punch.date >= start &&
      item.punch.date <= end &&
      (!requiredAfter || item.punch.date >= requiredAfter)
    );
    candidates.sort((a, b) =>
      Math.abs(a.punch.date - target) - Math.abs(b.punch.date - target) ||
      a.punch.date - b.punch.date
    );
    if (!candidates.length) return null;
    used.add(candidates[0].index);
    return candidates[0].punch;
  }

  function evaluateAttendance(employees, scans, month, year) {
    if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year)) {
      throw new Error("เดือนหรือปีไม่ถูกต้อง");
    }
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows = [];
    const byEmployee = new Map();

    employees.forEach((employee) => {
      const employeeScans = scans
        .filter((scan) => scan.id === employee.id)
        .sort((a, b) => a.date - b.date)
        .map((punch, index) => ({ punch, index }));
      const segments = [];
      const shiftRows = [];

      for (let day = 1; day <= daysInMonth; day += 1) {
        const rawCodes = employee.shifts[day];
        const codes = (Array.isArray(rawCodes) ? rawCodes : [rawCodes]).map(clean)
          .filter((code) => code && !OFF_CODES.has(code.toUpperCase()));
        if (!codes.length) continue;
        const code = codes.join(" + ");
        const date = new Date(year, month, day);
        const halfDayLeave = codes.some((item) => item.toUpperCase() === "V0.5");
        const leavePeriod = employee.halfDayLeaves && employee.halfDayLeaves[day];
        const resolvedCodes = codes.map((item) => item.toUpperCase() === "V0.5" && ["AM", "PM"].includes(leavePeriod) ? `V0.5-${leavePeriod}` : item);
        const unknownCodes = resolvedCodes.filter((item) => !SHIFT_RULES[item.toUpperCase()]);
        if (unknownCodes.length) {
          shiftRows.push({ id: employee.id, name: employee.name, date, day, code, segments: [], unknownCodes, halfDayLeave, leavePeriod });
          continue;
        }
        const daySegments = [];
        // Adjacent base/PartTime duties form one continuous shift, like ชบ.
        resolvedCodes.flatMap((item) => getSegments(date, item)).sort((a, b) => a.start - b.start).forEach((segment) => {
          const previous = daySegments[daySegments.length - 1];
          if (previous && segment.start <= previous.end) {
            if (segment.end > previous.end) {
              previous.end = segment.end;
              previous.outWindow = segment.outWindow;
            } else if (segment.end.getTime() === previous.end.getTime() && segment.outWindow) {
              previous.outWindow = segment.outWindow;
            }
          } else daySegments.push(segment);
        });
        if (!daySegments.length) continue;
        const row = { id: employee.id, name: employee.name, date, day, code, segments: daySegments, halfDayLeave, leavePeriod };
        shiftRows.push(row);
        daySegments.forEach((segment) => segments.push({ segment, row }));
      }

      segments.sort((a, b) => a.segment.start - b.segment.start);
      const usedIns = new Set();
      segments.forEach(({ segment }, index) => {
        const earliest = segment.inWindow ? segment.inWindow[0] : new Date(segment.start.getTime() - 4 * 60 * 60 * 1000);
        const latest = segment.inWindow ? segment.inWindow[1] : new Date(segment.start.getTime() + 12 * 60 * 60 * 1000 - 1);
        const next = segments[index + 1];
        const checkInEnd = next ? new Date(Math.min(latest.getTime(), next.segment.start.getTime() - 1)) : latest;
        segment.checkIn = pickPunch(
          employeeScans, usedIns, "IN", earliest, checkInEnd, segment.start, null
        );
        segment.late = Boolean(segment.checkIn && segment.checkIn.date > segment.start);
      });

      const usedOuts = new Set();
      segments.forEach(({ segment }) => {
        const earliest = segment.outWindow ? segment.outWindow[0] : new Date(segment.end.getTime() - 4 * 60 * 60 * 1000);
        const latest = segment.outWindow ? segment.outWindow[1] : new Date(segment.end.getTime() + 4 * 60 * 60 * 1000);
        segment.checkOut = pickPunch(
          employeeScans, usedOuts, "OUT", earliest, latest, segment.end,
          segment.checkIn ? segment.checkIn.date : null
        );
      });

      shiftRows.forEach((row) => {
        row.segments.forEach((segment) => {
          segment.status = !segment.checkIn ? "missingIn" : !segment.checkOut ? "missingOut" : segment.late ? "late" : "onTime";
        });
        const hasMissingIn = row.segments.some((segment) => !segment.checkIn);
        const hasMissingOut = row.segments.some((segment) => segment.checkIn && !segment.checkOut);
        const hasLate = row.segments.some((segment) => segment.late);
        row.status = row.unknownCodes ? "unknownShift" : hasMissingIn ? "missingIn" :
          hasMissingOut ? "missingOut" : hasLate ? "late" : "onTime";
        row.checkIn = row.segments.map((segment) => segment.checkIn).filter(Boolean)
          .sort((a, b) => a.date - b.date)[0] || null;
        row.checkOut = row.segments.map((segment) => segment.checkOut).filter(Boolean)
          .sort((a, b) => b.date - a.date)[0] || null;
        rows.push(row);
      });
      byEmployee.set(employee.id, shiftRows);
    });
    rows.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id, "th"));
    return { rows, byEmployee, labels: STATUS_LABELS };
  }

  return { parseRoster, parseRosterSheets, parseRosterFiles, parseScans, parseScanSheets, parseDateTime, evaluateAttendance, STATUS_LABELS };
});
