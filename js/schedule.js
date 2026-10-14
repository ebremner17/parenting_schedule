(function ($, Drupal, drupalSettings, once) {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const MONTH_NAMES_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  Drupal.behaviors.parentingSchedule = {
    attach: function (context) {
      once('scheduleProcessed', '#calendars-wrapper', context).forEach(function () {
        initScheduleApp();
      });
    }
  };

  const settings = drupalSettings.parentingSchedule || {};
  const EDITABLE = !!settings.editable;
  const CSRF_TOKEN = settings.csrfToken || '';

  let appData = { months: [], days: [] };
  let dayIndex = {};
  let rangeFilter = null;
  let rangeDefaultsApplied = false;

  async function initScheduleApp() {
    await loadData();
    wireRangeControls();
    if (EDITABLE) {
      wireModal();
      wireControlPanel();
    }
  }

  async function loadData() {
    try {
      const response = await fetch('/api/parenting-schedule');
      appData = await response.json();
      indexDays();
      populateRangeDefaults();
      renderApp();
    } catch (error) {
      console.error('Failed to load parenting schedule data:', error);
    }
  }

  function indexDays() {
    dayIndex = {};
    (appData.days || []).forEach(d => { dayIndex[d.day_date] = d; });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateStr(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function monthLabel(year, month) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  function monthLabelShort(year, month) {
    return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
  }

  // -------- Display range filter --------

  function monthKey(year, month) {
    return year * 12 + month;
  }

  function isInRange(year, month) {
    if (!rangeFilter) return true;
    const key = monthKey(year, month);
    return key >= rangeFilter.startKey && key <= rangeFilter.endKey;
  }

  function sortedMonths() {
    return (appData.months || []).slice()
      .map(m => ({ year: Number(m.year), month: Number(m.month) }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  }

  function populateRangeDefaults() {
    if (rangeDefaultsApplied) return;
    const months = sortedMonths();
    if (!months.length) return;

    const startMonthEl = document.getElementById('range-start-month');
    const startYearEl = document.getElementById('range-start-year');
    const endMonthEl = document.getElementById('range-end-month');
    const endYearEl = document.getElementById('range-end-year');
    if (!startMonthEl || !startYearEl || !endMonthEl || !endYearEl) return;

    const first = months[0];
    const last = months[months.length - 1];
    startMonthEl.value = String(first.month);
    startYearEl.value = String(first.year);
    endMonthEl.value = String(last.month);
    endYearEl.value = String(last.year);
    rangeDefaultsApplied = true;
  }

  function wireRangeControls() {
    const applyBtn = document.getElementById('range-apply-btn');
    const resetBtn = document.getElementById('range-reset-btn');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const startYear = parseInt(document.getElementById('range-start-year').value, 10);
        const startMonth = parseInt(document.getElementById('range-start-month').value, 10);
        const endYear = parseInt(document.getElementById('range-end-year').value, 10);
        const endMonth = parseInt(document.getElementById('range-end-month').value, 10);

        if (!startYear || !startMonth || !endYear || !endMonth) return;

        const startKey = monthKey(startYear, startMonth);
        const endKey = monthKey(endYear, endMonth);
        if (startKey > endKey) {
          alert('The "From" month must be on or before the "To" month.');
          return;
        }

        rangeFilter = { startKey, endKey };
        renderApp();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        rangeFilter = null;
        renderApp();
      });
    }

    const exportBtn = document.getElementById('export-pdf-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        // The site theme/admin toolbar reserves layout space on an ancestor
        // of our content in a way that resists CSS and inline-style
        // overrides. Sidestep it entirely: relocate our content to be a
        // direct child of <body> for the print pass, then move it back.
        const wrapper = document.querySelector('.wrapper-container');
        if (!wrapper) {
          window.print();
          return;
        }

        const originalParent = wrapper.parentNode;
        const originalNextSibling = wrapper.nextSibling;
        document.body.appendChild(wrapper);

        const restore = () => {
          originalParent.insertBefore(wrapper, originalNextSibling);
          window.removeEventListener('afterprint', restore);
        };
        window.addEventListener('afterprint', restore);

        window.print();
      });
    }
  }

  function timeToLabel(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = (h % 12) || 12;
    return `${h12}:${pad(m)} ${period}`;
  }

  function timeToFraction(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h + m / 60) / 24;
  }

  // -------- Hours calculation --------

  function calculateMonthlyHours(year, month) {
    const nDays = daysInMonth(year, month);
    let ericHours = 0;
    let sarahHours = 0;

    for (let day = 1; day <= nDays; day++) {
      const entry = dayIndex[dateStr(year, month, day)];
      if (!entry) continue;

      if (entry.day_type === 'parenting') {
        if (entry.parent === 'eric') {
          ericHours += 24;
        } else {
          sarahHours += 24;
        }
      } else if (entry.day_type === 'exchange' && entry.exchange_time) {
        const beforeHours = Math.round(timeToFraction(entry.exchange_time) * 24);
        const afterHours = 24 - beforeHours;
        const beforeIsEric = entry.exchange_type === 'eric_to_sarah';

        ericHours += beforeIsEric ? beforeHours : afterHours;
        sarahHours += beforeIsEric ? afterHours : beforeHours;
      }
    }

    return { ericHours, sarahHours };
  }

  function formatDaysHours(totalHours) {
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return h === 0 ? `${d} days` : `${d} days, ${h} hours`;
  }

  function formatDaysHoursWithTotal(totalHours) {
    return `${formatDaysHours(totalHours)} (${totalHours} h)`;
  }

  function getVarianceBadge(variance) {
    if (variance > 0) {
      return `<span class="variance-tag variance-eric">+${variance} h (Eric surplus)</span>`;
    }
    if (variance < 0) {
      return `<span class="variance-tag variance-sarah">+${Math.abs(variance)} h (Sarah surplus)</span>`;
    }
    return `<span class="variance-tag variance-even">Even (0 h)</span>`;
  }

  // -------- Rendering --------

  function renderApp() {
    const wrapper = document.getElementById('calendars-wrapper');
    const summaryBody = document.getElementById('summary-table-body');
    const summaryFoot = document.getElementById('summary-table-foot');
    if (!wrapper) return;

    wrapper.innerHTML = '';
    if (summaryBody) summaryBody.innerHTML = '';
    if (summaryFoot) summaryFoot.innerHTML = '';

    const months = sortedMonths();

    let ytdEric = 0;
    let ytdSarah = 0;

    let rangeEric = 0;
    let rangeSarah = 0;
    let rangeDays = 0;
    let firstShown = null;
    let lastShown = null;

    months.forEach(({ year, month }) => {
      const nDays = daysInMonth(year, month);
      const { ericHours, sarahHours } = calculateMonthlyHours(year, month);
      ytdEric += ericHours;
      ytdSarah += sarahHours;

      if (!isInRange(year, month)) return;

      if (!firstShown) firstShown = { year, month };
      lastShown = { year, month };
      rangeEric += ericHours;
      rangeSarah += sarahHours;
      rangeDays += nDays;

      wrapper.appendChild(buildMonthCard(year, month, nDays, ericHours, sarahHours, ytdEric, ytdSarah));

      if (summaryBody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${monthLabelShort(year, month)}</strong></td>
          <td>${nDays} days (${nDays * 24} h)</td>
          <td>${formatDaysHoursWithTotal(ericHours)}</td>
          <td>${formatDaysHoursWithTotal(sarahHours)}</td>
          <td>${getVarianceBadge(ericHours - sarahHours)}</td>
        `;
        summaryBody.appendChild(tr);
      }
    });

    if (!firstShown) {
      wrapper.innerHTML = '<p class="no-months-message">No months in the selected range.</p>';
    }

    if (summaryFoot) {
      const totalLabel = (rangeFilter && firstShown)
        ? `Total (${monthLabelShort(firstShown.year, firstShown.month)} &ndash; ${monthLabelShort(lastShown.year, lastShown.month)})`
        : 'Total';
      summaryFoot.innerHTML = `
        <tr>
          <td><strong>${totalLabel}</strong></td>
          <td>${rangeDays} days (${rangeDays * 24} h)</td>
          <td>${formatDaysHoursWithTotal(rangeEric)}</td>
          <td>${formatDaysHoursWithTotal(rangeSarah)}</td>
          <td>${getVarianceBadge(rangeEric - rangeSarah)}</td>
        </tr>
      `;
    }
  }

  function buildMonthCard(year, month, nDays, ericHours, sarahHours, ytdEric, ytdSarah) {
    const firstDayIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

    const card = document.createElement('div');
    card.className = 'calendar-container';
    card.innerHTML = `
      <div class="header">
        <div class="stats stats-eric">
          <div class="stats-name">Eric</div>
          <div>Month: ${formatDaysHoursWithTotal(ericHours)}</div>
          <div>YTD: ${formatDaysHoursWithTotal(ytdEric)}</div>
        </div>
        <h2>${monthLabel(year, month)}</h2>
        <div class="stats stats-sarah">
          <div class="stats-name">Sarah</div>
          <div>Month: ${formatDaysHoursWithTotal(sarahHours)}</div>
          <div>YTD: ${formatDaysHoursWithTotal(ytdSarah)}</div>
        </div>
      </div>
      ${EDITABLE ? `<div class="month-actions"><button type="button" class="remove-month-btn">Remove Month</button></div>` : ''}
      <div class="grid">
        <div class="day-header">Sun</div><div class="day-header">Mon</div><div class="day-header">Tue</div>
        <div class="day-header">Wed</div><div class="day-header">Thu</div><div class="day-header">Fri</div><div class="day-header">Sat</div>
      </div>
      <div class="legend">
        <div class="legend-item"><div class="legend-color bar-eric"></div><span>Eric</span></div>
        <div class="legend-item"><div class="legend-color bar-sarah"></div><span>Sarah</span></div>
        <div class="legend-item"><div class="legend-color bar-unassigned"></div><span>Unassigned</span></div>
      </div>
    `;

    const grid = card.querySelector('.grid');
    for (let i = 0; i < firstDayIndex; i++) {
      const empty = document.createElement('div');
      empty.className = 'cell empty';
      grid.appendChild(empty);
    }
    for (let day = 1; day <= nDays; day++) {
      grid.appendChild(renderDayCell(year, month, day));
    }

    const removeBtn = card.querySelector('.remove-month-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => removeMonth(year, month));
    }

    return card;
  }

  function renderDayCell(year, month, day) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const ds = dateStr(year, month, day);
    const entry = dayIndex[ds];

    const dayNum = document.createElement('div');
    dayNum.className = 'day-number';
    dayNum.innerText = day;
    cell.appendChild(dayNum);

    const shiftLabel = document.createElement('div');
    shiftLabel.className = 'shift-label';
    if (entry && entry.occasion) {
      const occasionLine = document.createElement('div');
      occasionLine.className = 'occasion-label';
      occasionLine.innerText = entry.occasion;
      shiftLabel.appendChild(occasionLine);
    }
    if (entry && entry.label) {
      const labelLine = document.createElement('div');
      labelLine.className = 'regular-label';
      labelLine.innerText = entry.label;
      shiftLabel.appendChild(labelLine);
    }
    cell.appendChild(shiftLabel);

    const barWrapper = document.createElement('div');
    barWrapper.className = 'bar-wrapper';
    const barContainer = document.createElement('div');
    barContainer.className = 'bar-container';

    if (!entry) {
      const seg = document.createElement('div');
      seg.className = 'bar-segment bar-unassigned';
      seg.style.width = '100%';
      barContainer.appendChild(seg);
    } else if (entry.day_type === 'parenting') {
      const seg = document.createElement('div');
      seg.className = `bar-segment ${entry.parent === 'eric' ? 'bar-eric' : 'bar-sarah'}`;
      seg.style.width = '100%';
      barContainer.appendChild(seg);
    } else if (entry.day_type === 'exchange' && entry.exchange_time) {
      const firstPct = (timeToFraction(entry.exchange_time) * 100).toFixed(1);
      const secondPct = (100 - firstPct).toFixed(1);
      const firstIsEric = entry.exchange_type === 'eric_to_sarah';

      const badge = document.createElement('div');
      badge.className = 'exchange-badge';
      badge.innerText = timeToLabel(entry.exchange_time);
      badge.style.left = `${firstPct}%`;
      barWrapper.appendChild(badge);

      const seg1 = document.createElement('div');
      seg1.className = `bar-segment ${firstIsEric ? 'bar-eric' : 'bar-sarah'}`;
      seg1.style.width = `${firstPct}%`;
      const seg2 = document.createElement('div');
      seg2.className = `bar-segment ${firstIsEric ? 'bar-sarah' : 'bar-eric'}`;
      seg2.style.width = `${secondPct}%`;
      barContainer.appendChild(seg1);
      barContainer.appendChild(seg2);
    }

    barWrapper.appendChild(barContainer);
    cell.appendChild(barWrapper);

    if (EDITABLE) {
      cell.classList.add('editable');
      cell.addEventListener('click', () => openModal(ds));
    }

    return cell;
  }

  // -------- Modal (click a day -> Exchange Day / Parenting Day) --------

  const PRESET_LABELS = ['Nights', 'Makeup day', 'Hunting', 'Vacation', 'March Break', 'Balancing'];

  function toggleDayTypeSections(dayType) {
    document.getElementById('exchange-section').style.display = dayType === 'exchange' ? 'block' : 'none';
    document.getElementById('parenting-section').style.display = dayType === 'parenting' ? 'block' : 'none';
  }

  function toggleLabelCustom(selectValue) {
    document.getElementById('modal-label-custom').style.display = selectValue === 'custom' ? 'block' : 'none';
  }

  function wireModal() {
    document.querySelectorAll('input[name="day-type"]').forEach(r => {
      r.addEventListener('change', (e) => toggleDayTypeSections(e.target.value));
    });
    document.getElementById('modal-label-select').addEventListener('change', (e) => toggleLabelCustom(e.target.value));
  }

  window.openModal = function (dateString) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    const entry = dayIndex[dateString];

    document.getElementById('modal-date-title').innerText = `Edit ${dateString}`;
    document.getElementById('modal-date-val').value = dateString;
    document.getElementById('modal-occasion').value = (entry && entry.occasion) || '';

    const dayType = entry ? entry.day_type : 'exchange';
    document.querySelectorAll('input[name="day-type"]').forEach(r => { r.checked = (r.value === dayType); });
    toggleDayTypeSections(dayType);

    document.getElementById('modal-exchange-time').value = (entry && entry.exchange_time) || '16:00';
    document.querySelectorAll('input[name="exchange-type"]').forEach(r => {
      r.checked = (entry && entry.exchange_type) ? (r.value === entry.exchange_type) : (r.value === 'eric_to_sarah');
    });
    document.querySelectorAll('input[name="parent"]').forEach(r => {
      r.checked = (entry && entry.parent) ? (r.value === entry.parent) : (r.value === 'eric');
    });
    const label = (entry && entry.label) || '';
    const labelSelect = document.getElementById('modal-label-select');
    const labelCustom = document.getElementById('modal-label-custom');
    if (!label) {
      labelSelect.value = '';
      labelCustom.value = '';
    } else if (PRESET_LABELS.includes(label)) {
      labelSelect.value = label;
      labelCustom.value = '';
    } else {
      labelSelect.value = 'custom';
      labelCustom.value = label;
    }
    toggleLabelCustom(labelSelect.value);

    document.getElementById('modal-delete-btn').style.display = entry ? 'inline-block' : 'none';

    modal.style.display = 'flex';
  };

  window.closeModal = function () {
    const modal = document.getElementById('modal');
    if (modal) modal.style.display = 'none';
  };

  window.saveDay = async function () {
    const date = document.getElementById('modal-date-val').value;
    const dayType = document.querySelector('input[name="day-type"]:checked')?.value;
    const labelSelectVal = document.getElementById('modal-label-select').value;
    const label = labelSelectVal === 'custom'
      ? document.getElementById('modal-label-custom').value.trim()
      : labelSelectVal;
    const occasion = document.getElementById('modal-occasion').value.trim();
    const payload = { date, day_type: dayType, label, occasion };

    if (dayType === 'exchange') {
      payload.exchange_time = document.getElementById('modal-exchange-time').value;
      payload.exchange_type = document.querySelector('input[name="exchange-type"]:checked')?.value;
      if (!payload.exchange_time || !payload.exchange_type) {
        alert('Please provide an exchange time and select an exchange direction.');
        return;
      }
    } else if (dayType === 'parenting') {
      payload.parent = document.querySelector('input[name="parent"]:checked')?.value;
      if (!payload.parent) {
        alert('Please select who has the kids on this parenting day.');
        return;
      }
    }

    try {
      const response = await postJson('/admin/config/parenting-schedule/day/save', payload);
      const result = await response.json();
      if (result.success) {
        closeModal();
        loadData();
      } else {
        alert(result.message || 'Failed to save.');
      }
    } catch (error) {
      console.error('Error saving day:', error);
    }
  };

  window.deleteDay = async function () {
    const date = document.getElementById('modal-date-val').value;
    if (!confirm(`Clear the entry for ${date}?`)) return;

    try {
      await postJson('/admin/config/parenting-schedule/day/delete', { date });
      closeModal();
      loadData();
    } catch (error) {
      console.error('Error deleting day:', error);
    }
  };

  // -------- Month management --------

  async function addMonth(year, month) {
    try {
      const response = await postJson('/admin/config/parenting-schedule/month/add', { year, month });
      const result = await response.json();
      if (result.success) {
        loadData();
      } else {
        alert(result.message || 'Failed to add month.');
      }
    } catch (error) {
      console.error('Error adding month:', error);
    }
  }

  async function removeMonth(year, month) {
    if (!confirm(`Remove ${monthLabel(year, month)} and all of its day entries?`)) return;
    try {
      await postJson('/admin/config/parenting-schedule/month/delete', { year, month });
      loadData();
    } catch (error) {
      console.error('Error removing month:', error);
    }
  }

  function wireControlPanel() {
    const addBtn = document.getElementById('add-month-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const year = parseInt(document.getElementById('add-month-year').value, 10);
        const month = parseInt(document.getElementById('add-month-select').value, 10);
        if (!year || !month) return;
        addMonth(year, month);
      });
    }
  }

  // -------- Export / Import / Clear --------

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      body: JSON.stringify(body || {}),
    });
  }

  window.exportJson = function () {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appData, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', 'parenting_schedule_backup.json');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.importJson = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported.months || !imported.days) {
          alert('Invalid JSON format. Missing months or days arrays.');
          return;
        }
        const response = await postJson('/admin/config/parenting-schedule/import', imported);
        const result = await response.json();
        if (result.success) {
          alert('Schedule imported successfully.');
          loadData();
        } else {
          alert(result.message || 'Import failed.');
        }
      } catch (err) {
        console.error('Error parsing JSON file:', err);
        alert('Failed to parse the uploaded JSON file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  window.clearSchedule = async function () {
    if (!confirm('Delete the entire schedule (all months and days)? This cannot be undone.')) return;
    try {
      const response = await postJson('/admin/config/parenting-schedule/clear', {});
      const result = await response.json();
      if (result.success) {
        appData = { months: [], days: [] };
        indexDays();
        renderApp();
      } else {
        alert('Failed to clear schedule.');
      }
    } catch (error) {
      console.error('Error clearing schedule:', error);
    }
  };

})(jQuery, Drupal, drupalSettings, once);
