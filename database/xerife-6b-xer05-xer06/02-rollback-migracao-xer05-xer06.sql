-- Rollback reversível para a migração 20261118101800_xerife_6b_instance_combat.sql (XER-05 + XER-06)
BEGIN;

DROP TRIGGER IF EXISTS trg_mesa_tokens_sync_6b_instancia ON public.mesa_tokens;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mesa_6b_instancia'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.mesa_6b_instancia;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.remover_6b_instancia(uuid, uuid);
DROP FUNCTION IF EXISTS public.renovar_6b_instancia(uuid, uuid, bigint, text, boolean);
DROP FUNCTION IF EXISTS public.ajustar_fadiga_6b_instancia(uuid, uuid, bigint, integer, text);
DROP FUNCTION IF EXISTS public.curar_dano_6b_instancia(uuid, uuid, bigint, integer[], text);
DROP FUNCTION IF EXISTS public.aplicar_dano_6b_instancia(uuid, uuid, bigint, integer, integer[], text);
DROP FUNCTION IF EXISTS public.consumir_6b_instancia(uuid, uuid, bigint, integer[], text);
DROP FUNCTION IF EXISTS public.rolar_6b_instancia(uuid, uuid, bigint, text);
DROP FUNCTION IF EXISTS public.ler_6b_instancia(uuid, uuid);
DROP FUNCTION IF EXISTS public.inicializar_6b_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]);

DROP FUNCTION IF EXISTS xerife_6b.remover_instancia(uuid, uuid);
DROP FUNCTION IF EXISTS xerife_6b.renovar_instancia(uuid, uuid, bigint, text, boolean);
DROP FUNCTION IF EXISTS xerife_6b.ajustar_fadiga_instancia(uuid, uuid, bigint, integer, text);
DROP FUNCTION IF EXISTS xerife_6b.curar_dano_instancia(uuid, uuid, bigint, integer[], text);
DROP FUNCTION IF EXISTS xerife_6b.aplicar_dano_instancia(uuid, uuid, bigint, integer, integer[], text);
DROP FUNCTION IF EXISTS xerife_6b.consumir_instancia(uuid, uuid, bigint, integer[], text);
DROP FUNCTION IF EXISTS xerife_6b.rolar_instancia(uuid, uuid, bigint, text);
DROP FUNCTION IF EXISTS xerife_6b.ler_instancia(uuid, uuid);
DROP FUNCTION IF EXISTS xerife_6b.inicializar_instancia(uuid, uuid, integer[], text, uuid, uuid, text, text, integer, integer[], integer[], integer[]);
DROP FUNCTION IF EXISTS xerife_6b.sincronizar_vinculo_token_instancia();
DROP FUNCTION IF EXISTS xerife_6b.registrar_operacao_instancia(uuid, uuid, text, text, bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS xerife_6b.sincronizar_token_status_instancia(public.mesa_6b_instancia);
DROP FUNCTION IF EXISTS xerife_6b.serializar_instancia(public.mesa_6b_instancia, boolean, jsonb);
DROP FUNCTION IF EXISTS xerife_6b.recalcular_derivados_instancia(integer[], integer[], integer[], integer[], integer[]);
DROP FUNCTION IF EXISTS xerife_6b.aplicar_fadiga_cascata(integer[], integer[], integer);
DROP FUNCTION IF EXISTS xerife_6b.autorizar_instancia(uuid, uuid, text);

DROP TABLE IF EXISTS xerife_6b.instancia_operacoes;
DROP TABLE IF EXISTS public.mesa_6b_instancia;

NOTIFY pgrst, 'reload schema';

COMMIT;
