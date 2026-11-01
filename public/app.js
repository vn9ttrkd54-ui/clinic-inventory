const demo = new URLSearchParams(location.search).get('demo') === '1';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:4}).format(value);
const readableDay = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'});
const itemDialog = $('#item-dialog');
const detailDialog = $('#detail-dialog');
const stockDialog = $('#stock-dialog');
const dailyDialog = $('#daily-dialog');
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/></svg>';
let state, selectedItem, editingItem, dayData, noticeTimer, dayRequest = 0, quickDirty = false;

function apiPath(path) { return `${path}${path.includes('?')?'&':'?'}workspace=${demo?'demo':'clinic'}`; }
async function request(path, body) {
  if (globalThis.ClinicCloud) return globalThis.ClinicCloud.request(apiPath(path),body);
  const response = await fetch(apiPath(path), body === undefined ? {cache:'no-store'} : {
    method:'POST',headers:{'Content-Type':'application/json','X-Clinic-Request':'1'},body:JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete this request.');
  return result;
}
function announce(message) {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 6000);
}
function showError(error) {
  const dialog = document.querySelector('dialog[open]');
  let box = dialog?.querySelector('.dialog-error') || $('#page-error');
  if (dialog && !dialog.querySelector('.dialog-error')) {
    box = document.createElement('p');box.className = 'error dialog-error';box.setAttribute('role','alert');
    dialog.querySelector('.dialog-heading').after(box);
  }
  box.hidden = false;box.textContent = error.message || 'Unable to reach the local inventory server.';
}
function clearError() { $('#page-error').hidden = true;document.querySelectorAll('.dialog-error').forEach(box => box.remove()); }
function findItem(id) { return state.items.find(item => item.id === id); }
function statusText(item) { return item.archived?'Archived':item.status === 'out'?'Out of stock':item.status === 'low'?'Low stock':'In stock'; }
function present(dialog, returnTo) {
  document.querySelectorAll('dialog[open]').forEach(open => open.close());
  dialog.dataset.returnTo = returnTo;
  dialog.showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    if (document.querySelector('dialog[open]')) return;
    const target = dialog.dataset.returnTo && document.querySelector(dialog.dataset.returnTo);
    (target || $('#inventory-heading')).focus();
  });
}

async function refresh(message) {
  const next = await request('/api/state');
  const today = await request(`/api/day?date=${encodeURIComponent(next.today)}`);
  state = next;
  $('#today-label').textContent = readableDay(state.today);
  $('#today-label').dateTime = state.today;
  $('#demo-banner').hidden = !demo;
  $('#sample-link').hidden = demo;
  $('#workspace-label').textContent = demo?'Sample workspace':'Your inventory';
  if (!quickDirty) $('#quick-patients').value = today.patients ?? '';
  const estimates = state.items.filter(item => !item.archived && item.mode === 'patients').length;
  $('#daily-summary').textContent = estimates
    ? `Patient totals estimate usage for ${estimates} ${estimates === 1?'supply':'supplies'}.`
    : 'Log exact usage, or set up estimates in a supply’s settings.';
  renderInventory();renderActivity();
  if (message) announce(message);
}

function renderInventory() {
  const filter = $('#stock-filter').value;
  const query = $('#search').value.trim().toLowerCase();
  const active = state.items.filter(item => !item.archived);
  const attention = active.filter(item => item.status !== 'ok').length;
  $('#inventory-summary').innerHTML = active.length?`${active.length} ${active.length === 1?'supply':'supplies'} tracked <span aria-hidden="true">·</span> <span class="${attention?'attention-count':''}">${attention?`${attention} ${attention === 1?'needs':'need'} restocking`:'Everything is stocked'}</span>`:'Add your first supply to get started.';
  const items = state.items.filter(item => (filter === 'archived'?item.archived:!item.archived) &&
    (filter !== 'attention' || item.status !== 'ok') && `${item.name} ${item.location}`.toLowerCase().includes(query));
  const rank = {out:0,low:1,ok:2};
  items.sort((a,b) => rank[a.status]-rank[b.status] || a.name.localeCompare(b.name));
  $('#supply-count').textContent = items.length;
  if (!items.length) {
    const first = !state.items.length;
    $('#inventory-content').innerHTML = `<div class="empty"><h3>${first?'Let’s stock your supply room.':'No matching supplies'}</h3><p>${first?'Start with one item. Add its count, a low-stock level, and the suppliers you already use.':'Try another search or choose a different filter.'}</p>${first?`<div class="toolbar"><button class="primary-button" data-action="add-item" type="button">Add your first supply</button>${!demo?'<a class="secondary-button" href="/?demo=1">Try sample inventory</a>':''}</div>`:''}</div>`;
    return;
  }
  $('#inventory-content').innerHTML = `<div class="supply-grid">${items.map(item => {
    const suppliers = item.suppliers.filter(supplier => !supplier.archived).length;
    const name = escapeHtml(item.name);
    return `<article class="supply-card ${item.archived?'archived':item.status !== 'ok'?'attention':''}" aria-labelledby="supply-${item.id}">
      <div class="card-heading"><div><h3 id="supply-${item.id}">${name}</h3><p class="item-location">${escapeHtml(item.location || 'No location set')}</p></div><button class="icon-button" type="button" data-edit-item="${item.id}" aria-label="Edit ${name}" title="Edit supply">${editIcon}</button></div>
      <div class="stock-line"><div><div><strong class="stock-number">${number(item.remaining)}</strong><span class="stock-unit">${escapeHtml(item.unit)}</span></div><p class="stock-caption">${item.hasEstimates?'Estimated stock':'Tracked stock'}</p></div><button class="status-pill" type="button" data-open-item="${item.id}" aria-label="${escapeHtml(`${statusText(item)}: ${item.name}. View suppliers.`)}"><span class="status-dot" aria-hidden="true"></span>${statusText(item)}</button></div>
      <div class="card-meta"><span>Remind at ${number(item.threshold)} ${escapeHtml(item.unit)}</span><span>${item.mode === 'patients'?`${number(item.rate)} ${escapeHtml(item.unit)} / patient`:'Actual usage'}</span></div>
      <div class="card-actions"><button class="secondary-button supplier-button" type="button" data-open-item="${item.id}" aria-label="Suppliers for ${name}">${suppliers?`Suppliers <span>(${suppliers})</span>`:'Add suppliers'}</button>${item.archived?`<button class="secondary-button" type="button" data-archive-item="${item.id}" data-archived="false">Restore supply</button>`:`<button class="secondary-button" type="button" data-stock-item="${item.id}" aria-label="Update stock for ${name}">Update stock</button>`}</div>
    </article>`;
  }).join('')}</div>`;
}
function renderActivity() {
  $('#activity-content').innerHTML = state.activity.length?`<ol class="activity-list">${state.activity.map(entry => `<li><time datetime="${escapeHtml(entry.created_at)}">${new Date(entry.created_at).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time><div><strong>${escapeHtml(entry.kind)}${entry.item_name?`: ${escapeHtml(entry.item_name)}`:''}</strong><p>${escapeHtml(entry.detail)}</p></div></li>`).join('')}</ol>`:'<p class="activity-empty">Your saved changes will appear here.</p>';
}

function openItemForm(id) {
  editingItem = id || null;
  const item = id?findItem(id):null;
  itemDialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">Supply settings</p><h2 id="item-dialog-title">${item?'Edit supply':'Add a supply'}</h2></div><button class="close-button" type="button" data-close="item-dialog" aria-label="Close supply form">×</button></div>
    <form id="item-form"><div class="form-grid">
      <label class="span-two">Supply name<input name="name" maxlength="120" value="${escapeHtml(item?.name || '')}" placeholder="e.g. Exam gloves — medium" required autofocus></label>
      <label>Tracking unit<input name="unit" maxlength="30" value="${escapeHtml(item?.unit || 'items')}" required ${item?'readonly':''}><small>${item?'The unit stays fixed to keep history consistent.':'e.g. gloves, pairs, boxes, or rolls'}</small></label>
      ${!item?'<label>Current quantity<input name="quantity" type="number" min="0" step="any" required></label>':''}
      <label>Remind when stock reaches<input name="threshold" type="number" min="0" step="any" value="${item?.threshold ?? ''}" required><small>Use the tracking unit above.</small></label>
      <label ${item?'':'class="span-two"'}>Track usage by<select id="usage-mode" name="mode"><option value="manual" ${item?.mode !== 'patients'?'selected':''}>Entering exact daily use</option><option value="patients" ${item?.mode === 'patients'?'selected':''}>Estimating from patient totals</option></select></label>
      <label id="rate-group" class="span-two" ${item?.mode !== 'patients'?'hidden':''}>Units used per patient<input name="rate" type="number" min="0" step="any" value="${item?.rate ?? ''}" ${item?.mode === 'patients'?'required':''}><small>Use your staff’s estimate in the tracking unit above. Two pairs = four individual gloves.</small></label>
      ${!item?`<label class="span-two">Count includes usage through<input name="countThrough" type="date" max="${state.today}" value="${state.today}" required><small>Choose today for an end-of-day count, or yesterday for a start-of-day count.</small></label>`:''}
    </div><details class="optional-settings"><summary>Storage &amp; packaging</summary><div class="form-grid"><label>Storage location<input name="location" maxlength="120" value="${escapeHtml(item?.location || '')}" placeholder="e.g. Cabinet 2"></label><label>Units per pack<input name="packSize" type="number" min="0.0001" step="any" value="${item?.pack_size ?? 1}" required><small>For reference; counts still use the tracking unit.</small></label></div></details>
    <p class="form-error" role="alert" hidden></p><div class="form-actions">${item?`<button class="${item.archived?'secondary-button':'danger-button'}" type="button" data-archive-item="${item.id}" data-archived="${!item.archived}">${item.archived?'Restore supply':'Archive'}</button>`:''}<button class="secondary-button" type="button" data-close="item-dialog">Cancel</button><button class="primary-button" type="submit">${item?'Save changes':'Add supply'}</button></div></form>`;
  present(itemDialog, id?`[data-edit-item="${id}"]`:'[data-action="add-item"]');
}

function renderDetail(focusTitle = false) {
  const item = findItem(selectedItem);
  const suppliers = item.suppliers.filter(supplier => !supplier.archived);
  const archived = item.suppliers.filter(supplier => supplier.archived);
  detailDialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">Saved suppliers</p><h2 id="detail-dialog-title" tabindex="-1">${escapeHtml(item.name)}</h2><p class="secondary">Choose a supplier to reopen its website.</p></div><button class="close-button" type="button" data-close="detail-dialog" aria-label="Close suppliers">×</button></div>
    <div class="dialog-stock ${item.status !== 'ok'?'attention':''}"><strong>${number(item.remaining)} ${escapeHtml(item.unit)}</strong><span>${statusText(item)} · Remind at ${number(item.threshold)}</span></div>
    ${suppliers.length?`<ul class="suppliers">${suppliers.map(supplier => `<li><div><a class="supplier-link" href="${escapeHtml(supplier.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(supplier.name)}<span class="external-arrow" aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a><span class="supplier-host">${escapeHtml(new URL(supplier.url).hostname)}</span></div><button class="quiet-button" type="button" data-archive-supplier="${supplier.id}" aria-label="Archive ${escapeHtml(supplier.name)}">Archive</button></li>`).join('')}</ul>`:'<p class="help">No suppliers yet. Save a company website or product link below.</p>'}
    <details class="add-supplier-section" ${!suppliers.length?'open':''}><summary>${suppliers.length?'Add another supplier':'Add a supplier'}</summary><form id="supplier-form" class="add-supplier"><div class="form-grid"><label>Company name<input name="name" maxlength="80" placeholder="e.g. Company A" required></label><label>Website or product link<input name="url" type="url" maxlength="2048" placeholder="https://…" required></label></div><p class="form-error" role="alert" hidden></p><div class="inline-actions"><button class="primary-button" type="submit">Save supplier</button></div></form></details>
    ${archived.length?`<details class="archived-links"><summary>Archived links (${archived.length})</summary><ul>${archived.map(supplier => `<li>${escapeHtml(supplier.name)} <button class="quiet-button" type="button" data-restore-supplier="${supplier.id}">Restore</button></li>`).join('')}</ul></details>`:''}`;
  if (focusTitle) $('#detail-dialog-title').focus();
}
function openDetail(id) {
  selectedItem = id;renderDetail();present(detailDialog, `[data-open-item="${id}"]`);
  $('#detail-dialog-title').focus();
}
function openStock(id) {
  selectedItem = id;
  const item = findItem(id);
  stockDialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">Update stock</p><h2 id="stock-dialog-title">${escapeHtml(item.name)}</h2></div><button class="close-button" type="button" data-close="stock-dialog" aria-label="Close stock update">×</button></div>
    <div class="dialog-stock ${item.status !== 'ok'?'attention':''}"><strong>${number(item.remaining)} ${escapeHtml(item.unit)}</strong><span>Currently tracked${item.hasEstimates?' · estimated':''}</span></div>
    ${item.shortfall?`<p class="shortfall">Recorded usage exceeds stock by ${number(item.shortfall)} ${escapeHtml(item.unit)}. Count the shelf to correct it.</p>`:''}
    <form id="stock-form"><fieldset class="stock-options"><legend>What changed?</legend><label class="stock-option"><input type="radio" name="operation" value="delivery" checked><span><strong>Received supplies</strong><small>Add a delivery to your stock</small></span></label><label class="stock-option"><input type="radio" name="operation" value="count"><span><strong>Counted the shelf</strong><small>Replace with a physical count</small></span></label></fieldset>
    <label><span id="stock-quantity-label">Quantity received (${escapeHtml(item.unit)})</span><input id="stock-quantity" name="quantity" type="number" min="0.0001" step="any" required></label>
    <div id="count-date-group" hidden><label>Count includes usage through<input name="countThrough" type="date" value="${state.today}" max="${state.today}"></label><p class="help">Choose today if this count includes today’s use, or yesterday for a start-of-day count. Later usage is subtracted; later deliveries are added.</p></div>
    <p class="count-note">Last physical count: ${number(item.baseline)} ${escapeHtml(item.unit)} · includes usage through ${readableDay(item.count_through)}.</p>
    <p class="form-error" role="alert" hidden></p><div class="form-actions"><button class="secondary-button" type="button" data-close="stock-dialog">Cancel</button><button id="stock-save" class="primary-button" type="submit">Add delivery</button></div></form>`;
  present(stockDialog, `[data-stock-item="${id}"]`);
}
function updateStockFields() {
  const count = $('#stock-form input[name="operation"]:checked').value === 'count';
  const item = findItem(selectedItem);
  $('#stock-quantity-label').textContent = `${count?'Quantity counted':'Quantity received'} (${item.unit})`;
  $('#stock-quantity').min = count?'0':'0.0001';
  $('#count-date-group').hidden = !count;
  $('#count-date-group input').required = count;
  $('#stock-save').textContent = count?'Save count':'Add delivery';
}

async function loadDay(day) {
  const token = ++dayRequest;
  const result = await request(`/api/day?date=${encodeURIComponent(day)}`);
  if (token !== dayRequest) return;
  dayData = result;
  const items = state.items.filter(item => !item.archived);
  $('#daily-content').innerHTML = `<form id="daily-form"><div class="daily-top"><label>Date<input id="usage-date" type="date" name="day" value="${day}" max="${state.today}" required></label><label>Daily patient total<input id="patient-total" name="patients" type="number" min="0" max="10000" step="1" value="${result.patients ?? ''}" placeholder="Optional"></label></div><p class="help">Enter the amount used, not the amount left. Exact use replaces that item’s patient estimate for this date. Leave it blank to use the estimate. Saving a date again updates its entry.</p>${items.length?items.map(item => {
    const actual = result.actuals.find(row => row.item_id === item.id);
    return `<div class="usage-row"><div><strong>${escapeHtml(item.name)}</strong><span id="estimate-${item.id}"></span>${day <= item.count_through?'<span>Already included in the latest physical count.</span>':''}</div><label>Actual use (${escapeHtml(item.unit)})<input type="number" min="0" step="any" aria-label="Actual use (${escapeHtml(item.unit)}) for ${escapeHtml(item.name)}" data-actual="${item.id}" value="${actual?.quantity ?? ''}" placeholder="Optional"></label></div>`;
  }).join(''):'<p class="help">Add a supply before logging its usage.</p>'}<p class="form-error" role="alert" hidden></p><div class="form-actions"><button class="secondary-button" type="button" data-close="daily-dialog">Cancel</button><button class="primary-button" type="submit">Save usage</button></div></form>`;
  updateEstimates();
}
function updateEstimates() {
  const field = $('#patient-total');
  if (!field) return;
  const total = field.value === ''?null:Number(field.value);
  for (const item of state.items.filter(item => !item.archived)) {
    const existing = dayData.estimates.find(row => row.item_id === item.id);
    const label = $(`#estimate-${item.id}`);
    if (!label) continue;
    const rate = existing?.rate ?? item.rate;
    label.textContent = existing || item.mode === 'patients'
      ? total === null?'No patient estimate without a daily total.':`Estimate: ${number(Math.round(total*rate*10000)/10000)} ${item.unit} · ${number(rate)} per patient`
      : 'Exact usage only';
  }
}
function exportInventory() {
  const safe = value => {
    let text = String(value ?? '');if (/^[=+@\t\r-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g,'""')}"`;
  };
  const rows = [['Supply','Unit','Tracked quantity','Reminder level','Status','Location','Usage method','Usage per patient','Count includes usage through','Supplier links'],...state.items.filter(item => !item.archived).map(item => [item.name,item.unit,item.remaining,item.threshold,statusText(item),item.location,item.mode,item.rate,item.count_through,item.suppliers.filter(s => !s.archived).map(s => `${s.name}: ${s.url}`).join(' | ')])];
  const blob = new Blob([rows.map(row => row.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);const link = document.createElement('a');link.href = url;link.download = `${demo?'sample-':''}clinic-inventory-${state.today}.csv`;document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button');if (!button) return;
  if (button.closest('[data-cloud-ui]')) return;
  clearError();
  try {
    if (button.dataset.close) $(`#${button.dataset.close}`).close();
    else if (button.dataset.action === 'refresh') await refresh('Inventory refreshed.');
    else if (!state) throw new Error('Inventory is still loading. Use Refresh to try again.');
    else if (button.dataset.openItem) openDetail(button.dataset.openItem);
    else if (button.dataset.stockItem) openStock(button.dataset.stockItem);
    else if (button.dataset.editItem) openItemForm(button.dataset.editItem);
    else if (button.dataset.archiveSupplier || button.dataset.restoreSupplier) {
      button.disabled = true;
      const id = button.dataset.archiveSupplier || button.dataset.restoreSupplier;
      await request(`/api/suppliers/${id}/archive`,{archived:!!button.dataset.archiveSupplier});
      await refresh('Supplier list updated.');renderDetail(true);
    } else if (button.dataset.archiveItem) {
      button.disabled = true;
      const archived = button.dataset.archived === 'true';
      await request(`/api/items/${button.dataset.archiveItem}/archive`,{archived});
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      await refresh(archived?'Supply archived. You can restore it with the Archived supplies filter.':'Supply restored.');
      $('#inventory-heading').focus();
    } else if (button.dataset.action === 'add-item') openItemForm();
    else if (button.dataset.action === 'daily') {
      button.disabled = true;await loadDay(state.today);present(dailyDialog,'[data-action="daily"]');
    } else if (button.dataset.action === 'export') exportInventory();
  } catch (error) { showError(error); }
  finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['item-form','supplier-form','stock-form','daily-form','quick-day-form'].includes(form.id)) return;
  event.preventDefault();clearError();
  const errorBox = form.querySelector('.form-error');errorBox.hidden = true;
  const buttons = Array.from(form.querySelectorAll('button'));buttons.forEach(button => button.disabled = true);
  const values = Object.fromEntries(new FormData(form));
  let saved = false;
  try {
    if (form.id === 'item-form') {
      const id = editingItem;
      const result = await request(id?`/api/items/${id}`:'/api/items',values);saved = true;
      await refresh(id?'Supply settings saved.':'Supply added. You can save its suppliers here.');
      itemDialog.close();
      if (!id) openDetail(result.id);
    } else if (form.id === 'supplier-form') {
      await request(`/api/items/${selectedItem}/suppliers`,values);saved = true;
      await refresh('Supplier saved.');renderDetail(true);
    } else if (form.id === 'stock-form') {
      const count = values.operation === 'count';
      await request(`/api/items/${selectedItem}/${count?'count':'deliveries'}`,{quantity:values.quantity,countThrough:values.countThrough});
      saved = true;
      await refresh(count?'Physical count saved.':'Delivery added to stock.');
      stockDialog.close();
    } else if (form.id === 'daily-form') {
      const actuals = Array.from(form.querySelectorAll('[data-actual]')).map(input => ({itemId:input.dataset.actual,quantity:input.value === ''?null:Number(input.value)}));
      await request('/api/day',{day:values.day,patients:values.patients === ''?null:Number(values.patients),actuals});
      saved = true;quickDirty = false;
      await refresh('Usage saved. Your stock is up to date.');
      dailyDialog.close();
    } else if (form.id === 'quick-day-form') {
      // Omitted actual entries stay untouched: this updates only the patient total and estimates.
      await request('/api/day',{day:state.today,patients:Number(values.patients),actuals:[]});
      saved = true;quickDirty = false;
      await refresh('Patient total saved. Stock estimates updated.');
    }
  } catch (error) {
    if (saved) {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      showError(new Error('Your change was saved, but the display could not refresh. Use Refresh to load the latest inventory.'));
    } else { errorBox.hidden = false;errorBox.textContent = error.message || 'Unable to save. Please try again.'; }
  } finally {
    buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
    if (saved && form.id === 'quick-day-form') form.querySelector('button[type="submit"]').focus();
  }
});

$('#search').addEventListener('input', () => state && renderInventory());
$('#stock-filter').addEventListener('change', () => state && renderInventory());
$('#quick-patients').addEventListener('input', () => { quickDirty = true; });
document.addEventListener('input', event => { if (event.target.id === 'patient-total') updateEstimates(); });
document.addEventListener('change', async event => {
  if (event.target.id === 'usage-mode') {
    const patients = event.target.value === 'patients';
    $('#rate-group').hidden = !patients;$('#rate-group input').required = patients;
  }
  if (event.target.name === 'operation') updateStockFields();
  if (event.target.id === 'usage-date') {
    if (!event.target.value) return;
    try { await loadDay(event.target.value);$('#usage-date').focus(); } catch (error) { showError(error); }
  }
});
if (globalThis.ClinicCloud) {
  globalThis.ClinicCloud.start(() => refresh(), () => {
    state = null;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    for (const id of ['inventory-content','activity-content','daily-content']) $(`#${id}`).replaceChildren();
    for (const dialog of [itemDialog,detailDialog,stockDialog]) dialog.replaceChildren();
    $('#quick-patients').value = '';
    $('#inventory-summary').textContent = '';
    $('#notice').textContent = '';
  }).catch(showError);
} else refresh().catch(showError);
