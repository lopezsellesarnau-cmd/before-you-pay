const FILES = {
  listing3c: new URL('../examples/argumosa-3c.listing.txt', import.meta.url),
  listing3: new URL('../examples/argumosa-3.listing.txt', import.meta.url),
  '3c': new URL('../examples/argumosa-3c.report.json', import.meta.url),
  question: new URL('../examples/argumosa-3.question.report.json', import.meta.url),
  answered: new URL('../examples/argumosa-3.answered.report.json', import.meta.url),
};

const state = {
  step: 1,
  draft: '',
  listingText: '',
  listingName: '',
  contractText: '',
  contractPdfBase64: '',
  contractName: '',
  otherName: '',
  photoText: '',
  photos: [],
  samples: {},
  reports: {},
  reportKey: null,
  answers: {},
  history: [],
  activeHistory: null,
  slot: null,
  editingSlot: null,
  editingOriginal: null,
  mode: 'ui',
  playing: false,
  visible: 0,
  reveal: 0,
  openSteps: new Set(),
  openTerms: new Set(),
  termFull: new Set(),
  thoughtOpen: false,
  planOpen: false,
  sourceAt: 0,
  doorNote: '',
  checkError: '',
  checkStatus: '',
  /* True only while a live check is playing. Saved reports keep the canned line. */
  liveRun: false,
  loadError: '',
  side: 'open',
  /* Sidebar width the user had before a run. Collapse is only for the working state. */
  sideBefore: null,
};

let token = 0;
let traceEnter = false;
let planEnter = false;
let expandEnter = null;
let termEnter = null;
let folding = false;
let sideClosing = false;
let askScroll = 0;
let diagramNow = null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function boot() {
  try {
    const [a, b, c, d, e] = await Promise.all([
      fetch(FILES.listing3c).then((r) => r.text()),
      fetch(FILES.listing3).then((r) => r.text()),
      fetch(FILES['3c']).then((r) => r.json()),
      fetch(FILES.question).then((r) => r.json()),
      fetch(FILES.answered).then((r) => r.json()),
    ]);
    state.samples = { '3c': a, '3': b };
    state.reports = { '3c': c, question: d, answered: e };
  } catch (err) {
    state.loadError = 'The saved listings could not be loaded. Open this page from the project server (npm run ui).';
    console.error(err);
  }
  paint();
  bind();
  runScene();
}

function bind() {
  document.body.addEventListener('click', onClick);
  document.body.addEventListener('input', onInput);
  document.body.addEventListener('keydown', onKey);
  document.body.addEventListener('dragover', (e) => {
    const zone = e.target.closest?.('.drop');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('over');
  });
  document.body.addEventListener('dragleave', (e) => e.target.closest?.('.drop')?.classList.remove('over'));
  document.body.addEventListener('drop', onDrop);
  $('file-listing').addEventListener('change', (e) => readFile(e.target.files[0], 'listing'));
  $('file-contract').addEventListener('change', (e) => readFile(e.target.files[0], 'contract'));
  window.addEventListener('resize', drawFlow);
  window.addEventListener('resize', layoutPixelBars);
  $('file-other').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.otherName = file.name;
    paint();
  });
  window.addEventListener('resize', placeSpot);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCite(true);
    if (!$('stage') || !report()) return;
    if (e.key === 'ArrowRight') stepSource(1);
    if (e.key === 'ArrowLeft') stepSource(-1);
  });
  // Citation previews: hover or focus a marker, leave or blur to close.
  document.body.addEventListener('mouseover', (e) => {
    const chip = e.target.closest?.('.chip[data-fact]');
    if (chip) showCite(chip);
  });
  document.body.addEventListener('mouseout', (e) => {
    const chip = e.target.closest?.('.chip[data-fact]');
    if (chip && !e.relatedTarget?.closest?.('#cite-card')) hideCite();
  });
  document.body.addEventListener('focusin', (e) => {
    const chip = e.target.closest?.('.chip[data-fact]');
    if (chip) showCite(chip);
  });
  document.body.addEventListener('focusout', (e) => {
    const chip = e.target.closest?.('.chip[data-fact]');
    if (chip) hideCite();
    if (e.target.id === 'slot-edit' && state.editingSlot) {
      saveSlotEdit(e.target.dataset.id, e.target.value, { commit: true });
    }
  });
  $('frame').addEventListener('scroll', () => hideCite(true), { passive: true });
  // Slot field ↔ region hover sync (delegation survives paintSlots rebuilds).
  document.body.addEventListener('pointerover', onSlotHover);
  document.body.addEventListener('pointerout', onSlotUnhover);
}

function onClick(e) {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.stopPropagation();
    navigator.clipboard?.writeText(copy.dataset.copy);
    copy.textContent = 'Copied';
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'sample') loadSample(el.dataset.id);
  if (action === 'pick-listing') $('file-listing').click();
  if (action === 'pick-contract') $('file-contract').click();
  if (action === 'clear-listing') {
    state.listingText = '';
    state.listingName = '';
    state.draft = '';
    state.slot = null;
    state.editingSlot = null;
    state.editingOriginal = null;
    paint();
  }
  if (action === 'edit-listing') {
    // Dismiss overlay: listingText gates slotsHtml vs draft textarea (uploadHtml).
    state.draft = state.listingText || state.draft;
    state.listingText = '';
    state.slot = null;
    state.editingSlot = null;
    state.editingOriginal = null;
    paint();
  }
  if (action === 'clear-contract') {
    state.contractText = '';
    state.contractPdfBase64 = '';
    state.contractName = '';
    paint();
  }
  if (action === 'pick-other') $('file-other').click();
  if (action === 'clear-other') {
    state.otherName = '';
    paint();
  }
  if (action === 'generate') {
    if (!state.listingText && state.draft.trim()) {
      state.listingText = state.draft;
      state.listingName = state.listingName || 'Pasted listing';
    }
    generate();
  }
  if (action === 'new') {
    token += 1;
    releaseSidebar();
    state.step = 1;
    state.listingText = '';
    state.listingName = '';
    state.contractText = '';
    state.contractPdfBase64 = '';
    state.contractName = '';
    state.otherName = '';
    state.draft = '';
    state.photoText = '';
    state.photos = [];
    state.reportKey = null;
    state.answers = {};
    state.activeHistory = null;
    state.playing = false;
    state.reveal = 0;
    state.doorNote = '';
    state.checkError = '';
    state.stageEntered = false;
    state.slot = null;
    state.editingSlot = null;
    state.editingOriginal = null;
    paint();
  }
  if (action === 'open-history') openHistory(el.dataset.id);
  if (action === 'slot') {
    const needPaint = state.editingSlot != null;
    state.slot = el.dataset.id;
    state.editingSlot = null;
    state.editingOriginal = null;
    if (needPaint) paintSlots();
    else applySlotSelection(el.dataset.id);
  }
  if (action === 'edit-slot') {
    state.slot = el.dataset.id;
    state.editingSlot = el.dataset.id;
    const slots = slotsFrom(state.listingText);
    state.editingOriginal = slots.find((s) => s.id === el.dataset.id)?.quote ?? null;
    paintSlots();
    const input = $('slot-edit');
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }
  if (action === 'mode') {
    state.mode = el.dataset.mode;
    document.querySelectorAll('.mode button').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.mode === state.mode);
    });
    paintTrace();
  }
  if (action === 'side') {
    const opening = state.side === 'rail';
    state.side = opening ? 'open' : 'rail';
    /* A toggle during the run is a preference, so settle restores that choice. */
    if (state.playing) state.sideBefore = state.side;
    if (!opening && !reduced) {
      collapseSidebar();
      return;
    }
    sideClosing = false;
    paintSidebar();
  }
  if (action === 'thought' && !state.playing) {
    const opening = !state.thoughtOpen;
    el.querySelector('.chev')?.classList.toggle('open', opening);
    if (!opening) {
      closeThen('#trace [data-disclose="trace"]', () => {
        state.thoughtOpen = false;
        paintTrace();
      });
      return;
    }
    state.thoughtOpen = true;
    traceEnter = true;
    paintTrace();
    armDisclose('#trace [data-disclose="trace"]');
    traceEnter = false;
    return;
  }
  if (action === 'plan' && !state.playing) {
    const opening = !state.planOpen;
    if (!opening && waitingOnYou()) return;
    el.querySelector('.chev')?.classList.toggle('open', opening);
    if (!opening) {
      closeThen('[data-disclose="plan"]', () => {
        state.planOpen = false;
        paintSidebar();
      });
      return;
    }
    state.planOpen = true;
    planEnter = true;
    paintSidebar();
    armDisclose('[data-disclose="plan"]');
    planEnter = false;
    return;
  }
  if (action === 'expand') {
    const key = el.dataset.step;
    const opening = !state.openSteps.has(key);
    el.querySelector('.chev')?.classList.toggle('open', opening);
    if (!opening) {
      closeThen(`[data-step-panel="${key}"]`, () => toggleSet(state.openSteps, key));
      return;
    }
    expandEnter = key;
    toggleSet(state.openSteps, key);
    armDisclose(`[data-step-panel="${key}"]`);
    expandEnter = null;
    return;
  }
  if (action === 'term') {
    const key = el.dataset.step;
    const opening = !state.openTerms.has(key);
    if (!opening) {
      closeThen(`[data-term-panel="${key}"]`, () => toggleSet(state.openTerms, key));
      return;
    }
    termEnter = key;
    toggleSet(state.openTerms, key);
    armDisclose(`[data-term-panel="${key}"]`);
    termEnter = null;
    return;
  }
  if (action === 'term-full') {
    state.termFull.add(el.dataset.step);
    paintTrace();
  }
  if (action === 'replay') generate();
  if (action === 'cite') {
    const facts = citedFacts();
    const i = facts.findIndex((f) => f.id === el.dataset.fact);
    if (i >= 0) {
      state.sourceAt = i;
      paintStage();
      document.querySelector('.sv')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }
  }
  if (action === 'source-step') stepSource(Number(el.dataset.dir));
  if (action === 'door') chooseDoor(el.dataset.value);
}

function onInput(e) {
  if (e.target.id === 'slot-edit') {
    saveSlotEdit(e.target.dataset.id, e.target.value, { commit: false });
    return;
  }
  if (e.target.id === 'photos') {
    state.photoText = e.target.value;
    state.photos = parsePhotoUrls(e.target.value).urls;
    const hint = $('photo-hint');
    if (hint) hint.textContent = photoHint();
    return;
  }
  if (e.target.id !== 'draft') return;
  state.draft = e.target.value;
  $('go')?.toggleAttribute('disabled', !e.target.value.trim() && !state.listingText);
  if (looksLikeListing(e.target.value)) {
    state.listingText = e.target.value;
    state.listingName = 'Pasted listing';
    state.slot = null;
    paint();
  }
}

function onKey(e) {
  if (e.target.id !== 'slot-edit') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    saveSlotEdit(e.target.dataset.id, e.target.value, { commit: true });
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    revertSlotEdit();
  }
}

function onDrop(e) {
  const zone = e.target.closest?.('.drop');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('over');
  readFile(e.dataTransfer.files?.[0], zone.dataset.kind);
}

function isPdf(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function readFile(file, kind) {
  if (!file) return;
  if (kind === 'other') {
    state.otherName = file.name;
    paint();
    return;
  }
  const pdf = isPdf(file);
  if (pdf && kind !== 'contract') return;
  const reader = new FileReader();
  reader.onload = () => {
    const raw = String(reader.result || '');
    if (kind === 'contract' && pdf) {
      const comma = raw.indexOf(',');
      state.contractName = file.name;
      state.contractText = '';
      state.contractPdfBase64 = comma >= 0 ? raw.slice(comma + 1) : '';
    } else if (kind === 'contract') {
      state.contractName = file.name;
      state.contractText = raw;
      state.contractPdfBase64 = '';
    } else {
      state.listingName = file.name;
      state.listingText = raw;
      state.draft = raw;
      state.slot = null;
    }
    paint();
  };
  if (pdf) reader.readAsDataURL(file);
  else reader.readAsText(file);
}

function loadSample(id) {
  state.listingText = state.samples[id] || '';
  state.listingName = id === '3c' ? 'argumosa-3c.listing.txt' : 'argumosa-3.listing.txt';
  state.draft = state.listingText;
  state.slot = null;
  state.answers = {};
  state.doorNote = '';
  paint();
}

function looksLikeListing(text) {
  return text.trim().length > 80 || /€|m2|fianza|calle/i.test(text);
}

function chooseDoor(value) {
  const question = report()?.questions?.[0];
  const key = question?.attribute || 'address.door';
  state.answers = { ...state.answers, [key]: value };
  state.doorNote = '';
  generate();
}

function openHistory(id) {
  const item = state.history.find((h) => h.id === id);
  if (!item) return;
  token += 1;
  releaseSidebar();
  state.activeHistory = id;
  state.listingText = item.listingText;
  state.listingName = item.listingName;
  state.contractText = item.contractText;
  state.contractPdfBase64 = item.contractPdfBase64 || '';
  state.contractName = item.contractName;
  state.photoText = item.photoText || '';
  state.photos = parsePhotoUrls(state.photoText).urls;
  state.answers = { ...item.answers };
  state.reportKey = item.reportKey;
  state.step = 2;
  state.playing = false;
  state.liveRun = false;
  state.visible = report().trace.length;
  state.reveal = 99;
  state.doorNote = '';
  state.thoughtOpen = false;
  state.planOpen = false;
  paint();
}

function report() {
  return state.reports[state.reportKey] || null;
}

function holdSidebar() {
  if (state.sideBefore == null) state.sideBefore = state.side;
  state.side = 'rail';
}

function releaseSidebar() {
  if (state.sideBefore == null) return;
  state.side = state.sideBefore;
  state.sideBefore = null;
}

async function generate() {
  const mine = ++token;
  const listing = (state.listingText || state.draft || '').trim();
  if (!listing) return;
  if (!state.listingText) {
    state.listingText = listing;
    state.listingName = state.listingName || 'Pasted listing';
  }
  state.checkError = '';
  state.liveRun = false;
  holdSidebar();
  state.reportKey = null;
  state.step = 2;
  state.playing = true;
  state.visible = 0;
  diagramNow = null;
  state.reveal = 0;
  state.openSteps = new Set();
  state.openTerms = new Set();
  state.termFull = new Set();
  state.thoughtOpen = true;
  state.planOpen = false;
  state.sourceAt = 0;
  state.doorNote = '';
  state.checkStatus = state.photos.length
    ? 'I’m checking the listing and the photos. Each photo adds about a minute…'
    : 'I’m checking the listing. The checker may take a minute to wake…';
  state.stageEntered = false;
  paint();
  let rep;
  let streamed = false;
  const stubId = `live-${mine}`;

  async function walkEntry(index) {
    const current = report();
    if (!current) return;
    state.visible = index;
    const entry = current.trace[index - 1];
    if (isFailure(entry)) state.openTerms.add(String(index - 1));
    const path = freshStages(entry, current.trace.slice(0, index - 1));
    const steps = path.length > 1 && !reduced ? path : [path.at(-1) || stageOf(entry)];
    for (let s = 0; s < steps.length; s++) {
      if (mine !== token) return;
      diagramNow = steps[s];
      if (s === 0) {
        paintTrace();
        paintGeo();
      }
      paintWorkflow();
      if (s < steps.length - 1) await sleep(280);
    }
  }

  async function consumeLive(res) {
    const stub = {
      runId: stubId,
      provider: 'live',
      trace: [],
      findings: [],
      questions: [],
      facts: [],
      sources: [],
      summary: {},
    };
    state.reports[stubId] = stub;
    state.reportKey = stubId;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let final = null;
    const take = async (line) => {
      if (!line || mine !== token) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        throw new Error('The checker sent a step the page could not read.');
      }
      if (msg.type === 'error') throw new Error(msg.error || 'The check failed.');
      if (msg.type === 'trace' && msg.entry) {
        stub.trace.push(msg.entry);
        await walkEntry(stub.trace.length);
      } else if (msg.type === 'report') final = msg.report;
    };
    try {
      while (mine === token) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: !done });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          await take(line);
        }
        if (done) break;
      }
      if (buf.trim() && mine === token) await take(buf.trim());
    } finally {
      reader.cancel().catch(() => {});
      delete state.reports[stubId];
      if (state.reportKey === stubId) state.reportKey = null;
    }
    if (mine !== token) return null;
    if (!final || !Array.isArray(final.trace)) throw new Error('The checker did not return a report.');
    return final;
  }

  try {
    const payload = { listing: state.listingText };
    if (state.photos.length) payload.photos = state.photos;
    if (state.contractPdfBase64) payload.contractPdfBase64 = state.contractPdfBase64;
    else if (state.contractText) payload.contract = state.contractText;
    if (Object.keys(state.answers).length) payload.answers = state.answers;
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
    });
    if (mine !== token) return;
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok) {
      const data = ctype.includes('json') ? await res.json().catch(() => ({})) : {};
      throw new Error(data.error || 'The check failed.');
    }
    state.liveRun = true;
    if (ctype.includes('application/x-ndjson') && res.body) {
      rep = await consumeLive(res);
      if (mine !== token || !rep) return;
      streamed = true;
    } else {
      const data = await res.json();
      if (!Array.isArray(data.trace)) throw new Error('The checker did not return a report.');
      rep = data;
    }
  } catch (err) {
    if (mine !== token) return;
    delete state.reports[stubId];
    if (state.reportKey === stubId) state.reportKey = null;
    state.playing = false;
    state.liveRun = false;
    releaseSidebar();
    state.checkError = err instanceof Error ? err.message : 'The check failed.';
    state.step = 1;
    paint();
    return;
  }
  if (mine !== token) return;
  const id = `${rep.runId || 'live'}-${state.answers['address.door'] || ''}`;
  state.reports[id] = rep;
  state.reportKey = id;
  const shown = streamed ? state.visible : 0;
  if (!streamed) paint();
  const delays = streamed ? null : pace(rep.trace);
  for (let i = shown + 1; i <= rep.trace.length; i++) {
    if (mine !== token) return;
    if (delays) await sleep(delays[i - 1]);
    if (mine !== token) return;
    await walkEntry(i);
  }
  if (mine !== token) return;
  diagramNow = null;
  state.playing = false;
  state.liveRun = false;
  state.thoughtOpen = false;
  state.reveal = 0;
  releaseSidebar();
  paintSidebar();
  paintStage();
  const total = revealCount();
  for (let i = 1; i <= total; i++) {
    if (mine !== token) return;
    await sleep(reduced ? 0 : 40);
    state.reveal = i;
    document.querySelectorAll(`[data-reveal="${i}"]`).forEach((el) => {
      el.classList.remove('hold');
      // Bars are built while this section is still held. Start the stagger
      // now, so cells stack up on screen instead of arriving already full.
      if (el.querySelector?.('.segments, .col-bar')) {
        layoutPixelBars();
        el.querySelectorAll('.segments, .col-bar').forEach(replayBar);
      }
    });
  }
  if (mine !== token) return;
  await sleep(reduced ? 0 : 340);
  if (mine !== token) return;
  document.querySelector('.report')?.classList.add('settled');
  remember();
}

function remember() {
  const rep = report();
  if (!rep) return;
  const title = (state.listingText.split('\n').find((l) => l.trim()) || 'Report').slice(0, 28);
  const id = `${rep.runId}-${state.answers['address.door'] || ''}`;
  state.history = state.history.filter((h) => h.id !== id);
  state.history.unshift({
    id,
    title,
    reportKey: state.reportKey,
    listingText: state.listingText,
    listingName: state.listingName,
    contractText: state.contractText,
    contractPdfBase64: state.contractPdfBase64,
    contractName: state.contractName,
    photoText: state.photoText,
    answers: { ...state.answers },
  });
  state.activeHistory = id;
  paintSidebar();
}

function pace(trace) {
  if (reduced || trace.length < 2) return trace.map(() => 0);
  const t0 = Date.parse(trace[0].t);
  const span = Math.max(1, Date.parse(trace.at(-1).t) - t0);
  const scale = Math.min(1, 6800 / span);
  return trace.map((entry, i) => {
    const prev = i === 0 ? t0 : Date.parse(trace[i - 1].t);
    return Math.max(220, Math.min(700, (Date.parse(entry.t) - prev) * scale));
  });
}

function paint() {
  $('app').classList.toggle('rail', state.side === 'rail');
  paintSidebar();
  const frame = $('frame');
  frame.classList.remove('centered');
  frame.innerHTML = state.step === 1 ? uploadHtml() : '<div id="stage"></div>';
  if (state.step === 2) paintStage();
  mountScene();
  placeSpot();
}

function paintSidebar() {
  const hadAsk = !!$('sidebar').querySelector('.side-ask');
  const app = $('app');
  const wasRail = app.classList.contains('rail');
  app.classList.toggle('rail', state.side === 'rail');
  app.classList.toggle('wide', sideWide());
  const side = $('sidebar');
  side.classList.toggle('is-rail', state.side === 'rail');
  side.classList.remove('side-leave');
  const opened = wasRail && state.side !== 'rail' && !reduced;
  if (state.side === 'rail') {
    const buttons = [
      `<button type="button" class="rail-btn ${state.step === 1 ? 'on' : ''}" data-action="new" title="New report" aria-label="New report">${icon('compose')}</button>`,
      `<button type="button" class="rail-btn ${state.step === 2 ? 'on' : ''}" data-action="side" title="Reports" aria-label="Reports">${icon('reports')}</button>`,
    ];
    // Only after the run. While playing, do not render the rail status control at all.
    if (state.step === 2 && state.playing !== true) {
      buttons.push(`<button type="button" class="rail-btn" data-action="side" title="Reasoning" aria-label="Show reasoning">${icon('check')}</button>`);
    }
    $('sidebar').innerHTML = `
      <button type="button" class="mark" data-action="side" aria-label="Expand sidebar">${icon('mark')}</button>
      <nav class="nav rail-nav">${buttons.join('')}</nav>`;
    $('sidebar').querySelectorAll('button.rail-btn[title="Checking"], button.rail-btn[aria-label="Checking this listing"]').forEach((el) => el.remove());
    if (opened) armSide(side);
    return;
  }
  const items = state.history.map((h) => reportRow(h.title, verdictLabel(state.reports[h.reportKey]), h.id === state.activeHistory, `data-action="open-history" data-id="${esc(h.id)}"`)).join('');
  const label = listingTitle();
  const pending = state.step === 2 && label && !state.history.some((h) => h.id === state.activeHistory && h.listingText === state.listingText)
    ? reportRow(label, verdictLabel(report()), true, '')
    : '';
  const count = state.history.length + (pending ? 1 : 0);
  const rep = report();
  const planShown = waitingOnYou() || state.planOpen;
  /* While a run is playing, the trace lives in the main column. Don't mirror it here. */
  const trace = state.step === 2 && !state.playing ? `
    <div class="side-tools">
      ${state.playing ? '' : replayBtn()}
      <button type="button" class="nav-item plan-head ${planShown ? 'on' : ''}" data-action="plan" aria-expanded="${planShown}" aria-label="Agentic workflow">
        <span class="nav-ico chev ${planShown ? 'open' : ''}">${icon('chev')}</span>
        <span>Agentic workflow</span>
      </button>
      ${planShown ? `<div class="disclose ${planEnter && !reduced ? '' : 'in'}" data-disclose="plan"><div class="disclose-body"><div id="workflow">${workflowHtml()}</div></div></div>` : ''}
      ${waitingOnYou() && sideWide() ? `<div class="side-ask">${questionHtml(rep.questions[0])}</div>` : ''}
      <div class="mode" role="tablist" aria-label="UI or terminal">
        <button type="button" data-action="mode" data-mode="ui" class="${state.mode === 'ui' ? 'on' : ''}">UI</button>
        <button type="button" data-action="mode" data-mode="terminal" class="${state.mode === 'terminal' ? 'on' : ''}">Terminal</button>
      </div>
      <div class="trace-block" id="trace">${traceHtml()}</div>
    </div>` : '';
  $('sidebar').innerHTML = `
    <div class="brand">
      <span class="mark">${icon('mark')}</span>
      <span class="brand-name">Casa</span>
      <button type="button" class="side-toggle" data-action="side" aria-label="Collapse sidebar">${icon('panel')}</button>
    </div>
    <nav class="nav">
      <button type="button" class="nav-item ${state.step === 1 ? 'on' : ''}" data-action="new"><span class="nav-ico">${icon('compose')}</span><span>New report</span></button>
      <button type="button" class="nav-item ${state.step === 2 ? 'on' : ''}" data-action="open-history" data-id="${esc(state.activeHistory || state.history[0]?.id || '')}" ${count ? '' : 'disabled'}><span class="nav-ico">${icon('reports')}</span><span>Reports</span>${count ? `<span class="count">${count}</span>` : ''}</button>
    </nav>
    ${count ? `<div class="report-list">${pending}${items}</div>` : ''}
    ${trace}
    <div class="side-foot"><b>Demo build</b><span>Replays saved Argumosa runs</span></div>`;
  if (opened) armSide(side);
  requestAnimationFrame(drawFlow);
  if (!hadAsk && $('sidebar').querySelector('.side-ask')) scrollSidebarToAsk();
}

function scrollSidebarToAsk() {
  const scroller = $('sidebar');
  const ask = scroller?.querySelector('.side-ask');
  if (!scroller || !ask) return;
  const delta = ask.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + delta - 12));
  const distance = target - scroller.scrollTop;
  if (Math.abs(distance) < 8) return;
  askScroll += 1;
  const id = askScroll;
  if (reduced) {
    scroller.scrollTop = target;
    return;
  }
  const scale = Math.abs(distance) <= 100 ? 1 : Math.abs(distance) <= 200 ? 1.3 : Math.abs(distance) <= 400 ? 1.6 : 1.8;
  const duration = Math.round(300 * scale);
  const start = scroller.scrollTop;
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const frame = (now) => {
    if (id !== askScroll) return;
    const t = Math.min(1, (now - t0) / duration);
    scroller.scrollTop = start + distance * ease(t);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function armSide(side) {
  side.classList.remove('side-swap');
  void side.offsetWidth;
  side.classList.add('side-swap');
}

function collapseSidebar() {
  const app = $('app');
  const side = $('sidebar');
  sideClosing = true;
  side.classList.add('side-leave');
  app.classList.add('rail');
  app.classList.remove('wide');
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    side.removeEventListener('transitionend', onEnd);
    if (!sideClosing || state.side !== 'rail') return;
    sideClosing = false;
    paintSidebar();
    if (!reduced) armSide($('sidebar'));
  };
  const onEnd = (event) => {
    if (event.target === side && event.propertyName === 'width') finish();
  };
  side.addEventListener('transitionend', onEnd);
  setTimeout(finish, 280);
}

function reportRow(title, subtitle, on, attrs) {
  return `<button type="button" class="report-row ${on ? 'on' : ''}" ${attrs}>
    <span class="nav-ico">${icon('doc')}</span>
    <span class="row-copy">
      <span class="row-title">${esc(trim(title, 36))}</span>
      ${subtitle ? `<span class="row-sub">${esc(subtitle)}</span>` : ''}
    </span>
  </button>`;
}

function verdictLabel(rep) {
  const s = rep?.summary;
  if (!s) return '';
  if (s.red) return `${s.red} red`;
  if (s.amber) return `${s.amber} amber`;
  if (s.unknown) return `${s.unknown} unknown`;
  if (s.green) return `${s.green} ok`;
  return '';
}

function listingTitle() {
  return (state.listingText.split('\n').find((line) => line.trim()) || 'Report').trim();
}

function paintWorkflow() {
  const el = $('workflow');
  if (!el) return;
  const wide = sideWide();
  const askShown = !!$('sidebar').querySelector('.side-ask');
  if ($('app').classList.contains('wide') !== wide || askShown !== (wide && waitingOnYou())) return paintSidebar();
  el.innerHTML = workflowHtml();
  drawFlow();
  const card = el.querySelector('.aw-card.now');
  const pin = el.closest('.work-pin');
  if (!card || !pin) return;
  const cr = card.getBoundingClientRect();
  const pr = pin.getBoundingClientRect();
  if (cr.top < pr.top) pin.scrollTop -= pr.top - cr.top + 8;
  else if (cr.bottom > pr.bottom) pin.scrollTop += cr.bottom - pr.bottom + 8;
}
function paintTrace() {
  const el = $('trace');
  if (!el) return;
  const scroller = el.classList.contains('work-steps') ? el : null;
  const stick = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  el.innerHTML = traceHtml();
  if (scroller && state.playing && stick) scroller.scrollTop = scroller.scrollHeight;
}
function paintStage() {
  const el = $('stage');
  if (!el) return;
  $('frame')?.classList.remove('centered');
  stopBuilding();
  el.innerHTML = stageHtml();
  startBuilding();
  mountReportFlags();
  layoutPixelBars();
  requestAnimationFrame(layoutPixelBars);
}
function paintSlots() {
  const host = $('slots');
  if (!host) return paint();
  host.innerHTML = slotsHtml();
  placeSpot();
}

function slotHoverTarget(node) {
  return node?.closest?.('.field-pick, .region[data-action="slot"]') || null;
}

function slotPairId(node) {
  const target = slotHoverTarget(node);
  if (target) return target.dataset.id || null;
  const field = node?.closest?.('.field');
  return field?.querySelector?.('.field-pick')?.dataset?.id || null;
}

function setSlotHot(id) {
  const host = $('slots');
  if (!host) return;
  host.querySelectorAll('.field.hot, .region.hot').forEach((el) => el.classList.remove('hot'));
  if (!id) return;
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  host.querySelector(`.field-pick[data-id="${safe}"]`)?.closest('.field')?.classList.add('hot');
  host.querySelector(`.region[data-id="${safe}"]`)?.classList.add('hot');
}

function onSlotHover(e) {
  const el = slotHoverTarget(e.target);
  if (!el || !el.closest('#slots')) return;
  const fromId = slotPairId(e.relatedTarget);
  if (fromId === el.dataset.id) return;
  setSlotHot(el.dataset.id);
  // Hovering a field on the right selects it, so the spotlight on the letter follows the pointer.
  if (el.matches('.field-pick') && state.editingSlot == null && state.slot !== el.dataset.id) {
    state.slot = el.dataset.id;
    applySlotSelection(el.dataset.id);
  }
}

function onSlotUnhover(e) {
  const el = slotHoverTarget(e.target);
  if (!el || !el.closest('#slots')) return;
  const toId = slotPairId(e.relatedTarget);
  if (toId === el.dataset.id) return;
  const field = el.closest('.field');
  if (field && e.relatedTarget && field.contains(e.relatedTarget)) return;
  setSlotHot(null);
}

/** Toggle .on on field + region in place — avoids paintSlots blink on click. */
function applySlotSelection(id) {
  const host = $('slots');
  if (!host) return paint();
  host.querySelectorAll('li.field').forEach((li) => {
    const pick = li.querySelector('.field-pick');
    li.classList.toggle('on', !!pick && pick.dataset.id === id);
  });
  host.querySelectorAll('.region[data-action="slot"]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.id === id);
  });
  placeSpot();
}

function uploadHtml() {
  const listing = state.listingText;
  return `<div class="upload-stage"><div class="upload">
    ${sceneHtml()}
    <div class="upload-head">
      <h1>Hogar, dulce hogar</h1>
      <p class="lead">Tell us about your next potential flat, anywhere in Spain.<br />We'll create a report flagging anything that's off, all based on traceable laws.</p>
    </div>
    ${state.loadError || state.checkError ? `<div class="banner">${esc(state.loadError || state.checkError)}</div>` : ''}
    ${listing ? `<div id="slots">${slotsHtml()}</div>` : ''}
    <div class="composer">
      ${listing ? '' : `<textarea id="draft" class="slots-input" placeholder="Address, price, deposit…" rows="2">${esc(state.draft)}</textarea>`}
      <label class="photo-urls">
        <span>Photo URLs</span>
        <textarea id="photos" rows="2" placeholder="https://… one link per line">${esc(state.photoText)}</textarea>
        <small id="photo-hint">${esc(photoHint())}</small>
      </label>
      <div class="presets">
        <span class="hint">Sample listings</span>
        <div class="suggestions">
          <button type="button" data-action="sample" data-id="3c">Calle Argumosa 11, 3º C</button>
          <button type="button" data-action="sample" data-id="3">Calle Argumosa 11, 3º</button>
        </div>
      </div>
      <div class="drops">
        ${drop('listing', state.listingName, 'listing')}
        ${drop('contract', state.contractName, 'contract')}
        ${drop('other', state.otherName, 'other documents')}
      </div>
    </div>
    <button type="button" class="send" id="go" data-action="generate" ${listing || state.draft.trim() ? '' : 'disabled'}>Generate report</button>
  </div></div>`;
}

// Upload tile glyphs: stroke outlines (magnifier / doc / folder / check), sized for the 22px drop slot.
const DROP_STROKE = {
  listing: '<path d="M3 6V3h3M13 3h3v3M16 13v3h-3M6 16H3v-3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9.5" cy="9.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  contract: '<path d="M5 2.5h6l3 3V15.5H5v-13z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 2.6V6h3.2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  other: '<path d="M3.5 7V14c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5V8.5c0-.8-.7-1.5-1.5-1.5H9.2L7.7 5.2H5C4.2 5.2 3.5 5.9 3.5 6.7V7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  check: '<path d="M4 9.2 7.2 12.4 14 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function parsePhotoUrls(text) {
  const parts = String(text || '').split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  const urls = [];
  let invalid = 0;
  for (const part of parts) {
    if (/^https?:\/\/\S+$/i.test(part)) urls.push(part);
    else invalid += 1;
  }
  return { urls: urls.slice(0, 5), extra: Math.max(0, urls.length - 5), invalid };
}

function photoHint() {
  const parsed = parsePhotoUrls(state.photoText);
  if (!state.photoText.trim()) return 'Optional. Up to 5 https links, kept out of the listing.';
  const bits = [];
  if (parsed.urls.length) bits.push(`${parsed.urls.length} ${parsed.urls.length === 1 ? 'link' : 'links'} attached.`);
  if (parsed.extra) bits.push('Only the first 5 are kept.');
  if (parsed.invalid) bits.push('Use https links.');
  if (!bits.length) bits.push('Use https links.');
  bits.push('Sent with the check. Each photo adds about a minute.');
  return bits.join(' ');
}

function dropIcon(kind) {
  return `<svg viewBox="0 0 18 18" width="22" height="22" aria-hidden="true">${DROP_STROKE[kind] || DROP_STROKE.contract}</svg>`;
}

function drop(kind, name, label) {
  const title = label[0].toUpperCase() + label.slice(1);
  if (!name) {
    return `<button type="button" class="drop" data-action="pick-${kind}" data-kind="${kind}">
      <span class="ico">${dropIcon(kind === 'listing' ? 'listing' : kind === 'contract' ? 'contract' : 'other')}</span>
      <span class="copy"><b>Upload ${esc(label)}</b><small>Optional</small></span>
    </button>`;
  }
  return `<div class="drop filled" data-kind="${kind}">
    <button type="button" class="chip-x" data-action="clear-${kind}" aria-label="Remove ${label}">${icon('close')}</button>
    <span class="ico">${dropIcon('check')}</span>
    <span class="copy"><b>${esc(title)}</b><small>${esc(name)}</small></span>
  </div>`;
}

const PX = {};

// Spain (mainland + Balearics) as a 44 x 33 coverage grid, rasterised from Natural Earth 50m.
// '#' cell is land, '+' mostly land, '.' coastline, ' ' sea. Row 0 is the north.
const SPAIN = [
  '                                            ',
  '    ###++++++.    .                         ',
  ' .+###################+++                   ',
  '.########################+                  ',
  ' ###########################.   .           ',
  ' .################################.         ',
  '  ##################################++##    ',
  '  #+####################################    ',
  '    +++ .##############################+    ',
  '         .############################.     ',
  '         +##########################+       ',
  '        +########################+.         ',
  '        ########################+           ',
  '        ########################.           ',
  '        #######################             ',
  '       .######################.           . ',
  '        #####################+        .+  ..',
  '      ++#####################        +##+   ',
  '      .######################         .#    ',
  '       ######################     .         ',
  '       +#####################+    .         ',
  '      .#######################.             ',
  '      .#####################+               ',
  '       +####################                ',
  '       ####################+                ',
  '      +####################.                ',
  '      ###################.                  ',
  '      .+################                    ',
  '         +#############+                    ',
  '         .######+.....                      ',
  '          ###+.                             ',
  '          .##                               ',
  '                                            ',
];
// Grid cells for places the runs can name. Only Madrid appears in the saved runs.
const PLACES = { madrid: { c: 18, r: 14, label: 'Madrid' } };

// 7×7 dither glyphs for workflow / plan diagram nodes and handoff (pix(), handoffRow).
// Nav chrome and drops use STROKE_ICONS / DROP_STROKE instead.
PX.ico = {
  doc: [
    '#####..',
    '#...##.',
    '#...###',
    '#.....#',
    '#.###.#',
    '#.....#',
    '#######',
  ],
  scan: [
    '.###...',
    '#...#..',
    '#...#..',
    '#...#..',
    '.####..',
    '....##.',
    '.....##',
  ],
  folder: [
    '.......',
    '###....',
    '#..####',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ],
  model: [
    '...#...',
    '...#...',
    '..###..',
    '#######',
    '..###..',
    '...#...',
    '...#...',
  ],
  condition: [
    '.....##',
    '....##.',
    '#..##..',
    '####...',
    '#..##..',
    '....##.',
    '.....##',
  ],
  tool: [
    '....###',
    '....#.#',
    '...####',
    '..###..',
    '.##....',
    '##.....',
    '#......',
  ],
  person: [
    '..###..',
    '..#.#..',
    '..###..',
    '.......',
    '.#####.',
    '#.....#',
    '#######',
  ],
  check: [
    '.......',
    '......#',
    '.....##',
    '#...##.',
    '##.##..',
    '.###...',
    '..#....',
  ],
  warn: [
    '...#...',
    '..###..',
    '..#.#..',
    '.##.##.',
    '.#####.',
    '###.###',
    '#######',
  ],
  bot: [
    '...#...',
    '..###..',
    '#######',
    '#.#.#.#',
    '#.....#',
    '#.###.#',
    '#######',
  ],
  arrow: [
    '.......',
    '....#..',
    '.....#.',
    '#######',
    '.....#.',
    '....#..',
    '.......',
  ],
};

// Generic dither icon: one square cell per '#', laid on a pitch of cell + gap (gap ≈ 0.35 cell, like
// the map's 1 + 0.4). Non-square grids are centred in a square viewBox. Cells are solid currentColor.
function ditherIcon(rows, { size = 14, cell = 1, gap = 0.35, cls = '' } = {}) {
  const pitch = cell + gap;
  const cols = Math.max(...rows.map((r) => r.length));
  const n = Math.max(cols, rows.length);
  const side = n * pitch - gap;
  const ox = ((n - cols) * pitch) / 2;
  const oy = ((n - rows.length) * pitch) / 2;
  let out = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '#') return;
      out += `<rect x="${(ox + x * pitch).toFixed(2)}" y="${(oy + y * pitch).toFixed(2)}" width="${cell}" height="${cell}"/>`;
    });
  });
  const s = side.toFixed(2);
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 ${s} ${s}" width="${size}" height="${size}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`;
}

function pix(name) {
  return ditherIcon(PX.ico[name] || PX.ico.doc);
}

// Where the flat is, read from the run itself: the Catastro query names the municipality,
// and the listing title names the city. Nothing else gets a dot.
function placeFor(rep) {
  const cat = rep?.trace?.find((e) => e.agent === 'catastro');
  const muni = (String(cat?.detail?.url || '').match(/Municipio=([^&]+)/i) || [])[1] || '';
  const title = listingTitle();
  if (/^madrid$/i.test(decodeURIComponent(muni)) || /\(madrid\)/i.test(title)) return PLACES.madrid;
  return null;
}

// Same house glyph as the upload scene / brand mark — used as the report place pin.
const HOUSE = ['.#.', '###', '###', '#.#'];
const SCENE_P = 1.4;
// Generating: remap which cells of the 3×4 Madrid footprint are lit (assemble → shuffle → settle).
const BUILD_FRAMES = [
  ['.#.', '...', '...', '...'],
  ['.#.', '.#.', '...', '...'],
  ['.#.', '###', '...', '...'],
  ['.#.', '###', '.#.', '...'],
  ['.#.', '###', '###', '...'],
  HOUSE,
  ['#.#', '###', '###', '.#.'],
  ['###', '.#.', '#.#', '###'],
  ['.#.', '#.#', '###', '#.#'],
  ['#.#', '.#.', '###', '###'],
  HOUSE,
];

function houseCells(pattern, c0, r0, P = SCENE_P) {
  let out = '';
  pattern.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== '#') return;
      out += `<rect x="${((c0 + c) * P).toFixed(1)}" y="${((r0 + r) * P).toFixed(1)}" width="1" height="1"/>`;
    });
  });
  return out;
}

let buildTimer = null;
let buildFrame = 0;

function motionOk() {
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stopBuilding() {
  if (buildTimer) {
    clearInterval(buildTimer);
    buildTimer = null;
  }
  buildFrame = 0;
}

// Small status icon: the same BUILD_FRAMES house, inline where .spin used to sit.
function houseFlipHtml() {
  const P = SCENE_P;
  const cols = 3;
  const rows = 4;
  const w = (cols - 1) * P + 1;
  const h = (rows - 1) * P + 1;
  const animate = state.playing && motionOk();
  const frame = animate ? BUILD_FRAMES[buildFrame % BUILD_FRAMES.length] : HOUSE;
  const cells = houseCells(frame, 0, 0, P);
  return `<svg class="house-flip" width="18" height="18" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" fill="currentColor" aria-hidden="true" shape-rendering="crispEdges"><g class="place${animate ? ' building' : ''}" data-c0="0" data-r0="0">${cells}</g></svg>`;
}

function settlePlacePin(g) {
  if (!g) return;
  g.classList.remove('building');
  const c0 = +g.dataset.c0;
  const r0 = +g.dataset.r0;
  if (Number.isFinite(c0) && Number.isFinite(r0)) g.innerHTML = houseCells(HOUSE, c0, r0);
}

function startBuilding() {
  stopBuilding();
  if (!motionOk() || !state.playing) return;
  const icons = () => [...document.querySelectorAll('.house-flip .place.building')];
  if (!icons().length) return;
  const tick = () => {
    const still = icons();
    if (!still.length || !state.playing) {
      stopBuilding();
      return;
    }
    const frame = BUILD_FRAMES[buildFrame % BUILD_FRAMES.length];
    for (const g of still) {
      const c0 = +g.dataset.c0;
      const r0 = +g.dataset.r0;
      if (!Number.isFinite(c0) || !Number.isFinite(r0)) continue;
      g.innerHTML = houseCells(frame, c0, r0);
    }
    buildFrame += 1;
  };
  tick();
  buildTimer = setInterval(tick, 240);
}

// Square dither map (port of the Elements map answer, drawn as a cell grid instead of tiles).
// Report: place + lines:false → HOUSE pin on the cell. Upload: scene → walking houses.
// loading: animate house cells on the lattice while the report generates.
// reportScene: settled report — man places one flag per verdict around the pin.
function ditherMap({ place = null, lines = false, size = 'lg', scene = false, loading = false, reportScene = false, flagLabel = '' } = {}) {
  const P = SCENE_P; // cell pitch: 1 unit cell, 0.4 unit gap, like size-2 + gap-1
  const W = SPAIN[0].length * P - (P - 1);
  const H = SPAIN.length * P - (P - 1);
  const pinHouse = place && !lines;
  let cells = '';
  SPAIN.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === ' ') return;
      const hot = place && lines && place.c === c && place.r === r;
      const cls = hot ? 'here' : ch === '#' ? 'full' : ch === '+' ? 'half' : 'edge';
      const x = (c * P).toFixed(1);
      const y = (r * P).toFixed(1);
      cells += hot
        ? `<rect class="here" x="${(c * P - 0.2).toFixed(1)}" y="${(r * P - 0.2).toFixed(1)}" width="1.4" height="1.4"/>`
        : `<rect class="${cls}" x="${x}" y="${y}" width="1" height="1"/>`;
    });
  });
  let guides = '';
  if (place && lines) {
    const cx = (place.c * P + 0.5).toFixed(1);
    const cy = (place.r * P + 0.5).toFixed(1);
    guides = `<line class="guide" x1="0" x2="${W}" y1="${cy}" y2="${cy}"/><line class="guide" x1="${cx}" x2="${cx}" y1="0" y2="${H}"/>`;
  }
  // House footprint centred on the place cell (3×4 glyph → offset −1 col, −2 row).
  let pin = '';
  if (pinHouse) {
    const c0 = place.c - 1;
    const r0 = place.r - 2;
    const animate = loading && motionOk();
    const house = houseCells(animate ? BUILD_FRAMES[0] : HOUSE, c0, r0, P);
    // data-c0/r0 always set so a late startBuilding can revive the dance.
    pin = `<g class="place${animate ? ' building' : ''}" data-c0="${c0}" data-r0="${r0}">${house}</g>`;
  }
  let label = loading && place
    ? `Checking listing near ${place.label}`
    : place
      ? `Map of Spain with ${place.label} marked`
      : 'Map of Spain';
  if (flagLabel) label += `, ${flagLabel}`;
  const layer = scene
    ? '<g class="scene" id="scene-layer"></g>'
    : reportScene
      ? '<g class="scene report-flags" id="report-scene"></g>'
      : '';
  return `<svg class="dither ${size}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges">${guides}<g class="land">${cells}</g>${pin}${layer}</svg>`;
}

// Same counts the check board reads from summary: red → flag, amber → check, green → pass.
function verdictFlagKinds(rep) {
  const s = rep?.summary;
  const n = (v) => Math.max(0, Number(v) || 0);
  if (s && (n(s.red) || n(s.amber) || n(s.green))) {
    return [
      ...Array(n(s.red)).fill('flag'),
      ...Array(n(s.amber)).fill('check'),
      ...Array(n(s.green)).fill('pass'),
    ];
  }
  return (rep?.findings || []).flatMap((f) => (
    f.status === 'red' ? ['flag'] : f.status === 'amber' ? ['check'] : f.status === 'green' ? ['pass'] : []
  ));
}

function flagLabel(kinds) {
  if (!kinds?.length) return '';
  const n = (k) => kinds.filter((x) => x === k).length;
  return [
    n('flag') ? `${n('flag')} flagged` : '',
    n('check') ? `${n('check')} to check` : '',
    n('pass') ? `${n('pass')} passed` : '',
  ].filter(Boolean).join(', ');
}

// Report hero map: large dither Spain with a house pin (geo context lives in Overview).
// While generating, force Madrid so the house can be the loading signal even before Catastro lands.
function geoHtml(rep) {
  const place = placeFor(rep) || (state.playing ? PLACES.madrid : null);
  if (!place) return '';
  const kinds = !state.playing && rep ? verdictFlagKinds(rep) : [];
  const map = ditherMap({
    place,
    lines: false,
    size: 'lg',
    loading: state.playing,
    reportScene: kinds.length > 0,
    flagLabel: flagLabel(kinds),
  });
  return `<div class="report-map-field" data-slot="map-answer">
    <div class="hero-map report-map">${map}</div>
  </div>`;
}

// Street / municipio from the Catastro query; census district + SERPAVI year from the price agent.
// Only fields already present in the run — nothing invented.
function geoFacts(rep) {
  const trace = rep?.trace || [];
  const cat = trace.find((e) => e.agent === 'catastro');
  const url = String(cat?.detail?.url || '');
  const q = Object.fromEntries([...url.matchAll(/[?&]([^=]+)=([^&]*)/g)].map(([, k, v]) => [k, decodeURIComponent(v)]));
  let street = '';
  let municipio = '';
  if (q.Calle) {
    street = `${q.Sigla === 'CL' ? 'Calle' : q.Sigla || ''} ${titleCase(q.Calle)} ${q.Numero || ''}`.trim();
    municipio = titleCase(q.Municipio || '');
  }
  const d = trace.find((e) => e.agent === 'price')?.detail || {};
  return {
    street,
    municipio,
    areaName: d.areaName ? String(d.areaName) : '',
    areaCode: d.areaCode ? String(d.areaCode) : '',
    year: d.year != null && d.year !== '' ? String(d.year) : '',
  };
}

// Quiet place clause for the overview line, e.g. "for Calle Argumosa 11 (Madrid)".
function overviewWhere(rep) {
  const g = geoFacts(rep);
  if (g.street && g.municipio) return `for ${g.street} (${g.municipio})`;
  if (g.street) return `for ${g.street}`;
  if (g.municipio) return `in ${g.municipio}`;
  const place = placeFor(rep);
  return place?.label ? `in ${place.label}` : '';
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function paintGeo() {
  // Trace repaints replace the icons. Keep the small house flip running.
  if (state.playing) {
    if (!buildTimer) startBuilding();
    return;
  }
  stopBuilding();
  settlePlacePin(document.querySelector('.report-map .place'));
}

function statusFlag(status) {
  const color = status === 'red' ? 'var(--flag)' : status === 'amber' ? 'var(--check)' : status === 'green' ? 'var(--pass)' : 'var(--muted)';
  // Same pixel flag as the house animation (pole + three-row pennant).
  return `<svg class="status-flag" viewBox="0 0 6 8" width="18" height="24" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="0" y="0" width="1" height="8" fill="currentColor"/>
    <g fill="${color}"><rect x="1" y="0" width="4" height="1"/><rect x="1" y="1" width="4" height="1"/><rect x="1" y="2" width="3" height="1"/></g>
  </svg>`;
}

function sceneHtml() {
  // Upload stage: walking scene only — never the Madrid "here" cell / crosshair guides.
  return `<div class="hero-map">${ditherMap({ place: null, lines: false, size: 'lg', scene: true })}</div>`;
}

// Door-to-door scene on the dither map. Everything is drawn on the map's own cell lattice:
// five houses emerge on land, a man walks to the nearest one, flags it, moves on, then a new round starts.
const MAN = [['#', '#', '#'], ['.#.', '.#.', '#.#']];
const FLAG_KINDS = ['flag', 'check', 'pass'];
const scene = { houses: [], man: null, round: 0 };

function landAt(c, r) {
  const ch = SPAIN[r]?.[c];
  return ch === '#' || ch === '+';
}

function sceneCells(rows, c0, r0) {
  return houseCells(rows, c0, r0, SCENE_P);
}

function rollHouses() {
  const place = state.listingText ? placeFor(null) : null;
  const out = [];
  for (let tries = 0; tries < 400 && out.length < 5; tries++) {
    const c = 2 + Math.floor(Math.random() * 30);
    const r = 2 + Math.floor(Math.random() * (SPAIN.length - 7));
    let ok = true;
    for (let dr = -1; dr <= 4 && ok; dr++) for (let dc = -2; dc <= 5; dc++) if (!landAt(c + dc, r + dr)) { ok = false; break; }
    if (!ok) continue;
    if (place && Math.max(Math.abs(place.c - c), Math.abs(place.r - r)) < 5) continue;
    if (out.some((h) => Math.max(Math.abs(h.c - c), Math.abs(h.r - r)) < 7)) continue;
    out.push({ id: `${scene.round}-${out.length}`, c, r, flag: reduced ? FLAG_KINDS[out.length % 3] : null });
  }
  return out;
}

function rollMan() {
  for (;;) {
    const c = 2 + Math.floor(Math.random() * 30);
    const r = 2 + Math.floor(Math.random() * (SPAIN.length - 5));
    if (landAt(c, r) && landAt(c, r + 2)) return { c, r, frame: 0 };
  }
}

function houseSvg(h, shown) {
  const flag = `<g class="dflag ${h.flag || ''}">${sceneCells(['#'], h.c + 3, h.r + 1)}${sceneCells(['#'], h.c + 3, h.r + 2)}${sceneCells(['#'], h.c + 3, h.r + 3)}<g class="cloth">${sceneCells(['##'], h.c + 3, h.r)}</g></g>`;
  return `<g class="dh ${shown ? 'in' : ''} ${h.flag ? 'flagged' : ''}" data-id="${h.id}">${sceneCells(HOUSE, h.c, h.r)}${flag}</g>`;
}

function manSvg(m, shown) {
  const rows = MAN[m.frame];
  const off = m.frame ? 1 : 0;
  return `<g class="dm ${shown ? 'in' : ''}">${sceneCells(rows, m.c - off, m.r)}</g>`;
}

// Rebuilds the layer after a repaint; the loop keeps everything else incremental so fades survive.
function mountScene() {
  const layer = $('scene-layer');
  if (!layer || layer.childElementCount) return;
  layer.innerHTML = scene.houses.map((h) => houseSvg(h, true)).join('') + (scene.man ? manSvg(scene.man, true) : '');
}

function reveal(el) {
  if (!el) return;
  setTimeout(() => el.classList.add('in'), 30);
}

async function runScene() {
  for (;;) {
    const layer = $('scene-layer');
    if (!layer) { await sleep(300); continue; }
    mountScene();
    if (!scene.houses.length) {
      scene.round += 1;
      scene.houses = rollHouses();
      for (const h of scene.houses) {
        layer.insertAdjacentHTML('beforeend', houseSvg(h, reduced));
        reveal(layer.lastElementChild);
        await sleep(reduced ? 0 : 180);
      }
      await sleep(reduced ? 0 : 500);
    }
    if (reduced) { await sleep(600); continue; }
    if (!scene.man) {
      scene.man = rollMan();
      layer.insertAdjacentHTML('beforeend', manSvg(scene.man, false));
      reveal(layer.lastElementChild);
      await sleep(600);
      continue;
    }
    const m = scene.man;
    const open = scene.houses.filter((h) => !h.flag);
    if (!open.length) {
      await sleep(1600);
      layer.querySelectorAll('.dh').forEach((el) => el.classList.add('gone'));
      await sleep(500);
      layer.querySelectorAll('.dh').forEach((el) => el.remove());
      scene.houses = [];
      continue;
    }
    const dist = (h) => Math.max(Math.abs(h.c - 2 - m.c), Math.abs(h.r + 1 - m.r));
    const target = open.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const tc = target.c - 2;
    const tr = target.r + 1;
    if (m.c === tc && m.r === tr) {
      m.frame = 0;
      layer.querySelector('.dm')?.replaceWith(frag(manSvg(m, true)));
      await sleep(260);
      target.flag = FLAG_KINDS[Math.floor(Math.random() * 3)];
      const el = layer.querySelector(`.dh[data-id="${target.id}"]`);
      if (el) {
        el.querySelector('.dflag').className.baseVal = `dflag ${target.flag}`;
        el.classList.add('flagged');
      }
      await sleep(700);
      continue;
    }
    m.c += Math.sign(tc - m.c);
    m.r += Math.sign(tr - m.r);
    m.frame = m.frame ? 0 : 1;
    layer.querySelector('.dm')?.replaceWith(frag(manSvg(m, true)));
    await sleep(115);
  }
}

function frag(html) {
  const tpl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tpl.innerHTML = html;
  return tpl.firstElementChild;
}

// Clockwise ring around the report house pin (cloth anchor, relative to the pin origin).
const FLAG_RING = [
  { c: 0, r: -6 },
  { c: 4, r: -5 },
  { c: 5, r: 1 },
  { c: 3, r: 6 },
  { c: -1, r: 6 },
  { c: -4, r: 5 },
  { c: -4, r: 0 },
];

function flagAnchor(i) {
  const base = FLAG_RING[i % FLAG_RING.length];
  const lap = Math.floor(i / FLAG_RING.length);
  if (!lap) return base;
  const push = 4 * lap;
  return {
    c: base.c + (Math.sign(base.c) || 0) * push,
    r: base.r + (Math.sign(base.r) || -1) * push,
  };
}

function flagSlots(n) {
  if (n <= 0) return [];
  if (n >= FLAG_RING.length) return Array.from({ length: n }, (_, i) => flagAnchor(i));
  const step = FLAG_RING.length / n;
  const used = new Set();
  const picked = [];
  for (let i = 0; i < n; i++) {
    let idx = Math.round(i * step) % FLAG_RING.length;
    while (used.has(idx)) idx = (idx + 1) % FLAG_RING.length;
    used.add(idx);
    picked.push(FLAG_RING[idx]);
  }
  return picked.sort((a, b) => FLAG_RING.indexOf(a) - FLAG_RING.indexOf(b));
}

const reportFlags = { key: '', spots: [], man: null, block: null, token: 0 };

function flagMarkup(s) {
  const pole = `${sceneCells(['#'], s.c, s.r + 1)}${sceneCells(['#'], s.c, s.r + 2)}${sceneCells(['#'], s.c, s.r + 3)}`;
  const cloth = `<g class="cloth">${sceneCells(['##'], s.c, s.r)}</g>`;
  return `<g class="dflag ${s.kind}${s.placed ? ' placed' : ''}" data-id="${s.id}">${pole}${cloth}</g>`;
}

function stepAround(m, tc, tr, block) {
  const dc = Math.sign(tc - m.c);
  const dr = Math.sign(tr - m.r);
  const inside = (c, r) => block && c >= block.c0 && c <= block.c1 && r >= block.r0 && r <= block.r1;
  const cand = [
    [m.c + dc, m.r + dr],
    [m.c + dc, m.r],
    [m.c, m.r + dr],
    [m.c + dr, m.r + dc],
    [m.c - dr, m.r - dc],
    [m.c + 1, m.r],
    [m.c - 1, m.r],
    [m.c, m.r + 1],
    [m.c, m.r - 1],
  ];
  for (const [c, r] of cand) {
    if ((c !== m.c || r !== m.r) && !inside(c, r)) return { c, r };
  }
  return { c: m.c, r: m.r };
}

function mountReportFlags() {
  const layer = document.getElementById('report-scene');
  if (!layer) {
    reportFlags.token += 1;
    reportFlags.key = '';
    reportFlags.spots = [];
    reportFlags.man = null;
    return;
  }
  const rep = report();
  const place = placeFor(rep);
  const kinds = verdictFlagKinds(rep);
  const key = `${state.reportKey}|${place?.c ?? ''},${place?.r ?? ''}|${kinds.join('.')}`;
  if (!place || !kinds.length) {
    reportFlags.token += 1;
    reportFlags.key = '';
    layer.replaceChildren();
    return;
  }
  if (reportFlags.key !== key) {
    const c0 = place.c - 1;
    const r0 = place.r - 2;
    const instant = !motionOk();
    reportFlags.key = key;
    reportFlags.block = { c0, c1: c0 + 2, r0, r1: r0 + 3 };
    reportFlags.spots = flagSlots(kinds.length).map((a, i) => ({
      id: `rf${i}`,
      c: c0 + a.c,
      r: r0 + a.r,
      kind: kinds[i],
      placed: instant,
    }));
    reportFlags.man = instant ? null : { c: c0 - 2, r: r0 + 2, frame: 0 };
  }
  const token = ++reportFlags.token;
  layer.innerHTML = reportFlags.spots.map(flagMarkup).join('') + (reportFlags.man ? manSvg(reportFlags.man, true) : '');
  if (reportFlags.man && reportFlags.spots.some((s) => !s.placed)) walkReportFlags(token);
}

async function walkReportFlags(token) {
  const alive = () => token === reportFlags.token && document.getElementById('report-scene');
  for (let i = 0; i < 40 && alive(); i++) {
    const hero = document.querySelector('.report-map')?.closest('.report-hero');
    if (!hero || !hero.classList.contains('hold')) break;
    await sleep(50);
  }
  if (!alive()) return;
  await sleep(280);
  if (!alive()) return;
  const block = reportFlags.block;
  for (const spot of reportFlags.spots) {
    if (!alive()) return;
    if (spot.placed) continue;
    const tc = spot.c - 2;
    const tr = spot.r + 1;
    let guard = 0;
    while (alive() && (reportFlags.man.c !== tc || reportFlags.man.r !== tr) && guard < 80) {
      const next = stepAround(reportFlags.man, tc, tr, block);
      if (next.c === reportFlags.man.c && next.r === reportFlags.man.r) break;
      reportFlags.man.c = next.c;
      reportFlags.man.r = next.r;
      reportFlags.man.frame = reportFlags.man.frame ? 0 : 1;
      guard += 1;
      document.getElementById('report-scene')?.querySelector('.dm')?.replaceWith(frag(manSvg(reportFlags.man, true)));
      await sleep(115);
    }
    if (!alive()) return;
    reportFlags.man.frame = 0;
    document.getElementById('report-scene')?.querySelector('.dm')?.replaceWith(frag(manSvg(reportFlags.man, true)));
    await sleep(200);
    if (!alive()) return;
    spot.placed = true;
    document.getElementById('report-scene')?.querySelector(`.dflag[data-id="${spot.id}"]`)?.setAttribute('class', `dflag ${spot.kind} placed`);
    await sleep(380);
  }
}

function parseSlots(text) {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const specs = [
    ['address', 'Address', first],
    ['price', 'Price', match(text, /(\d[\d.]*)\s*€\s*\/\s*mes/)],
    ['size', 'Size', match(text, /(\d+)\s*m2[^\n.,]*/i)],
    ['deposit', 'Deposit', match(text, /Fianza:\s*[^.\n]+/)],
    ['agency', 'Agency', match(text, /Honorarios de agencia:[^\n]+|Sin honorarios de agencia/)],
    ['insurance', 'Insurance', match(text, /Seguro de impago[^\n]*/)],
    ['ibi', 'IBI', match(text, /IBI a cargo del inquilino/)],
  ];
  const found = specs
    .map(([id, label, hit]) => {
      const quote = Array.isArray(hit) ? hit[0] : hit;
      if (!quote) return null;
      const value = id === 'price' ? quote.replace(/\s+/g, ' ') : quote;
      return { id, label, value, quote };
    })
    .filter(Boolean);
  const used = [];
  return found
    .map((slot) => {
      let start = text.indexOf(slot.quote);
      while (start >= 0 && used.some(([a, b]) => start < b && start + slot.quote.length > a)) {
        start = text.indexOf(slot.quote, start + 1);
      }
      if (start < 0) return null;
      const end = start + slot.quote.length;
      used.push([start, end]);
      return { ...slot, start, end };
    })
    .filter(Boolean);
}

// Edited fields keep their span. A fresh listing text reparses from the patterns.
let slotLayout = null;

function slotsFrom(text) {
  if (slotLayout && slotLayout.text === text) return slotLayout.slots;
  const slots = parseSlots(text);
  slotLayout = { text, slots };
  return slots;
}

function writeSlot(id, value) {
  const text = state.listingText;
  const slots = slotsFrom(text);
  const slot = slots.find((s) => s.id === id);
  if (!slot || slot.quote === value) return false;
  const next = text.slice(0, slot.start) + value + text.slice(slot.end);
  const delta = value.length - (slot.end - slot.start);
  const nextSlots = slots.map((s) => {
    if (s.id === id) return { ...s, quote: value, value, start: s.start, end: s.start + value.length };
    if (s.start >= slot.end) return { ...s, start: s.start + delta, end: s.end + delta };
    return s;
  });
  state.listingText = next;
  state.draft = next;
  slotLayout = { text: next, slots: nextSlots };
  return true;
}

function match(text, re) {
  const m = text.match(re);
  return m ? m : null;
}

function slotCssEscape(id) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
}

function endSlotEdit() {
  state.editingSlot = null;
  state.editingOriginal = null;
  paintSlots();
}

function revertSlotEdit() {
  const id = state.editingSlot;
  const original = state.editingOriginal;
  if (id && original != null) writeSlot(id, original);
  endSlotEdit();
}

/** Write slot text into listingText. Live typing keeps the input mounted; commit exits edit mode. */
function saveSlotEdit(id, next, { commit = true } = {}) {
  const raw = String(next ?? '');
  const value = commit ? raw.trim() : raw;
  const slots = slotsFrom(state.listingText);
  const slot = slots.find((s) => s.id === id);
  if (!slot) {
    if (commit) endSlotEdit();
    return;
  }
  if (commit && !value) {
    revertSlotEdit();
    return;
  }
  if (value === slot.quote) {
    if (commit) endSlotEdit();
    return;
  }
  writeSlot(id, value);
  state.slot = id;
  $('go')?.toggleAttribute('disabled', !state.listingText.trim());
  if (commit) {
    endSlotEdit();
    return;
  }
  const host = $('slots');
  const region = host?.querySelector(`.region[data-id="${slotCssEscape(id)}"]`);
  if (region) region.textContent = value;
  placeSpot();
}

function fieldRow(s) {
  if (state.editingSlot === s.id) {
    return `<li class="field editing">
      <span class="k">${esc(s.label)}</span>
      <input id="slot-edit" class="field-input" type="text" data-id="${esc(s.id)}" value="${esc(s.quote)}" aria-label="Edit ${esc(s.label)}" />
    </li>`;
  }
  return `<li class="field ${s.id === state.slot ? 'on' : ''}">
    <button type="button" class="field-pick" data-action="edit-slot" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.label)}">
      <span class="k">${esc(s.label)}</span>
      <span class="v">${esc(s.value)}</span>
    </button>
  </li>`;
}

function slotsHtml() {
  const slots = slotsFrom(state.listingText);
  if (!state.slot || !slots.some((s) => s.id === state.slot)) state.slot = slots[0]?.id || null;
  if (state.editingSlot && !slots.some((s) => s.id === state.editingSlot)) {
    state.editingSlot = null;
    state.editingOriginal = null;
  }
  return `<section class="overlay" aria-label="Check the details">
    <div class="ov-head">
      <span>Check the details</span>
      <button type="button" class="ov-close" data-action="edit-listing" aria-label="Edit listing">${icon('close')}</button>
    </div>
    <div class="ov-grid">
      <div class="ov-doc-wrap"><div class="ov-doc" id="ov-doc">${docHtml(state.listingText, slots)}<span class="spot" id="spot"></span></div></div>
      <ul class="fields">${slots.map(fieldRow).join('')}</ul>
    </div>
  </section>`;
}

function docHtml(text, slots) {
  const ranges = slots
    .map((s) => ({ ...s, start: Number.isInteger(s.start) ? s.start : text.indexOf(s.quote) }))
    .filter((s) => s.start >= 0 && s.quote)
    .sort((a, b) => a.start - b.start);
  let html = '';
  let i = 0;
  for (const range of ranges) {
    if (range.start < i) continue;
    html += esc(text.slice(i, range.start));
    html += `<button type="button" class="region ${range.id === state.slot ? 'on' : ''}" data-action="slot" data-id="${range.id}">${esc(text.slice(range.start, range.start + range.quote.length))}</button>`;
    i = range.start + range.quote.length;
  }
  html += esc(text.slice(i));
  return html;
}

function placeSpot() {
  const doc = $('ov-doc');
  const spot = $('spot');
  const region = doc?.querySelector('.region.on');
  if (!doc || !spot || !region) return;
  const dr = doc.getBoundingClientRect();
  const rr = region.getBoundingClientRect();
  spot.style.left = `${rr.left - dr.left + doc.scrollLeft - 3}px`;
  spot.style.top = `${rr.top - dr.top + doc.scrollTop - 3}px`;
  spot.style.width = `${rr.width + 6}px`;
  spot.style.height = `${rr.height + 6}px`;
  spot.classList.add('show');
}

function visibleTrace() {
  const rep = report();
  if (!rep) return [];
  return rep.trace.slice(0, state.visible);
}

function waitingOnYou() {
  const rep = report();
  return !state.playing && !!rep?.questions?.length;
}

function sideWide() {
  return state.side === 'open' && state.step === 2 && !state.playing && (waitingOnYou() || state.planOpen);
}

function stagePath(entry) {
  if (!entry) return [];
  const action = String(entry.action || '');
  if (entry.agent === 'riskguard') {
    if (/no email|template rejected/.test(action)) return ['risk'];
    if (/email draft rejected/.test(action)) return ['risk', 'email'];
    if (/fixed template/.test(action)) return ['email'];
    if (/email draft approved/.test(action)) return ['risk', 'email', 'approve'];
    if (/waiting for the renter/.test(action)) return ['approve'];
    return ['risk'];
  }
  const stage = stageOf(entry);
  return stage ? [stage] : [];
}

// Nodes this step introduces. A line that covers several cards walks through the new ones.
function freshStages(entry, prior) {
  const path = stagePath(entry);
  if (!path.length) return [];
  const seen = new Set(prior.flatMap((item) => stagePath(item)));
  const novel = path.filter((id) => !seen.has(id));
  return novel.length ? novel : [path.at(-1)];
}

function stageOf(entry) {
  if (!entry) return null;
  const action = String(entry.action || '');
  if (entry.agent === 'planner') {
    const next = action.match(/^next:\s*([a-z]+)/i);
    if (next) {
      const map = { extract: 'extractor', check: 'checks' };
      return map[next[1]] || next[1];
    }
    if (action === 'done') return 'approve';
    return 'planner';
  }
  if (entry.agent === 'critic') {
    if (/needs a human check/.test(action)) return 'review';
    if (/^explanation/.test(action)) return 'explainer';
    return 'critic';
  }
  if (entry.agent === 'riskguard') {
    if (/waiting for the renter/.test(action)) return 'approve';
    if (/email draft|fixed template/.test(action)) return 'email';
    return 'risk';
  }
  const known = ['extractor', 'catastro', 'law', 'price', 'photos', 'checks', 'planner'];
  return known.includes(entry.agent) ? entry.agent : null;
}

const NODE_ICON = {
  planner: 'book',
  extractor: 'listing',
  catastro: 'house',
  law: 'scale',
  price: 'tag',
  photos: 'camera',
  checks: 'clipboard',
  critic: 'glass',
  explainer: 'bubble',
  risk: 'shield',
  email: 'mail',
};

const AGENT_ICON = {
  planner: 'book',
  extractor: 'listing',
  critic: 'glass',
  catastro: 'house',
  law: 'scale',
  price: 'tag',
  photos: 'camera',
  checks: 'clipboard',
  riskguard: 'shield',
};

function workflowHtml() {
  const trace = visibleTrace();
  const agent = (name) => trace.some((e) => e.agent === name);
  const reached = new Set();
  trace.forEach((entry, i) => {
    const path = stagePath(entry);
    let upto = path.length - 1;
    if (i === trace.length - 1 && state.playing && diagramNow) {
      const at = path.indexOf(diagramNow);
      if (at >= 0) upto = at;
    }
    path.slice(0, upto + 1).forEach((id) => reached.add(id));
  });
  const now = waitingOnYou() ? 'renter' : (state.playing ? (diagramNow || stageOf(trace.at(-1))) : null);
  const on = {
    renter: trace.length > 0,
    planner: agent('planner'),
    extractor: agent('extractor'),
    catastro: agent('catastro'),
    law: agent('law'),
    price: agent('price'),
    photos: agent('photos'),
    world: ['extractor', 'catastro', 'law', 'price', 'photos', 'checks'].some(agent),
    sources: ['catastro', 'law', 'price', 'photos'].some(agent),
    checks: agent('checks'),
    critic: agent('critic'),
    explainer: reached.has('explainer'),
    risk: reached.has('risk'),
    email: reached.has('email'),
    review: reached.has('review'),
    approve: reached.has('approve'),
  };
  const mark = (id, role) => role === 'human'
    ? `<span class="aw-ico">${icon('person')}</span>`
    : NODE_ICON[id]
      ? `<span class="aw-ico">${icon(NODE_ICON[id])}</span>`
      : '';
  const card = (id, role, title, sub) => `<article class="aw-card ${role}${on[id] ? ' settled' : ''}${now === id ? ' now' : ''}" data-node="${id}"${now === id ? ' aria-current="step"' : ''}>
    <span class="aw-title">${mark(id, role)}${esc(title)}</span>
    <span class="aw-sub">${esc(sub)}</span>
  </article>`;
  const arrow = (dir) => `<span class="aw-arrow ${dir}" aria-hidden="true"></span>`;
  return `<div class="flow aw" id="flow" aria-label="Agentic workflow">
    <div class="aw-row">
      ${card('renter', 'human', 'Renter', 'Listing, contract, photos')}
      ${arrow('both')}
      ${card('planner', 'agent', 'Planner', 'Routes the next task')}
    </div>
    <p class="aw-note">If several units match, the critic asks which door and the answer comes back.</p>
    ${arrow('down')}
    <div class="aw-band">
      <div class="aw-row">
        ${card('critic', 'agent', 'Critic', 'Checks each result')}
      </div>
      <p class="aw-caption">An explanation or the email gets one revision, then stops.</p>
      <div class="aw-row aw-specs">
        ${card('extractor', 'agent', 'Extractor', 'Listing and contract')}
        ${card('catastro', 'agent', 'Catastro', 'Size and building')}
        ${card('law', 'agent', 'Law', 'BOE')}
        ${card('price', 'agent', 'Price', 'SERPAVI')}
        ${card('photos', 'agent', 'Photos', state.photos.length ? `${state.photos.length} ${state.photos.length === 1 ? 'link' : 'links'} attached` : 'Google Lens, if sent')}
      </div>
    </div>
    <div class="aw-row aw-pair">
      <div class="aw-stack">
        ${arrow('both-down')}
        ${card('world', 'data', 'World store', 'Facts, findings, flags')}
      </div>
      <div class="aw-stack">
        ${arrow('both-down')}
        ${card('sources', 'data', 'Sources', 'Catastro, BOE, Zetaris, CSV, Bright\u00a0Data')}
      </div>
    </div>
    ${arrow('down')}
    <div class="aw-row aw-pipe">
      <div class="aw-stack">
        ${card('checks', 'agent', 'Checks', 'Rules in code')}
        ${arrow('dash-down')}
        ${card('review', 'human', 'Human review', 'If confidence is low')}
      </div>
      ${arrow('right')}
      ${card('explainer', 'agent', 'Explainer', 'Writes each finding')}
      ${arrow('right')}
      ${card('risk', 'agent', 'Risk guard', 'Tone, figures, personal data')}
      ${arrow('right')}
      <div class="aw-stack">
        ${card('email', 'agent', 'Email', 'Draft only')}
        ${arrow('down')}
        ${card('approve', 'human', 'Renter approves', 'Nothing sends itself')}
      </div>
    </div>
    <ul class="aw-legend">
      <li><i class="agent"></i>Agent</li>
      <li><i class="data"></i>Data and memory</li>
      <li><span class="aw-ico">${icon('person')}</span>Human</li>
    </ul>
  </div>`;
}

function drawFlow() {
  // Arrows are part of the diagram markup. Kept so resize and paint callers stay valid.
}

// The running title is the latest step, spoken in the first person. Counts come from that step's action.
const CHECK_SAY = {
  area: 'size',
  use: 'use',
  deposit: 'deposit',
  rent_insurance: 'insurance',
  agency_fees: 'agency fee',
  taxes: 'tax',
  price: 'rent',
  scam: 'scam check',
};

function countPhrase(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function runningTitle(entry) {
  if (!state.liveRun) return thoughtLine(entry);
  const action = String(entry?.action || '').trim();
  return action || state.checkStatus || 'I’m checking the listing…';
}

function thoughtLine(entry) {
  if (!entry) return 'I’m starting…';
  const action = String(entry.action || '');
  const num = (re) => {
    const m = action.match(re);
    return m ? Number(m[1]) : null;
  };
  if (entry.agent === 'planner') {
    if (action === 'start') return 'I’m starting with the listing…';
    if (action === 'done') return 'I’m finished with the checks…';
    if (/no strategy left/.test(action)) return 'Actually, I realized Catastro has no way left to try…';
    if (/^next:/.test(action)) {
      const kind = action.replace(/^next:\s*/, '').trim();
      const doc = entry.detail && entry.detail.doc;
      const next = {
        extract: doc === 'contract' ? 'I’m reading the contract…' : 'I’m reading the listing…',
        catastro: 'I’m looking the address up in Catastro…',
        law: 'I’m reading the law in force…',
        price: 'I’m comparing the rent with the area…',
        photos: 'I’m checking where the photos appear…',
        check: 'I’m running the checks…',
      };
      return next[kind] || 'I’m deciding what to do next…';
    }
  }
  if (entry.agent === 'extractor') {
    if (/failed/.test(action)) return 'Actually, I realized I couldn’t read that document…';
    const fields = num(/^(\d+) fields from/);
    const doc = /contract/.test(action) ? 'contract' : 'listing';
    if (fields != null) return `I found ${countPhrase(fields, 'field', 'fields')} in the ${doc}…`;
    return 'I’m reading…';
  }
  if (entry.agent === 'critic') {
    const kept = action.match(/^extraction: kept (\d+), dropped (\d+)/);
    if (kept) {
      const dropped = Number(kept[2]);
      if (!dropped) return 'As a critic, I see the quotes hold…';
      return `Actually, I realized ${countPhrase(dropped, 'field has', 'fields have')} no quote…`;
    }
    if (/catastro: one unit/.test(action)) return 'As a critic, I see one unit…';
    const ask = action.match(/catastro: ask — (\d+) candidate/);
    if (ask) return `As a critic, I see ${ask[1]} units and the listing doesn’t say which…`;
    if (/^catastro:/.test(action)) return 'As a critic, I see the building doesn’t settle on one flat…';
    if (/Zetaris unavailable/.test(action)) return 'Actually, I realized Zetaris didn’t answer, so I used the local figures…';
    if (/^price:/.test(action)) return 'As a critic, I see the area match only holds in Madrid…';
    if (/law text changed/.test(action)) return 'Actually, I realized those rules aren’t in the text in force…';
    const rejected = action.match(/^explanation of (\w+) rejected: (.*)/);
    if (rejected) {
      const what = CHECK_SAY[rejected[1]] || 'that';
      if (/cites no evidence/.test(rejected[2])) return `Actually, I realized the ${what} explanation cites nothing…`;
      if (/numbers not in the evidence/.test(rejected[2])) return `Actually, I realized the ${what} numbers aren’t in the evidence…`;
      return `Actually, I realized the ${what} explanation doesn’t hold…`;
    }
    const keptExplain = action.match(/^explanation of (\w+): using the rule outcome/);
    if (keptExplain) return `As a critic, I’ll use the rule’s own wording for the ${CHECK_SAY[keptExplain[1]] || 'check'}…`;
    const wrote = action.match(/^explanation of (\w+): kept/);
    if (wrote) return `I’m writing the ${CHECK_SAY[wrote[1]] || 'check'} finding…`;
    if (/needs a human check/.test(action)) return 'As a critic, I see this needs a person…';
    if (/^dropped /.test(action)) return 'Actually, I realized that check doesn’t hold…';
    return 'As a critic, I’m looking again…';
  }
  if (entry.agent === 'catastro') {
    if (/failed/.test(action)) return 'Actually, I realized that lookup didn’t answer…';
    const found = action.match(/(\d+) units, (\d+) match/);
    if (found) {
      const matches = Number(found[2]);
      return `I found ${found[1]} units, and ${matches} of them ${matches === 1 ? 'matches' : 'match'}…`;
    }
    return 'I’m searching Catastro…';
  }
  if (entry.agent === 'law') {
    if (/unreachable/.test(action)) return 'Actually, I realized the BOE didn’t answer…';
    const rules = num(/fetched (\d+) rules/);
    if (rules != null) return `I’m reading ${countPhrase(rules, 'rule', 'rules')} from the BOE…`;
    return 'I’m reading the law…';
  }
  if (entry.agent === 'price') {
    if (/no reference/.test(action)) return 'Actually, I realized there’s no reference rent…';
    if (/SERPAVI/.test(action)) return 'I’m comparing the rent with SERPAVI…';
    return 'I’m comparing the rent…';
  }
  if (entry.agent === 'photos') {
    if (/not configured|not checked/.test(action)) return 'Actually, I realized the photos can’t be checked…';
    if (/failed/.test(action)) return 'Actually, I realized this photo didn’t come back…';
    const pages = num(/Lens: (\d+) pages/);
    if (pages != null) return `I see this photo on ${countPhrase(pages, 'other page', 'other pages')}…`;
    return 'I’m checking where the photos appear…';
  }
  if (entry.agent === 'checks') {
    const findings = num(/^(\d+) findings/);
    if (findings != null) return `I have ${countPhrase(findings, 'finding', 'findings')}…`;
    return 'I’m running the checks…';
  }
  if (entry.agent === 'riskguard') {
    if (/approved/.test(action)) return 'I checked the tone, and the draft holds…';
    if (/fixed template/.test(action)) return 'I’ll use the fixed wording…';
    if (/no email/.test(action)) return 'Actually, I realized the draft can’t go out…';
    if (/rejected/.test(action)) return 'Actually, I realized the draft doesn’t hold…';
    return 'I’m checking the tone of the draft…';
  }
  return 'I’m working through the listing…';
}

const THINK_ROLE = {
  planner: 'Planner',
  extractor: 'Extractor',
  critic: 'Critic',
  catastro: 'Catastro',
  law: 'Law',
  price: 'Price',
  photos: 'Photos',
  checks: 'Checks',
  riskguard: 'Risk guard',
};

function thinkMark(entry, waiting) {
  const agent = waiting ? 'renter' : entry?.agent;
  const glyph = waiting ? 'person' : AGENT_ICON[agent];
  const role = waiting ? 'Renter' : THINK_ROLE[agent];
  if (!glyph || !role) return `<span class="status">${icon('check')}</span>`;
  return `<span class="think-mark${waiting ? '' : ' think-in'}"><span class="think-role">${esc(role)}</span><span class="aw-ico">${icon(glyph)}</span></span>`;
}

function traceHtml() {
  const rep = report();
  if (!rep) {
    if (!state.playing) return '';
    return `<section class="tree" aria-label="Reasoning trace">
      <div class="tree-head">
        <span class="chev open">${icon('chev')}</span>
        <span class="think-mark think-in"><span class="think-role">Planner</span><span class="aw-ico">${icon('book')}</span></span>
        <span class="tree-title shimmer">${esc(state.checkStatus || 'I’m checking the listing…')}</span>
      </div>
    </section>`;
  }
  const rows = visibleTrace();
  if (state.mode === 'terminal') return terminalHtml(rows);
  const elapsed = rows.length > 1 ? seconds(Date.parse(rows.at(-1).t) - Date.parse(rows[0].t)) : rows.length ? '0s' : '';
  const running = state.playing;
  const waiting = !running && rep.questions?.length;
  const title = running ? runningTitle(rows.at(-1)) : waiting ? 'Waiting on you' : 'Checked';
  const titleClass = running ? (rows.length ? 'think-in' : 'shimmer') : '';
  const open = running || state.thoughtOpen;
  const statusIco = running || waiting
    ? thinkMark(rows.at(-1), waiting)
    : `<span class="status ok">${icon('check')}</span>`;
  return `<section class="tree ${open ? '' : 'collapsed'}" aria-label="Reasoning trace">
    <button type="button" class="tree-head cot-trigger" data-action="thought" aria-expanded="${open}">
      <span class="chev ${open ? 'open' : ''}">${icon('chev')}</span>
      ${statusIco}
      <span class="tree-title ${titleClass}">${esc(title)}</span>
      <span class="tree-meta">${elapsed}${rows.length ? ` · ${rows.length} steps` : ''}</span>
    </button>
    ${open ? `<div class="disclose ${traceEnter && !reduced ? '' : 'in'}" data-disclose="trace"><div class="disclose-body"><ul>${rows.map((entry, i) => treeRow(entry, i, rows)).join('')}</ul></div></div>` : ''}
  </section>`;
}

function replayBtn() {
  const ico = `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9a5.5 5.5 0 1 0 1.6-3.9"/><path d="M3.5 3.5v3.5H7"/></svg>`;
  return `<button type="button" class="nav-item replay" data-action="replay"><span class="nav-ico">${ico}</span><span>Replay</span></button>`;
}

// Planner "next: x" steps are handoffs: control passes from the planner to another agent.
const HANDOFF_AGENT = { extract: 'extractor', check: 'checks' };

function handoffRow(entry, i, rows) {
  const to = String(entry.action).replace(/^next:\s*/, '').trim();
  const agent = HANDOFF_AGENT[to] || to;
  const settled = rows.slice(i + 1).some((e) => e.agent === agent);
  const detail = entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
  const reason = Object.entries(detail)
    .filter(([k, v]) => k !== 'kind' && !Array.isArray(v))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  const carried = Object.values(detail).filter(Array.isArray).flat().map(String);
  const arrow = ditherIcon(PX.ico.arrow, { size: 14, cls: 'handoff-arrow' });
  const glyph = (name) => AGENT_ICON[name] ? `<span class="aw-ico">${icon(AGENT_ICON[name])}</span>` : '';
  return `<li class="handoff-li">
    ${i ? '<i class="stem"></i>' : ''}
    <i class="elbow"></i>
    <div class="handoff ${settled ? 'settled' : ''}" data-slot="agent-handoff">
      <div class="handoff-pills">
        <span class="pill from">${glyph(entry.agent)}${esc(entry.agent)}</span>
        ${arrow}
        <span class="pill to">${glyph(agent)}${esc(agent)}</span>
        <span class="time">${esc(dur(rows, entry))}</span>
      </div>
      ${reason ? `<p class="handoff-reason">${esc(reason)}</p>` : ''}
      ${carried.length ? `<div class="carried"><span>carried over</span>${carried.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
    </div>
  </li>`;
}

function treeRow(entry, i, rows) {
  if (entry.agent === 'planner' && /^next:/.test(String(entry.action))) return handoffRow(entry, i, rows);
  const last = i === rows.length - 1 && state.playing;
  const failed = isFailure(entry);
  const open = state.openSteps.has(String(i));
  const mark = last ? '' : failed ? icon('warn') : icon('check');
  const cls = last ? '' : failed ? 'warn' : 'ok';
  return `<li>
    ${i ? '<i class="stem"></i>' : ''}
    <i class="elbow"></i>
    <button type="button" class="row" data-action="expand" data-step="${i}">
      <span class="status ${cls}">${mark}</span>
      ${AGENT_ICON[entry.agent] ? `<span class="aw-ico">${icon(AGENT_ICON[entry.agent])}</span>` : ''}
      <span class="name">${esc(entry.agent)}</span>
      <span class="detail ${last ? 'shimmer' : ''}">${esc(short(entry.action))}</span>
      <span class="time">${esc(dur(rows, entry))}</span>
      <span class="chev ${open ? 'open' : ''}">${icon('chev')}</span>
    </button>
    ${open ? `<div class="disclose ${expandEnter === String(i) && !reduced ? '' : 'in'}" data-step-panel="${i}"><div class="disclose-body"><pre class="step-detail">${esc(pretty(entry.detail))}</pre></div></div>` : ''}
  </li>`;
}

function terminalHtml(rows) {
  if (!rows.length) return '<p class="meta">Waiting for the first step.</p>';
  const lines = rows.map((entry, i) => {
    const full = pretty(entry.detail);
    const parts = full.split('\n');
    const open = state.openTerms.has(String(i));
    const showFull = state.termFull.has(String(i));
    const hidden = !showFull && parts.length > 12 ? parts.length - 8 : 0;
    const shown = hidden ? parts.slice(-8).join('\n') : full;
    const fail = isFailure(entry);
    return `<div class="term ${open ? 'open' : ''} ${fail ? 'fail' : ''}">
      <div class="term-bar">
        <button type="button" class="caret" data-action="term" data-step="${i}" aria-label="Toggle output">${open ? '▾' : '▸'}</button>
        <button type="button" class="cmd" data-action="term" data-step="${i}">${esc(entry.agent)} ${esc(short(entry.action))}</button>
        ${fail ? '<span class="exit">Exit 1</span>' : `<span class="dur">${esc(dur(rows, entry))}</span>`}
        <button type="button" class="copy" data-copy="${esc(`$ ${entry.agent} ${entry.action}\n${full}`)}">Copy</button>
      </div>
      ${open ? `<div class="disclose ${termEnter === String(i) && !reduced ? '' : 'in'}" data-term-panel="${i}"><div class="disclose-body">${hidden ? `<button type="button" class="earlier" data-action="term-full" data-step="${i}">${hidden} earlier lines</button>` : ''}<pre>${colorize(shown)}</pre></div></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="term-log">${lines}</div>`;
}

function colorize(text) {
  return esc(text).replace(/^(✓.*)$/gm, '<span class="ok-line">$1</span>').replace(/(rejected|dropped [1-9]|Exit 1|error)/gi, '<span class="err-line">$1</span>');
}

function stageHtml() {
  const rep = report();
  const address = esc(listingTitle());
  if (state.playing) {
    const enter = !state.stageEntered;
    state.stageEntered = true;
    // Working: the workflow stays put. The thinking line stays put. The steps scroll beneath it.
    return `<header class="report-hero generating${enter ? ' stage-enter' : ''}">
      <div class="work-pin">
        <h2 class="work-pin-title">Agentic workflow</h2>
        <div id="workflow">${workflowHtml()}</div>
      </div>
      <div class="work-steps" id="trace">${traceHtml()}</div>
    </header>`;
  }
  if (!rep) {
    return `<header class="report-hero"><h1>${address}</h1></header><div class="banner">This demo builds the report from the saved Argumosa runs. Load Calle Argumosa 11, 3º C, or the listing with no door, and generate again.</div>`;
  }
  const facts = citedFacts();
  const fact = facts[state.sourceAt] || facts[0];
  const finding = fact && rep.findings.find((f) => f.evidence.includes(fact.id));
  let n = 0;
  const hold = (i) => (state.reveal >= i ? '' : 'hold');
  const sec = (title, lead, body) => {
    const head = title || lead
      ? `<div class="sec-head">${title ? `<h2>${title}</h2>` : ''}${lead ? `<p>${lead}</p>` : ''}</div>`
      : '';
    return `<section class="sec ${hold(n)}" data-reveal="${n}">${head}${body}</section>`;
  };
  const blocks = [`<header data-reveal="${++n}" class="report-hero ${hold(n)}"><div class="hero-row"><h1>${address}</h1>${geoHtml(rep)}</div></header>`];
  ++n;
  blocks.push(sec('', '', `${statsHtml(rep)}${notesHtml(rep)}`));
  const tiles = findingsHtml(rep, n);
  n = tiles.next;
  blocks.push(`<section class="sec"><div class="sec-head"><h2>Each check</h2><p>Every figure links back to its source. Pick a number to see the exact line.</p></div>${tiles.html}</section>`);
  ++n;
  const aside = rep.questions.length && !sideWide() ? questionHtml(rep.questions[0]) : '';
  blocks.push(sec('Where it comes from', '', `<div class="bento two ${aside ? '' : 'solo'}">${sourceHtml(rep, finding, fact, facts)}${aside}</div>`));
  const email = emailHtml(rep, ++n);
  blocks.push(`<section class="sec ${hold(n)}" data-reveal="${n}"><div class="sec-head"><h2>Before you pay</h2><p>A draft you copy and send yourself. Nothing sends it for you.</p></div>${email}</section>`);
  state.revealTotal = n;
  const settled = state.reveal >= n ? 'settled' : '';
  return `<div class="report ${settled}">${blocks.join('')}<p class="meta">${esc(rep.provider)}, ${esc(when(rep.createdAt))}, run ${esc(rep.runId)}</p></div>`;
}

const SOURCE_WORDS = { listing: 'the listing', contract: 'the contract', catastro: 'Catastro', boe: 'the BOE', serpavi: 'SERPAVI', renter: 'your answers' };

function pageNames(fact) {
  return String(fact?.quote || '').split('|').map((part) => {
    const domain = part.trim().split(':')[0].trim();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : '';
  }).filter(Boolean);
}

function pageName(fact) {
  return pageNames(fact)[0] || '';
}

function webLead(rep) {
  const ids = new Set(rep.sources.filter((s) => s.kind === 'web').map((s) => s.id));
  const domains = [];
  for (const fact of rep.facts || []) {
    if (!ids.has(fact.sourceId)) continue;
    for (const domain of pageNames(fact)) {
      if (!domains.includes(domain)) domains.push(domain);
    }
  }
  return domains.length === 1 ? domains[0] : 'Google Lens';
}

function sourcesLead(rep) {
  const g = geoFacts(rep);
  const words = [...new Set(rep.sources.map((s) => s.kind))].map((k) => {
    if (k === 'serpavi' && g.year) return `SERPAVI ${g.year}`;
    if (k === 'web') return webLead(rep);
    return SOURCE_WORDS[k];
  }).filter(Boolean);
  if (!words.length) return '';
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  let text = `checked against ${list}`;
  if (g.areaCode) {
    const district = `${g.areaName || ''} census district ${g.areaCode}`.trim();
    text += ` (${district})`;
  }
  return esc(text);
}

function revealCount() {
  return state.revealTotal || 1;
}

function sourceHtml(rep, finding, fact, facts) {
  if (!fact) return '';
  const src = rep.sources.find((s) => s.id === fact.sourceId);
  const at = Math.max(0, state.sourceAt);
  const file = src?.kind === 'web' ? (pageName(fact) || 'Google Lens') : kindLabel(src);
  const status = [src?.version, src && src.live === false ? 'cached' : src ? 'live' : ''].filter(Boolean).join(' · ');
  const link = src?.url ? `<a class="sv-link" href="${esc(src.url)}" target="_blank" rel="noreferrer">Open source</a>` : '';
  const meta = [
    status ? `<span class="mono">${esc(status)}</span>` : '',
    fact.confidence ? `<span class="conf">${esc(fact.confidence)} confidence</span>` : '',
    link,
  ].filter(Boolean).join('');
  return `<section class="sv">
    <p class="sv-sentence">${finding ? sentence(finding, fact.id) : esc(fact.attribute)}</p>
    <article class="sv-card">
      <header class="sv-head">
        <div class="sv-head-copy">
          <span class="sv-label">${esc(src?.label || 'Source')}</span>
          ${file ? `<span class="sv-file mono">${esc(file)}</span>` : ''}
        </div>
        <div class="sv-nav">
          <button type="button" data-action="source-step" data-dir="-1" aria-label="Previous citation">⌃</button>
          <span>${at + 1} / ${facts.length}</span>
          <button type="button" data-action="source-step" data-dir="1" aria-label="Next citation">⌄</button>
        </div>
      </header>
      ${bodyFor(fact, src)}
      ${meta ? `<footer class="sv-foot"><div class="sv-meta">${meta}</div></footer>` : ''}
    </article>
  </section>`;
}

function sentence(finding, activeId) {
  const text = finding.explanation || finding.detail;
  const rep = report();
  const html = esc(text).replace(/\[(f\d+)\]/g, (_, id) => {
    const src = rep?.sources.find((s) => s.id === rep.facts.find((f) => f.id === id)?.sourceId);
    const name = src?.label ? ` aria-label="Source ${id.replace('f', '')}: ${esc(src.label)}"` : '';
    return `<button type="button" class="chip ${id === activeId ? 'on' : ''}" data-action="cite" data-fact="${id}"${name}>${id.replace('f', '')}</button>`;
  });
  return html;
}

// Inline citation preview (port of the Elements inline citation): one floating card,
// opened by hover or focus on a marker, filled from the fact and its source.
let citeTimer = 0;

function citeCard() {
  let card = $('cite-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'cite-card';
    card.className = 'cite-card';
    card.setAttribute('role', 'tooltip');
    card.hidden = true;
    document.body.appendChild(card);
    card.addEventListener('mouseenter', () => clearTimeout(citeTimer));
    card.addEventListener('mouseleave', () => hideCite());
  }
  return card;
}

function citeHtml(fact, src) {
  let domain = '';
  try { domain = src?.url ? new URL(src.url).host.replace(/^www\d?\./, '') : ''; } catch { domain = ''; }
  const stamp = src?.retrievedAt ? new Date(src.retrievedAt) : null;
  const date = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const meta = domain || date
    ? `<div class="cite-meta">${domain ? `<span class="cite-favicon">${esc(domain[0].toUpperCase())}</span><span class="mono">${esc(domain)}</span>` : ''}${date ? `<span class="mono">${esc(date)}</span>` : ''}</div>`
    : '';
  const snippet = fact.quote || [fact.value, fact.unit].filter((x) => x !== undefined && x !== '').join(' ');
  const link = src?.url ? `<a class="cite-link" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">Open source <span class="sr-only">(opens in a new tab)</span></a>` : '';
  return `${meta}<p class="cite-title ${meta ? 'spaced' : ''}">${esc(src?.label || kindLabel(src))}</p><p class="cite-snippet">${esc(snippet)}</p>${link}`;
}

function showCite(chip) {
  const rep = report();
  const fact = rep?.facts.find((f) => f.id === chip.dataset.fact);
  if (!fact) return;
  clearTimeout(citeTimer);
  const src = rep.sources.find((s) => s.id === fact.sourceId);
  const card = citeCard();
  card.innerHTML = citeHtml(fact, src);
  card.hidden = false;
  card.classList.remove('show');
  document.querySelectorAll('.chip[aria-expanded="true"]').forEach((c) => c.removeAttribute('aria-expanded'));
  chip.setAttribute('aria-expanded', 'true');
  const r = chip.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const gap = 8;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.top - h - gap;
  let side = 'top';
  if (top < 8) {
    top = r.bottom + gap;
    side = 'bottom';
  }
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
  card.style.setProperty('--ox', `${Math.round(r.left + r.width / 2 - left)}px`);
  card.dataset.side = side;
  // Layout was already flushed by the offsetWidth read above, so the transition starts from the hidden state.
  card.classList.add('show');
}

function hideCite(now = false) {
  clearTimeout(citeTimer);
  const card = $('cite-card');
  if (!card) return;
  const close = () => {
    card.classList.remove('show');
    document.querySelectorAll('.chip[aria-expanded="true"]').forEach((c) => c.removeAttribute('aria-expanded'));
    setTimeout(() => { if (!card.classList.contains('show')) card.hidden = true; }, reduced ? 0 : 200);
  };
  if (now) close();
  else citeTimer = setTimeout(close, 120);
}

function bodyFor(fact, src) {
  const quote = fact.quote || '';
  let body = '';
  let missing = false;
  if (src?.kind === 'listing') body = state.listingText;
  else if (src?.kind === 'contract') body = state.contractText;
  else if (src?.kind === 'boe') body = quote;
  else if (src?.kind === 'renter') body = `You answered ${fact.value}.`;
  else if (src?.kind === 'web') body = quote || [fact.value, fact.unit].filter((x) => x !== undefined && x !== '').join(' ');
  else body = [fact.value, fact.unit].filter((x) => x !== undefined && x !== '').join(' ');
  if (quote && body && !body.includes(quote)) missing = true;
  const marked = quote && body.includes(quote)
    ? esc(body).replace(esc(quote), `<mark class="active">${esc(quote)}</mark>`)
    : esc(body);
  return `${missing ? '<p class="missing">This quote is not in the text the screen has for that source.</p>' : ''}
    <div class="sv-doc"><div class="sv-body">${marked}</div></div>`;
}

function kindLabel(src) {
  if (!src) return '';
  if (src.kind === 'listing') return state.listingName || 'Listing';
  if (src.kind === 'renter') return 'Your answer';
  if (src.kind === 'web') return 'Google Lens';
  return src.kind;
}

function questionHtml(q) {
  const chosen = state.answers[q.attribute];
  return `<section class="ask">
    <h2>${esc(q.text)}</h2>
    <p class="why">${esc(q.reason)}</p>
    <div class="ask-options">${(q.options || []).map((option) => `<button type="button" data-action="door" data-value="${esc(option)}" class="${chosen === option ? 'on' : ''}"><i class="port"></i><span>${esc(option)}</span></button>`).join('')}</div>
    ${state.doorNote ? `<p class="note">${esc(state.doorNote)}</p>` : ''}
  </section>`;
}

function verdictFigure(rep) {
  const s = rep.summary || {};
  const total = (s.red || 0) + (s.amber || 0) + (s.unknown || 0) + (s.green || 0);
  const where = overviewWhere(rep);
  let huge;
  let label;
  if (s.red) {
    huge = `${s.red} flagged`;
    label = total === 1
      ? (where || 'from the listing checks')
      : (where ? `out of ${total} checks ${where}` : `out of ${total} checks on this listing`);
  } else if (s.amber) {
    huge = `${s.amber} to check`;
    label = total === 1
      ? (where ? `needs a closer look ${where}` : 'needs a closer look')
      : (where ? `out of ${total} checks ${where}` : `out of ${total} checks on this listing`);
  } else if (s.unknown) {
    huge = `${s.unknown} Unknown`;
    label = total === 1
      ? (where ? `could not be verified ${where}` : 'could not be verified')
      : (where ? `out of ${total} checks ${where}` : `out of ${total} checks on this listing`);
  } else {
    huge = `${s.green || 0} passed`;
    label = (s.green || 0) === 1
      ? (where ? `the check came back clear ${where}` : 'the check came back clear')
      : (where ? `every check came back clear ${where}` : 'every check came back clear');
  }
  const rows = [
    s.red ? ['red', 'flagged', s.red] : null,
    s.amber ? ['amber', 'to check', s.amber] : null,
    s.unknown ? ['unknown', 'Unknown', s.unknown] : null,
    s.green ? ['green', 'passed', s.green] : null,
  ].filter(Boolean);
  const segs = rows.map(([k, , v]) => `<i class="seg ${k}" data-share="${v}"></i>`).join('');
  const board = rows.map(([k, name, v]) => `<div class="check-row">
      <span><i class="dot ${k}"></i>${name}</span>
      <b>${v}</b>
    </div>`).join('');
  const lead = sourcesLead(rep);
  return `<article class="tile overview">
    <p class="huge">${esc(huge)}</p>
    <p class="overview-line"><span class="huge-label">${esc(label)}</span>${lead ? `<span class="overview-lead">${lead}</span>` : ''}</p>
    <div class="check-board">
      <div class="segments" aria-hidden="true">${segs}</div>
      <div class="check-rows">${board}</div>
    </div>
  </article>`;
}

function priceFacts(rep) {
  const price = rep.findings.find((f) => f.checkId === 'price');
  const cited = new Set(price?.evidence || []);
  const find = (attr) => rep.facts.find((f) => f.attribute === attr && cited.has(f.id)) || rep.facts.find((f) => f.attribute === attr);
  const p50 = find('ref.eur_m2_p50');
  const p75 = find('ref.eur_m2_p75');
  const rent = find('terms.rent_eur');
  const area = find('unit.area_m2');
  if (!p50 || !p75 || !rent || !area || !Number(area.value)) return null;
  return { p50: Number(p50.value), p75: Number(p75.value), rent: Number(rent.value), area: Number(area.value), rate: Number(rent.value) / Number(area.value), unit: p50.unit || '€/m²' };
}

function statsHtml(rep) {
  const p = priceFacts(rep);
  const tiles = [verdictFigure(rep)];
  if (p) {
    const delta = Math.round(((p.rate - p.p50) / p.p50) * 100);
    tiles.push(`<article class="tile chart-tile">
      <p class="huge">${delta > 0 ? '+' : ''}${delta}%</p>
      <p class="huge-label">rent per m² ${delta >= 0 ? 'above' : 'below'} the area median</p>
      ${priceScale(rep)}
    </article>`);
  }
  return `<div class="bento two ${p ? '' : 'solo'}">${tiles.join('')}</div>`;
}

const ATTR = {
  'unit.area_m2': ['Size', 'm²'],
  'terms.rent_eur': ['Rent', '€'],
  'terms.deposit_months': ['Deposit asked', 'months'],
  'law.max_deposit_months': ['Legal maximum', 'months'],
  'terms.agency_fee_eur': ['Agency fee', '€'],
  'terms.agency_fee_to_tenant': ['Agency fee charged to the tenant', ''],
  'law.agency_fees_forbidden': ['Charging the tenant is forbidden', ''],
  'terms.rent_insurance_required': ['Rent insurance required', ''],
  'law.rent_insurance_forbidden': ['Requiring it is forbidden', ''],
  'terms.taxes_to_tenant': ['Property tax charged to the tenant', ''],
  'law.taxes_to_tenant_forbidden': ['Passing it on is forbidden', ''],
  'unit.use': ['Registered use', ''],
  'ref.eur_m2_p50': ['Area median', '€/m²'],
  'ref.eur_m2_p75': ['Area 75th percentile', '€/m²'],
};
const CLAIM_KINDS = new Set(['listing', 'contract', 'renter']);

function attrLabel(attr) {
  if (ATTR[attr]) return ATTR[attr];
  return [attr.split('.').pop().replace(/_/g, ' '), ''];
}

function sourceName(rep, fact) {
  const src = rep.sources.find((s) => s.id === fact.sourceId);
  if (!src) return '';
  if (src.kind === 'listing') return 'Listing';
  if (src.kind === 'contract') return 'Contract';
  if (src.kind === 'catastro') return 'Catastro';
  if (src.kind === 'serpavi') return 'SERPAVI';
  if (src.kind === 'renter') return 'You';
  return src.label || src.kind;
}

function compareHtml(rep, finding) {
  const byId = Object.fromEntries(rep.facts.map((f) => [f.id, f]));
  const cited = (finding.evidence || []).map((id) => byId[id]).filter(Boolean);
  const kindOf = (f) => rep.sources.find((s) => s.id === f.sourceId)?.kind;
  if (finding.checkId === 'price') {
    const p = priceFacts(rep);
    if (!p) return '';
    return statPair(
      { value: num(p.rate), unit: '€/m²', label: 'This listing', source: 'Rent and size on record' },
      { value: num(p.p50), unit: '€/m²', label: 'Area median', source: 'SERPAVI' },
    );
  }
  const claims = cited.filter((f) => CLAIM_KINDS.has(kindOf(f)));
  const refs = cited.filter((f) => !CLAIM_KINDS.has(kindOf(f)));
  const numClaim = claims.find((f) => Number.isFinite(Number(f.value)) && typeof f.value !== 'boolean');
  const numRef = refs.find((f) => Number.isFinite(Number(f.value)) && typeof f.value !== 'boolean');
  if (numClaim && numRef) {
    const a = Number(numClaim.value);
    const b = Number(numRef.value);
    const [la, ua] = attrLabel(numClaim.attribute);
    const [lb, ub] = attrLabel(numRef.attribute);
    return statPair(
      { value: num(a), unit: ua, label: la, source: sourceName(rep, numClaim) },
      { value: num(b), unit: ub, label: lb, source: sourceName(rep, numRef) },
    );
  }
  const rows = cited.map((f) => {
    const [label, unitHint] = attrLabel(f.attribute);
    const claim = CLAIM_KINDS.has(kindOf(f));
    let value = f.value;
    if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
    if (value === null || value === undefined || value === '') return '';
    const unit = typeof f.value === 'boolean' ? '' : (f.unit || unitHint);
    const show = typeof f.value === 'boolean' && !claim ? '' : `<b>${esc(String(value))}${unit ? ` ${esc(unit)}` : ''}</b>`;
    return `<li><i class="dot ${claim ? 'coral' : 'teal'}"></i><span class="who">${esc(sourceName(rep, f))}</span><span class="what">${esc(label)}</span>${show}</li>`;
  }).filter(Boolean);
  return rows.length ? `<ul class="fact-rows">${rows.join('')}</ul>` : '';
}

function statPair(a, b) {
  const cell = (c) => `<div class="cmp">
      <b>${esc(c.value)}<small>${esc(c.unit)}</small></b>
      <span class="cmp-label">${esc(c.label)}</span>
      <span class="cmp-src">${esc(c.source)}</span>
    </div>`;
  return `<div class="compare">${cell(a)}${cell(b)}</div>`;
}

function findingsHtml(rep, start) {
  let n = start;
  const hold = (i) => (state.reveal >= i ? '' : 'hold');
  const tile = (f, index) => `<article class="tile finding ${f.status} ${hold(index)}" data-reveal="${index}">
      <div class="tile-head"><span class="ico flag">${statusFlag(f.status)}</span><span>${esc(f.title)}</span></div>
      <p class="explain">${sentence(f, '')}</p>
      ${holdLine(f)}
      ${compareHtml(rep, f)}
      ${f.question ? `<div class="askline"><p class="askline-kicker">Ask the landlord</p><p class="askline-bubble">${esc(f.question)}</p></div>` : ''}
    </article>`;
  const parts = rep.findings.map((f) => tile(f, ++n));
  return { html: `<div class="bento two">${parts.join('')}</div>`, next: n };
}

// One painted square from the Spain map. Bars use that same thickness.
function mapCellPx() {
  const rect = document.querySelector('.report .dither .land rect');
  const w = rect?.getBoundingClientRect().width || 0;
  if (w >= 1) return Math.round(w * 100) / 100;
  return 0;
}

// Play the stroke along the bar. No-op while the bar is still held, and
// no-op under reduced motion so the full bar stays visible.
function replayBar(bar) {
  if (!bar) return;
  bar.classList.remove('is-filling');
  if (bar.closest('.hold')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  void bar.offsetWidth;
  bar.classList.add('is-filling');
}

function layoutPixelBars() {
  const root = document.querySelector('.report');
  if (!root) return;
  const cell = mapCellPx();
  if (cell) {
    root.style.setProperty('--dither-cell', `${cell}px`);
    /* Same gap the map leaves between cells: pitch 1.4, cell width 1. */
    root.style.setProperty('--dither-gap', `${Math.round(cell * (SCENE_P - 1) * 100) / 100}px`);
  }
  const stroke = cell || 5;

  root.querySelectorAll('.segments').forEach((bar) => {
    const segs = [...bar.querySelectorAll(':scope > .seg')];
    if (!segs.length) return;
    const key = `line:${stroke}:${segs.map((seg) => seg.dataset.share || '0').join(',')}`;
    if (bar.dataset.px === key) return;
    bar.dataset.px = key;
    segs.forEach((seg) => {
      seg.style.setProperty('--share', seg.dataset.share || '0');
      seg.style.width = '';
      seg.replaceChildren();
    });
    replayBar(bar);
  });

  root.querySelectorAll('.col-bar').forEach((bar, idx) => {
    bar.style.setProperty('--i', String(idx));
    const track = bar.closest('.col-track');
    const trackH = track?.clientHeight || 0;
    if (!trackH) return;
    const pct = Number(bar.dataset.pct);
    const ratio = Number.isFinite(pct) ? pct / 100 : 0;
    const height = Math.max(stroke, Math.round(ratio * trackH));
    const key = `line:${stroke}:${height}`;
    if (bar.dataset.px === key) return;
    bar.dataset.px = key;
    bar.style.width = `${stroke}px`;
    bar.style.height = `${height}px`;
    bar.replaceChildren();
    replayBar(bar);
  });
}

function priceScale(rep) {
  const p = priceFacts(rep);
  if (!p) return '';
  const max = Math.max(p.rate, p.p50, p.p75) * 1.1;
  const h = (v) => Math.max(4, Math.min(100, (v / max) * 100));
  const cols = [
    ['teal', 'Area median', p.p50],
    ['muted', '75th percentile', p.p75],
    ['coral', 'This listing', p.rate],
  ];
  return `<div class="columns" role="img" aria-label="${esc(cols.map(([, l, v]) => `${l} ${num(v)} ${p.unit}`).join(', '))}">
    ${cols.map(([tone, label, v]) => `<div class="col">
      <b>${esc(num(v))}</b>
      <span class="col-track"><i class="col-bar ${tone}" data-pct="${h(v)}"></i></span>
      <span class="col-label">${label}</span>
    </div>`).join('')}
  </div>`;
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

function notesHtml(rep) {
  const notes = Array.isArray(rep.notes) ? rep.notes.map((n) => n?.text).filter(Boolean) : [];
  if (!notes.length) return '';
  return `<p class="report-notes">${notes.map((text) => esc(text)).join(' ')}</p>`;
}

function holdLine(f) {
  const bits = [];
  if (f.needsReview) bits.push('Held out of the email.');
  if (Array.isArray(f.caveats) && f.caveats.length) bits.push(...f.caveats);
  if (!bits.length) return '';
  return `<p class="held">${esc(bits.join(' '))}</p>`;
}

function emailHtml(rep, index) {
  const hold = state.reveal >= index ? '' : 'hold';
  const email = rep.email;
  if (!email?.body) {
    return `<div class="email-wrap ${hold}" data-reveal="${index}">
      <article class="letter">
        <div class="logo">Casa</div>
        <h2>Nothing to raise</h2>
        <p class="intro">The checks that ran did not produce a question for the landlord.</p>
        <div class="panel"><p>Nothing to raise with the landlord before you pay.</p></div>
      </article></div>`;
  }
  const subject = email.subject || 'Before you pay';
  const letter = String(email.body).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    .map((part) => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`).join('');
  const names = (email.covers || []).map((id) => rep.findings.find((f) => f.checkId === id)?.title || id);
  const via = email.via === 'template'
    ? 'The fixed wording was used after the tone check.'
    : 'Checked for tone, figures, and personal data.';
  const copy = `${subject}\n\n${email.body}`;
  return `<div class="email-wrap ${hold}" data-reveal="${index}">
    <article class="letter">
      <div class="logo">Casa</div>
      <h2>${esc(subject)}</h2>
      <p class="intro">A draft. Copy it and send it yourself.</p>
      <div class="panel">${letter}</div>
      <dl class="facts">
        <div><dt>Status</dt><dd>Draft</dd></div>
        ${names.length ? `<div><dt>Covers</dt><dd>${esc(names.join(', '))}</dd></div>` : ''}
      </dl>
      <button type="button" class="copy-btn" data-copy="${esc(copy)}">Copy the message</button>
      <p class="email-foot">${esc(via)} Nothing sends itself.</p>
    </article></div>`;
}

function citedFacts() {
  const rep = report();
  if (!rep) return [];
  const ids = new Set(rep.findings.flatMap((f) => f.evidence));
  return rep.facts.filter((f) => ids.has(f.id));
}

function stepSource(dir) {
  const facts = citedFacts();
  if (!facts.length) return;
  state.sourceAt = (state.sourceAt + dir + facts.length) % facts.length;
  paintStage();
}

function armDisclose(selector) {
  const nodes = [...document.querySelectorAll(selector)];
  if (!nodes.length) return;
  if (reduced) {
    nodes.forEach((el) => el.classList.add('in'));
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nodes.forEach((el) => el.classList.add('in'));
    });
  });
}

function foldAway(selector) {
  const el = document.querySelector(selector);
  if (!el || reduced) return Promise.resolve();
  el.classList.add('out');
  el.classList.remove('in');
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    el.addEventListener('transitionend', (event) => {
      if (event.target === el) finish();
    });
    setTimeout(finish, 320);
  });
}

function closeThen(selector, apply) {
  if (folding) return;
  folding = true;
  foldAway(selector).then(() => {
    folding = false;
    apply();
  });
}

function toggleSet(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
  paintTrace();
}

function isFailure(entry) {
  return /rejected|dropped [1-9]/i.test(String(entry.action));
}

function pretty(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function short(text) {
  const s = String(text ?? '');
  return s.length > 72 ? `${s.slice(0, 69)}…` : s;
}

function trim(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function dur(rows, entry) {
  const i = rows.indexOf(entry);
  if (i <= 0) return '0s';
  return seconds(Date.parse(entry.t) - Date.parse(rows[i - 1].t));
}

function seconds(ms) {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function when(iso, timeOnly) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (timeOnly) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Brand mark: the same 3×4 dither house used on the Spain map, scaled into the 18×18 icon box.
function houseMark() {
  const cell = 2.6;
  const gap = 1;
  const pitch = cell + gap;
  const ox = (18 - (3 * pitch - gap)) / 2;
  const oy = (18 - (4 * pitch - gap)) / 2;
  let out = '';
  HOUSE.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== '#') return;
      out += `<rect x="${(ox + c * pitch).toFixed(1)}" y="${(oy + r * pitch).toFixed(1)}" width="${cell}" height="${cell}" fill="currentColor"/>`;
    });
  });
  return out;
}

// Stroke path table for nav chrome and shared UI marks (sidebar, rail, drops, field controls).
// Workflow / plan diagram nodes still use dither via pix() → PX.ico; brand mark stays houseMark().
const STROKE_ICONS = {
  scan: '<path d="M3 6V3h3M13 3h3v3M16 13v3h-3M6 16H3v-3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9.5" cy="9.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  check: '<path d="M4 9.2 7.2 12.4 14 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M9 4.2 15.2 15H2.8L9 4.2z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 8v3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  model: '<path d="M9 2.2 10.2 6 14 7.2 10.2 8.4 9 12.2 7.8 8.4 4 7.2 7.8 6 9 2.2z" fill="currentColor"/>',
  condition: '<circle cx="5" cy="5" r="1.3" fill="currentColor"/><circle cx="13" cy="6" r="1.3" fill="currentColor"/><circle cx="13" cy="13" r="1.3" fill="currentColor"/><path d="M6.2 5.6h5M6 6.4 12 12.2" stroke="currentColor" stroke-width="1.2" fill="none"/>',
  tool: '<path d="M7 11.5 3.6 14.2l-1-1.7L6.2 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11" cy="6.5" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  doc: '<path d="M5 2.5h6l3 3V15.5H5v-13z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 2.6V6h3.2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  compose: '<path d="M11.2 3.4 14.6 6.8 6.4 15H3.2v-3.2L11.2 3.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  book: '<path d="M5 3.2h8.2v11.6H5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 3.2v11.6M7.4 6.2h3.6M7.4 8.6h3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  house: '<path d="M3.2 8 9 3.4 14.8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 7.4V14.6h8V7.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  scale: '<path d="M9 2.8v11.2M5.4 14.6h7.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.6 6.2h2.2c1.2 0 2.8-.6 4.2-1.3 1.4.7 3 1.3 4.2 1.3h2.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 6.2 1.6 9.6c.5.7 1.3 1.1 2.2 1.1s1.7-.4 2.2-1.1L4.8 6.2M13.2 6.2 12 9.6c.5.7 1.3 1.1 2.2 1.1s1.7-.4 2.2-1.1L15.2 6.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  listing: '<path d="M4.5 2.8h6.2l3 3v9.4h-9.2V2.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.5 2.9V6h3.1M6.6 9h5M6.6 11.4h3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  tag: '<path d="M3.4 8.1 8 3.5h6.2v6.2L8.6 15.3 3.4 8.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="11.6" cy="6.2" r="0.9" fill="currentColor"/>',
  camera: '<path d="M3.2 6.6h2.3l1.1-1.6h4.8l1.1 1.6h2.3v7.2H3.2V6.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  clipboard: '<path d="M6.4 3.2h5.2v1.8H6.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.2 4.1H5v11h8V4.1h-2.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 9.4 8.3 10.7 11.2 7.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  glass: '<circle cx="7.6" cy="7.6" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.6 10.6 15 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  person: '<circle cx="9" cy="5.2" r="2.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.2 15.4v-.6a3.1 3.1 0 0 1 3.1-3.1h3.4a3.1 3.1 0 0 1 3.1 3.1v.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  shield: '<path d="M9 2.6 14.6 4.8v4.2c0 3.1-2.2 5-5.6 6.4-3.4-1.4-5.6-3.3-5.6-6.4V4.8L9 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  bubble: '<path d="M3.2 4.2h11.6v7.2H8.2L6 13.6V11.4H3.2V4.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  mail: '<path d="M3.2 5h11.6v8.4H3.2V5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.4 5.4 9 9.6l5.6-4.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  reports: '<path d="M3.5 5h11M3.5 9h11M3.5 13h7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  panel: '<rect x="3" y="3.5" width="12" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 3.5v11" stroke="currentColor" stroke-width="1.3"/>',
  chev: '<path d="M7 4.5 12 9 7 13.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M5 5l8 8M13 5l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

function icon(name) {
  if (name === 'mark') {
    return `<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges">${houseMark()}</svg>`;
  }
  if (STROKE_ICONS[name]) {
    return `<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true">${STROKE_ICONS[name]}</svg>`;
  }
  return '<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true"></svg>';
}

boot();
