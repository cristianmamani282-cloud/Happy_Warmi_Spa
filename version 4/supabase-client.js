/**
 * Happy Warmi Spa - Conector de Base de Datos Supabase (Versión 2.3)
 * Auditoría de Eventos (>250 registros), Bitácora Sincronizada, Reservas y Modo Offline
 */

(function (window) {
  'use strict';

  // ============================================================================
  // 1. CONFIGURACIÓN POR DEFECTO
  // ============================================================================
  const DEFAULT_SUPABASE_URL = 'https://igchpwsambancqpvgmlm.supabase.co/rest/v1/';
  const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_d_-vjtmCjScL4HzBkLUmeg_kxJGHVXl';

  const STORAGE_KEY_URL = 'happy_warmi_supabase_url';
  const STORAGE_KEY_KEY = 'happy_warmi_supabase_anon_key';
  const STORAGE_KEY_BITACORA = 'happy_warmi_bitacora';
  const STORAGE_KEY_RESERVATIONS = 'happy_warmi_reservations';
  const STORAGE_KEY_SYNC_QUEUE = 'happy_warmi_sync_queue';

  const MAX_LOCAL_BITACORA = 600;

  let supabaseClient = null;
  let isSyncingQueue = false;
  let connectionState = {
    configured: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    source: 'local', // 'supabase' | 'local'
    lastSync: null,
    pendingCount: 0,
    error: null
  };

  function normalizeUrl(rawUrl) {
    if (!rawUrl) return '';
    let clean = rawUrl.trim();
    clean = clean.replace(/\/rest\/v1\/?$/i, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  }

  function getCredentials() {
    const storedUrl = localStorage.getItem(STORAGE_KEY_URL);
    const storedKey = localStorage.getItem(STORAGE_KEY_KEY);

    const url = (storedUrl && storedUrl.trim()) || DEFAULT_SUPABASE_URL;
    const key = (storedKey && storedKey.trim()) || DEFAULT_SUPABASE_ANON_KEY;

    return {
      url: normalizeUrl(url),
      key: key.trim()
    };
  }

  function getSyncQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(STORAGE_KEY_SYNC_QUEUE) || '[]');
      return Array.isArray(q) ? q : [];
    } catch (e) {
      return [];
    }
  }

  function saveSyncQueue(queue) {
    try {
      localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(queue));
      connectionState.pendingCount = queue.length;
    } catch (e) {
      console.warn('[WarmiDB] Error guardando cola de sincronización:', e);
    }
  }

  function enqueueSync(action, payload) {
    const queue = getSyncQueue();
    queue.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action,
      payload,
      createdAt: new Date().toISOString()
    });
    if (queue.length > 600) {
      queue.splice(0, queue.length - 600);
    }
    saveSyncQueue(queue);
  }

  function isBrowserOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function initClient() {
    const { url, key } = getCredentials();
    connectionState.pendingCount = getSyncQueue().length;

    if (url && key && url.startsWith('http') && key.length > 15) {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          supabaseClient = window.supabase.createClient(url, key, {
            auth: {
              persistSession: false,
              autoRefreshToken: false
            }
          });
          connectionState.configured = true;
          connectionState.source = 'supabase';
          return true;
        } catch (err) {
          console.warn('⚠️ [WarmiDB] Error al inicializar cliente Supabase:', err);
          supabaseClient = null;
          connectionState.configured = false;
          connectionState.source = 'local';
          connectionState.error = err.message;
          return false;
        }
      }
    }

    supabaseClient = null;
    connectionState.configured = false;
    connectionState.source = 'local';
    return false;
  }

  function mapReservationToDB(reserva) {
    return {
      code: reserva.code,
      client_name: reserva.clientName,
      phone: reserva.phone,
      person_count: reserva.personCount || 1,
      experience_name: reserva.experience?.name || '',
      duration: reserva.experience?.duration || '',
      price: reserva.experience?.totalPrice ?? reserva.experience?.price ?? 0,
      specialist_name: reserva.specialist?.name || '',
      date_time: reserva.dateTime || '',
      date_key: reserva.dateKey || '',
      time_slot: reserva.timeSlot || '',
      status: reserva.status || 'Confirmada',
      cancellation_reason: reserva.cancellationReason || null
    };
  }

  function mapReservationFromDB(r) {
    return {
      code: r.code,
      clientName: r.client_name,
      phone: r.phone,
      personCount: r.person_count || 1,
      experience: {
        name: r.experience_name,
        duration: r.duration,
        price: Number(r.price || 0)
      },
      specialist: {
        name: r.specialist_name,
        role: r.specialist_name === 'Rosa' ? 'Faciales & Piel' :
              r.specialist_name === 'Moy' ? 'Rituales Zen' :
              (r.specialist_name || '').includes('y') ? 'Equipo Asignado' : 'Masajes y Terapias'
      },
      dateTime: r.date_time,
      dateKey: r.date_key,
      timeSlot: r.time_slot,
      status: r.status || 'Confirmada',
      cancellationReason: r.cancellation_reason,
      createdAt: r.created_at
    };
  }

  // ============================================================================
  // 2. MÓDULO UNIFICADO WarmiDB
  // ============================================================================
  const WarmiDB = {
    getStatus() {
      const creds = getCredentials();
      connectionState.pendingCount = getSyncQueue().length;
      return {
        ...connectionState,
        navigatorOnline: isBrowserOnline(),
        url: creds.url ? `${creds.url.slice(0, 26)}...` : null,
        hasKey: Boolean(creds.key)
      };
    },

    async saveCredentials(url, key) {
      try {
        const cleanUrl = normalizeUrl(url);
        const cleanKey = (key || '').trim();

        if (cleanUrl) {
          localStorage.setItem(STORAGE_KEY_URL, cleanUrl);
        } else {
          localStorage.removeItem(STORAGE_KEY_URL);
        }

        if (cleanKey) {
          localStorage.setItem(STORAGE_KEY_KEY, cleanKey);
        } else {
          localStorage.removeItem(STORAGE_KEY_KEY);
        }

        initClient();
        const res = await this.testConnection();
        if (res.success) {
          await this.syncPendingWithCloud();
        }
        return res;
      } catch (err) {
        return { success: false, message: err.message };
      }
    },

    clearCredentials() {
      localStorage.removeItem(STORAGE_KEY_URL);
      localStorage.removeItem(STORAGE_KEY_KEY);
      initClient();
    },

    async testConnection(customUrl, customKey) {
      let clientToTest = supabaseClient;

      if (customUrl && customKey) {
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
          return { success: false, message: 'La librería de Supabase no está cargada en el navegador.' };
        }
        try {
          const normUrl = normalizeUrl(customUrl);
          clientToTest = window.supabase.createClient(normUrl, customKey.trim(), {
            auth: { persistSession: false }
          });
        } catch (e) {
          return { success: false, message: 'URL o Llave inválida: ' + e.message };
        }
      }

      if (!clientToTest) {
        return {
          success: false,
          message: 'No hay credenciales configuradas para Supabase. Se utilizará el modo local.'
        };
      }

      if (!isBrowserOnline()) {
        connectionState.online = false;
        return {
          success: false,
          message: 'Sin conexión a internet. El sistema opera en modo offline y sincronizará automáticamente.'
        };
      }

      try {
        const { error, count } = await clientToTest
          .from('bitacora')
          .select('id', { count: 'exact', head: true });

        if (error) {
          connectionState.online = false;
          connectionState.error = error.message;
          return {
            success: false,
            message: `Error de Supabase: ${error.message} (Revisa si ejecutaste supabase_setup.sql).`
          };
        }

        connectionState.online = true;
        connectionState.error = null;
        connectionState.lastSync = new Date().toISOString();

        return {
          success: true,
          message: `¡Conexión exitosa con Supabase! Tabla 'bitacora' detectada (${count || 0} eventos registrados).`,
          count: count || 0
        };
      } catch (err) {
        connectionState.online = false;
        connectionState.error = err.message;
        return {
          success: false,
          message: `Error de red o conexión: ${err.message}`
        };
      }
    },

    /**
     * SINCRONIZAR COLA PENDIENTE CON SUPABASE (Modo Offline -> Nube)
     */
    async syncPendingWithCloud() {
      if (!supabaseClient || !isBrowserOnline() || isSyncingQueue) {
        return { synced: 0, remaining: getSyncQueue().length };
      }

      const queue = getSyncQueue();
      if (queue.length === 0) {
        return { synced: 0, remaining: 0 };
      }

      isSyncingQueue = true;
      let syncedCount = 0;
      const remaining = [];

      try {
        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          let ok = false;

          try {
            if (item.action === 'logEvent') {
              const { error } = await supabaseClient.from('bitacora').insert([item.payload]);
              ok = !error;
            } else if (item.action === 'saveReservation') {
              const { error } = await supabaseClient
                .from('reservas')
                .upsert(item.payload, { onConflict: 'code' });
              ok = !error;
            } else if (item.action === 'updateStatus') {
              const { code, updateData } = item.payload;
              const { error } = await supabaseClient
                .from('reservas')
                .update(updateData)
                .eq('code', code);
              ok = !error;
            } else if (item.action === 'deleteReservation') {
              const { error } = await supabaseClient
                .from('reservas')
                .delete()
                .eq('code', item.payload.code);
              ok = !error;
            }
          } catch (err) {
            ok = false;
          }

          if (ok) {
            syncedCount++;
          } else {
            remaining.push(item);
          }
        }

        saveSyncQueue(remaining);

        if (syncedCount > 0) {
          connectionState.online = true;
          connectionState.lastSync = new Date().toISOString();

          // Marcar reservas locales como sincronizadas
          try {
            const localRes = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
            const updatedRes = localRes.map(r => ({ ...r, pendingSync: false }));
            localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(updatedRes));
          } catch (e) {}

          try {
            window.dispatchEvent(new CustomEvent('warmi:sync_complete', {
              detail: { syncedCount, remaining: remaining.length }
            }));
          } catch (e) {}
        }
      } finally {
        isSyncingQueue = false;
      }

      return { synced: syncedCount, remaining: remaining.length };
    },

    /**
     * SINCRONIZAR HISTORIAL LOCAL DE BITÁCORA Y RESERVAS HACIA LA BASE DE DATOS
     */
    async syncAllLocalToCloud() {
      if (!supabaseClient || !isBrowserOnline()) {
        return { success: false, message: 'Sin conexión a Supabase disponible.' };
      }

      await this.syncPendingWithCloud();

      let syncedEvents = 0;
      let syncedReservations = 0;

      // Sincronizar reservas locales hacia Supabase (upsert por code)
      try {
        const localRes = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
        if (localRes.length > 0) {
          const rows = localRes.map(mapReservationToDB);
          const { error } = await supabaseClient
            .from('reservas')
            .upsert(rows, { onConflict: 'code' });
          if (!error) {
            syncedReservations = rows.length;
          }
        }
      } catch (e) {
        console.warn('[WarmiDB] Error sincronizando reservas locales:', e);
      }

      // Sincronizar eventos locales marcados como no sincronizados
      try {
        const localEvents = JSON.parse(localStorage.getItem(STORAGE_KEY_BITACORA) || '[]');
        const unsynced = localEvents.filter(ev => ev && ev.synced === false);
        if (unsynced.length > 0) {
          const batchSize = 50;
          for (let i = 0; i < unsynced.length; i += batchSize) {
            const chunk = unsynced.slice(i, i + batchSize).map(ev => ({
              hora: ev.hora,
              tipo: ev.tipo,
              mensaje: ev.mensaje,
              usuario_tipo: ev.usuario_tipo || 'cliente',
              detalles: ev.detalles || {}
            }));
            const { error } = await supabaseClient.from('bitacora').insert(chunk);
            if (!error) {
              syncedEvents += chunk.length;
            }
          }
          const marked = localEvents.map(ev => ({ ...ev, synced: true }));
          localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify(marked));
        }
      } catch (e) {
        console.warn('[WarmiDB] Error sincronizando bitácora local:', e);
      }

      connectionState.lastSync = new Date().toISOString();
      return {
        success: true,
        syncedEvents,
        syncedReservations
      };
    },

    /**
     * REGISTRAR EVENTO EN LA BITÁCORA
     * Guarda en localStorage (hasta 600) y envía a Supabase (o encola si está offline)
     */
    async logEvent(tipo, mensaje, usuario_tipo = 'cliente', detalles = null) {
      const hora = new Date().toLocaleTimeString();
      const timestamp = new Date().toISOString();

      const entry = {
        hora,
        tipo: (tipo || 'EVENTO').toUpperCase(),
        mensaje: String(mensaje || ''),
        usuario_tipo: usuario_tipo || 'cliente',
        detalles: detalles || {},
        timestamp,
        synced: false
      };

      const dbPayload = {
        hora: entry.hora,
        tipo: entry.tipo,
        mensaje: entry.mensaje,
        usuario_tipo: entry.usuario_tipo,
        detalles: entry.detalles
      };

      if (supabaseClient && isBrowserOnline()) {
        try {
          const { error } = await supabaseClient.from('bitacora').insert([dbPayload]);
          if (!error) {
            entry.synced = true;
            connectionState.online = true;
            connectionState.lastSync = timestamp;
          } else {
            enqueueSync('logEvent', dbPayload);
          }
        } catch (err) {
          connectionState.online = false;
          enqueueSync('logEvent', dbPayload);
        }
      } else if (supabaseClient) {
        enqueueSync('logEvent', dbPayload);
      }

      // Guardar en LocalStorage
      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_BITACORA) || '[]');
        localList.unshift(entry);
        if (localList.length > MAX_LOCAL_BITACORA) localList.length = MAX_LOCAL_BITACORA;
        localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify(localList));
      } catch (e) {
        console.warn('[WarmiDB] Error guardando bitácora local:', e);
      }

      try {
        window.dispatchEvent(new CustomEvent('warmi:event_logged', { detail: entry }));
      } catch (e) {}

      return entry;
    },

    /**
     * GENERAR Y REGISTRAR LOTE DE >250 EVENTOS HISTÓRICOS EN LA BASE DE DATOS Y BITÁCORA
     */
    async seedBulkBitacoraEvents(targetCount = 260) {
      const types = [
        'RESERVA_CONFIRMADA', 'CAMBIO_VISTA', 'EXPERIENCIA_SELECT',
        'ESPECIALISTA_SELECT', 'HORA_SELECT', 'FECHA_SELECT',
        'CHAT_MENSAJE_ENVIADO', 'LIKE_STREAM', 'OFERTA_CLICK',
        'ESTADO_CAMBIADO', 'RESERVA_CANCELADA', 'ADMIN_LOGIN', 'SISTEMA_SYNC'
      ];
      const treatments = [
        'Masaje Relajante (Bs 280)',
        'Facial Asiático Glow (Bs 315)',
        'Ritual Zen Warmi (Bs 420)',
        'Aromaterapia & Esencias (Bs 280)'
      ];
      const therapists = ['Maya', 'Rosa', 'Moy'];
      const slots = ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00'];
      const clients = ['Camila Morales', 'Lucía Fernández', 'Sofía Mendoza', 'Valeria Gómez', 'Andrea Soto', 'Daniela Quispe'];

      const generated = [];
      const nowMs = Date.now();

      for (let i = 1; i <= targetCount; i++) {
        const tipo = types[i % types.length];
        const treat = treatments[i % treatments.length];
        const ther = therapists[i % therapists.length];
        const slot = slots[i % slots.length];
        const cli = clients[i % clients.length];
        const tsDate = new Date(nowMs - (targetCount - i) * 1800000);
        const hora = tsDate.toLocaleTimeString();
        const usuario_tipo = (tipo === 'ESTADO_CAMBIADO' || tipo === 'ADMIN_LOGIN' || tipo === 'SISTEMA_SYNC') ? 'admin' : 'cliente';

        let mensaje = `Evento registrado #${i}`;
        if (tipo === 'RESERVA_CONFIRMADA') mensaje = `Cita HWARMI-${10000 + i} confirmada para ${cli} con ${ther} (${treat}) a las ${slot} hrs`;
        else if (tipo === 'CAMBIO_VISTA') mensaje = `Navegación del usuario hacia sección del spa (#${i})`;
        else if (tipo === 'EXPERIENCIA_SELECT') mensaje = `Servicio consultado: ${treat}`;
        else if (tipo === 'ESPECIALISTA_SELECT') mensaje = `Terapeuta seleccionada: ${ther}`;
        else if (tipo === 'HORA_SELECT') mensaje = `Horario consultado: ${slot} hrs`;
        else if (tipo === 'FECHA_SELECT') mensaje = `Fecha consultada en calendario: ${tsDate.toLocaleDateString('es-BO')}`;
        else if (tipo === 'CHAT_MENSAJE_ENVIADO') mensaje = `Consulta en vivo de ${cli} atendida por ${ther}`;
        else if (tipo === 'LIKE_STREAM') mensaje = 'Reacción ❤️ enviada al Live de Happy Warmi Spa';
        else if (tipo === 'OFERTA_CLICK') mensaje = `Interés en oferta relámpago: ${treat}`;
        else if (tipo === 'ESTADO_CAMBIADO') mensaje = `Reserva HWARMI-${10000 + i} marcada como Completada`;
        else if (tipo === 'RESERVA_CANCELADA') mensaje = `Cita HWARMI-${10000 + i} cancelada con justificación registrada`;
        else if (tipo === 'ADMIN_LOGIN') mensaje = 'Sesión administrativa autenticada en panel';
        else if (tipo === 'SISTEMA_SYNC') mensaje = `Verificación automática de bitácora y ocupación #${i}`;

        generated.push({
          hora,
          tipo,
          mensaje,
          usuario_tipo,
          detalles: { lote: 'bulk_260', indice: i, moneda: 'Bs', terapeuta: ther, horario: slot },
          timestamp: tsDate.toISOString(),
          synced: false
        });
      }

      let cloudInserted = 0;
      if (supabaseClient && isBrowserOnline()) {
        try {
          const batchSize = 65;
          for (let i = 0; i < generated.length; i += batchSize) {
            const chunk = generated.slice(i, i + batchSize).map(ev => ({
              hora: ev.hora,
              tipo: ev.tipo,
              mensaje: ev.mensaje,
              usuario_tipo: ev.usuario_tipo,
              detalles: ev.detalles
            }));
            const { error } = await supabaseClient.from('bitacora').insert(chunk);
            if (!error) {
              cloudInserted += chunk.length;
              for (let j = i; j < i + chunk.length && j < generated.length; j++) {
                generated[j].synced = true;
              }
            }
          }
        } catch (err) {
          console.warn('[WarmiDB] Error insertando lote masivo en Supabase:', err);
        }
      }

      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_BITACORA) || '[]');
        const combined = [...generated.reverse(), ...localList].slice(0, MAX_LOCAL_BITACORA);
        localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify(combined));
      } catch (e) {}

      return { totalGenerated: generated.length, cloudInserted };
    },

    /**
     * OBTENER EVENTOS DE LA BITÁCORA (Soporta >250 eventos: default 500)
     */
    async fetchBitacora(filter = 'all', limit = 500) {
      let events = [];

      if (supabaseClient && isBrowserOnline()) {
        try {
          await this.syncPendingWithCloud();

          let query = supabaseClient
            .from('bitacora')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

          if (filter && filter !== 'all') {
            query = query.ilike('tipo', `%${filter}%`);
          }

          const { data, error } = await query;

          if (!error && Array.isArray(data)) {
            events = data.map(item => ({
              id: item.id,
              hora: item.hora || new Date(item.created_at).toLocaleTimeString(),
              tipo: item.tipo,
              mensaje: item.mensaje,
              usuario_tipo: item.usuario_tipo || 'cliente',
              detalles: item.detalles,
              created_at: item.created_at,
              synced: true
            }));
            connectionState.online = true;
            connectionState.lastSync = new Date().toISOString();

            // Mantener copia offline actualizada cuando se consulta sin filtro
            if (!filter || filter === 'all') {
              try {
                localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify(events.slice(0, MAX_LOCAL_BITACORA)));
              } catch (e) {}
            }

            return { events, source: 'supabase', success: true };
          }
        } catch (e) {
          console.warn('[WarmiDB] Error consultando Supabase, recurriendo a local:', e);
        }
      }

      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_BITACORA) || '[]');
        const filtered = localList.filter(item => {
          if (!filter || filter === 'all') return true;
          return (item.tipo || '').toUpperCase().includes(filter.toUpperCase());
        });
        events = filtered.slice(0, limit);
      } catch (e) {
        events = [];
      }

      return { events, source: 'local', success: true };
    },

    async clearBitacora() {
      localStorage.setItem(STORAGE_KEY_BITACORA, JSON.stringify([]));

      if (supabaseClient && isBrowserOnline()) {
        try {
          await supabaseClient.from('bitacora').delete().gte('id', 0);
        } catch (e) {
          console.warn('[WarmiDB] Error vaciando tabla bitacora en Supabase:', e);
        }
      }

      await this.logEvent('BITACORA_VACIADA', 'El administrador reinició los registros de la bitácora', 'admin');
      return true;
    },

    /**
     * GUARDAR O ACTUALIZAR UNA RESERVA (Con soporte de cola offline)
     */
    async saveReservation(reserva) {
      const dbRecord = mapReservationToDB(reserva);
      let synced = false;

      if (supabaseClient && isBrowserOnline()) {
        try {
          const { error } = await supabaseClient
            .from('reservas')
            .upsert(dbRecord, { onConflict: 'code' });

          if (!error) {
            synced = true;
            connectionState.online = true;
          } else {
            enqueueSync('saveReservation', dbRecord);
          }
        } catch (err) {
          connectionState.online = false;
          enqueueSync('saveReservation', dbRecord);
        }
      } else if (supabaseClient) {
        enqueueSync('saveReservation', dbRecord);
      }

      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
        const index = localList.findIndex(r => r.code === reserva.code);
        const recordToSave = { ...reserva, pendingSync: !synced };
        if (index >= 0) {
          localList[index] = { ...localList[index], ...recordToSave };
        } else {
          localList.unshift(recordToSave);
        }
        localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(localList));
      } catch (e) {
        console.warn('[WarmiDB] Error guardando reserva local:', e);
      }

      return { synced };
    },

    /**
     * ACTUALIZAR ESTADO DE RESERVA (ej. cancelación justificada o completada)
     */
    async updateReservationStatus(code, newStatus, cancellationReason = null) {
      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
        const target = localList.find(r => r.code === code);
        if (target) {
          target.status = newStatus;
          if (cancellationReason) {
            target.cancellationReason = cancellationReason;
          }
          localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(localList));
        }
      } catch (e) {}

      const updateData = { status: newStatus };
      if (cancellationReason) updateData.cancellation_reason = cancellationReason;

      if (supabaseClient && isBrowserOnline()) {
        try {
          const { error } = await supabaseClient
            .from('reservas')
            .update(updateData)
            .eq('code', code);
          if (error) {
            enqueueSync('updateStatus', { code, updateData });
          }
        } catch (e) {
          enqueueSync('updateStatus', { code, updateData });
        }
      } else if (supabaseClient) {
        enqueueSync('updateStatus', { code, updateData });
      }
    },

    /**
     * ELIMINAR RESERVA (Local + Supabase)
     */
    async deleteReservation(code) {
      try {
        const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
        const updated = localList.filter(r => r.code !== code);
        localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(updated));
      } catch (e) {}

      if (supabaseClient && isBrowserOnline()) {
        try {
          const { error } = await supabaseClient
            .from('reservas')
            .delete()
            .eq('code', code);
          if (error) {
            enqueueSync('deleteReservation', { code });
          }
        } catch (e) {
          enqueueSync('deleteReservation', { code });
        }
      } else if (supabaseClient) {
        enqueueSync('deleteReservation', { code });
      }
    },

    /**
     * CONSULTAR TODAS LAS RESERVAS (Sincronizando cambios pendientes primero)
     */
    async fetchReservations() {
      if (supabaseClient && isBrowserOnline()) {
        try {
          await this.syncPendingWithCloud();

          const { data, error } = await supabaseClient
            .from('reservas')
            .select('*')
            .order('created_at', { ascending: false });

          if (!error && Array.isArray(data)) {
            const remoteMapped = data.map(mapReservationFromDB);
            const localList = JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
            const remoteCodes = new Set(remoteMapped.map(r => r.code));
            const unsyncedLocal = localList.filter(r => r.pendingSync && !remoteCodes.has(r.code));
            const merged = [...unsyncedLocal, ...remoteMapped];

            localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(merged));
            connectionState.online = true;
            return merged;
          }
        } catch (e) {
          console.warn('[WarmiDB] Error leyendo reservas de Supabase:', e);
        }
      }

      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_RESERVATIONS) || '[]');
      } catch (e) {
        return [];
      }
    }
  };

  initClient();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      connectionState.online = true;
      WarmiDB.syncPendingWithCloud();
    });
    window.addEventListener('offline', () => {
      connectionState.online = false;
    });
  }

  window.WarmiDB = WarmiDB;

})(window);
