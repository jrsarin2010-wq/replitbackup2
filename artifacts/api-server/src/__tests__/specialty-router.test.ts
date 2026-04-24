/**
 * TESTES UNITÁRIOS — specialty-router.ts (Task #14)
 *
 * Cobre a lógica central de roteamento por especialidade que impede o vazamento
 * de profissionais fora da especialidade solicitada:
 *
 * 1. detectNeededSpecialty — detecção por mensagem atual
 * 2. filterProfessionalsByDetectedSpecialty — filtragem da lista
 * 3. applySpecialtyRouting — shortcut que combina detect + filter
 * 4. Prioridade da mensagem atual sobre o histórico (Task #14)
 *    — garante que "perdi um dente" + "dente torto" na msg atual
 *      aciona SOMENTE ortodontia (sem contaminação de implantodontia).
 */
import { describe, it, expect } from "vitest";
import {
  detectNeededSpecialty,
  filterProfessionalsByDetectedSpecialty,
  applySpecialtyRouting,
} from "../lib/specialty-router.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PROF_SIVERINO = {
  id: 10,
  name: "Dr. Siverino",
  specialty: "Ortodontia",
  specialties: "Ortodontia,aparelho",
};

const PROF_ROBERTINO = {
  id: 20,
  name: "Dr. Robertino",
  specialty: "Implantodontia",
  specialties: "Implantodontia,protese,lente de contato",
};

const PROF_JOAO = {
  id: 1,
  name: "Dr. João",
  specialty: "Clínica Geral",
  specialties: null,
};

const ALL_PROFESSIONALS = [PROF_SIVERINO, PROF_ROBERTINO, PROF_JOAO];

// ── 1. detectNeededSpecialty ───────────────────────────────────────────────────
describe("detectNeededSpecialty", () => {
  it("detecta ortodontia em 'coloquei dente torto'", () => {
    const result = detectNeededSpecialty("coloquei dente torto");
    expect(result.labels).toContain("ortodontia");
    expect(result.keywords).toContain("ortodont");
  });

  it("detecta ortodontia em 'quero aparelho'", () => {
    const result = detectNeededSpecialty("quero aparelho");
    expect(result.labels).toContain("ortodontia");
  });

  it("detecta implantodontia em 'perdi um dente'", () => {
    const result = detectNeededSpecialty("perdi um dente");
    expect(result.labels).toContain("implantodontia");
    expect(result.keywords).toContain("implant");
  });

  it("detecta implantodontia em 'meu dente caiu'", () => {
    const result = detectNeededSpecialty("meu dente caiu");
    expect(result.labels).toContain("implantodontia");
  });

  it("retorna vazio para mensagem ambígua como 'sim'", () => {
    const result = detectNeededSpecialty("sim");
    expect(result.labels).toHaveLength(0);
    expect(result.keywords).toHaveLength(0);
  });

  it("retorna vazio para 'plano'", () => {
    const result = detectNeededSpecialty("plano");
    expect(result.labels).toHaveLength(0);
  });

  it("não contamina ortodontia com implantodontia — mensagens separadas", () => {
    const ortho = detectNeededSpecialty("dente torto");
    const impl = detectNeededSpecialty("perdi um dente");
    // Cada mensagem deve detectar apenas sua própria especialidade
    expect(ortho.labels).toContain("ortodontia");
    expect(ortho.labels).not.toContain("implantodontia");
    expect(impl.labels).toContain("implantodontia");
    expect(impl.labels).not.toContain("ortodontia");
  });
});

// ── 2. filterProfessionalsByDetectedSpecialty ─────────────────────────────────
describe("filterProfessionalsByDetectedSpecialty", () => {
  it("mantém só Siverino quando detected=ortodontia", () => {
    const detected = detectNeededSpecialty("dente torto");
    const result = filterProfessionalsByDetectedSpecialty(ALL_PROFESSIONALS, detected);
    expect(result.filtered).toBe(true);
    expect(result.professionals.map((p) => p.name)).toContain("Dr. Siverino");
    expect(result.professionals.map((p) => p.name)).not.toContain("Dr. Robertino");
  });

  it("mantém só Robertino quando detected=implantodontia", () => {
    const detected = detectNeededSpecialty("perdi um dente");
    const result = filterProfessionalsByDetectedSpecialty(ALL_PROFESSIONALS, detected);
    expect(result.filtered).toBe(true);
    expect(result.professionals.map((p) => p.name)).toContain("Dr. Robertino");
    expect(result.professionals.map((p) => p.name)).not.toContain("Dr. Siverino");
  });

  it("aciona noMatchFallback quando nenhum profissional tem a especialidade", () => {
    const detected = detectNeededSpecialty("dente torto");
    // Clínica sem ortodontista
    const result = filterProfessionalsByDetectedSpecialty([PROF_ROBERTINO, PROF_JOAO], detected);
    expect(result.noMatchFallback).toBe(true);
    expect(result.filtered).toBe(false);
    // Retorna lista original (fallback seguro)
    expect(result.professionals).toHaveLength(2);
  });

  it("não filtra quando detected.keywords está vazio (mensagem ambígua)", () => {
    const detected = detectNeededSpecialty("sim");
    const result = filterProfessionalsByDetectedSpecialty(ALL_PROFESSIONALS, detected);
    expect(result.filtered).toBe(false);
    expect(result.professionals).toHaveLength(ALL_PROFESSIONALS.length);
  });
});

// ── 3. applySpecialtyRouting — shortcut ───────────────────────────────────────
describe("applySpecialtyRouting (shortcut)", () => {
  it("'dente torto' → filtra para apenas Siverino", () => {
    const result = applySpecialtyRouting("dente torto", ALL_PROFESSIONALS);
    expect(result.filtered).toBe(true);
    expect(result.professionals).toHaveLength(1);
    expect(result.professionals[0].name).toBe("Dr. Siverino");
  });

  it("'perdi um dente' → filtra para apenas Robertino", () => {
    const result = applySpecialtyRouting("perdi um dente", ALL_PROFESSIONALS);
    expect(result.filtered).toBe(true);
    expect(result.professionals[0].name).toBe("Dr. Robertino");
  });

  it("janela contaminada (implante + ortodontia) → detecta ambos quando ambos estão no texto", () => {
    // Esta é a janela CONTAMINADA que o Task #14 impede de usar quando a msg atual é clara.
    // Aqui testamos diretamente o applySpecialtyRouting com a janela composta:
    // o resultado deve incluir AMBOS (Siverino + Robertino).
    const contaminatedWindow = "perdi um dente dente torto quero aparelho";
    const result = applySpecialtyRouting(contaminatedWindow, ALL_PROFESSIONALS);
    const names = result.professionals.map((p) => p.name);
    expect(names).toContain("Dr. Siverino");
    expect(names).toContain("Dr. Robertino");
  });
});

// ── 4. Comportamento esperado de ai-engine (Task #14): prioridade da msg atual ─
//
// Simula a lógica introduzida em ai-engine.ts:
// - Se detectNeededSpecialty(incomingMessage).labels.length > 0 → usar só incomingMessage
// - Caso contrário → usar janela com histórico
//
// Este teste documenta e protege o comportamento sem precisar montar o ai-engine completo.
describe("Prioridade da mensagem atual sobre o histórico (lógica de ai-engine.ts)", () => {
  function simulateRoutingDecision(
    incomingMessage: string,
    historyTexts: string[],
    professionals: typeof ALL_PROFESSIONALS,
  ) {
    // Replicate the ai-engine.ts routing decision logic introduced by Task #14.
    const currentMsgDetected = detectNeededSpecialty(incomingMessage);
    const routingTextWindow =
      currentMsgDetected.labels.length > 0
        ? incomingMessage
        : [...historyTexts, incomingMessage].join(" ");
    return {
      routing: applySpecialtyRouting(routingTextWindow, professionals),
      usedCurrentMsgOnly: currentMsgDetected.labels.length > 0,
    };
  }

  it("(a) 'dente torto' sem histórico → apenas Dr. Siverino no resultado", () => {
    const { routing, usedCurrentMsgOnly } = simulateRoutingDecision(
      "dente torto",
      [],
      ALL_PROFESSIONALS,
    );
    expect(usedCurrentMsgOnly).toBe(true);
    expect(routing.filtered).toBe(true);
    expect(routing.professionals.map((p) => p.name)).toEqual(["Dr. Siverino"]);
  });

  it("(b) histórico 'perdi um dente' + msg atual 'dente torto' → apenas Dr. Siverino", () => {
    const { routing, usedCurrentMsgOnly } = simulateRoutingDecision(
      "dente torto",
      ["perdi um dente"],
      ALL_PROFESSIONALS,
    );
    // Porque a mensagem atual detecta ortodontia, o histórico de implante é ignorado.
    expect(usedCurrentMsgOnly).toBe(true);
    expect(routing.filtered).toBe(true);
    const names = routing.professionals.map((p) => p.name);
    expect(names).toContain("Dr. Siverino");
    expect(names).not.toContain("Dr. Robertino");
  });

  it("(c) msg atual ambígua 'sim' com histórico 'dente torto' → usa janela → Dr. Siverino", () => {
    const { routing, usedCurrentMsgOnly } = simulateRoutingDecision(
      "sim",
      ["dente torto"],
      ALL_PROFESSIONALS,
    );
    // Mensagem atual ambígua: deve expandir para a janela com histórico.
    expect(usedCurrentMsgOnly).toBe(false);
    expect(routing.filtered).toBe(true);
    const names = routing.professionals.map((p) => p.name);
    expect(names).toContain("Dr. Siverino");
    expect(names).not.toContain("Dr. Robertino");
  });

  it("(d) msg ambígua com histórico misto (implante + ortodontia) → ambos detectados", () => {
    // Quando a msg atual é ambígua, o histórico completo é usado — e se ele
    // contém ambas especialidades, ambos os profissionais aparecem. Isso é o
    // comportamento atual esperado para msgs curtas de acompanhamento.
    const { routing, usedCurrentMsgOnly } = simulateRoutingDecision(
      "sim",
      ["perdi um dente", "mas tbm tenho dente torto"],
      ALL_PROFESSIONALS,
    );
    expect(usedCurrentMsgOnly).toBe(false);
    expect(routing.filtered).toBe(true);
    const names = routing.professionals.map((p) => p.name);
    expect(names).toContain("Dr. Siverino");
    expect(names).toContain("Dr. Robertino");
  });

  it("(e) msg atual 'quero aparelho' com histórico implante → só Siverino (sem contaminação)", () => {
    const { routing, usedCurrentMsgOnly } = simulateRoutingDecision(
      "quero aparelho",
      ["perdi um dente", "tava pensando em implante"],
      ALL_PROFESSIONALS,
    );
    expect(usedCurrentMsgOnly).toBe(true);
    expect(routing.filtered).toBe(true);
    const names = routing.professionals.map((p) => p.name);
    expect(names).toContain("Dr. Siverino");
    expect(names).not.toContain("Dr. Robertino");
  });
});
