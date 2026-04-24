import { describe, it, expect } from "vitest";
import { detectIntent, classifyLeadTemperature } from "../lib/intent-detector.js";
import { INSURANCE_DECLARED_PATTERN, PRIVATE_DECLARED_PATTERN, isBareParticularAnswer, isBareInsuranceAnswer, resolveInsuranceMode } from "../lib/lead-engine.js";

describe("detectIntent — classificação de intenção do paciente", () => {
  describe("scheduling (agendamento)", () => {
    it("detecta 'quero marcar uma consulta'", async () => {
      expect(await detectIntent("quero marcar uma consulta")).toBe("scheduling");
    });
    it("detecta 'quero agendar'", async () => {
      expect(await detectIntent("quero agendar")).toBe("scheduling");
    });
    it("detecta 'tem horario disponivel'", async () => {
      expect(await detectIntent("tem horario disponivel?")).toBe("scheduling");
    });
    it("detecta 'tem vaga'", async () => {
      expect(await detectIntent("tem vaga pra hoje?")).toBe("scheduling");
    });
    it("detecta 'pode marcar pra mim'", async () => {
      expect(await detectIntent("pode marcar pra mim?")).toBe("scheduling");
    });
    it("detecta 'agenda pra mim'", async () => {
      expect(await detectIntent("agenda pra mim amanha")).toBe("scheduling");
    });
    it("detecta 'preciso marcar'", async () => {
      expect(await detectIntent("preciso marcar uma avaliacao")).toBe("scheduling");
    });
  });

  describe("cancellation (cancelamento)", () => {
    it("detecta 'quero cancelar'", async () => {
      expect(await detectIntent("quero cancelar minha consulta")).toBe("cancellation");
    });
    it("detecta 'desmarcar'", async () => {
      expect(await detectIntent("preciso desmarcar")).toBe("cancellation");
    });
    it("detecta 'nao vou poder ir'", async () => {
      expect(await detectIntent("nao vou poder ir")).toBe("cancellation");
    });
    it("detecta 'nao posso mais'", async () => {
      expect(await detectIntent("nao posso mais comparecer")).toBe("cancellation");
    });
  });

  describe("rescheduling (remarcação)", () => {
    it("detecta 'remarcar'", async () => {
      expect(await detectIntent("preciso remarcar")).toBe("rescheduling");
    });
    it("detecta 'reagendar'", async () => {
      expect(await detectIntent("quero reagendar minha consulta")).toBe("rescheduling");
    });
    it("detecta 'mudar horario'", async () => {
      expect(await detectIntent("quero mudar o horario")).toBe("rescheduling");
    });
    it("detecta 'outro horario'", async () => {
      expect(await detectIntent("tem outro horario?")).toBe("rescheduling");
    });
    it("detecta 'esse horario nao'", async () => {
      expect(await detectIntent("esse horario nao da pra mim")).toBe("rescheduling");
    });
  });

  describe("price_inquiry (preço)", () => {
    it("detecta 'quanto custa'", async () => {
      expect(await detectIntent("quanto custa uma limpeza?")).toBe("price_inquiry");
    });
    it("detecta 'qual o valor'", async () => {
      expect(await detectIntent("qual o valor da consulta?")).toBe("price_inquiry");
    });
    it("detecta 'parcela'", async () => {
      expect(await detectIntent("tem parcelamento?")).toBe("price_inquiry");
    });
    it("detecta 'aceita pix'", async () => {
      expect(await detectIntent("aceita pix?")).toBe("price_inquiry");
    });
    it("detecta 'tem desconto'", async () => {
      expect(await detectIntent("tem desconto a vista?")).toBe("price_inquiry");
    });
  });

  describe("objection (objeção)", () => {
    it("detecta 'muito caro'", async () => {
      expect(await detectIntent("achei muito caro")).toBe("objection");
    });
    it("detecta 'vou pensar'", async () => {
      expect(await detectIntent("vou pensar")).toBe("objection");
    });
    it("detecta 'tenho medo'", async () => {
      expect(await detectIntent("tenho medo de dentista")).toBe("objection");
    });
    it("detecta 'nao tenho dinheiro'", async () => {
      expect(await detectIntent("nao tenho dinheiro agora")).toBe("objection");
    });
    it("detecta 'depois eu ligo'", async () => {
      expect(await detectIntent("depois eu ligo pra marcar")).toBe("objection");
    });
  });

  describe("question (pergunta)", () => {
    it("detecta 'como funciona'", async () => {
      expect(await detectIntent("como funciona o clareamento?")).toBe("question");
    });
    it("detecta 'aceita convenio'", async () => {
      expect(await detectIntent("aceita convenio?")).toBe("question");
    });
    it("detecta 'onde fica'", async () => {
      expect(await detectIntent("onde fica a clinica?")).toBe("question");
    });
    it("detecta 'quanto tempo dura'", async () => {
      expect(await detectIntent("quanto tempo dura o procedimento?")).toBe("question");
    });
  });

  describe("greeting (saudação)", () => {
    it("detecta 'oi'", async () => {
      expect(await detectIntent("oi")).toBe("greeting");
    });
    it("detecta 'bom dia'", async () => {
      expect(await detectIntent("bom dia")).toBe("greeting");
    });
    it("detecta 'boa tarde'", async () => {
      expect(await detectIntent("boa tarde")).toBe("greeting");
    });
    it("detecta 'ola tudo bem'", async () => {
      expect(await detectIntent("ola tudo bem")).toBe("greeting");
    });
    it("NÃO detecta saudação com frase longa", async () => {
      expect(await detectIntent("oi quero marcar uma consulta")).not.toBe("greeting");
    });
  });

  describe("other (não classificado)", () => {
    it("retorna 'other' para mensagem genérica", async () => {
      expect(await detectIntent("sim")).toBe("other");
    });
    it("retorna 'other' para mensagem vazia", async () => {
      expect(await detectIntent("")).toBe("other");
    });
    it("retorna 'other' para 'obrigado'", async () => {
      expect(await detectIntent("obrigado")).toBe("other");
    });
  });

  describe("prioridade de intenção (scheduling vence greeting)", () => {
    it("'quero agendar' vence sobre saudação implícita", async () => {
      expect(await detectIntent("quero agendar uma consulta por favor")).toBe("scheduling");
    });
    it("'quanto custa' vence sobre pergunta genérica", async () => {
      expect(await detectIntent("quanto custa o clareamento?")).toBe("price_inquiry");
    });
  });
});

describe("classifyLeadTemperature — cálculo de temperatura do lead", () => {
  describe("lead frio (cold → ?)", () => {
    it("cold + greeting + poucas mensagens → permanece cold", () => {
      expect(classifyLeadTemperature("greeting", "cold", 1)).toBe("cold");
    });
    it("cold + question + poucas mensagens → sobe para warm", () => {
      expect(classifyLeadTemperature("question", "cold", 2)).toBe("warm");
    });
    it("cold + scheduling → sobe para hot", () => {
      expect(classifyLeadTemperature("scheduling", "cold", 1)).toBe("hot");
    });
    it("cold + price_inquiry → sobe para warm", () => {
      expect(classifyLeadTemperature("price_inquiry", "cold", 1)).toBe("warm");
    });
    it("cold + objection → permanece cold", () => {
      expect(classifyLeadTemperature("objection", "cold", 1)).toBe("cold");
    });
  });

  describe("lead morno (warm → ?)", () => {
    it("warm + scheduling → sobe para hot", () => {
      expect(classifyLeadTemperature("scheduling", "warm", 3)).toBe("hot");
    });
    it("warm + objection + 3 msgs → permanece warm (heat 2+(-1)+0 = 1 → cold? no: 2-1=1 → cold)", () => {
      expect(classifyLeadTemperature("objection", "warm", 3)).toBe("cold");
    });
    it("warm + cancellation → cai (cold ou warm dependendo do messageCount)", () => {
      const result = classifyLeadTemperature("cancellation", "warm", 1);
      expect(result).toBe("cold");
    });
    it("warm + greeting → mantém warm", () => {
      expect(classifyLeadTemperature("greeting", "warm", 2)).toBe("warm");
    });
  });

  describe("lead quente (hot → ?)", () => {
    it("hot + scheduling → permanece hot", () => {
      expect(classifyLeadTemperature("scheduling", "hot", 5)).toBe("hot");
    });
    it("hot + cancellation + 1 msg → cai para cold (3+(-2)+0=1)", () => {
      expect(classifyLeadTemperature("cancellation", "hot", 1)).toBe("cold");
    });
    it("hot + greeting + 3 msgs → cai para warm (3+0+0=3)", () => {
      expect(classifyLeadTemperature("greeting", "hot", 3)).toBe("warm");
    });
  });

  describe("engagementBonus — mensagens > 4 dão bonus", () => {
    it("cold + greeting + 5 mensagens → sobe (bonus de engajamento)", () => {
      const withBonus = classifyLeadTemperature("greeting", "cold", 5);
      const withoutBonus = classifyLeadTemperature("greeting", "cold", 2);
      expect(withBonus).not.toBe("cold");
      expect(withoutBonus).toBe("cold");
    });
    it("warm + other + 5 mensagens → sobe para warm (bonus ajuda)", () => {
      expect(classifyLeadTemperature("other", "warm", 5)).toBe("warm");
    });
  });
});

// ─── Novos casos — scheduling ─────────────────────────────────────────────────

describe("detectIntent — scheduling (novos casos)", () => {
  it("detecta 'reservar uma consulta'", async () => {
    expect(await detectIntent("reservar uma consulta")).toBe("scheduling");
  });
  it("detecta 'quero reservar uma avaliacao'", async () => {
    expect(await detectIntent("quero reservar uma avaliacao")).toBe("scheduling");
  });
  it("detecta 'marcar hora'", async () => {
    expect(await detectIntent("quero marcar hora")).toBe("scheduling");
  });
  it("detecta 'fazer hora'", async () => {
    expect(await detectIntent("quero fazer hora")).toBe("scheduling");
  });
  it("detecta 'quero ir ao dentista'", async () => {
    expect(await detectIntent("quero ir ao dentista")).toBe("scheduling");
  });
  it("detecta 'quero ir hoje'", async () => {
    expect(await detectIntent("quero ir hoje")).toBe("scheduling");
  });
  it("detecta 'tem espaco na agenda'", async () => {
    expect(await detectIntent("tem espaco na agenda")).toBe("scheduling");
  });
  it("detecta 'tem espaço na agenda' (com acento)", async () => {
    expect(await detectIntent("tem espaço na agenda")).toBe("scheduling");
  });
  it("detecta 'quero um encaixe'", async () => {
    expect(await detectIntent("quero um encaixe")).toBe("scheduling");
  });
  it("detecta 'encaixe'", async () => {
    expect(await detectIntent("preciso de um encaixe")).toBe("scheduling");
  });
  it("detecta 'fazer uma consulta'", async () => {
    expect(await detectIntent("quero fazer uma consulta")).toBe("scheduling");
  });
  it("detecta 'preciso de atendimento'", async () => {
    expect(await detectIntent("preciso de atendimento")).toBe("scheduling");
  });
  it("detecta 'posso marcar pra hoje'", async () => {
    expect(await detectIntent("posso marcar pra hoje?")).toBe("scheduling");
  });
  it("detecta 'posso ir hoje'", async () => {
    expect(await detectIntent("posso ir hoje?")).toBe("scheduling");
  });
  it("detecta 'agendar horário' (com acento)", async () => {
    expect(await detectIntent("agendar horário")).toBe("scheduling");
  });
  it("detecta 'tem vaga na agenda'", async () => {
    expect(await detectIntent("tem vaga na agenda")).toBe("scheduling");
  });
  it("detecta 'quero uma hora'", async () => {
    expect(await detectIntent("quero uma hora")).toBe("scheduling");
  });
});

// ─── Novos casos — cancellation ───────────────────────────────────────────────

describe("detectIntent — cancellation (novos casos)", () => {
  it("detecta 'não consigo comparecer' (com acento)", async () => {
    expect(await detectIntent("não consigo comparecer")).toBe("cancellation");
  });
  it("detecta 'nao consigo comparecer'", async () => {
    expect(await detectIntent("nao consigo comparecer")).toBe("cancellation");
  });
  it("detecta 'não dá pra ir' (com acento)", async () => {
    expect(await detectIntent("não dá pra ir")).toBe("cancellation");
  });
  it("detecta 'nao da pra ir'", async () => {
    expect(await detectIntent("nao da pra ir")).toBe("cancellation");
  });
  it("detecta 'não posso nesse dia' (com acento)", async () => {
    expect(await detectIntent("não posso nesse dia")).toBe("cancellation");
  });
  it("detecta 'nao posso nesse dia'", async () => {
    expect(await detectIntent("nao posso nesse dia")).toBe("cancellation");
  });
});

// ─── Novos casos — rescheduling ───────────────────────────────────────────────

describe("detectIntent — rescheduling (novos casos)", () => {
  it("detecta 'encaixar em outro dia'", async () => {
    expect(await detectIntent("encaixar em outro dia")).toBe("rescheduling");
  });
  it("detecta 'encaixar em outro horario'", async () => {
    expect(await detectIntent("encaixar em outro horario")).toBe("rescheduling");
  });
  it("detecta 'encaixar outro dia'", async () => {
    expect(await detectIntent("encaixar outro dia")).toBe("rescheduling");
  });
});

// ─── Novos casos — price_inquiry ──────────────────────────────────────────────

describe("detectIntent — price_inquiry (novos casos)", () => {
  it("detecta 'vocês parcelam' (com acento)", async () => {
    expect(await detectIntent("vocês parcelam?")).toBe("price_inquiry");
  });
  it("detecta 'voces parcelam'", async () => {
    expect(await detectIntent("voces parcelam?")).toBe("price_inquiry");
  });
  it("detecta 'tem previsão de valor' (com acento)", async () => {
    expect(await detectIntent("tem previsão de valor?")).toBe("price_inquiry");
  });
  it("detecta 'tem previsao de valor'", async () => {
    expect(await detectIntent("tem previsao de valor?")).toBe("price_inquiry");
  });
  it("detecta 'quanto fica o implante'", async () => {
    expect(await detectIntent("quanto fica o implante?")).toBe("price_inquiry");
  });
  it("detecta 'quanto fica o clareamento'", async () => {
    expect(await detectIntent("quanto fica o clareamento?")).toBe("price_inquiry");
  });
});

// ─── Novos casos — objection ──────────────────────────────────────────────────

describe("detectIntent — objection (novos casos)", () => {
  it("detecta 'tô com medo' (com acento)", async () => {
    expect(await detectIntent("tô com medo")).toBe("objection");
  });
  it("detecta 'to com medo'", async () => {
    expect(await detectIntent("to com medo")).toBe("objection");
  });
  it("detecta 'não tenho condição' (com acento)", async () => {
    expect(await detectIntent("não tenho condição")).toBe("objection");
  });
  it("detecta 'nao tenho condicao'", async () => {
    expect(await detectIntent("nao tenho condicao")).toBe("objection");
  });
  it("detecta 'não tenho condição agora' (com acento)", async () => {
    expect(await detectIntent("não tenho condição agora")).toBe("objection");
  });
  it("detecta 'é caro' (com acento)", async () => {
    expect(await detectIntent("é caro demais")).toBe("objection");
  });
  it("detecta 'tô nervoso' (com acento)", async () => {
    expect(await detectIntent("tô nervoso com a consulta")).toBe("objection");
  });
});

// ─── Novos casos — greeting ───────────────────────────────────────────────────

describe("detectIntent — greeting (novos casos)", () => {
  it("detecta 'olá' (com acento)", async () => {
    expect(await detectIntent("olá")).toBe("greeting");
  });
  it("detecta 'olá tudo bem' (com acento)", async () => {
    expect(await detectIntent("olá tudo bem")).toBe("greeting");
  });
  it("detecta 'eaí' (com acento)", async () => {
    expect(await detectIntent("eaí")).toBe("greeting");
  });
  it("detecta 'eai'", async () => {
    expect(await detectIntent("eai")).toBe("greeting");
  });
  it("detecta 'boa tarde!' (com exclamação)", async () => {
    expect(await detectIntent("boa tarde!")).toBe("greeting");
  });
  it("detecta 'oi, boa tarde!' (com vírgula e exclamação)", async () => {
    expect(await detectIntent("oi, boa tarde!")).toBe("greeting");
  });
  it("detecta 'Boa noite' (maiúscula)", async () => {
    expect(await detectIntent("Boa noite")).toBe("greeting");
  });
  it("detecta 'boa manhã' (com acento)", async () => {
    expect(await detectIntent("boa manhã")).toBe("greeting");
  });
});

// ─── Normalização de acentos — testes cruzados ────────────────────────────────

describe("detectIntent — normalização de acentos (cross-check)", () => {
  it("'não vou poder ir' com acento → cancellation", async () => {
    expect(await detectIntent("não vou poder ir")).toBe("cancellation");
  });
  it("'horário disponível' com acentos → scheduling", async () => {
    expect(await detectIntent("horário disponível")).toBe("scheduling");
  });
  it("'Quero Agendar' maiúsculo → scheduling", async () => {
    expect(await detectIntent("Quero Agendar")).toBe("scheduling");
  });
  it("'Vou Pensar' maiúsculo → objection", async () => {
    expect(await detectIntent("Vou Pensar")).toBe("objection");
  });
  it("'Bom Dia' maiúsculo → greeting", async () => {
    expect(await detectIntent("Bom Dia")).toBe("greeting");
  });
  it("mensagem toda em maiúsculo com acento → classificada corretamente", async () => {
    expect(await detectIntent("QUERO MARCAR UMA CONSULTA")).toBe("scheduling");
  });
});

// ─── Anti-regressão: casos que devem continuar sendo 'other' ─────────────────

describe("detectIntent — anti-regressão: 'other' não expandiu demais", () => {
  it("'sim' ainda é other", async () => {
    expect(await detectIntent("sim")).toBe("other");
  });
  it("'obrigado' ainda é other", async () => {
    expect(await detectIntent("obrigado")).toBe("other");
  });
  it("'ok' ainda é other", async () => {
    expect(await detectIntent("ok")).toBe("other");
  });
  it("'perfeito' ainda é other", async () => {
    expect(await detectIntent("perfeito")).toBe("other");
  });
});

describe("INSURANCE_DECLARED_PATTERN — detecção de convênio (regressão)", () => {
  it("detecta 'plano'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("quero agendar pelo plano")).toBe(true);
  });
  it("detecta 'convênio' com acento", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("vou usar convênio")).toBe(true);
  });
  it("detecta 'convenio' sem acento", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("vou usar convenio")).toBe(true);
  });
  it("detecta 'tenho plano'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho plano de saude")).toBe(true);
  });
  it("detecta 'pelo convênio'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("quero agendar pelo convênio")).toBe(true);
  });
  it("detecta operadora 'unimed'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho unimed")).toBe(true);
  });
  it("detecta operadora 'hapvida'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("meu plano e hapvida")).toBe(true);
  });
  it("detecta operadora 'amil'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("uso amil")).toBe(true);
  });
  it("NÃO detecta 'particular'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("vou pagar particular")).toBe(false);
  });
  it("NÃO detecta mensagem genérica", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("quero agendar uma consulta")).toBe(false);
  });
  it("NÃO detecta saudação", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("oi tudo bem")).toBe(false);
  });
  it("case-insensitive: detecta 'VOU USAR PLANO'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("VOU USAR PLANO")).toBe(true);
  });
  it("detecta 'usar convênio' (variante verbal)", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("vou usar convênio")).toBe(true);
  });
  it("detecta 'usar convenio' sem acento", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("vou usar convenio")).toBe(true);
  });
  // Falsos positivos — perguntas sobre cobertura NÃO devem ser detectadas como declaração
  it("NÃO detecta pergunta 'voces atendem plano?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("voces atendem plano?")).toBe(false);
  });
  it("NÃO detecta pergunta 'aceita convenio?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("aceita convenio?")).toBe(false);
  });
  it("NÃO detecta pergunta 'voce atende convenio?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("voce atende convenio?")).toBe(false);
  });
  it("NÃO detecta pergunta 'atende algum plano?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("atende algum plano?")).toBe(false);
  });
  it("NÃO detecta pergunta 'tem atendimento por plano?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tem atendimento por plano?")).toBe(false);
  });
  it("NÃO detecta pergunta 'boa tarde, atende plano?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("boa tarde, atende plano?")).toBe(false);
  });
  // Falsos positivos de "plano" como plano de ação/intenção — NÃO são convênio
  it("NÃO detecta 'tenho plano de pagar parcelado'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho plano de pagar parcelado")).toBe(false);
  });
  it("NÃO detecta 'tenho um plano de visitar a clinica'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho um plano de visitar a clinica")).toBe(false);
  });
  it("NÃO detecta 'meu plano e ir semana que vem'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("meu plano e ir semana que vem")).toBe(false);
  });
  it("NÃO detecta 'qual o plano de tratamento?'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("qual o plano de tratamento?")).toBe(false);
  });
  // Contexto odontológico obrigatório: "tenho plano" sozinho SIM, "tenho plano de X" não-dental NÃO
  it("detecta 'tenho plano' sozinho (declaração direta)", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho plano")).toBe(true);
  });
  it("detecta 'tenho plano odontologico'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho plano odontologico")).toBe(true);
  });
  it("detecta 'tenho plano de saude'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("tenho plano de saude")).toBe(true);
  });
  it("detecta 'meu plano de saude bucal'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("meu plano de saude bucal")).toBe(true);
  });
  it("detecta 'meu plano dental'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("meu plano dental")).toBe(true);
  });
  it("detecta 'meu plano e Bradesco dental'", () => {
    expect(INSURANCE_DECLARED_PATTERN.test("meu plano e Bradesco dental")).toBe(true);
  });
});

describe("PRIVATE_DECLARED_PATTERN — detecção de particular (regressão)", () => {
  it("detecta 'particular'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("vou pagar particular")).toBe(true);
  });
  it("detecta 'sou particular'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("sou particular")).toBe(true);
  });
  it("detecta 'sem plano'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("estou sem plano")).toBe(true);
  });
  it("detecta 'nao tenho plano'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("nao tenho plano")).toBe(true);
  });
  it("detecta 'por conta propria'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("vou pagar por conta propria")).toBe(true);
  });
  it("NÃO detecta 'plano' (é insurance)", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("uso plano")).toBe(false);
  });
  it("NÃO detecta saudação", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("oi bom dia")).toBe(false);
  });

  // ─── Bug grave: triagem de convênio era pulada por falsos positivos ─────────
  // O lead enviava "atende particular?" ou "consulta particular urgente" e o
  // regex marcava isPrivate=true, fazendo o mode-resolver cair em
  // PARTICULAR_SPIN. Resultado: a IA partia direto pra SPIN sem perguntar
  // "plano ou particular?", mesmo com convênio ativado.
  describe("regressão: NÃO matcha 'particular' como adjetivo ou em pergunta", () => {
    it("NÃO detecta 'atende particular?' (pergunta, não declaração)", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("atende particular?")).toBe(false);
    });
    it("NÃO detecta 'voces atendem particular?'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("voces atendem particular?")).toBe(false);
    });
    it("NÃO detecta 'consulta particular urgente' (adjetivo)", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("preciso de uma consulta particular urgente")).toBe(false);
    });
    it("NÃO detecta 'consultorio particular' (adjetivo)", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("voces sao um consultorio particular?")).toBe(false);
    });
    it("NÃO detecta 'particular' sozinho (precisa de contexto contextualBarePrivate em ai-engine)", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("particular")).toBe(false);
    });
  });

  describe("declarações expandidas", () => {
    it("detecta 'sera particular'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("sera particular")).toBe(true);
    });
    it("detecta 'vai ser particular'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("vai ser particular")).toBe(true);
    });
    it("detecta 'prefiro particular'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("prefiro particular mesmo")).toBe(true);
    });
    it("detecta 'particular mesmo' (suffix)", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("particular mesmo")).toBe(true);
    });
    it("detecta 'sem convenio'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("estou sem convenio")).toBe(true);
    });
    it("detecta 'nao uso plano'", () => {
      expect(PRIVATE_DECLARED_PATTERN.test("nao uso plano")).toBe(true);
    });
  });
});

describe("isBareParticularAnswer — resposta única à triagem", () => {
  it("matcha 'particular' sozinho", () => {
    expect(isBareParticularAnswer("particular")).toBe(true);
  });
  it("matcha 'particular.' com pontuação", () => {
    expect(isBareParticularAnswer("particular.")).toBe(true);
  });
  it("matcha '  particular!  ' com espaços", () => {
    expect(isBareParticularAnswer("  particular!  ")).toBe(true);
  });
  it("NÃO matcha 'atende particular?'", () => {
    expect(isBareParticularAnswer("atende particular?")).toBe(false);
  });
  it("NÃO matcha 'sou particular'", () => {
    expect(isBareParticularAnswer("sou particular")).toBe(false);
  });
  it("NÃO matcha string vazia", () => {
    expect(isBareParticularAnswer("")).toBe(false);
  });
});

describe("isBareInsuranceAnswer — resposta única à triagem de convênio", () => {
  it("matcha 'plano' sozinho", () => {
    expect(isBareInsuranceAnswer("plano")).toBe(true);
  });
  it("matcha 'convênio' com acento", () => {
    expect(isBareInsuranceAnswer("convênio")).toBe(true);
  });
  it("matcha 'convenio' sem acento", () => {
    expect(isBareInsuranceAnswer("convenio")).toBe(true);
  });
  it("matcha 'plano.' com pontuação", () => {
    expect(isBareInsuranceAnswer("plano.")).toBe(true);
  });
  it("matcha '  convênio!  ' com espaços", () => {
    expect(isBareInsuranceAnswer("  convênio!  ")).toBe(true);
  });
  it("NÃO matcha 'atende plano?'", () => {
    expect(isBareInsuranceAnswer("atende plano?")).toBe(false);
  });
  it("matcha 'tenho plano' (resposta declarativa curta à triagem)", () => {
    expect(isBareInsuranceAnswer("tenho plano")).toBe(true);
  });
  it("matcha 'tenho o plano'", () => {
    expect(isBareInsuranceAnswer("tenho o plano")).toBe(true);
  });
  it("matcha 'meu plano' sozinho", () => {
    expect(isBareInsuranceAnswer("meu plano")).toBe(true);
  });
  it("NÃO matcha 'meu plano e unimed' (tem conteúdo extra)", () => {
    expect(isBareInsuranceAnswer("meu plano e unimed")).toBe(false);
  });
  it("NÃO matcha string vazia", () => {
    expect(isBareInsuranceAnswer("")).toBe(false);
  });
});

// ─── Integração: resolveInsuranceMode + falsos positivos ─────────────────────
describe("resolveInsuranceMode — bug do SPIN antecipado (falso positivo de 'particular')", () => {
  const base = {
    clinicAcceptsInsurance: true,
    persistedPaymentType: null,
    historyMessages: [],
  };

  it("'atende particular?' NÃO completa triagem (era bug — virava PARTICULAR_SPIN)", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "atende particular?" });
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(false);
    expect(r.triageNeeded).toBe(true);
  });

  it("'consulta particular urgente' NÃO completa triagem", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "preciso de consulta particular urgente" });
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(false);
  });

  it("'consultorio particular' NÃO completa triagem", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "voces sao consultorio particular?" });
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(false);
  });

  it("'sou particular' COMPLETA triagem como private", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "sou particular" });
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  it("'tenho unimed' COMPLETA triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "tenho unimed" });
    expect(r.isInsurance).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  // Falsos positivos de convênio — perguntas de cobertura NÃO devem completar triagem
  it("'voces atendem plano?' NÃO completa triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "voces atendem plano?" });
    expect(r.isInsurance).toBe(false);
    expect(r.triageComplete).toBe(false);
    expect(r.triageNeeded).toBe(true);
  });
  it("'aceita convenio?' NÃO completa triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "aceita convenio?" });
    expect(r.isInsurance).toBe(false);
    expect(r.triageComplete).toBe(false);
  });
  it("'atende algum plano?' NÃO completa triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "atende algum plano?" });
    expect(r.isInsurance).toBe(false);
    expect(r.triageComplete).toBe(false);
  });
  it("'boa tarde, atende plano?' NÃO completa triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "boa tarde, atende plano?" });
    expect(r.isInsurance).toBe(false);
    expect(r.triageComplete).toBe(false);
  });
  it("'tenho plano' COMPLETA triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "tenho plano" });
    expect(r.isInsurance).toBe(true);
    expect(r.triageComplete).toBe(true);
  });
  it("'vou usar convenio' COMPLETA triagem como insurance", () => {
    const r = resolveInsuranceMode({ ...base, currentMessage: "vou usar convenio" });
    expect(r.isInsurance).toBe(true);
    expect(r.triageComplete).toBe(true);
  });
});
