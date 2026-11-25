-- ==============================================================================
-- HAPPY WARMI SPA - BASE DE DATOS SUPABASE (UPDS 2026)
-- Script de configuración para Bitácora de Auditoría (>250 eventos) y Reservas
-- Precios expresados en Bolivianos (Bs)
-- ==============================================================================

-- 1. TABLA: bitacora (Registro y Auditoría de Eventos)
CREATE TABLE IF NOT EXISTS public.bitacora (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  hora TEXT NOT NULL,
  tipo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  usuario_tipo TEXT DEFAULT 'cliente', -- 'cliente', 'admin' o 'sistema'
  detalles JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.bitacora IS 'Bitácora de eventos y auditoría de acciones en tiempo real de Happy Warmi Spa';

-- 2. TABLA: reservas (Registro de Citas del Spa)
CREATE TABLE IF NOT EXISTS public.reservas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  code TEXT UNIQUE NOT NULL,
  client_name TEXT NOT NULL,
  phone TEXT,
  person_count INTEGER DEFAULT 1,
  experience_name TEXT,
  duration TEXT,
  price NUMERIC DEFAULT 0,
  specialist_name TEXT,
  date_time TEXT,
  date_key TEXT,
  time_slot TEXT,
  status TEXT DEFAULT 'Confirmada',
  cancellation_reason TEXT
);

COMMENT ON TABLE public.reservas IS 'Reservas de citas y asignación a especialistas Maya, Rosa y Moy (Precios en Bs)';

-- 3. ÍNDICES DE RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_bitacora_created_at ON public.bitacora (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_tipo ON public.bitacora (tipo);
CREATE INDEX IF NOT EXISTS idx_bitacora_usuario_tipo ON public.bitacora (usuario_tipo);
CREATE INDEX IF NOT EXISTS idx_reservas_code ON public.reservas (code);
CREATE INDEX IF NOT EXISTS idx_reservas_date_key ON public.reservas (date_key);
CREATE INDEX IF NOT EXISTS idx_reservas_status ON public.reservas (status);
CREATE INDEX IF NOT EXISTS idx_reservas_specialist ON public.reservas (specialist_name);
CREATE INDEX IF NOT EXISTS idx_reservas_time_slot ON public.reservas (time_slot);

-- 4. SEGURIDAD A NIVEL DE FILAS (Row Level Security - RLS)
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir insercion anonima en bitacora" ON public.bitacora;
DROP POLICY IF EXISTS "Permitir lectura anonima en bitacora" ON public.bitacora;
DROP POLICY IF EXISTS "Permitir eliminacion anonima en bitacora" ON public.bitacora;

DROP POLICY IF EXISTS "Permitir insercion anonima en reservas" ON public.reservas;
DROP POLICY IF EXISTS "Permitir lectura anonima en reservas" ON public.reservas;
DROP POLICY IF EXISTS "Permitir actualizacion anonima en reservas" ON public.reservas;
DROP POLICY IF EXISTS "Permitir eliminacion anonima en reservas" ON public.reservas;

CREATE POLICY "Permitir insercion anonima en bitacora"
ON public.bitacora FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Permitir lectura anonima en bitacora"
ON public.bitacora FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Permitir eliminacion anonima en bitacora"
ON public.bitacora FOR DELETE
TO anon, authenticated
USING (true);

CREATE POLICY "Permitir insercion anonima en reservas"
ON public.reservas FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Permitir lectura anonima en reservas"
ON public.reservas FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Permitir actualizacion anonima en reservas"
ON public.reservas FOR UPDATE
TO anon, authenticated
USING (true);

CREATE POLICY "Permitir eliminacion anonima en reservas"
ON public.reservas FOR DELETE
TO anon, authenticated
USING (true);

-- 5. CARGA INICIAL DE MÁS DE 250 EVENTOS EN BITÁCORA (260 EVENTOS HISTÓRICOS REALISTAS)
-- Solo inserta el lote si actualmente hay menos de 250 registros para evitar duplicados al re-ejecutar.
DO $$
DECLARE
  existing_count INTEGER;
  i INTEGER;
  v_types TEXT[] := ARRAY[
    'RESERVA_CONFIRMADA',
    'CAMBIO_VISTA',
    'EXPERIENCIA_SELECT',
    'ESPECIALISTA_SELECT',
    'HORA_SELECT',
    'FECHA_SELECT',
    'CHAT_MENSAJE_ENVIADO',
    'LIKE_STREAM',
    'OFERTA_CLICK',
    'ESTADO_CAMBIADO',
    'RESERVA_CANCELADA',
    'ADMIN_LOGIN',
    'SISTEMA_SYNC'
  ];
  v_treatments TEXT[] := ARRAY[
    'Masaje Relajante (Bs 280)',
    'Facial Asiático Glow (Bs 315)',
    'Ritual Zen Warmi (Bs 420)',
    'Aromaterapia & Esencias (Bs 280)'
  ];
  v_therapists TEXT[] := ARRAY['Maya', 'Rosa', 'Moy'];
  v_slots TEXT[] := ARRAY['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00'];
  v_clients TEXT[] := ARRAY[
    'Camila Morales', 'Lucía Fernández', 'Sofía Mendoza', 'Valeria Gómez',
    'Andrea Soto', 'Daniela Quispe', 'Mariana Rojas', 'Paola Mamani',
    'Natalia Vargas', 'Carolina Torrez', 'Elena Paredes', 'Gabriela Justiniano'
  ];
  v_views TEXT[] := ARRAY['inicio', 'experiencias', 'reserva', 'cosas-spa', 'espacio'];
  v_tipo TEXT;
  v_msg TEXT;
  v_user TEXT;
  v_ts TIMESTAMPTZ;
  v_treat TEXT;
  v_ther TEXT;
  v_slot TEXT;
  v_cli TEXT;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM public.bitacora;

  IF existing_count < 250 THEN
    FOR i IN 1..260 LOOP
      v_tipo := v_types[1 + (i % array_length(v_types, 1))];
      v_treat := v_treatments[1 + (i % array_length(v_treatments, 1))];
      v_ther := v_therapists[1 + (i % array_length(v_therapists, 1))];
      v_slot := v_slots[1 + (i % array_length(v_slots, 1))];
      v_cli := v_clients[1 + (i % array_length(v_clients, 1))];
      v_ts := NOW() - ((261 - i) * INTERVAL '37 minutes');
      v_user := CASE WHEN v_tipo IN ('ESTADO_CAMBIADO', 'ADMIN_LOGIN', 'SISTEMA_SYNC') THEN 'admin' ELSE 'cliente' END;

      v_msg := CASE v_tipo
        WHEN 'RESERVA_CONFIRMADA' THEN format('Cita HWARMI-%s confirmada para %s con %s (%s) a las %s hrs', 10000 + i, v_cli, v_ther, v_treat, v_slot)
        WHEN 'CAMBIO_VISTA' THEN format('Navegación hacia la sección: %s', v_views[1 + (i % array_length(v_views, 1))])
        WHEN 'EXPERIENCIA_SELECT' THEN format('Servicio consultado/seleccionado: %s', v_treat)
        WHEN 'ESPECIALISTA_SELECT' THEN format('Terapeuta seleccionada para consulta: %s', v_ther)
        WHEN 'HORA_SELECT' THEN format('Horario verificado y seleccionado: %s hrs', v_slot)
        WHEN 'FECHA_SELECT' THEN format('Fecha consultada en calendario (%s)', TO_CHAR(v_ts, 'DD/MM/YYYY'))
        WHEN 'CHAT_MENSAJE_ENVIADO' THEN format('Consulta comunitaria en vivo de %s sobre disponibilidad con %s', v_cli, v_ther)
        WHEN 'LIKE_STREAM' THEN 'Reacción ❤️ enviada a la transmisión de bienestar Happy Warmi'
        WHEN 'OFERTA_CLICK' THEN format('Interés en promoción relámpago: %s', v_treat)
        WHEN 'ESTADO_CAMBIADO' THEN format('Reserva HWARMI-%s marcada como Completada tras finalizar la sesión', 10000 + i)
        WHEN 'RESERVA_CANCELADA' THEN format('Cita HWARMI-%s cancelada con justificación registrada (%s)', 10000 + i, v_cli)
        WHEN 'ADMIN_LOGIN' THEN 'Inicio de sesión administrativo verificado en el panel'
        ELSE format('Sincronización de bitácora y verificación de cupos #%s completada', i)
      END;

      INSERT INTO public.bitacora (created_at, hora, tipo, mensaje, usuario_tipo, detalles)
      VALUES (
        v_ts,
        TO_CHAR(v_ts AT TIME ZONE 'America/La_Paz', 'HH24:MI:SS'),
        v_tipo,
        v_msg,
        v_user,
        jsonb_build_object(
          'lote', 'seed_260',
          'indice', i,
          'moneda', 'Bs',
          'terapeuta', v_ther,
          'horario', v_slot
        )
      );
    END LOOP;
  END IF;
END $$;

-- 6. RESERVAS BASE DE MUESTRA EN BOLIVIANOS (Para reportes de popularidad y ocupación)
INSERT INTO public.reservas (code, client_name, phone, person_count, experience_name, duration, price, specialist_name, date_time, date_key, time_slot, status, cancellation_reason)
VALUES
  ('HWARMI-89421', 'Camila Morales', '78901234', 1, 'Masaje Relajante', '60 min', 280, 'Maya', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') || ' - 10:00 hrs', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'), '10:00', 'Confirmada', NULL),
  ('HWARMI-48102', 'Daniela Vargas', '71234567', 1, 'Facial Asiático Glow', '60 min', 315, 'Rosa', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') || ' - 11:00 hrs', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'), '11:00', 'Confirmada', NULL),
  ('HWARMI-71295', 'Valeria Gómez', '76543210', 1, 'Ritual Zen Warmi', '90 min', 420, 'Moy', TO_CHAR(CURRENT_DATE + 1, 'YYYY-MM-DD') || ' - 16:00 hrs', TO_CHAR(CURRENT_DATE + 1, 'YYYY-MM-DD'), '16:00', 'Confirmada', NULL),
  ('HWARMI-55104', 'Lucía Fernández', '77412580', 1, 'Masaje Relajante', '60 min', 280, 'Maya', TO_CHAR(CURRENT_DATE - 1, 'YYYY-MM-DD') || ' - 16:00 hrs', TO_CHAR(CURRENT_DATE - 1, 'YYYY-MM-DD'), '16:00', 'Completada', NULL),
  ('HWARMI-62318', 'Sofía Mendoza', '76329841', 1, 'Masaje Relajante', '60 min', 280, 'Maya', TO_CHAR(CURRENT_DATE - 2, 'YYYY-MM-DD') || ' - 10:00 hrs', TO_CHAR(CURRENT_DATE - 2, 'YYYY-MM-DD'), '10:00', 'Completada', NULL),
  ('HWARMI-33291', 'Roberto Silva', '72345678', 2, 'Aromaterapia & Esencias', '60 min', 560, 'Maya y Rosa', TO_CHAR(CURRENT_DATE + 2, 'YYYY-MM-DD') || ' - 12:00 hrs', TO_CHAR(CURRENT_DATE + 2, 'YYYY-MM-DD'), '12:00', 'Cancelada', 'Cambio de itinerario por viaje de trabajo.')
ON CONFLICT (code) DO NOTHING;

-- 7. CONFIRMACIÓN FINAL
SELECT
  (SELECT COUNT(*) FROM public.bitacora) AS total_eventos_bitacora,
  (SELECT COUNT(*) FROM public.reservas) AS total_reservas,
  'Configuración completada con éxito (moneda Bs y >250 eventos en bitácora).' AS resultado;
