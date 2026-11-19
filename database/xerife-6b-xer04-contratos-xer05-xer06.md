# OESTE SOMBRIO 2.0 — XER-04 & CONTRATOS TÉCNICOS PARA XER-05 E XER-06

**Branch:** `feature/xerife-6b-npc-boss`  
**Base de Referência:** `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab` (`main` / `origin/main` / tag `v1.4.5`)  
**Versão Pública Preservada:** `1.4.5` (inalterada)  
**Operações Remotas em Produção (`jxxhdqoyblykqiiyptsp`) / Homologação (`igyupxczhczidfgtjiws`):** **NENHUMA (0 alterações remotas)**

---

## 1. Resumo da Implementação XER-04 (Editor de 6B Próprio para NPCs e Bosses)

### 1.1 Arquitetura e Separação de Responsabilidades
- **Motor puro de regras (`dist/js/rules/own6BRules.js`):**
  - Módulo ES puro, sem dependência de DOM, `window`, `localStorage` ou Supabase.
  - Constantes canônicas:
    - `ALLOWED_6B_DIE_TYPES = ["d4", "d6", "d8", "d10", "d12"]`
    - `MIN_OWN_6B_DICE = 1`
    - `MAX_OWN_6B_DICE = 15`
  - Funções puras exportadas:
    - `createEmptyOwn6BCounts()`
    - `formatOwn6BComposition(counts)`
    - `parseStrictOwn6BString(rawStr, options)`
    - `validateOwn6BComposition(input, options)`
    - `extractOwn6BTemplate(targetOrData)`
    - `entityHasExplicitOwn6B(targetOrData)`
    - `createOwn6BInstanceStateContract(templateOrSheet, instanceContext)` *(Contrato XER-05)*
    - `validateAndProjectOwn6BInstanceCommand(instanceState, command)` *(Contrato XER-05 / XER-06)*
- **Extensão do Editor `freeEdit` existente (`dist/index.html`, `dist/style.css`, `dist/js/cylinder.js`, `dist/js/storage.js`, `dist/js/magiasUI.js`):**
  - Reaproveita integralmente `<article id="ficha">` quando `OS.freeEdit === true` (sem criar segundo editor).
  - Toggle explícito `#own-6b-toggle-wrap` (`#has-own-6b` + badge `#own-6b-mode-badge`) na barra superior de sessão do editor livre.
  - Painel compositor `#npc-own-6b-editor` com:
    - Resumo textual da fórmula (`#own-6b-composition-summary`), contador de limite (`#own-6b-dice-counter`: `0 / 15 dados` a `15 / 15 dados`) e atalho padrão `6d6` (`#btn-own-6b-preset-6d6`).
    - Controles individuais por tipo de dado (`d4`, `d6`, `d8`, `d10`, `d12`) com botões `−` / `+` e input numérico (`#own-6b-count-d4..d12`).
    - Pré-visualização de pílulas de dados (`#own-6b-preview-pills`) para até 15 dados.
    - Alerta de validação (`#own-6b-validation-feedback`) em tempo real para composições inválidas (`0` dados quando ativado, `>= 16` dados, ou tipos de dado fora de `d4..d12`), preservando a última composição válida.

### 1.2 Invariantes de Domínio Garantidas
1. **Ter 6B próprio NÃO torna o NPC uma Criatura:**
   - Ativar `#has-own-6b` ou configurar até 15 dados (`15d12`) não altera `OS.isCriatura`, `#is-criatura`, `operationalMode` (`full_sheet` / `creature_mode`) nem o modo de token em combate (`getCombatTokenMode`).
2. **Ter 6B próprio NÃO altera iniciativa nem concede ações extras:**
   - `OS.calculateInitiative()`, `OS.calculateActionsPerTurn()`, `OS.calculateInitiativeActionsBreakdown()` e `OS.computeCombatantTurnBudget()` permanecem estritamente governados pela Iniciativa e pela modalidade operacional (`COM-05` / `COM-06`).
3. **Isolamento em relação ao 6B compartilhado do Xerife (`XER-01/02/03`):**
   - `OS.entityHasOwn6B(entity)` identifica templates/instâncias com `hasOwn6B === true` (`own6B.enabled === true`).
   - `OS.getXerife6BForNpc(instanceId)` retorna `null` para instâncias com 6B próprio ativo, mantendo o retorno da projeção compartilhada do Xerife para NPCs sem 6B próprio.
   - `rollCreatureEntityAttack` e `isGmXerifeSheetMode()` usam o 6B próprio da entidade quando `hasOwn6B === true`, sem abrir o modal nem consumir dados do 6B compartilhado do Xerife.
4. **Retrocompatibilidade 100% com fichas legadas:**
   - NPCs legados sem `hasOwn6B` / `own6B` continuam funcionando sem mutação destrutiva (`normalizeLegacyNpcDataReadOnly`) e sem injeção involuntária de propriedades ao editar outros atributos.

---

## 2. Contrato Técnico para XER-05 (Persistência e Clonagem por Instância)

### 2.1 Formato Canônico do Molde (Template XER-04 em `fichas.dados` e `mesas.npcs_mesa`)
```json
{
  "hasOwn6B": true,
  "has-own-6b": true,
  "config-6b": "1d4 + 2d6 + 4d8 + 4d10 + 4d12",
  "config6B": { "d4": 1, "d6": 2, "d8": 4, "d10": 4, "d12": 4 },
  "own6B": {
    "schemaVersion": 1,
    "enabled": true,
    "totalDice": 15,
    "counts": { "d4": 1, "d6": 2, "d8": 4, "d10": 4, "d12": 4 },
    "diceTypes": ["d4", "d6", "d6", "d8", "d8", "d8", "d8", "d10", "d10", "d10", "d10", "d12", "d12", "d12", "d12"],
    "diceSides": [4, 6, 6, 8, 8, 8, 8, 10, 10, 10, 10, 12, 12, 12, 12],
    "formatted": "1d4 + 2d6 + 4d8 + 4d10 + 4d12"
  }
}
```
Quando desativado explicitamente no molde:
```json
{
  "hasOwn6B": false,
  "has-own-6b": false,
  "config-6b": "",
  "config6B": {},
  "own6B": {
    "schemaVersion": 1,
    "enabled": false,
    "totalDice": 0,
    "counts": { "d4": 0, "d6": 0, "d8": 0, "d10": 0, "d12": 0 },
    "diceTypes": [],
    "diceSides": [],
    "formatted": ""
  }
}
```

### 2.2 Contrato de Clonagem para Instâncias Vivas (`createOwn6BInstanceStateContract`)
Cada vez que um NPC ou Boss com `own6B.enabled === true` é colocado em cena (`addNpcMesaToScene` / `addCreatureToScene`), sua instância viva recebe um `instanceId` UUID v4 exclusivo e um estado de 6B próprio isolado:
```json
{
  "schemaVersion": 1,
  "mesaId": "<uuid-da-mesa>",
  "mapaId": "<uuid-do-mapa>",
  "instanceId": "<uuid-unico-da-instancia>",
  "tokenId": "<uuid-do-token-em-mesa_tokens>",
  "sourceId": "<id-do-molde-origem>",
  "sourceType": "custom | oficial | mesa_npc",
  "enabled": true,
  "versao": 0,
  "dados": [4, 6, 6, 8, 8, 8, 8, 10, 10, 10, 10, 12, 12, 12, 12],
  "resultados": [],
  "resultadosOriginais": [],
  "usados": [],
  "bloqueados": [],
  "fadiga": 0,
  "esgotado": false,
  "lastOpId": null,
  "opLedger": {}
}
```
- **Invariante de Isolamento entre Cópias (`#1`, `#2`, ...):**
  - Duas instâncias geradas do mesmo molde possuem `instanceId` distintos e vetores `dados`, `resultados`, `usados`, `bloqueados` independentes.
  - Consumir dados, aplicar dano ou renovar o 6B da instância `#1` jamais altera a instância `#2` nem o molde em `npcs_mesa` ou `public.fichas`.

### 2.3 Esquema SQL Proposto para XER-05 (Documentado — NÃO aplicar remotamente em XER-04)
```sql
-- Proposta de tabela autoritativa por instância para XER-05 (a ser aplicada apenas na etapa XER-05)
CREATE TABLE IF NOT EXISTS public.mesa_6b_instancia (
  instance_id uuid PRIMARY KEY,
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  source_id text,
  enabled boolean NOT NULL DEFAULT true,
  dados integer[] NOT NULL CHECK (
    cardinality(dados) BETWEEN 1 AND 15
    AND dados <@ ARRAY[4, 6, 8, 10, 12]::integer[]
  ),
  resultados integer[] NOT NULL DEFAULT '{}'::integer[],
  resultados_originais integer[] NOT NULL DEFAULT '{}'::integer[],
  usados integer[] NOT NULL DEFAULT '{}'::integer[],
  bloqueados integer[] NOT NULL DEFAULT '{}'::integer[],
  fadiga integer NOT NULL DEFAULT 0 CHECK (fadiga >= 0 AND fadiga <= 40),
  esgotado boolean NOT NULL DEFAULT false,
  versao bigint NOT NULL DEFAULT 0 CHECK (versao >= 0),
  last_op_id text,
  op_ledger jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 3. Contrato Técnico para XER-06 (Consumo, Dano com Escolha do Defensor, Fadiga e Renovação)

O validador puro `validateAndProjectOwn6BInstanceCommand(instanceState, command)` já implementa e testa as 4 operações atômicas de XER-06 com controle de versão otimista (`expectedVersion` -> `SQLSTATE 40001`) e idempotência por `opId`:

1. **`ROLL_INITIAL` (`rolar_6b_instancia`):**
   - Entrada: `{ type: "ROLL_INITIAL", expectedVersion: 0, opId, rolls }`.
   - Regra: exige `versao === 0` (se já rolado, retorna `0A000 ALREADY_ROLLED`), valida cada resultado contra as faces do respectivo dado (`1..sides`), aplica a regra oficial de Fadiga em cascata nos maiores dados intactos (`applyFatigueCascadeToInstanceRoll` / `xerife_6b.aplicar_fadiga_cascata`), registra eventuais dados zerados por fadiga em `zeradosPorFadiga` (sem misturar com `bloqueados` por dano físico), recalcula `usados` e `esgotado` e incrementa `versao`.
2. **`CONSUME` (`consumir_6b_instancia`):**
   - Entrada: `{ type: "CONSUME", expectedVersion, opId, indices }`.
   - Regra: exige `expectedVersion === state.versao` (`40001 VERSION_CONFLICT` se divergente), rejeita índices fora de `0..N-1`, duplicados, já presentes em `consumidos`/`usados`, presentes em `bloqueados`, presentes em `zeradosPorFadiga` ou com resultado `<= 0` (`22023 CHAMBER_ALREADY_SPENT_OR_BLOCKED`), impedindo saldo negativo ou duplo consumo.
3. **`APPLY_DAMAGE` (`aplicar_dano_6b_instancia` — Escolha pelo Defensor):**
   - Entrada: `{ type: "APPLY_DAMAGE", expectedVersion, opId, damagePoints, chosenIndices }`.
   - Regra: calcula `requiredChoices = Math.min(damagePoints, intactCount)`. Exige que o defensor escolha exatamente `requiredChoices` índices intactos (`22023 DEFENDER_CHOICE_COUNT_MISMATCH` ou `INVALID_DEFENDER_DAMAGE_CHOICE`). Adiciona os índices escolhidos em `bloqueados`, zera `resultados[idx] = 0` e `resultadosOriginais[idx] = 0`, recalcula `usados` e `esgotado` e incrementa `versao`.
4. **`RENEW` (`renovar_6b_instancia` — Fadiga Automática em Cascata e Idempotência):**
   - Entrada: `{ type: "RENEW", expectedVersion, opId, rolls, applyFatigue: true }`.
   - Regra:
     - Bloqueia renovação prematura enquanto houver qualquer dado intacto disponível (`55000 POOL_NOT_EXHAUSTED`).
     - Bloqueia renovação se todos os dados estiverem destruídos/bloqueados por dano (`55000 ALL_CHAMBERS_DAMAGED`).
     - Incrementa automaticamente `fadiga += 1` (salvo quando `applyFatigue === false` em efeitos específicos).
     - Preserva integralmente `bloqueados` (dados perdidos por dano continuam bloqueados com valor `0`).
     - Rola novos valores para os dados intactos aplicando a nova `fadiga` em cascata sobre os maiores resultados (`applyFatigueCascadeToInstanceRoll` / `xerife_6b.aplicar_fadiga_cascata`).
     - Registra `opId` em `opLedger` com retenção limitada a 64 entradas (`MAX_OP_LEDGER_ENTRIES = 64`): reenvios com o mesmo `opId` retornam `{ ok: true, idempotentReplay: true, state }` sem aplicar fadiga duplicada nem rolar novamente.

---

## 4. Arquivos Criados e Modificados em XER-04

| Arquivo | Tipo | Descrição das Alterações |
| :--- | :--- | :--- |
| `dist/js/rules/own6BRules.js` | **Novo** | Motor puro de validação de composições de 1 a 15 dados (`d4..d12`), extração de molde XER-04 e contratos puros de instância para XER-05 e XER-06. |
| `dist/js/rules/index.js` | Modificado | Reexportação de `./own6BRules.js`. |
| `dist/js/rules/cylinderRules.js` | Modificado | Guarda em `canReloadCylinder` quando `OS.freeEdit && OS.hasOwn6B === false && OS._own6BExplicit`. |
| `dist/index.html` | Modificado | Adição do toggle `#own-6b-toggle-wrap` (`#has-own-6b` + `#own-6b-mode-badge`) e da seção `#npc-own-6b-editor` no `<article id="ficha">`. |
| `dist/style.css` | Modificado | Estilos responsivos Dark Western para `.own-6b-toggle-label`, `.npc-own-6b-editor`, `.own-6b-die-control`, `.own-6b-stepper`, `.own-6b-die-pill` e `.npc-own-6b-validation`. |
| `dist/js/cylinder.js` | Modificado | Integração das funções de `own6BRules.js` no objeto `OS`, sincronização de UI (`syncOwn6BEditorUI`, `setOwn6BEnabled`, `setOwn6BComposition`, `setOwn6BDieCount`, `adjustOwn6BDieCount`), suporte a até 15 dados em `get6BDiceArray()` e bind de eventos em `bindRound7MechanicsEvents()`. |
| `dist/js/storage.js` | Modificado | Persistência e restauração de `hasOwn6B` e `own6B` em `collectState()`, `applyState()` e `clearForm()`, preservando 100% da retrocompatibilidade com fichas de jogadores e NPCs legados. |
| `dist/js/magiasUI.js` | Modificado | Integração de `applyMagiasState` e `onCfg6bChange` com o estado de 6B próprio em `freeEdit`. |
| `dist/js/mesaScreen.js` | Modificado | Suporte a `hasOwn6B: false` e `1..15` dados em `resolveCreature6BInfo`, validação em `applyCreatureStatsChanges`, exibição no modal do Bestiário e isolamento em `rollCreatureEntityAttack`. |
| `dist/js/modal.js` | Modificado | Isolamento em `isGmXerifeSheetMode()` para não forçar o 6B do Xerife quando a ficha editada possui 6B próprio ativo. |
| `dist/js/mesaXerife6B.js` | Modificado | Isolamento em `OS.getXerife6BForNpc(instanceId)` retornando `null` quando a instância possui 6B próprio explícito (`OS.entityHasOwn6B(inst)`). |
| `tests/xerife-6b-xer04-own-editor.cjs` | **Novo** | Suíte automatizada com 31 asserções cobrindo todos os 10 cenários obrigatórios de XER-04 e os contratos puros de XER-05 e XER-06. |

---

## 5. Pendências Exclusivas para XER-05 e XER-06

1. **XER-05 (Persistência e clonagem por instância):**
   - Conectar `createOwn6BInstanceStateContract` à criação/restauração de instâncias em `cena_ativa` / Supabase e renderizar os até 15 slots independentes por instância viva no card "Em Cena" e no popup flutuante.
2. **XER-06 (Consumo, dano, fadiga e renovação):**
   - Conectar `validateAndProjectOwn6BInstanceCommand` à UI de combate da instância em cena (modal de escolha de dados perdidos pelo defensor ao sofrer dano, consumo de dados na rolagem de ataque/teste da instância e botão de renovação com incremento automático de Fadiga e proteção de idempotência).
