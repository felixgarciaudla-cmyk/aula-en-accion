
document.addEventListener('DOMContentLoaded', () => {
const config = JSON.parse(document.getElementById('course-settings').textContent);
const clock = document.querySelector('#course-clock');
const clockTime = document.querySelector('#course-time');
const timeZone = config.timeZone;
const clockFormats = ['h23', 'h12'].map(hourCycle => new Intl.DateTimeFormat('es-EC', {
  timeZone, hourCycle, hour:'2-digit', minute:'2-digit', second:'2-digit',
}));
const clockDate = new Intl.DateTimeFormat('es-EC', {timeZone, dateStyle:'full'});
function updateClock() {
  const now = new Date();
  const twelveHour = clock.getAttribute('aria-pressed') === 'true';
  clockTime.textContent = clockFormats[Number(twelveHour)].format(now);
  clockTime.dateTime = now.toISOString();
  clock.title = clockDate.format(now) + ' · Cambiar a formato de ' + (twelveHour ? '24' : '12') + ' horas';
}
clock.addEventListener('click', () => {
  clock.setAttribute('aria-pressed', String(clock.getAttribute('aria-pressed') !== 'true'));
  updateClock();
});
updateClock();
setInterval(updateClock, 1000);

const slides = Array.from(document.querySelectorAll('.slide'));
const slideById = new Map(slides.map((slide, i) => [slide.getAttribute('aria-labelledby'), i]));
const index = document.querySelector('#slide-index');
const attendanceDialog = document.getElementById('attendance-dialog');
const sendEndpoint = config.server ? new URL('/api/practicas/envio', config.server) : null;
if (!sendEndpoint) {
  document.querySelectorAll('#open-attendance,#open-report,[data-group-question],[data-group-results]')
    .forEach(button => { button.hidden = true; });
}
const groupButtons = [...document.querySelectorAll('[data-group-question]')];
const storagePrefix = 'curso-interactivo:' + config.slug + ':' + (config.server || 'local') + ':';
const groupKeyName = storagePrefix + 'envio';
let presentationKey = '';
let groupSendRequest;

function getPresentationKey() {
  if (presentationKey) return presentationKey;
  try { presentationKey = localStorage.getItem(groupKeyName) || ''; } catch {}
  if (!/^[0-9a-f]{64}$/.test(presentationKey)) {
    presentationKey = [...crypto.getRandomValues(new Uint8Array(32))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(groupKeyName, presentationKey); } catch {}
  }
  return presentationKey;
}

function requestPresentation(endpoint, action, fields, signal) {
  return fetch(endpoint, {
    method:'POST', credentials:'omit', cache:'no-store', signal,
    headers:{Authorization:'Bearer ' + getPresentationKey()},
    body:new URLSearchParams({accion:action, ...fields}),
  });
}

function requestGroup(action, question, signal) {
  const fields = question ? {pregunta:question} : {};
  if (action === 'enviar') fields.reinicio = lastReset;
  return requestPresentation(sendEndpoint, action, fields, signal);
}

for (const button of groupButtons) {
  button.addEventListener('click', async () => {
    if (groupSendRequest || resetButton.disabled) return;
    const status = button.closest('.quiz').querySelector('.group-status');
    const setup = status.querySelector('.group-setup');
    const message = status.querySelector('.group-message');
    setup.hidden = true;
    message.textContent = '';
    const controller = new AbortController();
    groupSendRequest = controller;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await requestGroup('enviar', button.dataset.groupQuestion, controller.signal);
      if (controller.signal.aborted) return;
      if (response.ok) {
        for (const other of document.querySelectorAll('.group-message')) {
          if (other !== message) other.textContent = '';
        }
        for (const control of groupButtons) {
          control.toggleAttribute('data-complete', control === button);
          control.setAttribute('aria-pressed', String(control === button));
        }
        const announcement = document.getElementById('group-announcement');
        announcement.textContent = 'Pregunta enviada.';
        if (resultsDialog.open && activeQuestion === button.dataset.groupQuestion) {
          stopResults();
          void refreshGroupResults();
        }
      } else if (response.status === 401) {
        message.textContent = 'Vincula la presentación para habilitar el envío directo.';
        setup.hidden = false;
      } else if (response.status === 409) {
        await checkSessionReset();
        if (!controller.signal.aborted) message.textContent = 'La jornada cambió. Pulsa de nuevo para enviar a la jornada activa.';
      } else {
        throw new Error('No se pudo enviar la pregunta.');
      }
    } catch {
      if (!controller.signal.aborted) message.textContent = 'No se pudo enviar la pregunta. Comprueba la conexión e inténtalo de nuevo.';
    } finally {
      groupSendRequest = undefined;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}
for (const setup of document.querySelectorAll('.group-setup')) {
  setup.addEventListener('click', () => {
    void openPresentationLink(false);
  });
}

const qrMarkSource = config.qrMark;
const resultsDialog = document.getElementById('group-results-dialog');
const linkDialog = document.getElementById('presentation-link-dialog');
const courseLinkDialog = document.getElementById('course-link-dialog');
const resultsChart = document.getElementById('group-results-chart');
const resultsStatus = document.getElementById('group-results-status');
const resultsContext = document.getElementById('group-results-context');
const resultsQuestion = document.getElementById('group-results-question');
const resultLinkButton = resultsDialog.querySelector('[data-open-link-dialog]');
const teacherStatus = document.getElementById('cover-action-status');
const teacherLinkButton = document.getElementById('link-teacher-tools');
const linkStatus = document.getElementById('teacher-link-status');
const qrImage = document.getElementById('teacher-link-qr');
const qrCopy = document.getElementById('teacher-link-copy');
const qrUrl = document.getElementById('teacher-link-url');
const controlEndpoint = sendEndpoint && new URL('/api/presentacion', sendEndpoint);
let resultRequest;
let resultTimer;
let activeQuestion;
let resultStatusKey;
let linkRequest;
let linkTimer;
let coverActionBusy = false;

function modalIsOpen() {
  return Boolean(document.querySelector('dialog[open]'));
}

function showModal(dialog) {
  suspendPresentationPointer();
  setPresentationToolsOpen(false);
  dialog.showModal();
}

// Treat Escape as a local dismiss action before the browser can leave fullscreen.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !modalIsOpen()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const open = [...document.querySelectorAll('dialog[open]')];
  const top = open.at(-1);
  if (top === attendanceDialog) void closeAttendanceDialog();
  else top.close();
}, {capture:true});

function stopResults() {
  resultRequest?.abort();
  clearTimeout(resultTimer);
}

async function refreshGroupResults() {
  if (!resultsDialog.open || document.hidden) return;
  const controller = new AbortController();
  resultRequest = controller;
  try {
    const response = await requestGroup('resultados', activeQuestion, controller.signal);
    if (controller.signal.aborted) return;
    if (response.status === 401) {
      resultsChart.hidden = true;
      resultsStatus.textContent = 'Vincula la presentación para consultar las respuestas.';
      resultLinkButton.hidden = false;
      return;
    }
    if (!response.ok) throw Error();
    const counts = await response.json();
    if (controller.signal.aborted) return;
    const {correct, incorrect, total, session, round} = counts;
    if (![correct, incorrect, total, session, round].every(n => Number.isSafeInteger(n) && n >= 0)
        || correct + incorrect !== total) throw Error();
    for (const [key, number] of Object.entries({correct, incorrect, total})) {
      const row = resultsChart.querySelector('[data-result="' + key + '"]');
      row.querySelector('strong').textContent = String(number);
      row.style.setProperty('--result-width', (total ? number / total * 100 : 0) + '%');
      row.toggleAttribute('data-empty', !number);
    }
    resultsChart.hidden = false;
    const statusKey = [session,round,correct,incorrect,total].join(':');
    if (resultStatusKey !== statusKey) {
      resultStatusKey = statusKey;
      resultsStatus.textContent = total ? 'Actualización automática cada 4 segundos.' : 'Aún no se reciben respuestas para esta práctica.';
    }
  } catch {
    if (controller.signal.aborted) return;
    resultStatusKey = undefined;
    resultsStatus.textContent = 'No se pudieron actualizar los resultados. La consulta se reintentará.';
  }
  if (resultsDialog.open && !controller.signal.aborted) resultTimer = setTimeout(refreshGroupResults, 4000);
}

for (const trigger of document.querySelectorAll('[data-group-results]')) {
  trigger.addEventListener('click', () => {
    activeQuestion = trigger.dataset.groupResults;
    const slide = trigger.closest('.slide');
    const label = slide.querySelector('.kicker').textContent.trim();
    const title = document.getElementById(slide.getAttribute('aria-labelledby')).textContent.trim();
    resultsContext.textContent = label + ' · ' + title;
    resultsQuestion.textContent = trigger.closest('.quiz').querySelector('h3').textContent.trim();
    trigger.toggleAttribute('data-complete', true);
    trigger.setAttribute('aria-expanded', 'true');
    resultsDialog.addEventListener('close', () => trigger.setAttribute('aria-expanded','false'), {once:true});
    resultsChart.hidden = true;
    resultStatusKey = undefined;
    resultLinkButton.hidden = true;
    resultsStatus.textContent = 'Consultando respuestas…';
    showModal(resultsDialog);
    void refreshGroupResults();
  });
}
resultsDialog.addEventListener('close', stopResults);

function makeQr(url) {
  const code = qrcode(0, qrMarkSource ? 'H' : 'M');
  code.addData(url);
  code.make();
  const plain = code.createSvgTag(1, 4);
  const size = code.getModuleCount() + 8;
  const badge = 7;
  const center = size / 2;
  const svg = qrMarkSource ? plain.replace('</svg>',
    '<rect x="' + (center - badge / 2) + '" y="' + (center - badge / 2) +
    '" width="' + badge + '" height="' + badge + '" fill="white"/>' +
    '<image x="' + (center - 2.1) + '" y="' + (center - 2.7) +
    '" width="4.2" height="5.4" href="' + qrMarkSource + '"/></svg>') : plain;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function stopLinkCheck() {
  linkRequest?.abort();
  clearTimeout(linkTimer);
}

async function checkLink(requiredControls) {
  if (!linkDialog.open) return;
  const controller = new AbortController();
  linkRequest = controller;
  const check = requiredControls ? requestTeacher('jornada', {}, controller.signal) : requestGroup('estado', undefined, controller.signal);
  try {
    const response = await check;
    if (controller.signal.aborted) return;
    if (response.ok) {
      linkStatus.textContent = requiredControls ? 'Controles del docente habilitados. Cierra esta ventana para continuar.' : 'Presentación vinculada. Cierra esta ventana para continuar.';
      qrImage.hidden = qrCopy.hidden = true;
      if (requiredControls) {
        setCoverStatus('');
        teacherLinkButton.hidden = true;
      }
      return;
    }
    if (response.status !== 401 && response.status !== 403) throw Error();
  } catch {
    if (controller.signal.aborted) return;
    linkStatus.textContent = 'Comprueba la conexión para completar el vínculo.';
  }
  if (linkDialog.open && !controller.signal.aborted) linkTimer = setTimeout(() => checkLink(requiredControls), 3500);
}

async function openPresentationLink(requiredControls) {
  const hadResults = resultsDialog.open;
  stopResults();
  qrImage.hidden = qrCopy.hidden = true;
  linkStatus.textContent = 'Preparando código QR…';
  showModal(linkDialog);
  const existing = new AbortController();
  linkRequest = existing;
  linkDialog.addEventListener('close', () => {
    stopLinkCheck();
    if (hadResults && resultsDialog.open) {
      resultLinkButton.hidden = true;
      void refreshGroupResults();
    }
    if (attendanceDialog.open && !attendanceKey) startAttendance();
  }, {once:true});
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getPresentationKey()));
    if (existing.signal.aborted) return;
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const url = new URL('/practicas/vincular', sendEndpoint);
    url.hash = new URLSearchParams({vinculo:fingerprint});
    qrUrl.value = url.href;
    qrImage.src = makeQr(url.href);
    qrImage.hidden = qrCopy.hidden = false;
    linkStatus.textContent = requiredControls ? 'Activa «Habilitar reporte y reinicio» al confirmar.' : 'Esperando la autorización del docente…';
    void checkLink(requiredControls);
  } catch {
    if (!existing.signal.aborted) linkStatus.textContent = 'No se pudo preparar el vínculo. Cierra esta ventana y vuelve a intentarlo.';
  }
}

for (const button of document.querySelectorAll('[data-open-link-dialog]')) {
  button.addEventListener('click', () => void openPresentationLink(button === teacherLinkButton));
}
qrUrl.addEventListener('focus', () => qrUrl.select());

function requestTeacher(action, fields, signal) {
  return requestPresentation(controlEndpoint, action, fields, signal);
}

let coverStatusTimer;
function setCoverStatus(text, visible = true, temporary = false) {
  clearTimeout(coverStatusTimer);
  teacherStatus.hidden = !text;
  teacherStatus.classList.toggle('sr', !visible);
  teacherStatus.textContent = text;
  if (temporary) coverStatusTimer = setTimeout(() => setCoverStatus(''), 2400);
}

function showTeacherAccess() {
  setCoverStatus('Autoriza los controles del docente.', false, true);
  teacherLinkButton.hidden = false;
}

function downloadReport(response) {
  return response.blob().then(blob => {
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
    download.href = url;
    download.download = filename || 'Reporte_' + config.slug + '.pdf';
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

const resetButton = document.querySelector('[data-teacher-tool="reiniciar"]');
let pendingReset = null;
for (const button of document.querySelectorAll('[data-teacher-tool]')) {
  button.addEventListener('click', async () => {
    if (coverActionBusy) return;
    const action = button.dataset.teacherTool;
    if (!controlEndpoint && action === 'reiniciar') {
      resetCourseActivities();
      go('portada');
      setCoverStatus('Presentación reiniciada.', true, true);
      return;
    }
    coverActionBusy = button.disabled = true;
    teacherLinkButton.hidden = true;
    if (action === 'reiniciar') setCoverStatus('Reiniciando jornada…');
    else setCoverStatus('Preparando el PDF…', false);
    try {
      if (action === 'reiniciar' && !pendingReset) {
        const current = await requestTeacher('jornada', {});
        if (current.status === 401 || current.status === 403) return showTeacherAccess(current.status);
        if (!current.ok) throw Error();
        const {date, number, revision} = await current.json();
        pendingReset = {fecha:date, jornada:number, revision:revision ?? 0};
      }
      const response = await requestTeacher(action, action === 'reiniciar' ? pendingReset : {});
      if (response.status === 401 || response.status === 403) {
        if (action === 'reiniciar') pendingReset = null;
        return showTeacherAccess(response.status);
      }
      if (!response.ok) {
        if (action === 'reiniciar' && response.status === 400) pendingReset = null;
        throw Error();
      }
      if (action === 'reporte') {
        if (!response.headers.get('Content-Type')?.includes('pdf')) throw Error();
        await downloadReport(response);
        setCoverStatus('');
      } else {
        const {date, number, revision, reset} = await response.json();
        const {fecha, jornada, revision:previousRevision} = pendingReset;
        if (number !== jornada || date !== fecha || !Number.isSafeInteger(revision) ||
            revision <= previousRevision || !isResetMarker(reset)) throw Error();
        // The status poll or another tab may already have seen this same reset.
        pendingReset = null;
        applySessionReset(reset < lastReset ? lastReset : reset, true);
        go('portada');
        setCoverStatus('Jornada reiniciada.', true, true);
      }
    } catch {
      setCoverStatus(action === 'reporte' ? 'No se pudo descargar el PDF. Inténtalo de nuevo.'
        : 'No se pudo confirmar el reinicio. Inténtalo de nuevo.', true, true);
    } finally {
      coverActionBusy = button.disabled = false;
    }
  });
}

const attendanceLink = document.getElementById('attendance-link-value');
const attendanceLinkStatus = document.getElementById('attendance-link-status');
const attendanceQr = document.getElementById('attendance-live-qr');
const attendanceProjection = document.getElementById('attendance-projection');
const attendanceClose = document.getElementById('attendance-close');
const attendanceRetry = document.getElementById('attendance-retry');
let attendanceKey = '';
let attendanceRenewal;
let attendanceExpiry;
let attendanceRequest = Promise.resolve();

function attendanceMessage(message) {
  attendanceLinkStatus.textContent = message;
}

function stopAttendanceTimers() {
  clearTimeout(attendanceRenewal);
  clearTimeout(attendanceExpiry);
}

function hideAttendanceLink() {
  attendanceProjection.hidden = true;
  attendanceLink.value = '';
  attendanceQr.removeAttribute('src');
}

function renewAttendance(key, expires) {
  stopAttendanceTimers();
  attendanceRenewal = setTimeout(() => void sendAttendance('renovar', key), 25_000);
  attendanceExpiry = setTimeout(() => {
    if (attendanceKey !== key) return;
    hideAttendanceLink();
    attendanceRetry.hidden = false;
    attendanceMessage('El enlace venció. Habilita un nuevo QR.');
  }, Math.max(0, expires - Date.now()));
}

function sendAttendance(action, key) {
  // Serialize open, renew and close so an in-flight request cannot reopen a closed window.
  const fields = {clave:key};
  if (action === 'abrir') fields.reinicio = lastReset;
  attendanceRequest = attendanceRequest.catch(() => {}).then(async () => {
    if (key !== attendanceKey) return;
    const response = await requestTeacher('asistencia-' + action, fields);
    if (key !== attendanceKey) return;
    if (response.status === 401 || response.status === 403) {
      if (action === 'abrir') attendanceKey = '';
      stopAttendanceTimers();
      hideAttendanceLink();
      attendanceRetry.hidden = true;
      document.getElementById('attendance-link-teacher').hidden = false;
      attendanceMessage('Vincula la presentación como docente para abrir la asistencia.');
      return;
    }
    if (response.status === 409) {
      if (action === 'abrir') await checkSessionReset();
      if (key !== attendanceKey) return;
      attendanceKey = '';
      stopAttendanceTimers();
      hideAttendanceLink();
      attendanceRetry.hidden = false;
      attendanceMessage('El enlace dejó de estar activo. Habilita un nuevo QR.');
      return;
    }
    if (!response.ok) throw Error('No se pudo habilitar el registro.');
    const {expires} = await response.json();
    if (key !== attendanceKey) return;
    if (!Number.isFinite(expires) || expires <= Date.now()) throw Error('El enlace venció.');
    if (action === 'abrir') {
      const url = new URL('/', sendEndpoint);
      url.searchParams.set('acceso', key);
      attendanceLink.value = url.href;
      attendanceQr.src = makeQr(url.href);
      attendanceProjection.hidden = false;
    }
    attendanceRetry.hidden = true;
    renewAttendance(key, expires);
    attendanceMessage('Registro abierto. Al cerrar esta ventana se desactivan el QR y el enlace.');
  }).catch(() => {
    if (key !== attendanceKey) return;
    attendanceRetry.hidden = false;
    attendanceMessage(action === 'abrir' ? 'No se pudo abrir el registro. Inténtalo de nuevo.'
      : 'No se pudo renovar el enlace. Vuelve a habilitarlo si se vence.');
  });
  return attendanceRequest;
}

function startAttendance() {
  stopAttendanceTimers();
  hideAttendanceLink();
  attendanceRetry.hidden = true;
  document.getElementById('attendance-link-teacher').hidden = true;
  attendanceMessage('Habilitando registro…');
  const previous = attendanceKey;
  if (previous) void stopAttendance(previous);
  attendanceKey = crypto.randomUUID();
  void sendAttendance('abrir', attendanceKey);
}

function stopAttendance(key) {
  const close = attendanceRequest.catch(() => {}).then(async () => {
    const response = await requestTeacher('asistencia-cerrar', {clave:key});
    if (!response.ok) throw Error('No se pudo cerrar el registro.');
  });
  // Keep the queue usable while returning the rejection to the requesting UI.
  attendanceRequest = close.catch(() => {});
  return close;
}

async function closeAttendanceDialog() {
  if (attendanceClose.disabled) return;
  const key = attendanceKey;
  if (!key) {
    attendanceDialog.close();
    return;
  }
  stopAttendanceTimers();
  attendanceClose.disabled = true;
  attendanceRetry.hidden = true;
  attendanceMessage('Cerrando registro…');
  try {
    await stopAttendance(key);
    if (key !== attendanceKey) return;
    attendanceKey = '';
    attendanceDialog.close();
  } catch {
    if (key !== attendanceKey) return;
    hideAttendanceLink();
    attendanceMessage('No se pudo confirmar el cierre. Vuelve a pulsar Cerrar registro.');
  } finally {
    attendanceClose.disabled = false;
  }
}

document.getElementById('open-attendance').addEventListener('click', () => {
  if (!controlEndpoint) return;
  showModal(attendanceDialog);
  startAttendance();
});
attendanceRetry.addEventListener('click', startAttendance);
attendanceClose.addEventListener('click', () => void closeAttendanceDialog());
attendanceDialog.addEventListener('cancel', event => {
  event.preventDefault();
  void closeAttendanceDialog();
});
attendanceDialog.addEventListener('close', hideAttendanceLink);
window.addEventListener('pagehide', () => {
  if (!attendanceKey) return;
  const body = new URLSearchParams({accion:'asistencia-cerrar', clave:attendanceKey});
  void fetch(controlEndpoint, {
    method:'POST', credentials:'omit', cache:'no-store', keepalive:true,
    headers:{Authorization:'Bearer ' + getPresentationKey()}, body,
  }).catch(() => {});
});

attendanceLink.addEventListener('focus', () => attendanceLink.select());
document.getElementById('copy-attendance-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(attendanceLink.value);
    attendanceMessage('Enlace copiado. El registro sigue abierto.');
  } catch {
    attendanceLink.focus();
    attendanceLink.select();
    attendanceMessage('Enlace seleccionado. Cópialo con Ctrl+C o ⌘+C.');
  }
});

function showCourseLink(title, url) {
  document.getElementById('course-link-title').textContent = title;
  document.getElementById('course-link-url').value = url;
  document.getElementById('course-link-qr').src = makeQr(url);
  showModal(courseLinkDialog);
}
for (const trigger of document.querySelectorAll('[data-course-link]')) {
  trigger.addEventListener('click', event => {
    event.preventDefault();
    showCourseLink(trigger.dataset.courseLink, trigger.href);
  });
}
document.getElementById('practice-qr-button').addEventListener('click', () => {
  showCourseLink(resultsContext.textContent, new URL('/practicas/' + activeQuestion, sendEndpoint).href);
});
document.getElementById('course-link-url').addEventListener('focus', event => event.target.select());
document.addEventListener('visibilitychange', () => {
  stopResults();
  if (!document.hidden && resultsDialog.open && !linkDialog.open) void refreshGroupResults();
});

const whiteboard = document.querySelector('#whiteboard');
const search = document.querySelector('#index-search');
const indexList = document.querySelector('#index-list');
const mapRoute = index.querySelector('#course-map-route');
const mapSearchPanel = index.querySelector('#map-search-panel');
const mapViews = [...index.querySelectorAll('[data-map-view]')];
const mapDestinations = [...index.querySelectorAll('[data-map-destination]')];

function showMapView(view) {
  const searching = view === 'search';
  mapRoute.hidden = searching;
  mapSearchPanel.hidden = !searching;
  mapViews.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mapView === view));
  });
  index.scrollTop = 0;
  if (searching) search.focus();
}
const empty = document.querySelector('#index-empty');
const filters = Array.from(document.querySelectorAll('[data-filter]'));
const previous = document.querySelector('#prev');
const next = document.querySelector('#next');
const fullscreen = document.querySelector('#fullscreen');
const counter = document.querySelector('#counter');
const progress = document.querySelector('#progress');
let current = 0;
let kindFilter = '';
const format = number => String(number).padStart(2, '0');
const normalize = value => value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const {setCourseRouteVisible, setCourseRouteExposure, resetCourseRoute} = (() => {
  const route = document.getElementById('course-route');
  const frames = [...route.querySelectorAll('.course-route-frame')];
  const dots = [...route.querySelectorAll('.course-route-dot')];
  const pager = route.querySelector('.course-route-pager');
  const toggle = route.querySelector('.course-route-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = 0;
  let timer;
  let onCover = false;
  let inExposure = false;
  let paused = reducedMotion.matches;
  let hovered = false;
  let keyboardFocus = false;

  function showFrame(position) {
    active = (position + frames.length) % frames.length;
    frames.forEach((frame, i) => {
      frame.setAttribute('aria-hidden', String(i !== active));
      frame.inert = i !== active;
      dots[i].setAttribute('aria-current', String(i === active));
    });
  }

  function canAdvance() {
    return onCover && !paused && (inExposure || !hovered) && !keyboardFocus && !document.hidden && !index.open && !attendanceDialog.open;
  }

  function schedule() {
    clearTimeout(timer);
    if (!canAdvance()) return;
    timer = setTimeout(() => {
      if (canAdvance()) showFrame(active + 1);
      schedule();
    }, 3000);
  }

  function syncPlayback() {
    const label = paused ? 'Reanudar recorrido automático' : 'Pausar recorrido automático';
    toggle.dataset.paused = String(paused);
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    schedule();
  }

  dots.forEach((dot, i) => dot.addEventListener('click', () => {
    showFrame(i);
    schedule();
  }));
  pager.addEventListener('keydown', event => {
    if (!dots.includes(event.target) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    showFrame(active + (event.key === 'ArrowRight' ? 1 : -1));
    dots[active].focus();
    schedule();
  });
  toggle.addEventListener('click', () => {
    paused = !paused;
    syncPlayback();
  });
  route.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    hovered = true;
    if (!inExposure) schedule();
  });
  route.addEventListener('pointerleave', () => {
    hovered = false;
    if (!inExposure) schedule();
  });
  route.addEventListener('focusin', event => {
    keyboardFocus = event.target.matches(':focus-visible');
    schedule();
  });
  route.addEventListener('focusout', event => {
    if (route.contains(event.relatedTarget)) return;
    keyboardFocus = false;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  index.addEventListener('close', schedule);
  attendanceDialog.addEventListener('close', schedule);
  reducedMotion.addEventListener('change', event => {
    if (!event.matches) return;
    paused = true;
    syncPlayback();
  });
  syncPlayback();

  return {
    resetCourseRoute() {
      paused = reducedMotion.matches;
      hovered = false;
      keyboardFocus = false;
      showFrame(0);
      syncPlayback();
    },
    setCourseRouteVisible(visible) {
      onCover = visible;
      if (!visible) {
        hovered = false;
        keyboardFocus = false;
      }
      schedule();
    },
    setCourseRouteExposure(enabled) {
      if (inExposure === enabled) return;
      inExposure = enabled;
      if (enabled) {
        paused = false;
        if (route.contains(document.activeElement)) fullscreen.focus({preventScroll:true});
        keyboardFocus = false;
      }
      syncPlayback();
    },
  };
})();


function updateProgress() {
  const completed = document.querySelectorAll('.quiz[data-completed="true"]').length;
  document.querySelector('#course-status').textContent = completed + ' de ' +
    document.querySelectorAll('.quiz').length + ' comprobaciones resueltas en esta sesión';
}

const entries = slides.filter(slide => slide.dataset.kind !== 'Detalle').map(slide => {
  const id = slide.getAttribute('aria-labelledby');
  const kind = slide.dataset.kind;
  const theme = Number(slide.dataset.theme);
  const isModule = kind === 'Capítulo';
  const title = document.getElementById(id).textContent;
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'control';
  const prefix = isModule || kind === 'Práctica' ? 'Módulo ' + format(theme - 2) + ' · ' : '';
  entry.textContent = prefix + title;
  if (isModule) {
    const mark = document.querySelector('[data-subtopics-complete="' + theme + '"]');
    entry.classList.add('module-index-entry');
    entry.append(mark.cloneNode());
  }
  entry.addEventListener('click', () => {
    index.close();
    go(isModule ? 'temas-' + theme : id);
  });
  indexList.append(entry);
  return {entry, id, kind};
});

document.querySelectorAll('.module-outline').forEach(outline => {
  const checks = Array.from(outline.querySelectorAll('.subtopic-check'));
  const marks = document.querySelectorAll('[data-subtopics-complete="' + outline.dataset.theme + '"]');

  const updateCompletion = () => {
    const complete = checks.length > 0 && checks.every(check => check.checked);
    marks.forEach(mark => { mark.hidden = !complete; });
  };

  checks.forEach(check => {
    const storageKey = storagePrefix + 'subtopics:' + check.id;
    try {
      check.checked = localStorage.getItem(storageKey) === '1';
    } catch {
      // The preview may restrict storage. Selections still work on this page.
    }
    check.addEventListener('change', () => {
      updateCompletion();
      try {
        if (check.checked) localStorage.setItem(storageKey, '1');
        else localStorage.removeItem(storageKey);
      } catch {
        // Keep the current selection when storage is unavailable.
      }
    });
  });
  updateCompletion();
});

function filterEntries() {
  const term = normalize(search.value);
  let visible = 0;
  entries.forEach(({entry, kind}) => {
    const matchesFilter = kindFilter ? kind === kindFilter : kind !== 'Práctica';
    entry.hidden = !matchesFilter || !normalize(entry.textContent).includes(term);
    if (!entry.hidden) visible += 1;
  });
  empty.hidden = visible !== 0;
}

function show(position, focusHeading = false) {
  const destination = Math.max(0, Math.min(slides.length - 1, position));
  if (current === 0 && destination !== 0) stopAmbient();
  current = destination;
  slides.forEach((slide, i) => {
    slide.hidden = i !== current;
    slide.classList.remove('is-entering');
  });
  const active = slides[current];
  placeWhiteboard(active);
  active.classList.add('is-entering');
  const id = active.getAttribute('aria-labelledby');
  const indexId = active.dataset.theme ? 'capitulo-' + active.dataset.theme : id;
  entries.forEach(({entry, id:entryId}) => {
    if (entryId === id || entryId === indexId) entry.setAttribute('aria-current','true');
    else entry.removeAttribute('aria-current');
  });
  const mapTarget = active.dataset.theme ? 'temas-' + active.dataset.theme : id;
  mapDestinations.forEach(link => {
    if (link.hash === '#' + mapTarget) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  });
  counter.textContent = format(current + 1) + ' / ' + format(slides.length);
  progress.style.width = ((current + 1) / slides.length * 100) + '%';
  previous.disabled = current === 0;
  next.disabled = current === slides.length - 1;
  if (focusHeading) {
    const heading = document.getElementById(id);
    heading.tabIndex = -1;
    heading.focus({preventScroll:true});
  }
  window.scrollTo(0, 0);
  setCourseRouteVisible(current === 0);
  setPresentationToolsOpen(false);
  showPresentationInk();
  hidePresentationPointer();
  fitSlide();
}

function go(id) {
  if (!slideById.has(id)) return;
  if (location.hash === '#' + id) show(slideById.get(id), true);
  else location.hash = id;
}

function navigate(offset) {
  const target = slides[current + offset];
  if (target) go(target.getAttribute('aria-labelledby'));
}

function positionFromHash() {
  const id = location.hash.slice(1).replace(/^ejemplo-(\d+)$/, 'capitulo-$1');
  if (id === 'capitulo-1') return slideById.get('temas-2');
  return slideById.get(id) ?? slideById.get(id.replace(/^practica-/, 'capitulo-')) ?? 0;
}
window.addEventListener('hashchange', () => show(positionFromHash(), true));
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (index.open && index.contains(link)) index.close();
  go(link.getAttribute('href').slice(1));
});

previous.addEventListener('click', () => navigate(-1));
next.addEventListener('click', () => navigate(1));
document.querySelector('#open-index').addEventListener('click', () => {
  showModal(index);
  search.value = '';
  kindFilter = '';
  filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === '')));
  filterEntries();
  showMapView('route');
  mapViews[0].focus({preventScroll:true});
});
mapViews.forEach(button => button.addEventListener('click', () => showMapView(button.dataset.mapView)));
filters.forEach(button => button.addEventListener('click', () => {
  kindFilter = button.dataset.filter;
  filters.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  filterEntries();
}));
search.addEventListener('input', filterEntries);

const deck = document.getElementById('deck');
const stage = document.getElementById('slide-stage');
const toolsToggle = document.getElementById('presentation-tools-toggle');
const toolControl = toolsToggle.parentElement;
const toolsMenu = document.getElementById('presentation-tools-menu');
const toolButtons = [...toolsMenu.querySelectorAll('[data-presentation-tool]')];
const colorButtons = [...toolsMenu.querySelectorAll('[data-presentation-color]')];
const toolSymbol = toolsToggle.querySelector('.presentation-tool-symbol');
const idleToolShape = [...toolSymbol.children].map(shape => shape.cloneNode(true));
const colorName = document.getElementById('presentation-color-name');
const defaultPresentationColors = {pointer:'pink', pen:'cyan', highlighter:'yellow'};
const colorByTool = {...defaultPresentationColors};
const presentationPointer = document.getElementById('presentation-pointer');
const presentationInk = document.getElementById('presentation-ink');
const clearInk = document.getElementById('clear-presentation-ink');
const inkBySlide = new Map();
const svgNamespace = 'http://www.w3.org/2000/svg';
let presentationTool = 'off';
let drawingStroke = null;

function setPresentationToolsOpen(open, returnFocus = false) {
  toolsMenu.hidden = !open;
  toolsToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    suspendPresentationPointer();
    toolButtons.find(button => button.dataset.presentationTool === presentationTool).focus();
  } else if (returnFocus) toolsToggle.focus();
}

function currentPresentationColor() {
  const key = colorByTool[presentationTool];
  return colorButtons.find(button => button.dataset.presentationColor === key);
}

function presentationToolName() {
  return toolButtons.find(button => button.dataset.presentationTool === presentationTool).textContent.trim();
}

function updatePresentationColor() {
  const selected = currentPresentationColor();
  if (selected) {
    const color = selected.style.getPropertyValue('--ink-choice');
    presentationPointer.style.setProperty('--point-color', color);
    presentationPointer.dataset.color = selected.dataset.presentationColor;
    toolControl.style.setProperty('--active-tool-color', color);
    toolControl.dataset.color = selected.dataset.presentationColor;
    colorName.textContent = selected.getAttribute('aria-label');
    toolsToggle.setAttribute('aria-label', 'Herramientas del puntero (P) · ' + presentationToolName() + ' · ' + colorName.textContent);
  } else {
    toolsToggle.setAttribute('aria-label', 'Herramientas del puntero (P) · Inactivo');
    colorName.textContent = 'Desactivado';
    presentationPointer.style.removeProperty('--point-color');
    toolControl.style.removeProperty('--active-tool-color');
    delete presentationPointer.dataset.color;
    delete toolControl.dataset.color;
  }
  for (const button of colorButtons) {
    button.setAttribute('aria-pressed', String(button === selected));
    button.disabled = !selected;
  }
}

for (const button of colorButtons) {
  button.addEventListener('click', () => {
    colorByTool[presentationTool] = button.dataset.presentationColor;
    updatePresentationColor();
  });
}

function selectPresentationTool(tool) {
  suspendPresentationPointer();
  presentationTool = tool;
  toolsToggle.dataset.tool = tool;
  toolControl.dataset.tool = tool;
  deck.classList.toggle('is-annotating', tool === 'pen' || tool === 'highlighter');
  for (const button of toolButtons) {
    const active = button.dataset.presentationTool === tool;
    button.setAttribute('aria-pressed', String(active));
    if (!active) continue;
    const icon = button.querySelector('svg');
    const shapes = tool === 'off' ? idleToolShape : icon.children;
    toolSymbol.replaceChildren(...Array.from(shapes, shape => shape.cloneNode(true)));
  }
  updatePresentationColor();
}

toolsToggle.addEventListener('click', () => setPresentationToolsOpen(toolsMenu.hidden));
for (const button of toolButtons) {
  button.addEventListener('click', () => {
    selectPresentationTool(button.dataset.presentationTool);
    setPresentationToolsOpen(false, true);
  });
}
document.addEventListener('pointerdown', event => {
  if (!toolsMenu.hidden && !toolControl.contains(event.target)) setPresentationToolsOpen(false);
});
toolControl.addEventListener('focusout', event => {
  if (!toolsMenu.hidden && !toolControl.contains(event.relatedTarget)) setPresentationToolsOpen(false);
});

function hidePresentationPointer() {
  presentationPointer.hidden = true;
  deck.classList.remove('is-pointing');
}

function finishPresentationStroke() {
  if (!drawingStroke) return;
  const {id} = drawingStroke;
  drawingStroke = null;
  if (deck.hasPointerCapture(id)) deck.releasePointerCapture(id);
}

function showPresentationInk() {
  finishPresentationStroke();
  const strokes = inkBySlide.get(slides[current]);
  presentationInk.replaceChildren();
  if (strokes) presentationInk.append(strokes);
  clearInk.disabled = !strokes;
}

const interactiveControl = 'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[contenteditable]';
function positionPresentationPointer(event) {
  const target = drawingStroke ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
  if (presentationTool === 'off' || !toolsMenu.hidden || target?.closest(interactiveControl)) {
    hidePresentationPointer();
    return;
  }
  presentationPointer.style.setProperty('--pointer-x', event.clientX + 'px');
  presentationPointer.style.setProperty('--pointer-y', event.clientY + 'px');
  presentationPointer.hidden = false;
  deck.classList.toggle('is-pointing', event.pointerType !== 'touch');
}

function extendPresentationStroke(clientX, clientY) {
  const {left, top, width, height} = presentationInk.getBoundingClientRect();
  if (!width || !height) return;
  const point = presentationInk.createSVGPoint();
  point.x = (clientX - left) * 1000 / width;
  point.y = (clientY - top) * 1000 / height;
  drawingStroke.line.points.appendItem(point);
}

clearInk.addEventListener('click', () => {
  setPresentationToolsOpen(false, true);
  inkBySlide.delete(slides[current]);
  showPresentationInk();
});
deck.addEventListener('pointerdown', event => {
  if (!event.isPrimary) return;
  positionPresentationPointer(event);
  if (!deck.classList.contains('is-annotating') || !toolsMenu.hidden || drawingStroke || event.button !== 0 ||
      !stage.contains(event.target) ||
      event.target.closest(interactiveControl + ',#whiteboard')) return;
  event.preventDefault();
  drawingStroke = {id:event.pointerId, x:event.clientX, y:event.clientY, line:null};
  deck.setPointerCapture(event.pointerId);
});
deck.addEventListener('dragstart', event => {
  if (drawingStroke) event.preventDefault();
});
deck.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  positionPresentationPointer(event);
  if (drawingStroke?.id !== event.pointerId) return;
  if (!drawingStroke.line) {
    const {x, y} = drawingStroke;
    if (Math.hypot(event.clientX - x, event.clientY - y) < 3) return;
    const slide = slides[current];
    let group = inkBySlide.get(slide);
    if (!group) {
      group = document.createElementNS(svgNamespace, 'g');
      inkBySlide.set(slide, group);
      presentationInk.append(group);
      clearInk.disabled = false;
    }
    const line = document.createElementNS(svgNamespace, 'polyline');
    line.dataset.tool = presentationTool;
    line.setAttribute('stroke', currentPresentationColor().style.getPropertyValue('--ink-choice'));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    group.append(line);
    drawingStroke.line = line;
    extendPresentationStroke(x, y);
  }
  extendPresentationStroke(event.clientX, event.clientY);
}, {passive:true});

function endPresentationGesture(event) {
  if (!event.isPrimary) return;
  if (drawingStroke?.id === event.pointerId) finishPresentationStroke();
  if (event.pointerType === 'touch' || event.type === 'pointercancel') hidePresentationPointer();
}
deck.addEventListener('pointerup', endPresentationGesture);
deck.addEventListener('pointercancel', endPresentationGesture);
deck.addEventListener('lostpointercapture', endPresentationGesture);
deck.addEventListener('pointerover', event => {
  if (event.target.closest(interactiveControl)) hidePresentationPointer();
});
deck.addEventListener('pointerleave', hidePresentationPointer);
function suspendPresentationPointer() {
  finishPresentationStroke();
  hidePresentationPointer();
}
window.addEventListener('blur', suspendPresentationPointer);
document.addEventListener('visibilitychange', suspendPresentationPointer);


const ambientAudio = document.getElementById('ambient-audio');
const ambientToggle = document.getElementById('ambient-toggle');
let ambientWanted = true;
ambientAudio.volume = 0.25;

function syncAmbientControl() {
  const playing = !ambientAudio.paused && !ambientAudio.ended;
  ambientToggle.setAttribute('aria-pressed', String(playing));
  ambientToggle.setAttribute('aria-label', playing ? 'Pausar música de ambiente' : 'Reproducir música de ambiente');
  ambientToggle.title = ambientToggle.getAttribute('aria-label');
}

function playAmbient() {
  if (!ambientAudio.hasAttribute('src') || current !== 0 || !ambientWanted) return;
  void ambientAudio.play().catch(syncAmbientControl);
}

function stopAmbient() {
  ambientAudio.pause();
  ambientAudio.currentTime = 0;
}

ambientToggle.addEventListener('click', () => {
  if (ambientAudio.paused) {
    ambientWanted = true;
    playAmbient();
  } else {
    ambientWanted = false;
    ambientAudio.pause();
  }
});
for (const event of ['play', 'pause', 'ended']) ambientAudio.addEventListener(event, syncAmbientControl);

function fitSlide() {
  if (!document.fullscreenElement && !document.body.classList.contains('theater')) {
    stage.style.removeProperty('--fit');
    return;
  }
  const slide = slides[current];
  const width = slide.offsetWidth;
  const height = slide.offsetHeight;
  if (!width || !height) return;
  const scale = Math.min(1, (deck.clientWidth - 8) / width, (deck.clientHeight - 8) / height);
  stage.style.setProperty('--fit', Math.max(0, scale));
}
new ResizeObserver(fitSlide).observe(deck);
document.fonts.ready.then(fitSlide);
let exposureWanted = false;
function syncExposureControl() {
  const active = Boolean(document.fullscreenElement) || exposureWanted;
  document.body.classList.toggle('theater', active && !document.fullscreenElement);
  fullscreen.setAttribute('aria-pressed', String(active));
  suspendPresentationPointer();
  setCourseRouteExposure(active);
  if (!active) stopAmbient();
  fitSlide();
}

async function toggleFullscreen() {
  if (exposureWanted) {
    exposureWanted = false;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    syncExposureControl();
    return;
  }
  exposureWanted = true;
  playAmbient();
  if (document.fullscreenEnabled) await document.documentElement.requestFullscreen().catch(() => {});
  syncExposureControl();
}
fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncExposureControl);
document.addEventListener('keydown', event => {
  if (modalIsOpen() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.target.matches('input:not([type="checkbox"]), textarea, select')) return;
  const key = event.key.toLowerCase();
  if (['arrowright','pagedown','arrowleft','pageup','home','end','f','p'].includes(key)) {
    event.preventDefault();
  }
  if (key === 'arrowright' || key === 'pagedown') navigate(1);
  else if (key === 'arrowleft' || key === 'pageup') navigate(-1);
  else if (key === 'home') go('portada');
  else if (key === 'end') go('recursos');
  else if (key === 'p' && !event.repeat) setPresentationToolsOpen(toolsMenu.hidden, true);
  else if (key === 'f') toggleFullscreen();
  else if (key === 'escape' && !toolsMenu.hidden) {
    event.preventDefault();
    setPresentationToolsOpen(false, true);
  } else if (key === 'escape' && presentationTool !== 'off') selectPresentationTool('off');
  else if (key === 'escape' && document.body.classList.contains('theater')) void toggleFullscreen();
});

document.querySelectorAll('.quiz').forEach(quiz => {
  quiz.addEventListener('submit', event => {
    event.preventDefault();
    const selection = quiz.querySelector('input:checked');
    const result = quiz.querySelector('.feedback');
    if (!selection) {
      result.textContent = 'Elige una respuesta para comprobarla.';
      delete result.dataset.correct;
      delete result.dataset.checkedValue;
      return;
    }
    quiz.querySelector('.quiz-check-action').toggleAttribute('data-complete', true);
    const correct = selection.value === quiz.dataset.answer;
    result.dataset.correct = String(correct);
    result.dataset.checkedValue = selection.value;
    result.textContent = correct ? 'Correcto. ' + quiz.dataset.feedback : 'Revisa la explicación e inténtalo de nuevo.';
    if (correct) {
      quiz.dataset.completed = 'true';
      document.querySelectorAll('[data-done="' + quiz.dataset.theme + '"]').forEach(badge => {
        badge.hidden = false;
      });
      updateProgress();
    }
  });
});

const {placeWhiteboard, snapshotWhiteboards, resetWhiteboards} = (() => {
  const canvas = document.querySelector('#whiteboard-canvas');
  const view = canvas.getContext('2d');
  const inkLayer = document.createElement('canvas');
  inkLayer.width = canvas.width;
  inkLayer.height = canvas.height;
  const ink = inkLayer.getContext('2d');
  const color = document.querySelector('#board-color');
  const weight = document.querySelector('#board-weight');
  const undo = document.querySelector('#board-undo');
  const redo = document.querySelector('#board-redo');
  const clear = document.querySelector('#board-clear');
  const fileInput = document.querySelector('#board-image-file');
  const loadButton = document.querySelector('#board-load-image');
  const pasteButton = document.querySelector('#board-paste-image');
  const rotateButton = document.querySelector('#board-rotate-image');
  const cropButton = document.querySelector('#board-crop-image');
  const removeButton = document.querySelector('#board-remove-image');
  const status = document.querySelector('#board-image-status');
  const tools = [...whiteboard.querySelectorAll('[data-board-tool]')];
  const toolFrame = document.querySelector('#board-tools');
  const toolbar = toolFrame.querySelector('.board-compact-toolbar');
  const tooltip = document.querySelector('#board-tooltip');
  const shapeControl = document.querySelector('#board-shape-control');
  const shapeToggle = document.querySelector('#board-shape-toggle');
  const shapeSymbol = document.querySelector('#board-shape-symbol');
  const shapeMenu = document.querySelector('#board-shape-menu');
  const shapeButtons = [...shapeMenu.querySelectorAll('[data-board-tool]')];
  const shapes = new Map(shapeButtons.map(button => [button.dataset.boardTool, button]));
  const defaultShapeIcon = shapeSymbol.querySelector('svg').cloneNode(true);
  const swatch = document.querySelector('#board-color-swatch');
  const polygons = {
    triangle:[[.5,0],[1,1],[0,1]],
    diamond:[[.5,0],[1,.5],[.5,1],[0,.5]],
    pentagon:[[.5,0],[1,.38],[.81,1],[.19,1],[0,.38]],
    hexagon:[[.25,0],[.75,0],[1,.5],[.75,1],[.25,1],[0,.5]],
  };
  const drawings = new Map();
  const corners = [{x:-1,y:-1}, {x:1,y:-1}, {x:-1,y:1}, {x:1,y:1}];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  let board = null;
  let slot = null;
  let tool = 'pen';
  let pointer = null;
  let draft = null;
  let gesture = null;
  let selectedId = null;
  let crop = null;
  let fileTarget = null;
  let nextImageId = 0;
  let pendingFrame = false;

  function drawShape(context, shape, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (shape === 'line' || shape === 'arrow') {
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      if (shape === 'arrow') {
        const head = Math.min(Math.hypot(dx, dy) / 2, Math.max(17, context.lineWidth * 3));
        const angle = Math.atan2(dy, dx);
        for (const offset of [-Math.PI / 6, Math.PI / 6]) {
          context.moveTo(end.x, end.y);
          context.lineTo(end.x - head * Math.cos(angle + offset), end.y - head * Math.sin(angle + offset));
        }
      }
      return;
    }

    let width = Math.abs(dx);
    let height = Math.abs(dy);
    if (shape === 'square' || shape === 'circle') {
      const size = Math.min(
        Math.max(width, height),
        dx < 0 ? start.x : canvas.width - start.x,
        dy < 0 ? start.y : canvas.height - start.y,
      );
      width = size;
      height = size;
    }
    if (!width || !height) return;
    const x = dx < 0 ? start.x - width : start.x;
    const y = dy < 0 ? start.y - height : start.y;

    if (shape === 'rectangle' || shape === 'square') {
      context.rect(x, y, width, height);
    } else if (shape === 'ellipse' || shape === 'circle') {
      context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      polygons[shape].forEach(([vx, vy], index) => {
        if (index === 0) context.moveTo(x + vx * width, y + vy * height);
        else context.lineTo(x + vx * width, y + vy * height);
      });
      context.closePath();
    }
  }

  function draw(context, {tool, color, width, points}) {
    const shape = shapes.has(tool);
    if (shape && points.length < 2) return;
    const start = points[0];
    context.save();
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();

    if (shape) {
      drawShape(context, tool, start, points.at(-1));
      context.stroke();
    } else if (points.length === 1) {
      context.arc(start.x, start.y, width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(start.x, start.y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }

  function sceneFor(sheet) {
    const commands = sheet?.done ?? [];
    const first = commands.findLastIndex(item => item.tool === 'clear') + 1;
    const images = new Map();
    const strokes = [];
    for (let i = first; i < commands.length; i++) {
      const item = commands[i];
      if (item.tool === 'image') images.set(item.image.id, item.image);
      else if (item.tool === 'remove-image') images.delete(item.id);
      else strokes.push(item);
    }
    return {images, strokes};
  }

  function imageBox(image) {
    return {x:-image.width / 2, y:-image.height / 2, width:image.width, height:image.height};
  }

  function inside(point, box) {
    return point.x >= box.x && point.x <= box.x + box.width &&
      point.y >= box.y && point.y <= box.y + box.height;
  }

  function localPoint(point, image) {
    const angle = image.turn * Math.PI / 2;
    const x = point.x - image.x;
    const y = point.y - image.y;
    return {x:x * Math.cos(angle) + y * Math.sin(angle), y:-x * Math.sin(angle) + y * Math.cos(angle)};
  }

  function boardPoint(point, image) {
    const angle = image.turn * Math.PI / 2;
    return {
      x:image.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
      y:image.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
    };
  }

  function paintImage(context, image) {
    const source = image.source;
    context.save();
    context.translate(image.x, image.y);
    context.rotate(image.turn * Math.PI / 2);
    context.drawImage(
      image.asset, source.x, source.y, source.width, source.height,
      -image.width / 2, -image.height / 2, image.width, image.height,
    );
    context.restore();
  }

  function paintBoard(context, scene, inProgress, preview) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const image of scene.images.values()) paintImage(context, preview?.id === image.id ? preview : image);

    // Keep the eraser on the ink layer so it never erases imported images.
    ink.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of scene.strokes) draw(ink, stroke);
    if (inProgress) draw(ink, inProgress);
    context.drawImage(inkLayer, 0, 0);
  }

  function screenUnit() {
    return canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
  }

  function paintSelection(image) {
    const unit = screenUnit();
    const bounds = imageBox(image);
    const area = crop?.area ?? bounds;
    view.save();
    view.translate(image.x, image.y);
    view.rotate(image.turn * Math.PI / 2);
    if (crop?.area) {
      view.fillStyle = '#481a1c88';
      view.beginPath();
      view.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      view.rect(area.x, area.y, area.width, area.height);
      view.fill('evenodd');
    }
    view.strokeStyle = '#b91e22';
    view.lineWidth = 1.8 * unit;
    if (crop) view.setLineDash([5 * unit, 3 * unit]);
    view.strokeRect(area.x, area.y, area.width, area.height);
    if (!crop) {
      const size = 9 * unit;
      view.fillStyle = '#ffffff';
      for (const corner of corners) {
        const x = corner.x * image.width / 2 - size / 2;
        const y = corner.y * image.height / 2 - size / 2;
        view.fillRect(x, y, size, size);
        view.strokeRect(x, y, size, size);
      }
    }
    view.restore();
  }

  function render() {
    pendingFrame = false;
    const scene = sceneFor(board);
    paintBoard(view, scene, draft, gesture?.preview);
    const selected = gesture?.preview ?? scene.images.get(selectedId);
    if (tool === 'select' && selected) paintSelection(selected);
  }

  function snapshotWhiteboards() {
    const snapshots = new Map();
    let copy;
    let context;
    for (const [theme, sheet] of drawings) {
      const scene = sceneFor(sheet);
      const pending = sheet === board ? draft : null;
      if (!scene.images.size && !scene.strokes.length && !pending) continue;
      if (!copy) {
        copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        context = copy.getContext('2d');
      }
      paintBoard(context, scene, pending, sheet === board ? gesture?.preview : null);
      snapshots.set('capitulo-' + theme, copy.toDataURL('image/png'));
    }
    return snapshots;
  }

  function scheduleRender() {
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(render);
  }

  function announce(message) {
    status.textContent = message;
    status.hidden = !message;
    fitSlide();
  }

  function validCrop(area) {
    return Boolean(area && area.width >= 8 && area.height >= 8);
  }

  function updateControls() {
    const selected = tool === 'select' && sceneFor(board).images.has(selectedId);
    const moving = pointer !== null;
    const busy = moving || Boolean(crop);
    undo.disabled = busy || !board?.done.length;
    redo.disabled = busy || !board?.undone.length;
    clear.disabled = undo.disabled || board?.done.at(-1)?.tool === 'clear';
    rotateButton.disabled = !selected || busy;
    cropButton.disabled = !selected || moving || Boolean(crop && !validCrop(crop.area));
    labelControl(cropButton, crop ? 'Aplicar recorte' : 'Recortar imagen');
    removeButton.disabled = !selected || moving;
    labelControl(removeButton, crop ? 'Cancelar el recorte' : 'Quitar imagen');
    cropButton.dataset.mode = removeButton.dataset.mode = crop ? 'crop' : 'default';
    canvas.dataset.tool = tool;
    canvas.dataset.cropping = String(Boolean(crop));
  }

  function refresh() {
    updateControls();
    scheduleRender();
  }

  function commit(item, sheet = board) {
    sheet.done.push(item);
    sheet.undone.length = 0;
    if (sheet === board) refresh();
  }

  function labelControl(control, label) {
    control.setAttribute('aria-label', label);
    control.dataset.boardTooltip = label;
  }

  function positionToolOverlay(overlay, control, below = false) {
    const frame = toolFrame.getBoundingClientRect();
    const anchor = control.getBoundingClientRect();
    const scale = frame.width / toolFrame.clientWidth || 1;
    const center = (anchor.left + anchor.width / 2 - frame.left) / scale;
    const right = Math.max(4, toolFrame.clientWidth - overlay.offsetWidth - 4);
    const edge = ((below ? anchor.bottom : anchor.top) - frame.top) / scale;
    overlay.style.left = clamp(center - overlay.offsetWidth / 2, 4, right) + 'px';
    overlay.style.top = (below ? edge + 6 : edge - overlay.offsetHeight - 7) + 'px';
  }

  function showToolDescription(control) {
    if (control === shapeToggle && !shapeMenu.hidden) return;
    tooltip.textContent = control.dataset.boardTooltip;
    tooltip.hidden = false;
    positionToolOverlay(tooltip, control);
  }

  const hideToolDescription = () => { tooltip.hidden = true; };
  for (const control of toolFrame.querySelectorAll('[data-board-tooltip]')) {
    control.addEventListener('pointerenter', () => showToolDescription(control));
    control.addEventListener('pointerleave', hideToolDescription);
    control.addEventListener('focusin', event => {
      if (event.target.matches(':focus-visible')) showToolDescription(control);
    });
    control.addEventListener('focusout', hideToolDescription);
  }

  function setShapeMenu(open, returnFocus = false) {
    hideToolDescription();
    shapeMenu.hidden = !open;
    shapeToggle.setAttribute('aria-expanded', String(open));
    if (open) positionToolOverlay(shapeMenu, shapeToggle, true);
    if (returnFocus) shapeToggle.focus();
  }

  toolbar.addEventListener('scroll', () => setShapeMenu(false), {passive:true});
  window.addEventListener('resize', () => setShapeMenu(false));

  shapeToggle.addEventListener('click', () => {
    if (pointer !== null) return;
    const open = shapeMenu.hidden;
    setShapeMenu(open);
    if (open) (shapes.get(tool) ?? shapeButtons[0]).focus();
  });
  const inShapeControls = target => shapeControl.contains(target) || shapeMenu.contains(target);
  const leaveShapeControls = event => {
    if (!inShapeControls(event.relatedTarget)) setShapeMenu(false);
  };
  shapeControl.addEventListener('focusout', leaveShapeControls);
  shapeMenu.addEventListener('focusout', leaveShapeControls);
  document.addEventListener('pointerdown', event => {
    if (!shapeMenu.hidden && !inShapeControls(event.target)) setShapeMenu(false);
  });

  const updateSwatch = () => { swatch.style.backgroundColor = color.value; };
  color.addEventListener('change', updateSwatch);
  updateSwatch();

  function setTool(value) {
    tool = value;
    crop = null;
    if (tool !== 'select') selectedId = null;
    tools.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.boardTool === tool)));
    const shape = shapes.get(tool);
    shapeSymbol.replaceChildren((shape ? shape.querySelector('svg') : defaultShapeIcon).cloneNode(true));
    shapeToggle.dataset.active = String(Boolean(shape));
    labelControl(shapeToggle, shape ? 'Figuras geométricas · ' + shape.getAttribute('aria-label') : 'Figuras geométricas');
    refresh();
  }

  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x:clamp((event.clientX - rect.left) * canvas.width / rect.width, 0, canvas.width),
      y:clamp((event.clientY - rect.top) * canvas.height / rect.height, 0, canvas.height),
    };
  }

  function appendPoint(point) {
    const last = draft.points.at(-1);
    if (last.x === point.x && last.y === point.y) return;
    if (shapes.has(draft.tool)) draft.points[1] = point;
    else draft.points.push(point);
  }

  function beginGesture(point) {
    const {images} = sceneFor(board);
    const selected = images.get(selectedId);
    if (crop) {
      const local = localPoint(point, selected);
      return inside(local, imageBox(selected))
        ? {kind:'crop', image:selected, start:local, previous:crop.area}
        : null;
    }
    if (selected) {
      const local = localPoint(point, selected);
      const hit = 11 * screenUnit();
      const corner = corners.find(c => Math.abs(local.x - c.x * selected.width / 2) <= hit &&
        Math.abs(local.y - c.y * selected.height / 2) <= hit);
      if (corner) return {kind:'resize', image:selected, start:point, corner, preview:selected};
    }
    const image = [...images.values()].reverse().find(item => inside(localPoint(point, item), imageBox(item)));
    selectedId = image?.id ?? null;
    return image ? {kind:'move', image, start:point, preview:image} : null;
  }

  function movedImage(image, dx, dy) {
    const x = clamp(image.x + dx, 0, canvas.width);
    const y = clamp(image.y + dy, 0, canvas.height);
    return x === image.x && y === image.y ? image : {...image, x, y};
  }

  function resizedImage(image, start, point, corner) {
    const origin = localPoint(start, image);
    const local = localPoint(point, image);
    const fixed = {x:-corner.x * image.width / 2, y:-corner.y * image.height / 2};
    const widthVector = corner.x * image.width;
    const heightVector = corner.y * image.height;
    const projection = 1 + ((local.x - origin.x) * widthVector + (local.y - origin.y) * heightVector)
      / (widthVector ** 2 + heightVector ** 2);
    const longest = Math.max(image.width, image.height);
    const scale = clamp(projection, Math.min(1, 24 / longest), 2 * canvas.width / longest);
    if (Math.abs(scale - 1) < .002) return image;
    const width = image.width * scale;
    const height = image.height * scale;
    const center = boardPoint({x:fixed.x + corner.x * width / 2, y:fixed.y + corner.y * height / 2}, image);
    return {...image, ...center, width, height};
  }

  function updateGesture(point) {
    const {kind, image, start} = gesture;
    if (kind === 'crop') {
      const local = localPoint(point, image);
      const bounds = imageBox(image);
      const x = clamp(local.x, bounds.x, bounds.x + bounds.width);
      const y = clamp(local.y, bounds.y, bounds.y + bounds.height);
      crop.area = {x:Math.min(x, start.x), y:Math.min(y, start.y), width:Math.abs(x - start.x), height:Math.abs(y - start.y)};
    } else if (kind === 'resize') {
      gesture.preview = resizedImage(image, start, point, gesture.corner);
    } else {
      gesture.preview = movedImage(image, point.x - start.x, point.y - start.y);
    }
  }

  canvas.addEventListener('pointerdown', event => {
    if (!board || pointer !== null || event.button !== 0) return;
    const point = pointAt(event);
    if (tool === 'select') {
      gesture = beginGesture(point);
      if (!gesture) {
        refresh();
        return;
      }
    } else {
      const width = Number(weight.value);
      draft = {tool, color:color.value, width:tool === 'eraser' ? Math.max(20, width * 4) : width, points:[point]};
    }
    event.preventDefault();
    canvas.focus({preventScroll:true});
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    refresh();
  });

  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const point = pointAt(event);
    if (draft) appendPoint(point);
    else updateGesture(point);
    scheduleRender();
  });

  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    const point = pointAt(event);
    pointer = null;
    if (draft) {
      appendPoint(point);
      const finished = draft;
      draft = null;
      if (shapes.has(finished.tool) && finished.points.length < 2) refresh();
      else commit(finished);
      return;
    }
    updateGesture(point);
    const finished = gesture;
    gesture = null;
    if (finished.kind === 'crop') {
      if (!validCrop(crop.area)) crop.area = finished.previous;
      refresh();
    } else if (finished.preview !== finished.image) {
      commit({tool:'image', image:finished.preview});
    } else {
      refresh();
    }
  });

  function cancelPointer(event) {
    if (event.pointerId !== pointer) return;
    if (gesture?.kind === 'crop') crop.area = gesture.previous;
    draft = null;
    gesture = null;
    pointer = null;
    refresh();
  }
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('lostpointercapture', cancelPointer);

  tools.forEach(button => button.addEventListener('click', () => {
    if (pointer !== null) return;
    setTool(button.dataset.boardTool);
    if (shapes.has(tool)) setShapeMenu(false, true);
    announce('');
  }));

  undo.addEventListener('click', () => {
    board.undone.push(board.done.pop());
    refresh();
  });
  redo.addEventListener('click', () => {
    board.done.push(board.undone.pop());
    refresh();
  });
  clear.addEventListener('click', () => {
    selectedId = null;
    commit({tool:'clear'});
    announce('');
  });

  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch {
        // Let the browser's image decoder handle formats not supported by ImageBitmap.
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function insertImage(file, sheet = board) {
    if (!file || !sheet) return;
    try {
      const decoded = await decodeImage(file);
      if (!drawings.has(sheet.theme) || drawings.get(sheet.theme) !== sheet) {
        decoded.close?.();
        return;
      }
      const width = decoded.naturalWidth ?? decoded.width;
      const height = decoded.naturalHeight ?? decoded.height;
      const shrink = Math.min(1, canvas.width * 1.5 / width, canvas.height * 1.5 / height);
      const asset = document.createElement('canvas');
      asset.width = Math.max(1, Math.round(width * shrink));
      asset.height = Math.max(1, Math.round(height * shrink));
      try {
        asset.getContext('2d').drawImage(decoded, 0, 0, asset.width, asset.height);
      } finally {
        decoded.close?.();
      }
      const fit = Math.min(canvas.width * .74 / asset.width, canvas.height * .76 / asset.height,
        Math.max(1, 48 / Math.max(asset.width, asset.height)));
      const image = {
        id:++nextImageId, asset, turn:0, x:canvas.width / 2, y:canvas.height / 2,
        width:asset.width * fit, height:asset.height * fit,
        source:{x:0,y:0,width:asset.width,height:asset.height},
      };
      if (board === sheet && pointer === null) {
        selectedId = image.id;
        setTool('select');
        announce('Arrastra la imagen para moverla o usa una esquina para cambiar su tamaño.');
        canvas.focus({preventScroll:true});
      }
      commit({tool:'image', image}, sheet);
    } catch {
      if (board === sheet) announce('No se pudo abrir la imagen. Prueba con un archivo PNG, JPEG o WebP.');
    }
  }

  loadButton.addEventListener('click', () => {
    fileTarget = board;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const sheet = fileTarget ?? board;
    const file = fileInput.files?.[0];
    fileTarget = null;
    fileInput.value = '';
    return insertImage(file, sheet);
  });
  pasteButton.addEventListener('click', async () => {
    const sheet = board;
    try {
      const items = await navigator.clipboard?.read();
      for (const item of items ?? []) {
        const type = item.types.find(value => value.startsWith('image/'));
        if (type) return insertImage(await item.getType(type), sheet);
      }
    } catch {
      // Direct paste remains available when clipboard reading is restricted.
    }
    if (board === sheet) {
      announce('Copia una imagen y pégala aquí con Ctrl+V o ⌘+V.');
      canvas.focus({preventScroll:true});
    }
  });
  document.addEventListener('paste', event => {
    if (!board || index.open || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const data = event.clipboardData;
    const file = [...(data?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
      ?? [...(data?.files ?? [])].find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    return insertImage(file);
  });

  rotateButton.addEventListener('click', () => {
    const image = sceneFor(board).images.get(selectedId);
    commit({tool:'image', image:{...image, turn:(image.turn + 1) % 4}});
    announce('');
  });
  cropButton.addEventListener('click', () => {
    const image = sceneFor(board).images.get(selectedId);
    if (!crop) {
      crop = {area:null};
      refresh();
      announce('Arrastra sobre la imagen para elegir el área que quieres conservar.');
      canvas.focus({preventScroll:true});
      return;
    }

    const area = crop.area;
    const source = image.source;
    const bounds = imageBox(image);
    const scaleX = source.width / image.width;
    const scaleY = source.height / image.height;
    const center = boardPoint({x:area.x + area.width / 2, y:area.y + area.height / 2}, image);
    crop = null;
    commit({
      tool:'image',
      image:{
        ...image, ...center, width:area.width, height:area.height,
        source:{
          x:source.x + (area.x - bounds.x) * scaleX,
          y:source.y + (area.y - bounds.y) * scaleY,
          width:area.width * scaleX, height:area.height * scaleY,
        },
      },
    });
    announce('');
  });
  removeButton.addEventListener('click', () => {
    if (crop) {
      crop = null;
      refresh();
    } else {
      const id = selectedId;
      selectedId = null;
      commit({tool:'remove-image', id});
    }
    announce('');
  });

  whiteboard.addEventListener('keydown', event => {
    if (!board || event.altKey) return;
    if (!shapeMenu.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShapeMenu(false, true);
        return;
      }
      const offsets = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-5, ArrowDown:5};
      const current = shapeButtons.indexOf(event.target);
      const offset = offsets[event.key];
      if (current >= 0 && offset) {
        event.preventDefault();
        event.stopPropagation();
        shapeButtons[(current + offset + shapeButtons.length) % shapeButtons.length].focus();
        return;
      }
    }
    const key = event.key.toLowerCase();
    if (key === 'escape' && crop && pointer === null) {
      event.preventDefault();
      event.stopPropagation();
      removeButton.click();
      return;
    }
    if (event.target === canvas && (key === 'delete' || key === 'backspace') && selectedId !== null && !crop) {
      event.preventDefault();
      removeButton.click();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || (key !== 'z' && key !== 'y')) return;
    event.preventDefault();
    const action = key === 'y' || event.shiftKey ? redo : undo;
    action.click();
  });

  function placeWhiteboard(slide) {
    const destination = slide.querySelector('.board-slot');
    if (destination === slot) return;
    setShapeMenu(false);

    const captured = pointer;
    pointer = null;
    draft = null;
    gesture = null;
    crop = null;
    selectedId = null;
    if (captured !== null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    slot = destination;
    if (!slot) {
      board = null;
      whiteboard.hidden = true;
      return;
    }

    const theme = slide.dataset.theme;
    if (!drawings.has(theme)) drawings.set(theme, {theme, done:[], undone:[]});
    board = drawings.get(theme);
    slot.append(whiteboard);
    whiteboard.hidden = false;
    announce('');
    updateControls();
    render();
  }

  function resetWhiteboards() {
    const activeSlide = slides[current];
    const captured = pointer;
    pointer = null;
    draft = null;
    gesture = null;
    selectedId = null;
    crop = null;
    fileTarget = null;
    fileInput.value = '';
    if (captured !== null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    drawings.clear();
    nextImageId = 0;
    slot = null;
    board = null;
    toolbar.scrollLeft = 0;
    tooltip.hidden = true;
    announce('');
    view.clearRect(0, 0, canvas.width, canvas.height);
    ink.clearRect(0, 0, canvas.width, canvas.height);
    setShapeMenu(false);
    color.selectedIndex = Array.from(color.options).findIndex(option => option.defaultSelected);
    weight.selectedIndex = Array.from(weight.options).findIndex(option => option.defaultSelected);
    updateSwatch();
    setTool('pen');
    placeWhiteboard(activeSlide);
  }

  return {placeWhiteboard, snapshotWhiteboards, resetWhiteboards};
})();

function resetCourseActivities() {
  groupSendRequest?.abort();
  stopResults();
  stopLinkCheck();
  stopAttendanceTimers();
  attendanceKey = '';
  hideAttendanceLink();
  attendanceMessage('');
  attendanceRetry.hidden = true;
  document.getElementById('attendance-link-teacher').hidden = true;
  // Close the attendance dialog before any nested authorization dialog.
  // The reset has already canceled the registration window on the server.
  if (attendanceDialog.open) attendanceDialog.close();
  for (const dialog of [...document.querySelectorAll('dialog[open]')].reverse()) {
    dialog.close();
  }
  activeQuestion = undefined;
  resultStatusKey = undefined;
  resultsChart.hidden = true;
  resultLinkButton.hidden = true;
  for (const element of [resultsStatus, resultsContext, resultsQuestion, linkStatus]) element.textContent = '';
  for (const row of resultsChart.querySelectorAll('[data-result]')) {
    row.querySelector('strong').textContent = '0';
    row.style.removeProperty('--result-width');
    row.removeAttribute('data-empty');
  }
  qrImage.removeAttribute('src');
  qrCopy.open = false;
  qrImage.hidden = qrCopy.hidden = true;
  qrUrl.value = '';
  document.getElementById('course-link-url').value = '';
  document.getElementById('course-link-qr').removeAttribute('src');
  document.getElementById('course-link-title').textContent = '';
  teacherLinkButton.hidden = true;
  setCoverStatus('');
  for (const check of document.querySelectorAll('.subtopic-check')) {
    check.checked = false;
    check.dispatchEvent(new Event('change'));
  }
  for (const quiz of document.querySelectorAll('.quiz')) {
    quiz.reset();
    delete quiz.dataset.completed;
    const feedback = quiz.querySelector('.feedback');
    feedback.textContent = '';
    delete feedback.dataset.correct;
    delete feedback.dataset.checkedValue;
  }
  for (const control of document.querySelectorAll('.quiz-actions [data-complete]')) {
    control.removeAttribute('data-complete');
    if (control.hasAttribute('aria-pressed')) control.setAttribute('aria-pressed','false');
    if (control.hasAttribute('aria-expanded')) control.setAttribute('aria-expanded','false');
  }
  for (const status of document.querySelectorAll('.group-message')) status.textContent = '';
  for (const button of document.querySelectorAll('.group-setup')) button.hidden = true;
  document.getElementById('group-announcement').textContent = '';
  for (const badge of document.querySelectorAll('[data-done]')) badge.hidden = true;
  resetWhiteboards();
  inkBySlide.clear();
  Object.assign(colorByTool, defaultPresentationColors);
  selectPresentationTool('off');
  setPresentationToolsOpen(false);
  showPresentationInk();
  resetCourseRoute();
  clock.setAttribute('aria-pressed', 'false');
  updateClock();
  ambientWanted = true;
  stopAmbient();
  syncAmbientControl();
  exposureWanted = false;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  syncExposureControl();
  pdfStatus.classList.add('sr');
  pdfStatus.textContent = '';
  updateProgress();
}

const resetStorageKey = storagePrefix + 'jornada';
let lastReset = '';
try {
  lastReset = localStorage.getItem(resetStorageKey) || '';
} catch {
  // The presentation may run in a preview that restricts storage.
}
function isResetMarker(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{6}(?:\/\d{9})?$/.test(value);
}
function applySessionReset(value, confirmedHere = false) {
  if (!isResetMarker(value) || value < lastReset || (value === lastReset && !confirmedHere)) return;
  lastReset = value;
  resetCourseActivities();
  try {
    localStorage.setItem(resetStorageKey, value);
  } catch {
    // Keep the current tab synchronized even without persistent storage.
  }
}
const resetStatusUrl = sendEndpoint && new URL('/api/jornada', sendEndpoint);
let checkingReset = false;
async function checkSessionReset() {
  if (!resetStatusUrl || document.hidden || checkingReset) return;
  checkingReset = true;
  try {
    const response = await fetch(resetStatusUrl, {credentials:'omit', cache:'no-store'});
    if (response.ok) applySessionReset((await response.json()).reset);
  } catch {
    // Offline presentation controls remain available.
  } finally {
    checkingReset = false;
  }
}
window.addEventListener('storage', event => {
  if (event.key === resetStorageKey) applySessionReset(event.newValue || '');
});
window.addEventListener('focus', checkSessionReset);
document.addEventListener('visibilitychange', checkSessionReset);
window.addEventListener('online', checkSessionReset);
if (resetStatusUrl) setInterval(checkSessionReset, 15000);

function savePdfCheck(page, box, filled, colors) {
  const [x, y, width, height] = box;
  if (filled) {
    const r = width / 4;
    const path = [
      'M', r, 0, 'H', width - r, 'Q', width, 0, width, r,
      'V', height - r, 'Q', width, height, width - r, height,
      'H', r, 'Q', 0, height, 0, height - r, 'V', r, 'Q', 0, 0, r, 0, 'Z',
    ].join(' ');
    page.drawSvgPath(path, {x, y:y + height, color:colors.dark, borderColor:colors.checkBorder, borderWidth:.6});
  }
  const point = (px, py) => ({x:x + width * px, y:y + height * py});
  const middle = point(.43, .31);
  const style = {thickness:1.5, color:filled ? colors.check : colors.muted};
  page.drawLine({start:point(.24, .51), end:middle, ...style});
  page.drawLine({start:middle, end:point(.78, .70), ...style});
}

function drawPdfParagraph(page, text, x, y, width, font, color) {
  const {breakTextIntoLines, pushGraphicsState, setWordSpacing, popGraphicsState} = PDFLib;
  const size = 11.5;
  const lines = breakTextIntoLines(text, [' '], width, line => font.widthOfTextAtSize(line, size));
  lines.forEach((line, index) => {
    const value = line.trim();
    const gaps = value.split(' ').length - 1;
    const justify = index < lines.length - 1 && gaps > 0;
    const spacing = justify ? Math.max(0, width - font.widthOfTextAtSize(value, size)) / gaps : 0;
    page.pushOperators(pushGraphicsState(), setWordSpacing(spacing));
    page.drawText(value, {x, y:y - index * 14, size, font, color});
    page.pushOperators(popGraphicsState());
  });
}

async function createSessionPdf(basePdf, layout, state) {
  if (!state.checked.size && !state.boards.size && !state.practices.size) return basePdf;

  const {PDFDocument, StandardFonts, rgb} = PDFLib;
  const pdf = await PDFDocument.load(basePdf, {updateMetadata:false});
  const pages = pdf.getPages();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = {
    green:rgb(21/255, 112/255, 68/255),
    dark:rgb(1, 1, 1),
    check:rgb(0, 0, 0),
    selected:rgb(128/255, 83/255, 28/255),
    checkBorder:rgb(146/255, 134/255, 131/255),
    muted:rgb(98/255, 81/255, 80/255),
    amber:rgb(139/255, 75/255, 23/255),
    panel:rgb(255/255, 244/255, 224/255),
    line:rgb(217/255, 183/255, 127/255),
  };

  for (const [id, data] of state.boards) {
    const slot = layout[id];
    const image = await pdf.embedPng(data);
    const [x, y, width, height] = slot.board;
    pages[slot.page].drawImage(image, {x, y, width, height});
  }

  const hub = layout.temario;
  const hubPage = pages[hub.page];
  let completedModules = 0;
  let completedPractices = 0;
  for (const [theme, marks] of Object.entries(hub.modules)) {
    const slot = layout['temas-' + theme];
    const checks = Object.entries(slot.checks);
    const marked = checks.filter(([id]) => state.checked.has(id));
    for (const [, box] of marked) savePdfCheck(pages[slot.page], box, true, colors);
    if (checks.length && marked.length === checks.length) {
      savePdfCheck(hubPage, marks.subtopics, true, colors);
      completedModules++;
    }
    if (state.practices.get('practica-' + theme)?.completed) {
      savePdfCheck(hubPage, marks.practice, false, colors);
      completedPractices++;
    }
  }

  for (const [id, practice] of state.practices) {
    const slot = layout[id];
    const page = pages[slot.page];
    if (practice.selected !== null) {
      const [x, y] = slot.options[practice.selected];
      page.drawCircle({x, y, size:2.45, color:colors.selected});
    }

    const [x, y, width, height] = slot.feedback;
    page.drawRectangle({x, y, width, height, color:colors.panel, borderColor:colors.line, borderWidth:.8});
    const option = Object.keys(slot.options).indexOf(practice.checkedValue);
    const title = practice.feedback
      ? 'Última comprobación' + (option >= 0 ? ' · opción ' + (option + 1) : '')
      : 'Respuesta seleccionada';
    const headingColor = practice.correct === true ? colors.green
      : practice.correct === false ? colors.amber : colors.muted;
    page.drawText(title, {x:x + 13, y:y + height - 18, size:11, font:bold, color:headingColor});
    if (practice.completed) {
      const status = 'Práctica resuelta';
      const statusWidth = bold.widthOfTextAtSize(status, 10);
      page.drawText(status, {x:x + width - 13 - statusWidth, y:y + height - 18, size:10, font:bold, color:colors.green});
    }
    drawPdfParagraph(
      page, practice.feedback || 'Pendiente de comprobación.',
      x + 13, y + height - 36, width - 26, font, colors.muted,
    );
  }

  const moduleCount = Object.keys(hub.modules).length;
  const practiceCount = Object.values(layout).filter(slot => slot.options).length;
  const summary = 'Módulos revisados ' + completedModules + '/' + moduleCount
    + '  ·  Prácticas resueltas ' + completedPractices + '/' + practiceCount;
  const [x, y, width] = hub.summary;
  const summaryWidth = bold.widthOfTextAtSize(summary, 10.5);
  hubPage.drawText(summary, {x:x + width - summaryWidth, y:y + 5, size:10.5, font:bold, color:colors.muted});

  return pdf.save({useObjectStreams:false});
}

function capturePdfProgress() {
  const checked = new Set(Array.from(document.querySelectorAll('.subtopic-check:checked'), field => field.id));
  const practices = new Map();
  for (const quiz of document.querySelectorAll('.quiz')) {
    const selected = quiz.querySelector('input:checked')?.value ?? null;
    const result = quiz.querySelector('.feedback');
    const feedback = result.textContent.trim();
    const completed = quiz.dataset.completed === 'true';
    if (selected === null && !feedback && !completed) continue;
    const correct = result.dataset.correct === undefined ? null : result.dataset.correct === 'true';
    practices.set('practica-' + quiz.dataset.theme, {
      selected, feedback, completed, correct, checkedValue:result.dataset.checkedValue ?? null,
    });
  }
  return {checked, practices, boards:snapshotWhiteboards()};
}

const pdfButton = document.getElementById('download-deck');
const pdfStatus = document.getElementById('pdf-export-status');
function printCourse() {
  for (const previous of document.querySelectorAll('.board-print-snapshot')) previous.remove();
  for (const [id, image] of snapshotWhiteboards()) {
    const slot = document.getElementById(id)?.closest('.slide')?.querySelector('.board-slot');
    if (!slot) continue;
    const figure = document.createElement('img');
    figure.className = 'board-print-snapshot';
    figure.src = image;
    figure.alt = 'Pizarra de ' + document.getElementById(id).textContent;
    slot.append(figure);
  }
}
window.addEventListener('beforeprint', printCourse);
window.addEventListener('afterprint', () => {
  document.querySelectorAll('.board-print-snapshot').forEach(image => image.remove());
});
pdfButton.addEventListener('click', async () => {
  if (!document.getElementById('deck-pdf').textContent.trim()) {
    window.print();
    return;
  }
  pdfButton.disabled = true;
  pdfButton.setAttribute('aria-busy', 'true');
  pdfStatus.classList.add('sr');
  pdfStatus.textContent = 'Preparando el PDF con el avance de la sesión.';
  const startingReset = lastReset;
  try {
    const state = capturePdfProgress();
    const encoded = document.getElementById('deck-pdf').textContent.trim();
    const basePdf = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const layout = JSON.parse(document.getElementById('deck-pdf-layout').textContent);
    const bytes = await createSessionPdf(basePdf, layout, state);
    if (startingReset !== lastReset) return;
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = config.slug + '.pdf';
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    pdfStatus.textContent = 'PDF con el avance de la sesión preparado.';
  } catch (error) {
    if (startingReset !== lastReset) return;
    console.error('Error al preparar el PDF.', error);
    pdfStatus.classList.remove('sr');
    pdfStatus.textContent = 'No se pudo preparar el PDF. Vuelve a pulsar PDF.';
  } finally {
    pdfButton.removeAttribute('aria-busy');
    pdfButton.disabled = false;
  }
});

show(positionFromHash());
updateProgress();
checkSessionReset();
}, {once:true});
