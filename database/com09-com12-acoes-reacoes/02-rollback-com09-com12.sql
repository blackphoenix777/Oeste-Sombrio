-- Plano de reversão controlada para COM-09..COM-12 (NÃO executar sem aprovação explícita).
-- Remove apenas as funções novas de COM-09..COM-12 e orienta restauração das definições COM-05..COM-08.
-- Não altera tabelas, colunas, RLS, dados de mesas, fichas, tokens ou publicação Realtime.

BEGIN;

DROP FUNCTION IF EXISTS public.gerenciar_reacao_combate(
  uuid, uuid, uuid, text, text, text, integer, text, text, uuid, numeric, boolean,
  text, boolean, boolean, text, uuid, integer, bigint, bigint, text
);
DROP FUNCTION IF EXISTS public.calcular_fase_turno_combate(jsonb, jsonb, integer);

-- Em seguida, reaplicar exclusivamente as definições de public.obter_combate_publico(uuid)
-- e public.gerenciar_combate(uuid, text, bigint, jsonb, uuid, uuid) provenientes de:
-- supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql

COMMIT;
