(function () {
  "use strict";

  const MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const STATUS_CLASSES = {
    onTime: "status-on-time",
    late: "status-late",
    missingIn: "status-missing-in",
    missingOut: "status-missing-out",
    unknownShift: "status-missing-out"
  };
  const STATUS_FILTERS = ["all", "onTime", "late", "missingIn", "missingOut", "unknownShift"];
  const state = { employees: [], scans: [], results: [], selectedStatus: "all", month: null, year: null, leaveSelections: new Map() };

  const elements = {
    rosterFile: document.getElementById("roster-file"),
    scanFile: document.getElementById("scan-file"),
    month: document.getElementById("month"),
    year: document.getElementById("year"),
    employee: document.getElementById("employee"),
    process: document.getElementById("process-button"),
    message: document.getElementById("message"),
    resultsSection: document.getElementById("results-section"),
    resultPeriod: document.getElementById("result-period"),
    summary: document.getElementById("summary"),
    filters: document.getElementById("status-filters"),
    resultsBody: document.getElementById("results-body"),
    emptyResults: document.getElementById("empty-results"),
    resultCount: document.getElementById("result-count"),
    exportCsv: document.getElementById("export-csv"),
    exportExcel: document.getElementById("export-excel")
  };

  function setMessage(text, kind) {
    elements.message.className = `mt-3 alert alert-${kind}`;
    elements.message.textContent = text;
  }

  function readSpreadsheet(file, label) {
    if (!file) return Promise.reject(new Error(`กรุณาเลือก${label}`));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`อ่าน${label}ไม่สำเร็จ`));
      reader.onload = () => {
        try {
          const isCsv = file.name.toLowerCase().endsWith(".csv");
          const workbook = XLSX.read(reader.result, {
            type: isCsv ? "string" : "array",
            cellDates: false,
            raw: isCsv
          });
          if (!workbook.SheetNames.length) throw new Error(`${label}ไม่มีแผ่นงาน`);
          resolve(workbook.SheetNames.map((name) => ({
            name,
            rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: !isCsv })
          })));
        } catch (error) {
          reject(new Error(`เปิด${label}ไม่สำเร็จ: ${error.message}`));
        }
      };
      if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file, "UTF-8");
      else reader.readAsArrayBuffer(file);
    });
  }

  function setEmployeeOptions() {
    const selected = elements.employee.value;
    elements.employee.replaceChildren(new Option("เลือกทั้งหมด", ""));
    state.employees.forEach((employee) => {
      elements.employee.add(new Option(`${employee.id} - ${employee.name}`, employee.id));
    });
    elements.employee.disabled = false;
    if (state.employees.some((employee) => employee.id === selected)) elements.employee.value = selected;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function formatTime(punch) {
    if (!punch) return "—";
    return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(punch.date);
  }

  function formatShiftTime(punch, shiftDate) {
    if (!punch) return "—";
    const time = formatTime(punch);
    const punchDay = new Date(punch.date.getFullYear(), punch.date.getMonth(), punch.date.getDate());
    const dutyDay = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate());
    const dayOffset = Math.round((punchDay - dutyDay) / 86400000);
    if (dayOffset === -1) return `${time} (วันก่อน)`;
    if (dayOffset === 1) return `${time} (วันถัดไป)`;
    return time;
  }

  function visibleRows() {
    const employeeId = elements.employee.value;
    return state.results.filter((row) =>
      (!employeeId || row.id === employeeId) &&
      (state.selectedStatus === "all" || row.status === state.selectedStatus)
    );
  }

  function renderSummary(rows) {
    const counts = STATUS_FILTERS.slice(1).map((key) => ({
      label: Attendance.STATUS_LABELS[key],
      count: rows.filter((row) => row.status === key).length,
      key
    }));
    const cards = [{ label: "เวรที่ต้องตรวจ", count: rows.length, key: "all" }, ...counts];
    elements.summary.replaceChildren();
    cards.forEach(({ label, count, key }) => {
      const column = document.createElement("div");
      column.className = "col-6 col-lg";
      const card = document.createElement("div");
      card.className = "summary-card";
      const title = document.createElement("div");
      title.className = "summary-label";
      title.textContent = label;
      const value = document.createElement("div");
      value.className = "summary-value";
      value.textContent = String(count);
      if (key !== "all") value.classList.add(`text-${key === "onTime" ? "success" : key === "late" ? "warning" : "danger"}`);
      card.append(title, value);
      column.append(card);
      elements.summary.append(column);
    });
  }

  function renderFilters(rows) {
    elements.filters.replaceChildren();
    STATUS_FILTERS.forEach((key) => {
      const count = key === "all" ? rows.length : rows.filter((row) => row.status === key).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `nav-link${state.selectedStatus === key ? " active" : ""}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(state.selectedStatus === key));
      button.textContent = `${Attendance.STATUS_LABELS[key]} (${count})`;
      button.addEventListener("click", () => {
        state.selectedStatus = key;
        renderResults();
      });
      elements.filters.append(button);
    });
  }

  function renderTable(rows) {
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const values = [
        formatDate(row.date), row.id, row.name, row.code,
        formatShiftTime(row.checkIn, row.date), formatShiftTime(row.checkOut, row.date)
      ];
      values.forEach((value, column) => {
        const td = document.createElement("td");
        td.textContent = value;
        if ((column === 4 || column === 5) && row.segments.length > 1) {
          td.textContent = "";
          row.segments.forEach((segment, index) => {
            const line = document.createElement("div");
            line.className = "shift-round";
            const punch = column === 4 ? segment.checkIn : segment.checkOut;
            line.textContent = `${roundLabel(segment, index)}: ${formatShiftTime(punch, row.date)}`;
            td.append(line);
          });
        }
        if (column === 3 && row.halfDayLeave) {
          const select = document.createElement("select");
          select.className = "form-select form-select-sm mt-1";
          select.setAttribute("aria-label", `ช่วงลาครึ่งวัน ${row.name} ${formatDate(row.date)}`);
          select.add(new Option("เลือกช่วงลา V0.5", ""));
          select.add(new Option("ลาเช้า · ทำงาน 12:00–16:00", "AM"));
          select.add(new Option("ลาบ่าย · ทำงาน 08:00–12:00", "PM"));
          select.value = row.leavePeriod || "";
          select.addEventListener("change", () => {
            const employee = state.employees.find((item) => item.id === row.id);
            employee.halfDayLeaves = employee.halfDayLeaves || {};
            employee.halfDayLeaves[row.day] = select.value;
            state.leaveSelections.set(`${state.year}-${state.month}-${row.id}-${row.day}`, select.value);
            state.results = Attendance.evaluateAttendance(state.employees, state.scans, state.month, state.year).rows;
            renderResults();
            showImportMessage();
          });
          td.append(select);
        }
        tr.append(td);
      });
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${STATUS_CLASSES[row.status]}`;
      badge.textContent = Attendance.STATUS_LABELS[row.status];
      statusCell.append(badge);
      if (row.segments.length > 1) {
        row.segments.forEach((segment, index) => {
          const line = document.createElement("div");
          line.className = "shift-round small";
          line.textContent = `${roundLabel(segment, index)}: ${Attendance.STATUS_LABELS[segment.status]}`;
          statusCell.append(line);
        });
      }
      tr.append(statusCell);
      fragment.append(tr);
    });
    elements.resultsBody.replaceChildren(fragment);
    elements.emptyResults.classList.toggle("d-none", rows.length !== 0);
    elements.resultCount.textContent = `แสดง ${rows.length.toLocaleString("th-TH")} รายการ`;
  }

  function renderResults() {
    const allRows = state.results.filter((row) => !elements.employee.value || row.id === elements.employee.value);
    renderSummary(allRows);
    renderFilters(allRows);
    renderTable(visibleRows());
    elements.resultsSection.classList.remove("d-none");
  }

  function roundLabel(segment, index) {
    return `รอบ ${index + 1} (${segment.label || segment.code})`;
  }

  function exportPunches(row, key) {
    const format = (punch) => punch ? `${formatDate(punch.date)} ${formatTime(punch)}` : "";
    if (row.segments.length <= 1) return format(row[key]);
    return row.segments.map((segment, index) => `${roundLabel(segment, index)}: ${format(segment[key]) || "ไม่มี"}`).join(" | ");
  }

  function statusDetail(row) {
    if (row.unknownCodes) return `ยังไม่กำหนดเวลาเวรสำหรับรหัส: ${row.unknownCodes.join(", ")}`;
    const leaveDetail = row.halfDayLeave ? `${row.leavePeriod === "AM" ? "ลาเช้า (ทำงาน 12:00–16:00)" : "ลาบ่าย (ทำงาน 08:00–12:00)"}; ` : "";
    return leaveDetail + row.segments.map((segment, index) => {
      const inText = segment.checkIn ? formatShiftTime(segment.checkIn, row.date) : "ไม่มี";
      const outText = segment.checkOut ? formatShiftTime(segment.checkOut, row.date) : "ไม่มี";
      return `${roundLabel(segment, index)}: เข้า ${inText}, ออก ${outText}, ${Attendance.STATUS_LABELS[segment.status]}`;
    }).join(" | ");
  }

  function exportRows() {
    return visibleRows().map((row) => ({
      วันที่: formatDate(row.date),
      "รหัสพนักงาน": row.id,
      "ชื่อ-สกุล": row.name,
      "รหัสเวร": row.code,
      "เวลาเข้า": exportPunches(row, "checkIn"),
      "เวลาออก": exportPunches(row, "checkOut"),
      สถานะ: Attendance.STATUS_LABELS[row.status],
      รายละเอียดแต่ละช่วงเวร: statusDetail(row)
    }));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    const data = exportRows();
    if (!data.length) {
      setMessage("ไม่มีรายการที่ตรงกับตัวกรองสำหรับส่งออก", "warning");
      return;
    }
    const headers = Object.keys(data[0]);
    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(","), ...data.map((row) => headers.map((key) => escape(row[key])).join(","))]
      .join("\r\n");
    downloadBlob(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), "attendance-report.csv");
  }

  function exportExcel() {
    const data = exportRows();
    if (!data.length) {
      setMessage("ไม่มีรายการที่ตรงกับตัวกรองสำหรับส่งออก", "warning");
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ผลตรวจสอบ");
    XLSX.writeFile(workbook, "attendance-report.xlsx");
  }

  async function processFiles() {
    elements.process.disabled = true;
    elements.resultsSection.classList.add("d-none");
    try {
      const rosterFiles = Array.from(elements.rosterFile.files);
      if (!rosterFiles.length) throw new Error("กรุณาเลือกไฟล์ตารางเวร");
      const [rosterData, scanSheets] = await Promise.all([
        Promise.all(rosterFiles.map(async (file) => ({ name: file.name, sheets: await readSpreadsheet(file, `ไฟล์ตารางเวร ${file.name}`) }))),
        readSpreadsheet(elements.scanFile.files[0], "ไฟล์ Time Scan")
      ]);
      const month = Number(elements.month.value);
      const inputYear = Number(elements.year.value);
      const year = inputYear >= 2400 ? inputYear - 543 : inputYear;
      if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 1900 || year > 2457) {
        throw new Error("กรุณาระบุเดือนและปีให้ถูกต้อง");
      }
      const roster = Attendance.parseRosterFiles(rosterData, month, year);
      const scanData = Attendance.parseScanSheets(scanSheets);
      state.employees = roster.employees;
      state.scans = scanData.scans;
      state.month = month;
      state.year = year;
      state.employees.forEach((employee) => {
        employee.halfDayLeaves = {};
        Object.keys(employee.shifts).forEach((day) => {
          const selected = state.leaveSelections.get(`${year}-${month}-${employee.id}-${day}`);
          if (selected) employee.halfDayLeaves[day] = selected;
        });
      });
      const result = Attendance.evaluateAttendance(state.employees, state.scans, month, year);
      state.results = result.rows;
      state.selectedStatus = "all";
      setEmployeeOptions();
      elements.resultPeriod.textContent = `${MONTHS[month]} ${year + 543}`;
      renderResults();
      state.importInfo = { roster, scanData };
      showImportMessage();
    } catch (error) {
      setMessage(error.message || "เกิดข้อผิดพลาดขณะประมวลผลไฟล์", "danger");
    } finally {
      elements.process.disabled = false;
    }
  }

  function showImportMessage() {
      const { roster, scanData } = state.importInfo;
      const periodScans = state.scans.filter((scan) => scan.date.getMonth() === state.month && scan.date.getFullYear() === state.year);
      const bounds = state.scans.reduce((range, scan) => [Math.min(range[0], scan.date.getTime()), Math.max(range[1], scan.date.getTime())], [Infinity, -Infinity]);
      const firstScan = new Date(bounds[0]);
      const lastScan = new Date(bounds[1]);
      const coverage = periodScans.length ? "" : " ไม่พบรายการสแกนในเดือนที่เลือก";
      const unknownCodes = [...new Set(state.results.flatMap((row) => row.unknownCodes || []))];
      const codeWarning = unknownCodes.length ? ` รหัสที่ต้องตรวจสอบเวลาเวร: ${unknownCodes.join(", ")}${unknownCodes.includes("V0.5") ? " (เลือกลาเช้าหรือลาบ่ายที่แถวผลตรวจสอบ)" : ""}` : "";
      setMessage(
        `อ่านตารางเวร ${roster.sources.join("; ")}: พนักงาน ${state.employees.length.toLocaleString("th-TH")} คน และ Time Scan ${scanData.sheetNames.length} ชีต รวม ${state.scans.length.toLocaleString("th-TH")} รายการ (ช่วง ${formatDate(firstScan)}–${formatDate(lastScan)})${coverage}${codeWarning}${roster.warnings.length ? ` ${roster.warnings.join("; ")}` : ""} — วันที่ไม่มีข้อมูลสแกนอาจขึ้นสถานะไม่สแกนเข้า/ออก`,
        periodScans.length && !unknownCodes.length && !roster.warnings.length ? "success" : "warning"
      );
  }

  function initialize() {
    MONTHS.forEach((name, index) => elements.month.add(new Option(name, String(index))));
    const now = new Date();
    elements.month.value = String(now.getMonth());
    elements.year.value = String(now.getFullYear() + 543);
    elements.process.addEventListener("click", processFiles);
    elements.employee.addEventListener("change", () => {
      if (state.results.length) renderResults();
    });
    elements.exportCsv.addEventListener("click", exportCsv);
    elements.exportExcel.addEventListener("click", exportExcel);
  }

  initialize();
})();
