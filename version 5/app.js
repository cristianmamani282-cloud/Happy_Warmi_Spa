/**
 * Happy Warmi Spa - Aplicación Principal (Versión 2.3)
 * Incluye: Calendario dinámico actual, bloqueo de horarios hasta fin de reserva,
 * precios en Bolivianos (Bs), modo offline con sincronización, login admin seguro,
 * sanitización DOMPurify y telemetría interna silenciosa LCP/CLS.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ==========================================================================
  // 0. MODO OSCURO ARMÓNICO & UTILIDADES INTERNAS (DOMPurify + LCP/CLS)
  // ==========================================================================
  const STORAGE_KEY_THEME = 'happy_warmi_theme';
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeToggleIcon = document.getElementById('themeToggleIcon');

  function applyTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem(STORAGE_KEY_THEME, resolved);
    } catch (e) {}
    if (themeToggleIcon) {
      themeToggleIcon.textContent = resolved === 'dark' ? '☀️' : '🌙';
    }
    if (themeToggleBtn) {
      themeToggleBtn.title = resolved === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
    }
  }

  (function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY_THEME);
    } catch (e) {}
    if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      saved = 'dark';
    }
    applyTheme(saved || 'light');
  })();

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      showToast(next === 'dark' ? 'Modo Oscuro activado' : 'Modo Claro activado');
    });
  }

  const internalWebVitals = { lcp: 0, cls: 0 };

  (function initInternalVitalsObservers() {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        if (entries.length > 0) {
          internalWebVitals.lcp = Math.round(entries[entries.length - 1].startTime);
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}

    try {
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!entry.hadRecentInput) {
            internalWebVitals.cls += entry.value;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  })();

  function sanitizeText(value) {
    const str = String(value == null ? '' : value);
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
      return window.DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
    }
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/<[^>]*>/g, '').trim();
  }

  function sanitizeHTML(dirtyHtml) {
    const str = String(dirtyHtml == null ? '' : dirtyHtml);
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
      return window.DOMPurify.sanitize(str, {
        ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'span', 'div', 'br'],
        ALLOWED_ATTR: ['style', 'class']
      });
    }
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==========================================================================
  // 1. CONSTANTES, ALMACENAMIENTO Y HASHING SEGURO PARA ADMIN
  // ==========================================================================
  const STORAGE_KEY_RESERVATIONS = 'happy_warmi_reservations';
  const STORAGE_KEY_BITACORA = 'happy_warmi_bitacora';
  const STORAGE_KEY_ADMIN_CREDS = 'happy_warmi_admin_credentials';
  const STORAGE_KEY_AUTH_LOCK = 'happy_warmi_admin_lock';
  const LEGACY_STORAGE_KEY = 'asio_spa_reservations';

  // Hash SHA-256 de la credencial por defecto ('admin123') para no almacenar texto plano
  const DEFAULT_ADMIN_USER = 'admin@happywarmi.com';
  const DEFAULT_ADMIN_USER_ALIAS = 'admin';
  const DEFAULT_ADMIN_PASS_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

  async function sha256Hex(text) {
    const clean = String(text || '');
    if (window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined') {
      const msgUint8 = new TextEncoder().encode(clean);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Respaldo determinístico si el contexto no es seguro
    let h = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fallback_${(h >>> 0).toString(16)}`;
  }

  function getAdminCredentialsConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_ADMIN_CREDS) || 'null');
      if (saved && saved.username && saved.passwordHash) {
        return saved;
      }
    } catch (e) {}
    return {
      username: DEFAULT_ADMIN_USER,
      alias: DEFAULT_ADMIN_USER_ALIAS,
      passwordHash: DEFAULT_ADMIN_PASS_HASH
    };
  }

  function getStoredReservations() {
    try {
      const current = localStorage.getItem(STORAGE_KEY_RESERVATIONS);
      if (current) return JSON.parse(current);
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const adapted = parsed.map((r) => ({
          ...r,
          code: r.code ? r.code.replace('ASIO-', 'HWARMI-') : `HWARMI-${Math.floor(10000 + Math.random() * 90000)}`,
          personCount: r.personCount || 1,
          specialist: r.specialist?.name === 'Haru' ? { name: 'Rosa', role: 'Faciales & Piel' } :
                      r.specialist?.name === 'Sora' || r.specialist?.name === 'Kenji' ? { name: 'Moy', role: 'Rituales Zen' } :
                      { name: 'Maya', role: 'Masajes y Terapias' }
        }));
        localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(adapted));
        return adapted;
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredReservations(list) {
    try {
      localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(list));
    } catch (e) {
      console.warn('Error guardando reservas:', e);
    }
  }

  const SPECIALISTS = [
    { id: 'maya', name: 'Maya', role: 'Masajes y Terapias Corporales' },
    { id: 'rosa', name: 'Rosa', role: 'Faciales & Cuidado de la Piel' },
    { id: 'moy',  name: 'Moy',  role: 'Rituales Zen & Armonización' }
  ];

  // ==========================================================================
  // 2. SISTEMA DE BITÁCORA DE EVENTOS (SUPABASE + LOCALSTORAGE HÍBRIDO)
  // ==========================================================================
  function logEvent(tipo, mensaje, detalles = null) {
    const cleanMsg = sanitizeText(mensaje);
    if (window.WarmiDB && typeof window.WarmiDB.logEvent === 'function') {
      window.WarmiDB.logEvent(tipo, cleanMsg, 'cliente', detalles);
    } else {
      const hora = new Date().toLocaleTimeString();
      try {
        const bitacora = JSON.parse(localStorage.getItem(STORAGE_KEY_BITACORA) || '[]');
        bitacora.unshift({
          hora,
          tipo,
          mensaje: cleanMsg,
          usuario_tipo: 'cliente',
          timestamp: new Date().toISOString()
        });
        if (bitacora.length > 600) bitacora.length = 600;
        localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify(bitacora));
      } catch (e) {}
    }
  }

  // ==========================================================================
  // 3. MODO OFFLINE & SINCRONIZACIÓN AUTOMÁTICA PARA EL USUARIO
  // ==========================================================================
  const offlineBanner = document.getElementById('offlineBanner');
  const offlineBannerText = document.getElementById('offlineBannerText');
  const pwaStatusBadge = document.getElementById('pwaStatusBadge');
  const pwaStatusText = document.getElementById('pwaStatusText');

  function updateConnectivityUI() {
    const isOnline = navigator.onLine !== false;
    const dbStatus = window.WarmiDB ? window.WarmiDB.getStatus() : { pendingCount: 0 };
    const pending = dbStatus.pendingCount || 0;

    if (!isOnline) {
      if (offlineBanner) offlineBanner.classList.add('offline-banner--visible');
      if (offlineBannerText) {
        offlineBannerText.textContent = pending > 0
          ? `Modo Offline activo (${pending} cambio(s) guardado(s) localmente). Se sincronizarán al volver la red.`
          : 'Modo Offline activo: puedes explorar servicios, usar el calendario y reservar sin conexión.';
      }
      if (pwaStatusBadge) pwaStatusBadge.classList.add('pwa-status--offline');
      if (pwaStatusText) pwaStatusText.textContent = 'Modo Offline activo';
    } else {
      if (pending > 0) {
        if (offlineBanner) offlineBanner.classList.add('offline-banner--visible');
        if (offlineBannerText) offlineBannerText.textContent = `Sincronizando ${pending} registro(s) guardado(s) sin conexión...`;
      } else {
        if (offlineBanner) offlineBanner.classList.remove('offline-banner--visible');
      }
      if (pwaStatusBadge) pwaStatusBadge.classList.remove('pwa-status--offline');
      if (pwaStatusText) pwaStatusText.textContent = 'En línea · Modo Offline listo';
    }
  }

  window.addEventListener('online', async () => {
    updateConnectivityUI();
    if (window.WarmiDB && typeof window.WarmiDB.syncPendingWithCloud === 'function') {
      const res = await window.WarmiDB.syncPendingWithCloud();
      if (res.synced > 0) {
        showToast(`Conexión restablecida · ${res.synced} dato(s) sincronizado(s)`);
      }
      await refreshReservationsFromDB();
    }
    updateConnectivityUI();
  });

  window.addEventListener('offline', () => {
    updateConnectivityUI();
    showToast('Sin conexión: Modo Offline activado');
  });

  window.addEventListener('warmi:sync_complete', () => {
    updateConnectivityUI();
  });

  updateConnectivityUI();

  // ==========================================================================
  // 4. EVENT BUBBLING & DELEGACIÓN EN EL CONTENEDOR LIVE (#liveSpaContainer)
  // ==========================================================================
  const liveContainer = document.getElementById('liveSpaContainer');
  const chatInput = document.getElementById('chatInput');
  const btnSendChat = document.getElementById('btnSendChat');
  const liveChatFeed = document.getElementById('liveChatFeed');

  if (liveContainer) {
    liveContainer.addEventListener('click', (e) => {
      const btnOferta = e.target.closest('[data-prod]');
      if (btnOferta) {
        const prod = sanitizeText(btnOferta.dataset.prod);
        logEvent('OFERTA_CLICK', `Producto de Live seleccionado: ${prod}`);
        showToast(`Oferta seleccionada: ${prod}`);
        return;
      }

      const btnLike = e.target.closest('[data-action="like"]');
      if (btnLike) {
        logEvent('LIKE_STREAM', '¡El usuario envió un ❤️ al Live de Happy Warmi!');
        renderFloatingHeart(e.clientX, e.clientY);
        showToast('¡Gracias por tu ❤️ en el Live!');
      }
    });

    liveContainer.addEventListener('dblclick', (e) => {
      logEvent('LIKE_STREAM_DBLCLICK', '¡Doble corazón ❤️❤️ enviado al Live de Happy Warmi Spa!');
      renderFloatingHeart(e.clientX, e.clientY);
      setTimeout(() => renderFloatingHeart(e.clientX + 15, e.clientY - 15), 120);
      showToast('¡❤️❤️ Doble like enviado!');
    });
  }

  function handleSendChatMessage() {
    if (!chatInput) return;
    const rawMsg = chatInput.value;
    const msg = sanitizeText(rawMsg);
    if (!msg) return;

    logEvent('CHAT_MENSAJE_ENVIADO', `Mensaje enviado al chat: "${msg}"`);
    showToast('Mensaje enviado al chat del live');

    if (liveChatFeed) {
      const bubble = document.createElement('div');
      bubble.style.cssText = 'padding:0.3rem 0.5rem; background:rgba(255,255,255,0.06); border-radius:6px;';
      bubble.innerHTML = sanitizeHTML(`<strong>Tú:</strong> ${escapeHtml(msg)}`);
      liveChatFeed.appendChild(bubble);
      liveChatFeed.scrollTop = liveChatFeed.scrollHeight;

      setTimeout(() => {
        const therapistNames = ['Maya (Masajes)', 'Rosa (Faciales)', 'Moy (Rituales)'];
        const randomTherapist = therapistNames[Math.floor(Math.random() * therapistNames.length)];
        const reply = document.createElement('div');
        reply.style.cssText = 'padding:0.3rem 0.5rem; background:rgba(90, 73, 120, 0.2); border-radius:6px; color:#E9D5FF;';
        reply.innerHTML = sanitizeHTML(`🌿 <strong>${randomTherapist}:</strong> ¡Gracias por escribirnos! Estaremos encantadas de recibirte.`);
        liveChatFeed.appendChild(reply);
        liveChatFeed.scrollTop = liveChatFeed.scrollHeight;
      }, 1200);
    }

    chatInput.value = '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (chatInput) {
    chatInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') handleSendChatMessage();
    });
  }

  if (btnSendChat) {
    btnSendChat.addEventListener('click', handleSendChatMessage);
  }

  // Formulario de Registro de Eventos Operativos para Usuario (Criterio 1 y 2)
  const userEventRegisterForm = document.getElementById('userEventRegisterForm');
  const userEventReceipt = document.getElementById('userEventReceipt');

  if (userEventRegisterForm) {
    userEventRegisterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipo = sanitizeText(document.getElementById('uEventType')?.value || 'EXPERIENCIA_CLIENTE');
      const area = sanitizeText(document.getElementById('uEventArea')?.value || 'Recepción y Spa');
      const rawMsg = document.getElementById('uEventMessage')?.value || '';
      const mensaje = sanitizeText(rawMsg);

      if (mensaje.length < 5) {
        showToast('Describe el evento con al menos 5 caracteres.');
        return;
      }

      let resultEvent = null;
      if (window.WarmiDB && typeof window.WarmiDB.registerOperationalEvent === 'function') {
        resultEvent = await window.WarmiDB.registerOperationalEvent({
          tipo,
          area,
          mensaje: `[${area}] ${mensaje}`,
          usuario_tipo: 'cliente',
          responsable: area
        });
      } else {
        logEvent(tipo, `[${area}] ${mensaje}`, { area });
      }

      const ts = resultEvent?.serverTimestamp || new Date().toISOString();
      const wm = resultEvent?.watermark || 'LOCAL';
      if (userEventReceipt) {
        userEventReceipt.style.display = 'block';
        userEventReceipt.textContent = `✅ Registrado · Timestamp: ${new Date(ts).toLocaleString('es-BO')} · Marca: ${wm}`;
      }

      userEventRegisterForm.reset();
      showToast('Evento registrado con sello de tiempo automático');
    });
  }

  function renderFloatingHeart(clientX, clientY) {
    const heart = document.createElement('div');
    heart.className = 'floating-heart-anim';
    heart.textContent = '❤️';
    heart.style.left = `${clientX || window.innerWidth / 2}px`;
    heart.style.top = `${clientY || window.innerHeight / 2}px`;
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 1200);
  }

  // ==========================================================================
  // 5. SISTEMA DE DESPLIEGUE DE VISTAS (BEM: .spa-view--active)
  // ==========================================================================
  const viewPanels = document.querySelectorAll('.spa-view');
  const viewTabButtons = document.querySelectorAll('.view-nav__btn');
  const mobileNavItems = document.querySelectorAll('.mobile-nav__item');

  function switchView(targetViewName) {
    if (!targetViewName) return;

    viewPanels.forEach((panel) => panel.classList.remove('spa-view--active'));

    const activePanel = document.getElementById(`view-${targetViewName}`);
    if (activePanel) {
      activePanel.classList.add('spa-view--active');
      activePanel.scrollTop = 0;
    }

    viewTabButtons.forEach((btn) => {
      btn.classList.toggle('view-nav__btn--active', btn.dataset.targetView === targetViewName);
    });

    mobileNavItems.forEach((item) => {
      item.classList.toggle('mobile-nav__item--active', item.dataset.targetView === targetViewName);
    });

    if (targetViewName === 'reserva') {
      refreshReservationsFromDB();
    }

    logEvent('CAMBIO_VISTA', `Navegación del usuario hacia la vista: ${targetViewName}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.view-trigger-btn, .view-nav__btn, .mobile-nav__item');
    if (trigger && trigger.dataset.targetView) {
      e.preventDefault();
      switchView(trigger.dataset.targetView);
    }
  });

  // ==========================================================================
  // 6. ESTADO DE RESERVA Y FECHAS ACTUALES REALES
  // ==========================================================================
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const SLOT_TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '17:00', '18:00'];

  function formatDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatFullSpanishDate(dateObj) {
    return `${dayNames[dateObj.getDay()]}, ${dateObj.getDate()} de ${monthNames[dateObj.getMonth()]} de ${dateObj.getFullYear()}`;
  }

  // Determinar fecha inicial: hoy, o mañana si ya pasaron todos los horarios del día
  function getInitialBookingDate() {
    const now = new Date();
    const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastSlotHour = 18;
    if (now.getHours() >= lastSlotHour) {
      todayBase.setDate(todayBase.getDate() + 1);
    }
    return todayBase;
  }

  const initialDate = getInitialBookingDate();

  const bookingState = {
    step: 1,
    personCount: 1,
    experience: {
      id: 'masaje-relajante',
      name: 'Masaje Relajante',
      duration: '60 min',
      price: 280
    },
    specialist: {
      id: 'maya',
      name: 'Maya',
      role: 'Masajes y Terapias Corporales'
    },
    date: {
      day: initialDate.getDate(),
      month: initialDate.getMonth(),
      year: initialDate.getFullYear(),
      dateString: formatFullSpanishDate(initialDate),
      dateKey: formatDateKey(initialDate)
    },
    timeSlot: '10:00'
  };

  const calendarDaysContainer = document.getElementById('calendarDaysGrid');
  const calendarMonthTitle = document.getElementById('calendarMonthTitle');
  const calendarYearBadge = document.getElementById('calendarYearBadge');
  const calendarSelectedFullText = document.getElementById('calendarSelectedFullText');
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const todayJumpBtn = document.getElementById('todayJumpBtn');
  const continueBookingBtn = document.getElementById('continueBookingBtn');
  const stepperItems = document.querySelectorAll('.booking-panel__step');
  const groupSizeContainer = document.getElementById('groupSizeContainer');
  const timeSlotsContainer = document.getElementById('timeSlotsGridContainer');

  if (calendarSelectedFullText) {
    calendarSelectedFullText.textContent = bookingState.date.dateString;
  }

  // ==========================================================================
  // 7. SELECCIÓN DE EXPERIENCIAS, GRUPOS Y ESPECIALISTAS
  // ==========================================================================
  const experienceContainer = document.querySelector('.booking-panel__exp-grid');
  if (experienceContainer) {
    experienceContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.booking-panel__exp-item');
      if (!item) return;

      document.querySelectorAll('.booking-panel__exp-item').forEach((el) => el.classList.remove('booking-panel__exp-item--selected'));
      item.classList.add('booking-panel__exp-item--selected');

      bookingState.experience = {
        id: item.dataset.id,
        name: item.dataset.name,
        duration: item.dataset.duration,
        price: parseFloat(item.dataset.price)
      };

      updateStepper(1);
      logEvent('EXPERIENCIA_SELECT', `Servicio seleccionado: ${bookingState.experience.name} (Bs ${bookingState.experience.price})`);
      showToast(`Experiencia: ${bookingState.experience.name} (Bs ${bookingState.experience.price})`);
      updateSlotsAvailability();
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.deploy-reserve-btn');
    if (!btn) return;

    const targetId = btn.dataset.targetId;
    const matchingExpItem = document.querySelector(`.booking-panel__exp-item[data-id="${targetId}"]`);
    if (matchingExpItem) matchingExpItem.click();
    switchView('reserva');
  });

  if (groupSizeContainer) {
    groupSizeContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.booking-panel__group-pill');
      if (!pill) return;

      document.querySelectorAll('.booking-panel__group-pill').forEach((p) => p.classList.remove('booking-panel__group-pill--selected'));
      pill.classList.add('booking-panel__group-pill--selected');

      const count = parseInt(pill.dataset.persons, 10) || 1;
      bookingState.personCount = count;

      if (count === 3) {
        bookingState.specialist = {
          id: 'grupo-completo',
          name: 'Maya, Rosa y Moy',
          role: 'Todo el Equipo Asignado'
        };
        showToast('Grupo de 3 personas: Asignados Maya, Rosa y Moy');
      } else if (count === 2) {
        bookingState.specialist = {
          id: 'pareja-dos',
          name: 'Maya y Rosa',
          role: '2 Terapeutas Asignadas'
        };
        showToast('Cita para 2 personas: 2 Terapeutas asignadas');
      } else {
        const selectedSpecCard = document.querySelector('.specialist-card--selected');
        if (selectedSpecCard) {
          bookingState.specialist = {
            id: selectedSpecCard.dataset.id,
            name: selectedSpecCard.dataset.name,
            role: selectedSpecCard.dataset.role
          };
        }
      }

      updateStepper(2);
      logEvent('GRUPO_SELECT', `Tamaño de reserva: ${count} persona(s)`);
      updateSlotsAvailability();
    });
  }

  const specialistContainer = document.getElementById('specialistsListContainer');
  if (specialistContainer) {
    specialistContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.specialist-card');
      if (!card) return;

      document.querySelectorAll('.specialist-card').forEach((el) => el.classList.remove('specialist-card--selected'));
      card.classList.add('specialist-card--selected');

      if (bookingState.personCount === 1) {
        bookingState.specialist = {
          id: card.dataset.id,
          name: card.dataset.name,
          role: card.dataset.role
        };
        showToast(`Terapeuta: ${bookingState.specialist.name}`);
      } else {
        // Si seleccionó 2 o 3 personas y hace clic en un terapeuta, volver a 1 persona para respetarlo
        const singlePill = document.querySelector('.booking-panel__group-pill[data-persons="1"]');
        if (singlePill) singlePill.click();
        bookingState.specialist = {
          id: card.dataset.id,
          name: card.dataset.name,
          role: card.dataset.role
        };
        showToast(`Terapeuta: ${bookingState.specialist.name}`);
      }

      updateStepper(2);
      logEvent('ESPECIALISTA_SELECT', `Terapeuta seleccionado: ${bookingState.specialist.name}`);
      updateSlotsAvailability();
    });
  }

  // ==========================================================================
  // 8. LÓGICA DE OCUPACIÓN HASTA QUE PASE LA HORA DE LA RESERVA
  // ==========================================================================
  function parseDurationMinutes(durationStr) {
    const match = String(durationStr || '60').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 60;
  }

  function buildLocalDateTime(dateKey, timeSlot) {
    if (!dateKey || !timeSlot) return null;
    const [y, m, d] = dateKey.split('-').map(Number);
    const [hh, mm] = timeSlot.split(':').map(Number);
    if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  function getSpecialistNamesInReservation(reservation) {
    const raw = (reservation.specialist?.name || '').toLowerCase();
    const names = [];
    if (raw.includes('maya')) names.push('maya');
    if (raw.includes('rosa')) names.push('rosa');
    if (raw.includes('moy')) names.push('moy');
    if (names.length === 0) {
      const count = reservation.personCount || 1;
      if (count >= 3) return ['maya', 'rosa', 'moy'];
      if (count === 2) return ['maya', 'rosa'];
      return ['maya'];
    }
    return names;
  }

  function isReservationActiveNow(reservation, now) {
    const status = reservation.status || 'Confirmada';
    if (status === 'Cancelada' || status === 'Completada') return false;
    const startDt = buildLocalDateTime(reservation.dateKey, reservation.timeSlot);
    if (!startDt) return false;
    const durMin = parseDurationMinutes(reservation.experience?.duration);
    const endDt = new Date(startDt.getTime() + durMin * 60000);
    // La reserva mantiene ocupado el horario hasta que pase su hora de finalización
    return now.getTime() < endDt.getTime();
  }

  async function refreshReservationsFromDB() {
    if (window.WarmiDB && typeof window.WarmiDB.fetchReservations === 'function') {
      try {
        await window.WarmiDB.fetchReservations();
      } catch (e) {}
    }
    updateSlotsAvailability();
  }

  function updateSlotsAvailability() {
    if (!timeSlotsContainer) return;

    const now = new Date();
    const allReservations = getStoredReservations();
    const currentDateKey = bookingState.date.dateKey;
    const requestedPersons = bookingState.personCount || 1;
    const selectedDurationMin = parseDurationMinutes(bookingState.experience?.duration);

    // Reservas de la fecha elegida que aún NO han pasado su hora de finalización
    const activeReservationsForDate = allReservations.filter((r) =>
      r.dateKey === currentDateKey && isReservationActiveNow(r, now)
    );

    const slotButtons = timeSlotsContainer.querySelectorAll('.time-slots__pill');
    const summaryEl = document.getElementById('slotStatusSummary');
    let hasSelectedValidSlot = false;
    let occupiedCountTotal = 0;

    slotButtons.forEach((btn) => {
      const time = btn.dataset.time;
      const slotStart = buildLocalDateTime(currentDateKey, time);
      const slotEnd = slotStart ? new Date(slotStart.getTime() + selectedDurationMin * 60000) : null;

      btn.classList.remove('time-slots__pill--occupied', 'time-slots__pill--past', 'time-slots__pill--selected');
      btn.removeAttribute('disabled');
      btn.title = '';

      // 1. Verificar si la hora ya pasó en el día actual
      if (slotStart && slotStart.getTime() <= now.getTime()) {
        btn.classList.add('time-slots__pill--past');
        btn.setAttribute('disabled', 'true');
        btn.title = 'Este horario ya pasó en la fecha actual.';
        return;
      }

      // 2. Verificar reservas superpuestas cuya hora aún no haya pasado
      const overlappingReservations = activeReservationsForDate.filter((r) => {
        const resStart = buildLocalDateTime(r.dateKey, r.timeSlot);
        if (!resStart || !slotStart || !slotEnd) return false;
        const resDur = parseDurationMinutes(r.experience?.duration);
        const resEnd = new Date(resStart.getTime() + resDur * 60000);
        return slotStart.getTime() < resEnd.getTime() && resStart.getTime() < slotEnd.getTime();
      });

      const busyTherapists = new Set();
      overlappingReservations.forEach((r) => {
        getSpecialistNamesInReservation(r).forEach((name) => busyTherapists.add(name));
      });

      const freeTherapists = ['maya', 'rosa', 'moy'].filter((t) => !busyTherapists.has(t));
      const freeSpots = freeTherapists.length;

      const selectedSpecId = (bookingState.specialist?.id || '').toLowerCase();
      const isSelectedTherapistBusy =
        requestedPersons === 1 &&
        ['maya', 'rosa', 'moy'].includes(selectedSpecId) &&
        busyTherapists.has(selectedSpecId);

      // Si el horario ya está registrado (para el terapeuta elegido o sin cupo suficiente), marcar como Ocupado hasta que pase la hora
      if (overlappingReservations.length > 0 && (isSelectedTherapistBusy || freeSpots < requestedPersons || freeSpots === 0)) {
        occupiedCountTotal++;
        btn.classList.add('time-slots__pill--occupied');
        btn.setAttribute('disabled', 'true');
        if (freeSpots === 0) {
          btn.title = 'Horario ocupado: Maya, Rosa y Moy tienen reservas activas hasta finalizar esta hora.';
        } else if (isSelectedTherapistBusy) {
          btn.title = `Horario ocupado: ${bookingState.specialist.name} ya tiene una reserva registrada en este horario.`;
        } else {
          btn.title = `Cupo insuficiente: quedan ${freeSpots} terapeuta(s) disponible(s) y solicitaste ${requestedPersons}.`;
        }
      } else {
        btn.title = `Disponible (${freeSpots} terapeuta${freeSpots === 1 ? '' : 's'} libre${freeSpots === 1 ? '' : 's'})`;
        if (time === bookingState.timeSlot) {
          hasSelectedValidSlot = true;
          btn.classList.add('time-slots__pill--selected');
        }
      }
    });

    if (!hasSelectedValidSlot) {
      const firstAvailable = timeSlotsContainer.querySelector('.time-slots__pill:not([disabled])');
      if (firstAvailable) {
        slotButtons.forEach((b) => b.classList.remove('time-slots__pill--selected'));
        firstAvailable.classList.add('time-slots__pill--selected');
        bookingState.timeSlot = firstAvailable.dataset.time;
      } else {
        bookingState.timeSlot = '';
      }
    }

    if (summaryEl) {
      summaryEl.textContent = occupiedCountTotal > 0
        ? `${occupiedCountTotal} horario(s) ocupado(s) hasta finalizar su cita`
        : 'Horarios libres · Ocupado hasta finalizar reserva';
    }
  }

  if (timeSlotsContainer) {
    timeSlotsContainer.addEventListener('click', (e) => {
      const slot = e.target.closest('.time-slots__pill:not([disabled])');
      if (!slot) return;

      document.querySelectorAll('.time-slots__pill').forEach((s) => s.classList.remove('time-slots__pill--selected'));
      slot.classList.add('time-slots__pill--selected');
      bookingState.timeSlot = slot.dataset.time || slot.textContent.trim();

      updateStepper(3);
      logEvent('HORA_SELECT', `Hora seleccionada: ${bookingState.timeSlot} hrs`);
      showToast(`Hora: ${bookingState.timeSlot} hrs`);
    });
  }

  // Reevaluar cada 30 segundos para liberar automáticamente cualquier horario cuando pase la hora de la reserva
  setInterval(updateSlotsAvailability, 30000);

  // ==========================================================================
  // 9. CALENDARIO INTERACTIVO CON FECHAS ACTUALES (DÍA, MES Y AÑO)
  // ==========================================================================
  let currentViewingYear = bookingState.date.year;
  let currentViewingMonth = bookingState.date.month;

  function renderCalendar(year, month) {
    if (!calendarDaysContainer || !calendarMonthTitle) return;

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    calendarMonthTitle.textContent = monthNames[month];
    if (calendarYearBadge) calendarYearBadge.textContent = String(year);
    if (calendarSelectedFullText) calendarSelectedFullText.textContent = bookingState.date.dateString;

    // Deshabilitar navegación a meses anteriores al mes actual
    if (prevMonthBtn) {
      const isCurrentOrEarlierMonth =
        year < now.getFullYear() || (year === now.getFullYear() && month <= now.getMonth());
      prevMonthBtn.disabled = isCurrentOrEarlierMonth;
    }

    calendarDaysContainer.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const startingOffset = (firstDay + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startingOffset; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'spa-calendar__day spa-calendar__day--disabled';
      calendarDaysContainer.appendChild(emptyCell);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(year, month, d);
      const cellTime = cellDate.getTime();
      const dayCell = document.createElement('div');
      dayCell.className = 'spa-calendar__day';
      dayCell.textContent = String(d);
      dayCell.dataset.day = String(d);

      if (cellTime < todayMidnight) {
        dayCell.classList.add('spa-calendar__day--disabled');
        dayCell.title = 'Fecha pasada';
      } else {
        if (cellTime === todayMidnight) {
          dayCell.classList.add('spa-calendar__day--today');
          dayCell.title = 'Hoy';
        }
        if (d === bookingState.date.day && month === bookingState.date.month && year === bookingState.date.year) {
          dayCell.classList.add('spa-calendar__day--selected');
        }
      }

      calendarDaysContainer.appendChild(dayCell);
    }

    updateSlotsAvailability();
  }

  function selectCalendarDay(year, month, day) {
    const dateObj = new Date(year, month, day);
    bookingState.date = {
      day,
      month,
      year,
      dateString: formatFullSpanishDate(dateObj),
      dateKey: formatDateKey(dateObj)
    };
    if (calendarSelectedFullText) {
      calendarSelectedFullText.textContent = bookingState.date.dateString;
    }
    renderCalendar(currentViewingYear, currentViewingMonth);
  }

  if (calendarDaysContainer) {
    calendarDaysContainer.addEventListener('click', (e) => {
      const cell = e.target.closest('.spa-calendar__day:not(.spa-calendar__day--disabled)');
      if (!cell || !cell.dataset.day) return;

      const d = parseInt(cell.dataset.day, 10);
      selectCalendarDay(currentViewingYear, currentViewingMonth, d);
      updateStepper(3);
      logEvent('FECHA_SELECT', `Fecha seleccionada: ${bookingState.date.dateString}`);
      showToast(`Fecha: ${bookingState.date.dateString}`);
    });
  }

  if (prevMonthBtn && nextMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      const now = new Date();
      if (currentViewingYear === now.getFullYear() && currentViewingMonth <= now.getMonth()) return;
      currentViewingMonth--;
      if (currentViewingMonth < 0) {
        currentViewingMonth = 11;
        currentViewingYear--;
      }
      renderCalendar(currentViewingYear, currentViewingMonth);
    });

    nextMonthBtn.addEventListener('click', () => {
      currentViewingMonth++;
      if (currentViewingMonth > 11) {
        currentViewingMonth = 0;
        currentViewingYear++;
      }
      renderCalendar(currentViewingYear, currentViewingMonth);
    });
  }

  if (todayJumpBtn) {
    todayJumpBtn.addEventListener('click', () => {
      const now = new Date();
      currentViewingYear = now.getFullYear();
      currentViewingMonth = now.getMonth();
      selectCalendarDay(now.getFullYear(), now.getMonth(), now.getDate());
      showToast('Calendario actualizado a la fecha de hoy');
    });
  }

  renderCalendar(currentViewingYear, currentViewingMonth);
  refreshReservationsFromDB();

  function updateStepper(stepNumber) {
    bookingState.step = Math.max(bookingState.step, stepNumber);
    stepperItems.forEach((stepEl, idx) => {
      stepEl.classList.toggle('booking-panel__step--active', (idx + 1) === bookingState.step);
    });
  }

  if (continueBookingBtn) {
    continueBookingBtn.addEventListener('click', () => {
      if (!bookingState.timeSlot) {
        showToast('No hay horarios disponibles en esta fecha. Elige otro día o terapeuta.');
        return;
      }
      openBookingConfirmationModal();
    });
  }

  // ==========================================================================
  // 10. FORMULARIO DE RESERVA CON VALIDACIÓN Y PRECIOS EN BOLIVIANOS (Bs)
  // ==========================================================================
  const bookingModal = document.getElementById('bookingModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const confirmBookingForm = document.getElementById('confirmBookingForm');
  const clientNameInput = document.getElementById('clientName');
  const clientPhoneInput = document.getElementById('clientPhone');
  const clientNameError = document.getElementById('clientNameError');
  const clientPhoneError = document.getElementById('clientPhoneError');

  const NAME_REGEX = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]{3,60}$/;
  const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

  if (clientNameInput) {
    clientNameInput.addEventListener('input', (e) => {
      const cleanVal = e.target.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '');
      if (cleanVal !== e.target.value) e.target.value = cleanVal;
      validateName();
    });
  }

  function validateName() {
    if (!clientNameInput) return false;
    const val = clientNameInput.value.trim();
    const isValid = NAME_REGEX.test(val);
    if (!isValid && val.length > 0) {
      clientNameInput.classList.add('spa-form__input--invalid');
      clientNameInput.classList.remove('spa-form__input--valid');
      if (clientNameError) clientNameError.classList.add('spa-form__error--visible');
    } else if (isValid) {
      clientNameInput.classList.remove('spa-form__input--invalid');
      clientNameInput.classList.add('spa-form__input--valid');
      if (clientNameError) clientNameError.classList.remove('spa-form__error--visible');
    } else {
      clientNameInput.classList.remove('spa-form__input--invalid', 'spa-form__input--valid');
      if (clientNameError) clientNameError.classList.remove('spa-form__error--visible');
    }
    return isValid;
  }

  if (clientPhoneInput) {
    clientPhoneInput.addEventListener('input', (e) => {
      const cleanVal = e.target.value.replace(/[^0-9+]/g, '');
      if (cleanVal !== e.target.value) e.target.value = cleanVal;
      validatePhone();
    });
  }

  function validatePhone() {
    if (!clientPhoneInput) return false;
    const val = clientPhoneInput.value.trim();
    const isValid = PHONE_REGEX.test(val);
    if (!isValid && val.length > 0) {
      clientPhoneInput.classList.add('spa-form__input--invalid');
      clientPhoneInput.classList.remove('spa-form__input--valid');
      if (clientPhoneError) clientPhoneError.classList.add('spa-form__error--visible');
    } else if (isValid) {
      clientPhoneInput.classList.remove('spa-form__input--invalid');
      clientPhoneInput.classList.add('spa-form__input--valid');
      if (clientPhoneError) clientPhoneError.classList.remove('spa-form__error--visible');
    } else {
      clientPhoneInput.classList.remove('spa-form__input--invalid', 'spa-form__input--valid');
      if (clientPhoneError) clientPhoneError.classList.remove('spa-form__error--visible');
    }
    return isValid;
  }

  function openBookingConfirmationModal() {
    if (!bookingModal) return;

    const groupText = bookingState.personCount === 1 ? '1 Persona (Individual)' :
                      bookingState.personCount === 2 ? '2 Personas (Dúo / Pareja)' :
                      '3 Personas (Grupo Relax)';
    const totalPrice = bookingState.experience.price * bookingState.personCount;

    document.getElementById('summaryExpName').textContent = bookingState.experience.name;
    document.getElementById('summaryGroupSize').textContent = groupText;
    document.getElementById('summaryDuration').textContent = bookingState.experience.duration;
    document.getElementById('summaryPrice').textContent = `Bs ${totalPrice}`;
    document.getElementById('summarySpecialist').textContent = `${bookingState.specialist.name} (${bookingState.specialist.role})`;
    document.getElementById('summaryDateTime').textContent = `${bookingState.date.dateString} - ${bookingState.timeSlot} hrs`;

    bookingModal.classList.add('spa-modal--active');
    logEvent('MODAL_RESERVA_ABIERTO', `Revisión de reserva para ${bookingState.experience.name} (Bs ${totalPrice})`);
  }

  function closeBookingConfirmationModal() {
    if (bookingModal) bookingModal.classList.remove('spa-modal--active');
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeBookingConfirmationModal);
  if (bookingModal) {
    bookingModal.addEventListener('click', (e) => {
      if (e.target === bookingModal) closeBookingConfirmationModal();
    });
  }

  if (confirmBookingForm) {
    confirmBookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!validateName()) {
        if (clientNameInput) clientNameInput.focus();
        showToast('El nombre solo debe contener letras.');
        return;
      }

      if (!validatePhone()) {
        if (clientPhoneInput) clientPhoneInput.focus();
        showToast('El teléfono solo debe contener números.');
        return;
      }

      if (!bookingState.timeSlot) {
        closeBookingConfirmationModal();
        showToast('El horario seleccionado ya no está disponible.');
        return;
      }

      const clientName = sanitizeText(clientNameInput.value);
      const clientPhone = sanitizeText(clientPhoneInput.value);
      const bookingCode = `HWARMI-${Math.floor(10000 + Math.random() * 90000)}`;
      const totalPrice = bookingState.experience.price * bookingState.personCount;
      const isOffline = navigator.onLine === false;

      closeBookingConfirmationModal();

      const newReservation = {
        code: bookingCode,
        clientName,
        phone: clientPhone,
        personCount: bookingState.personCount,
        experience: {
          ...bookingState.experience,
          price: totalPrice,
          unitPrice: bookingState.experience.price,
          totalPrice
        },
        specialist: bookingState.specialist,
        dateTime: `${bookingState.date.dateString} - ${bookingState.timeSlot} hrs`,
        dateKey: bookingState.date.dateKey,
        timeSlot: bookingState.timeSlot,
        status: 'Confirmada',
        cancellationReason: null,
        cancelledAt: null,
        pendingSync: isOffline,
        createdAt: new Date().toISOString()
      };

      const stored = getStoredReservations();
      stored.unshift(newReservation);
      saveStoredReservations(stored);

      if (window.WarmiDB && typeof window.WarmiDB.saveReservation === 'function') {
        await window.WarmiDB.saveReservation(newReservation);
      }

      logEvent(
        'RESERVA_CONFIRMADA',
        `Cita ${bookingCode} confirmada para ${clientName} (${bookingState.personCount} pers.) con ${bookingState.specialist.name} el ${bookingState.date.dateKey} a las ${bookingState.timeSlot} hrs (Bs ${totalPrice})`
      );

      updateSlotsAvailability();
      updateConnectivityUI();

      const successModal = document.getElementById('successModal');
      const successOfflineNote = document.getElementById('successOfflineNote');
      if (successModal) {
        document.getElementById('successClientName').textContent = clientName;
        document.getElementById('successBookingCode').textContent = bookingCode;
        document.getElementById('successDetails').textContent =
          `${bookingState.experience.name} (${bookingState.personCount} pers. · Bs ${totalPrice}) con ${bookingState.specialist.name} para el ${bookingState.date.dateString} a las ${bookingState.timeSlot} hrs.`;
        if (successOfflineNote) {
          successOfflineNote.style.display = isOffline ? 'block' : 'none';
        }
        successModal.classList.add('spa-modal--active');
      }

      confirmBookingForm.reset();
      clientNameInput.classList.remove('spa-form__input--valid');
      clientPhoneInput.classList.remove('spa-form__input--valid');

      showToast(`¡Cita ${bookingCode} agendada con éxito!`);
    });
  }

  const successCloseBtn = document.getElementById('successCloseBtn');
  const successOkBtn = document.getElementById('successOkBtn');
  if (successCloseBtn) {
    successCloseBtn.addEventListener('click', () => {
      document.getElementById('successModal')?.classList.remove('spa-modal--active');
    });
  }
  if (successOkBtn) {
    successOkBtn.addEventListener('click', () => {
      document.getElementById('successModal')?.classList.remove('spa-modal--active');
    });
  }

  // ==========================================================================
  // 11. GESTIÓN DE "MIS CITAS" Y CANCELACIÓN JUSTIFICADA
  // ==========================================================================
  const myBookingsModal = document.getElementById('myBookingsModal');
  const openMyBookingsBtn = document.getElementById('openMyBookingsBtn');
  const myBookingsCloseBtn = document.getElementById('myBookingsCloseBtn');
  const myBookingsListContainer = document.getElementById('myBookingsListContainer');
  const myBookingCodeSearch = document.getElementById('myBookingCodeSearch');
  const btnSearchMyBooking = document.getElementById('btnSearchMyBooking');

  const cancelBookingModal = document.getElementById('cancelBookingModal');
  const cancelModalCloseBtn = document.getElementById('cancelModalCloseBtn');
  const btnDismissCancellation = document.getElementById('btnDismissCancellation');
  const cancelBookingForm = document.getElementById('cancelBookingForm');
  const cancellationReasonInput = document.getElementById('cancellationReasonInput');
  const cancelReasonError = document.getElementById('cancelReasonError');

  let pendingCancelCode = null;

  function renderMyBookings(filterCode = '') {
    if (!myBookingsListContainer) return;
    myBookingsListContainer.innerHTML = '';

    const list = getStoredReservations();
    const query = sanitizeText(filterCode).toLowerCase();

    const filtered = query
      ? list.filter((r) => (r.code || '').toLowerCase().includes(query) || (r.clientName || '').toLowerCase().includes(query))
      : list;

    if (filtered.length === 0) {
      myBookingsListContainer.innerHTML = sanitizeHTML(
        '<div style="text-align:center; padding:1.5rem; color:var(--text-muted); font-size:0.82rem;">No se encontraron citas registradas.</div>'
      );
      return;
    }

    filtered.forEach((r) => {
      const card = document.createElement('div');
      const isCancelled = (r.status || 'Confirmada') === 'Cancelada';
      card.className = `my-booking-card ${isCancelled ? 'my-booking-card--cancelled' : ''}`;

      const priceDisplay = r.experience?.totalPrice ?? r.experience?.price ?? 0;
      const syncTag = r.pendingSync
        ? '<span style="font-size:0.65rem; background:#FEF3C7; color:#92400E; padding:0.15rem 0.45rem; border-radius:8px; font-weight:700;">Offline · Pendiente sync</span>'
        : '';

      card.innerHTML = sanitizeHTML(`
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem; flex-wrap:wrap;">
          <span style="font-family:monospace; font-weight:700; color:var(--primary-purple);">${escapeHtml(r.code)}</span>
          <div style="display:flex; gap:0.35rem; align-items:center;">
            ${syncTag}
            <span style="font-size:0.72rem; padding:0.2rem 0.5rem; border-radius:12px; font-weight:700; ${isCancelled ? 'background:#FEE2E2; color:#DC2626;' : 'background:#DCFCE7; color:#15803D;'}">
              ${escapeHtml(r.status || 'Confirmada')}
            </span>
          </div>
        </div>
        <div style="font-size:0.82rem; font-weight:600; color:var(--text-primary); margin-top:0.2rem;">
          ${escapeHtml(r.experience?.name || 'Tratamiento')} (${r.personCount || 1} persona${(r.personCount || 1) > 1 ? 's' : ''}) · Bs ${priceDisplay}
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary);">
          Terapeuta: <strong>${escapeHtml(r.specialist?.name || 'Maya')}</strong> · Fecha: ${escapeHtml(r.dateTime || 'S/F')}
        </div>
        ${isCancelled && r.cancellationReason ? `
          <div style="font-size:0.73rem; background:rgba(220,38,38,0.08); padding:0.4rem; border-radius:6px; color:#B91C1C; margin-top:0.3rem;">
            <strong>Motivo de cancelación:</strong> "${escapeHtml(r.cancellationReason)}"
          </div>
        ` : ''}
      `);

      if (!isCancelled) {
        const btnCancel = document.createElement('button');
        btnCancel.type = 'button';
        btnCancel.className = 'btn-pill btn-pill--danger';
        btnCancel.style.cssText = 'font-size:0.75rem; padding:0.35rem 0.75rem; min-height:36px; margin-top:0.4rem; align-self:flex-start;';
        btnCancel.textContent = '✕ Cancelar esta Cita';
        btnCancel.addEventListener('click', () => openCancellationModal(r));
        card.appendChild(btnCancel);
      }

      myBookingsListContainer.appendChild(card);
    });
  }

  function openCancellationModal(reservation) {
    pendingCancelCode = reservation.code;
    document.getElementById('cancelSummaryCode').textContent = reservation.code;
    document.getElementById('cancelSummaryExp').textContent = reservation.experience?.name || 'Tratamiento';
    document.getElementById('cancelSummaryDateTime').textContent = reservation.dateTime || 'Fecha no definida';

    if (cancellationReasonInput) cancellationReasonInput.value = '';
    if (cancelReasonError) cancelReasonError.classList.remove('spa-form__error--visible');

    if (myBookingsModal) myBookingsModal.classList.remove('spa-modal--active');
    if (cancelBookingModal) cancelBookingModal.classList.add('spa-modal--active');

    logEvent('INICIO_CANCELACION', `Usuario inició trámite para cancelar la cita ${reservation.code}`);
  }

  if (openMyBookingsBtn) {
    openMyBookingsBtn.addEventListener('click', async () => {
      await refreshReservationsFromDB();
      renderMyBookings();
      if (myBookingsModal) myBookingsModal.classList.add('spa-modal--active');
    });
  }

  if (myBookingsCloseBtn) {
    myBookingsCloseBtn.addEventListener('click', () => {
      if (myBookingsModal) myBookingsModal.classList.remove('spa-modal--active');
    });
  }

  if (btnSearchMyBooking && myBookingCodeSearch) {
    btnSearchMyBooking.addEventListener('click', () => renderMyBookings(myBookingCodeSearch.value));
    myBookingCodeSearch.addEventListener('input', () => renderMyBookings(myBookingCodeSearch.value));
  }

  const btnViewMyBookingNow = document.getElementById('btnViewMyBookingNow');
  if (btnViewMyBookingNow) {
    btnViewMyBookingNow.addEventListener('click', () => {
      document.getElementById('successModal')?.classList.remove('spa-modal--active');
      renderMyBookings();
      if (myBookingsModal) myBookingsModal.classList.add('spa-modal--active');
    });
  }

  if (cancelBookingForm) {
    cancelBookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = sanitizeText(cancellationReasonInput ? cancellationReasonInput.value : '');

      if (reason.length < 5) {
        if (cancelReasonError) cancelReasonError.classList.add('spa-form__error--visible');
        if (cancellationReasonInput) cancellationReasonInput.focus();
        showToast('Debes justificar el motivo de la cancelación.');
        return;
      }

      if (!pendingCancelCode) return;

      const list = getStoredReservations();
      const target = list.find((r) => r.code === pendingCancelCode);

      if (target) {
        target.status = 'Cancelada';
        target.cancellationReason = reason;
        target.cancelledAt = new Date().toISOString();

        saveStoredReservations(list);

        if (window.WarmiDB && typeof window.WarmiDB.updateReservationStatus === 'function') {
          await window.WarmiDB.updateReservationStatus(target.code, 'Cancelada', reason);
        }

        logEvent('RESERVA_CANCELADA', `Cita ${target.code} (${target.clientName}) cancelada por el cliente. Motivo: "${reason}"`);
        updateSlotsAvailability();
        updateConnectivityUI();

        if (cancelBookingModal) cancelBookingModal.classList.remove('spa-modal--active');
        showToast(`Cita ${pendingCancelCode} cancelada correctamente.`);

        renderMyBookings();
        if (myBookingsModal) myBookingsModal.classList.add('spa-modal--active');
      }
    });
  }

  if (cancelModalCloseBtn) {
    cancelModalCloseBtn.addEventListener('click', () => {
      if (cancelBookingModal) cancelBookingModal.classList.remove('spa-modal--active');
    });
  }

  if (btnDismissCancellation) {
    btnDismissCancellation.addEventListener('click', () => {
      if (cancelBookingModal) cancelBookingModal.classList.remove('spa-modal--active');
      if (myBookingsModal) myBookingsModal.classList.add('spa-modal--active');
    });
  }

  // ==========================================================================
  // 12. BÚSQUEDA RÁPIDA (PRECIOS EN BOLIVIANOS)
  // ==========================================================================
  const searchToggleBtn = document.getElementById('searchToggleBtn');
  const searchModal = document.getElementById('searchModal');
  const searchModalClose = document.getElementById('searchModalClose');
  const searchInput = document.getElementById('siteSearchInput');
  const searchResultsContainer = document.getElementById('searchResultsContainer');

  const searchableServices = [
    { title: 'Masaje Relajante', desc: 'Libera el estrés y conecta con tu tranquilidad.', price: 'Bs 280', targetId: 'masaje-relajante' },
    { title: 'Facial Asiático Glow', desc: 'Limpieza profunda y rejuvenecimiento natural con técnicas ancestrales.', price: 'Bs 315', targetId: 'facial-asiatico' },
    { title: 'Ritual Zen Warmi', desc: 'Armoniza cuerpo, mente y espíritu con cuencos e incienso sagrado.', price: 'Bs 420', targetId: 'ritual-zen' },
    { title: 'Aromaterapia & Esencias', desc: 'Equilibrio a través de aceites esenciales y orquídeas aromáticas.', price: 'Bs 280', targetId: 'aromaterapia' }
  ];

  if (searchToggleBtn && searchModal) {
    searchToggleBtn.addEventListener('click', () => {
      searchModal.classList.add('spa-modal--active');
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 150);
        renderSearchResults('');
      }
    });

    if (searchModalClose) {
      searchModalClose.addEventListener('click', () => searchModal.classList.remove('spa-modal--active'));
    }

    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal) searchModal.classList.remove('spa-modal--active');
    });

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderSearchResults(sanitizeText(e.target.value).toLowerCase());
      });
    }
  }

  function renderSearchResults(query) {
    if (!searchResultsContainer) return;
    searchResultsContainer.innerHTML = '';

    const filtered = searchableServices.filter((s) =>
      s.title.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.style.cssText = 'text-align:center; padding:1rem; color:var(--text-muted); font-size:0.8rem;';
      emptyP.textContent = 'No se encontraron resultados.';
      searchResultsContainer.appendChild(emptyP);
      return;
    }

    filtered.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'booking-summary__row';
      row.style.cssText = 'padding:0.65rem; border-radius:8px; background:var(--bg-card-subtle); margin-bottom:0.4rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; min-height:44px;';

      const textWrap = document.createElement('div');
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-weight:700; color:var(--text-primary); font-size:0.84rem;';
      titleEl.textContent = item.title;

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:0.74rem; color:var(--text-muted);';
      descEl.textContent = item.desc;

      textWrap.appendChild(titleEl);
      textWrap.appendChild(descEl);

      const priceEl = document.createElement('div');
      priceEl.style.cssText = 'font-weight:700; color:var(--primary-purple); white-space:nowrap; margin-left:0.6rem;';
      priceEl.textContent = item.price;

      row.appendChild(textWrap);
      row.appendChild(priceEl);

      row.addEventListener('click', () => {
        if (searchModal) searchModal.classList.remove('spa-modal--active');
        const matchingExp = document.querySelector(`.booking-panel__exp-item[data-id="${item.targetId}"]`);
        if (matchingExp) matchingExp.click();
        switchView('reserva');
      });

      searchResultsContainer.appendChild(row);
    });
  }

  // ==========================================================================
  // 13. TOAST NOTIFICACIONES
  // ==========================================================================
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) return;

    toastMessage.textContent = sanitizeText(message);
    toast.classList.add('toast-notification--active');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('toast-notification--active');
    }, 2800);
  }

  // ==========================================================================
  // 14. GESTIÓN PWA & MODO OFFLINE
  // ==========================================================================
  let deferredInstallPrompt = null;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.info('[Happy Warmi PWA] Service Worker activo:', reg.scope);
        })
        .catch((err) => {
          console.warn('[Happy Warmi PWA] Service Worker:', err);
        });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  function triggerPWAInstall() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          showToast('¡Gracias por instalar Happy Warmi Spa!');
          logEvent('PWA_INSTALADA', 'El usuario aceptó la instalación de la aplicación');
        }
        deferredInstallPrompt = null;
      });
    } else {
      document.getElementById('pwaGuideModal')?.classList.add('spa-modal--active');
    }
  }

  document.querySelectorAll('.trigger-pwa-install').forEach((btn) => {
    btn.addEventListener('click', triggerPWAInstall);
  });

  document.getElementById('pwaGuideCloseBtn')?.addEventListener('click', () => {
    document.getElementById('pwaGuideModal')?.classList.remove('spa-modal--active');
  });
  document.getElementById('pwaGuideOkBtn')?.addEventListener('click', () => {
    document.getElementById('pwaGuideModal')?.classList.remove('spa-modal--active');
  });

  // ==========================================================================
  // 15. LOGIN SEGURO DE ADMINISTRADOR (USUARIO + CONTRASEÑA + BLOQUEO)
  // ==========================================================================
  const openAdminAuthModalBtn = document.getElementById('openAdminAuthModalBtn');
  const adminAuthModal = document.getElementById('adminAuthModal');
  const closeAdminAuthModalBtn = document.getElementById('closeAdminAuthModalBtn');
  const cancelAdminAuthBtn = document.getElementById('cancelAdminAuthBtn');
  const adminAuthForm = document.getElementById('adminAuthForm');
  const adminUserInput = document.getElementById('adminUserInput');
  const adminPinInput = document.getElementById('adminPinInput');
  const toggleAdminPassBtn = document.getElementById('toggleAdminPassBtn');
  const adminAuthError = document.getElementById('adminAuthError');

  function getAuthLockState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_AUTH_LOCK) || '{"attempts":0,"lockedUntil":0}');
    } catch (e) {
      return { attempts: 0, lockedUntil: 0 };
    }
  }

  function saveAuthLockState(state) {
    try {
      localStorage.setItem(STORAGE_KEY_AUTH_LOCK, JSON.stringify(state));
    } catch (e) {}
  }

  function openAdminModal() {
    if (!adminAuthModal) return;
    if (adminUserInput) adminUserInput.value = '';
    if (adminPinInput) {
      adminPinInput.value = '';
      adminPinInput.type = 'password';
    }
    if (toggleAdminPassBtn) toggleAdminPassBtn.textContent = '👁️';
    if (adminAuthError) adminAuthError.classList.remove('admin-auth-form__error--visible');
    adminAuthModal.classList.add('spa-modal--active');
    setTimeout(() => {
      if (adminUserInput) adminUserInput.focus();
    }, 150);
  }

  function closeAdminModal() {
    if (adminAuthModal) adminAuthModal.classList.remove('spa-modal--active');
  }

  if (toggleAdminPassBtn && adminPinInput) {
    toggleAdminPassBtn.addEventListener('click', () => {
      const isPass = adminPinInput.type === 'password';
      adminPinInput.type = isPass ? 'text' : 'password';
      toggleAdminPassBtn.textContent = isPass ? '🙈' : '👁️';
    });
  }

  if (openAdminAuthModalBtn) {
    openAdminAuthModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (sessionStorage.getItem('happy_warmi_admin_auth') === 'true') {
        window.location.href = './admin.html';
      } else {
        openAdminModal();
      }
    });
  }

  if (closeAdminAuthModalBtn) closeAdminAuthModalBtn.addEventListener('click', closeAdminModal);
  if (cancelAdminAuthBtn) cancelAdminAuthBtn.addEventListener('click', closeAdminModal);

  if (adminAuthForm) {
    adminAuthForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lock = getAuthLockState();
      const nowMs = Date.now();

      if (lock.lockedUntil && nowMs < lock.lockedUntil) {
        const secs = Math.ceil((lock.lockedUntil - nowMs) / 1000);
        if (adminAuthError) {
          adminAuthError.textContent = `⏳ Demasiados intentos fallidos. Espera ${secs}s para volver a intentar.`;
          adminAuthError.classList.add('admin-auth-form__error--visible');
        }
        return;
      }

      const enteredUser = sanitizeText(adminUserInput ? adminUserInput.value : '').toLowerCase();
      const enteredPass = (adminPinInput ? adminPinInput.value : '').trim();
      const creds = getAdminCredentialsConfig();

      const validUser = enteredUser === creds.username.toLowerCase() ||
                        (creds.alias && enteredUser === creds.alias.toLowerCase());
      const enteredHash = await sha256Hex(enteredPass);
      const validPass = enteredHash === creds.passwordHash;

      if (validUser && validPass) {
        saveAuthLockState({ attempts: 0, lockedUntil: 0 });
        sessionStorage.setItem('happy_warmi_admin_auth', 'true');
        sessionStorage.setItem('happy_warmi_admin_user', creds.username);
        sessionStorage.setItem('happy_warmi_admin_login_at', new Date().toISOString());

        logEvent('ADMIN_LOGIN', `Inicio de sesión administrativo exitoso (${creds.username})`);
        showToast('Acceso concedido al Panel de Administrador');
        closeAdminModal();
        setTimeout(() => {
          window.location.href = './admin.html';
        }, 250);
      } else {
        const nextAttempts = (lock.attempts || 0) + 1;
        const lockedUntil = nextAttempts >= 5 ? nowMs + 30000 : 0;
        saveAuthLockState({ attempts: nextAttempts >= 5 ? 0 : nextAttempts, lockedUntil });

        logEvent('ADMIN_LOGIN_FALLIDO', `Intento fallido de acceso administrativo (usuario: "${enteredUser || 'vacío'}")`);

        if (adminAuthError) {
          adminAuthError.textContent = lockedUntil
            ? '🔒 Cuenta bloqueada temporalmente por 30s tras 5 intentos fallidos.'
            : `⚠️ Usuario o contraseña incorrectos (intento ${nextAttempts}/5).`;
          adminAuthError.classList.add('admin-auth-form__error--visible');
        }
        if (adminPinInput) {
          adminPinInput.value = '';
          adminPinInput.focus();
        }
      }
    });
  }
});
