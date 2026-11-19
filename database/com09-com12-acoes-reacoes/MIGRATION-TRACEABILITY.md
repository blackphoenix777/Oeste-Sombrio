# Rastreabilidade Canônica de Migrações — COM-09 a COM-12

**Data:** 19/11/2026  
**Escopo:** Estratégia durável de rastreabilidade entre o arquivo versionado no repositório e os identificadores registrados em Homologação e Produção.

---

## 1. Mapa Oficial de Equivalência (Somente Leitura)

O mesmo artefato SQL foi aplicado de forma controlada nos dois ambientes remotos via `supabase_mcp.apply_migration`, que registra o campo `version` usando o timestamp UTC efetivo da aplicação, enquanto o arquivo local adota o timestamp de autoria (`20261119120000`):

| Ambiente | Identificador / Versão | Nome Registrado | Tamanho (`statements`) | Hash MD5 (`statements`) | SHA-256 do Arquivo |
| --- | --- | --- | ---: | --- | --- |
| **Repositório Git (Canônico)** | `20261119120000` | `20261119120000_com09_com12_reactions_and_opportunities.sql` | `53.631` chars (trimEnd) / `55.995` B | `8ae4b4c1e185240c9eeac8ffd4cd1833` | `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7` |
| **Homologação (`igyupxczhczidfgtjiws`)** | `20261119121535` | `com09_com12_reactions_and_opportunities` | `53.631` chars | `8ae4b4c1e185240c9eeac8ffd4cd1833` | Equivalência 100% comprovada |
| **Produção (`jxxhdqoyblykqiiyptsp`)** | `20261119145851` | `com09_com12_reactions_and_opportunities` | `53.631` chars | `8ae4b4c1e185240c9eeac8ffd4cd1833` | Equivalência 100% comprovada |

---

## 2. Estratégia Canônica Adotada (Durável e Não Destrutiva)

1. **Arquivo único no Git (sem duplicação nem renomeação retroativa):**
   - `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql` permanece como fonte canônica única para ambientes novos criados do zero (PostgreSQL 17 descartável, CI e novos ambientes de QA).
   - Não criar cópias duplicadas do SQL para replicar os timestamps `20261119121535` ou `20261119145851`.
   - Não inserir nem editar manualmente linhas em `supabase_migrations.schema_migrations`.

2. **Regra operacional obrigatória para futuras migrações em Produção e Homologação:**
   - **Proibido executar `supabase db push` diretamente** sobre `jxxhdqoyblykqiiyptsp` ou `igyupxczhczidfgtjiws` sem reconciliação prévia autorizada, pois a CLI compara estritamente o prefixo numérico (`20261119120000` ≠ `20261119145851`) e listaria a migração já aplicada como pendente.
   - **Fluxo recomendado para futuras migrações:**
     - Aplicar cada nova migração individualmente via `apply_migration` (ou via `--workdir` isolado da CLI contendo apenas o histórico remoto + o novo arquivo, sempre validado com `--dry-run` mostrando exatamente 1 migração pendente), registrando a equivalência nesta tabela.
     - Opcionalmente, caso o proprietário deseje no futuro voltar a usar `supabase db push` unificado em Produção, isso exige autorização específica separada para reconciliação oficial via `supabase migration repair` (fora do escopo do Checkpoint 10B).

3. **Mitigação de segurança contra reaplicação acidental:**
   - Todo o conteúdo de `20261119120000_com09_com12_reactions_and_opportunities.sql` é composto exclusivamente por `CREATE OR REPLACE FUNCTION`, `REVOKE ALL` e `GRANT EXECUTE` determinísticos e idempotentes — sem DDL destrutivo de tabelas/colunas e sem mutação de dados de negócio.
