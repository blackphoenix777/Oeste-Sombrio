/**
 * Constantes e dados estáticos
 */
import { OS } from "./app.js";

OS.STORAGE_KEY = "oesteSombrioFicha_v1";
OS.SAVE_DEBOUNCE_MS = 400;

OS.SKILLS = [
  { id: "acrobacia", name: "Acrobacia", classSkill: false },
  { id: "atletismo", name: "Atletismo", classSkill: false },
  { id: "blefe", name: "Blefe", classSkill: false },
  { id: "alquimia", name: "Alquimia", classSkill: true },
  { id: "conducao", name: "Condução", classSkill: true },
  { id: "natureza", name: "Natureza", classSkill: true },
  { id: "con-regional", name: "Con. Regional", classSkill: true },
  { id: "diplomacia", name: "Diplomacia", classSkill: false },
  { id: "engenharia", name: "Engenharia", classSkill: false },
  { id: "furtividade", name: "Furtividade", classSkill: false },
  { id: "intimidacao", name: "Intimidação", classSkill: false },
  { id: "medicina", name: "Medicina", classSkill: false },
  { id: "misticismo", name: "Misticismo", classSkill: false },
  { id: "montaria", name: "Montaria", classSkill: false },
  { id: "percepcao", name: "Percepção", classSkill: false },
  { id: "prestidigitacao", name: "Prestidigitação", classSkill: false },
  { id: "profissao", name: "Profissão", classSkill: false },
  { id: "sobrevivencia", name: "Sobrevivência", classSkill: false }
];

OS.COMBAT_SKILLS = [
  { id: "arma-curta", name: "Arma curta" },
  { id: "arma-longa", name: "Arma longa" },
  { id: "corpo-a-corpo", name: "Corpo a corpo" }
];

OS.DICE = ["d4", "d6", "d8", "d10", "d12"];
