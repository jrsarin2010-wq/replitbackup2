import { describe, it, expect } from "vitest";
import { stripForTTS, addSpeechRhythm } from "../lib/cartesia.js";
import { normalizeTtsText } from "../lib/elevenlabs.js";

// ─── stripForTTS ─────────────────────────────────────────────────────────────

describe("stripForTTS — limpeza de markdown e emojis", () => {
  it("remove negrito markdown **texto**", () => {
    expect(stripForTTS("Temos **horário disponível** amanhã.")).toBe(
      "Temos horário disponível amanhã."
    );
  });

  it("remove itálico markdown *texto*", () => {
    expect(stripForTTS("Clínica *Sorrizin*")).toBe("Clínica Sorrizin");
  });

  it("remove negrito triplo ***texto***", () => {
    expect(stripForTTS("***Confirmado!***")).toBe("Confirmado!");
  });

  it("remove markdown de headers ## e ###", () => {
    expect(stripForTTS("## Agendamento\nConfirmado")).toBe(
      "Agendamento, Confirmado"
    );
  });

  it("remove links markdown [texto](url)", () => {
    expect(stripForTTS("Acesse [nosso site](https://exemplo.com)")).toBe(
      "Acesse nosso site"
    );
  });

  it("remove código inline `código`", () => {
    expect(stripForTTS("Use o código `ABC123`")).toBe("Use o código ABC123");
  });

  it("remove bullet points com hífen", () => {
    expect(stripForTTS("- Segunda às 14h\n- Terça às 10h")).toBe(
      "Segunda às 14h, Terça às 10h"
    );
  });

  it("remove bullet points com asterisco", () => {
    expect(stripForTTS("* Opção 1\n* Opção 2")).toBe("Opção 1, Opção 2");
  });

  it("remove emojis variados", () => {
    expect(stripForTTS("Olá! 😊 Tudo bem? 🦷")).toBe("Olá! Tudo bem?");
  });

  it("remove emoji de coração e estrela", () => {
    expect(stripForTTS("Obrigada ❤️ Até logo ⭐")).toBe("Obrigada Até logo");
  });

  it("remove múltiplos emojis seguidos", () => {
    expect(stripForTTS("Ótimo! 🎉🎊✨ Confirmado")).toBe("Ótimo! Confirmado");
  });

  it("converte quebras de linha duplas em pausa natural", () => {
    expect(stripForTTS("Primeira frase.\n\nSegunda frase.")).toBe(
      "Primeira frase. Segunda frase."
    );
  });

  it("converte quebra de linha simples em vírgula", () => {
    expect(stripForTTS("Linha um\nLinha dois")).toBe("Linha um, Linha dois");
  });

  it("remove caracteres |, ~ e ^", () => {
    expect(stripForTTS("Opção A | Opção B")).toBe("Opção A Opção B");
  });

  it("não altera texto limpo sem símbolos", () => {
    expect(stripForTTS("Olá, como posso te ajudar?")).toBe(
      "Olá, como posso te ajudar?"
    );
  });

  it("colapsa múltiplos espaços em um só", () => {
    expect(stripForTTS("texto   com   espaços")).toBe("texto com espaços");
  });
});

// ─── normalizeTtsText — parcelamento (12x) ───────────────────────────────────

describe("normalizeTtsText — parcelamento Nx → N vezes", () => {
  it("converte 12x em 12 vezes", () => {
    expect(normalizeTtsText("Parcelo em 12x sem juros.")).toBe(
      "Parcelo em 12 vezes sem juros."
    );
  });

  it("converte 6x em 6 vezes", () => {
    expect(normalizeTtsText("Pode parcelar em 6x")).toBe(
      "Pode parcelar em 6 vezes"
    );
  });

  it("converte X maiúsculo", () => {
    expect(normalizeTtsText("Parcelamos em 3X")).toBe("Parcelamos em 3 vezes");
  });

  it("converte com espaço entre número e x", () => {
    expect(normalizeTtsText("pagamento em 10 x")).toBe(
      "pagamento em 10 vezes"
    );
  });

  it("não converte dimensões como 10x20", () => {
    const input = "Sala de 10x20 metros";
    const result = normalizeTtsText(input);
    expect(result).not.toContain("vezes");
  });

  it("converte 1x (singular)", () => {
    expect(normalizeTtsText("pagamento em 1x")).toBe("pagamento em 1 vezes");
  });
});

// ─── normalizeTtsText — horários ─────────────────────────────────────────────

describe("normalizeTtsText — horários", () => {
  it("converte 14:30 para catorze e meia da tarde", () => {
    const result = normalizeTtsText("Consulta às 14:30");
    expect(result).toContain("quatorze");
    expect(result).toContain("trinta");
    expect(result).toContain("tarde");
  });

  it("converte 09:00 para nove horas da manhã", () => {
    const result = normalizeTtsText("Horário: 09:00");
    expect(result).toContain("manhã");
  });

  it("converte 20:00 para oito horas da noite", () => {
    const result = normalizeTtsText("às 20:00 horas");
    expect(result).toContain("noite");
  });
});

// ─── normalizeTtsText — valores monetários ───────────────────────────────────

describe("normalizeTtsText — valores monetários", () => {
  it("converte R$ 500,00 para 500 reais", () => {
    const result = normalizeTtsText("Valor: R$ 500,00");
    expect(result).toContain("500 reais");
    expect(result).not.toContain("R$");
  });

  it("converte R$ 1.200,50 para 1200 reais e 50 centavos", () => {
    const result = normalizeTtsText("Total: R$ 1.200,50");
    expect(result).toContain("1200 reais");
    expect(result).toContain("50 centavos");
  });

  it("converte R$ 800 (sem centavos)", () => {
    const result = normalizeTtsText("Investimento de R$ 800");
    expect(result).toContain("800 reais");
    expect(result).not.toContain("R$");
  });
});

// ─── normalizeTtsText — abreviações médicas ──────────────────────────────────

describe("normalizeTtsText — abreviações", () => {
  it("converte Dr. para Doutor", () => {
    expect(normalizeTtsText("Dr. Silva")).toBe("Doutor Silva");
  });

  it("converte Dra. para Doutora", () => {
    expect(normalizeTtsText("Dra. Ana")).toBe("Doutora Ana");
  });

  it("converte Dr. no fim de frase (sem espaço após)", () => {
    expect(normalizeTtsText("com o Dr.")).toBe("com o Doutor");
  });

  it("converte Dra. no fim de frase (sem espaço após)", () => {
    expect(normalizeTtsText("com a Dra.")).toBe("com a Doutora");
  });

  it("converte Dr(a). para Doutor", () => {
    expect(normalizeTtsText("Dr(a). João")).toBe("Doutor João");
  });

  it("converte Dr(a). no fim de frase", () => {
    expect(normalizeTtsText("com o Dr(a).")).toBe("com o Doutor");
  });

  it("converte hs para horas", () => {
    expect(normalizeTtsText("2 hs de duração")).toBe("2 horas de duração");
  });

  it("converte hr para hora", () => {
    expect(normalizeTtsText("1 hr de consulta")).toBe("1 hora de consulta");
  });

  it("converte min para minutos", () => {
    expect(normalizeTtsText("30 min de espera")).toBe("30 minutos de espera");
  });
});

// ─── addSpeechRhythm — pausas e ritmo ────────────────────────────────────────

describe("addSpeechRhythm — ritmo de fala humanizado", () => {
  it("adiciona pausa antes de 'mas'", () => {
    const result = addSpeechRhythm("Temos horário mas está quase cheio.");
    expect(result).toContain(", mas");
  });

  it("adiciona pausa antes de 'então'", () => {
    const result = addSpeechRhythm("Confirmamos então o agendamento.");
    expect(result).toContain(", então");
  });

  it("adiciona pausa antes de 'por isso'", () => {
    const result = addSpeechRhythm("Está ocupado por isso ligue depois.");
    expect(result).toContain(", por isso");
  });

  it("adiciona pausa antes de 'além disso'", () => {
    const result = addSpeechRhythm("É rápido além disso é indolor.");
    expect(result).toContain(", além disso");
  });

  it("adiciona pausa após 'Olá'", () => {
    const result = addSpeechRhythm("Olá! Como posso ajudar?");
    expect(result.startsWith("Olá,")).toBe(true);
  });

  it("adiciona pausa após 'Bom dia'", () => {
    const result = addSpeechRhythm("Bom dia! Clínica Sorrizin.");
    expect(result.startsWith("Bom dia,")).toBe(true);
  });

  it("não duplica vírgulas existentes", () => {
    const result = addSpeechRhythm("Temos horário, mas está quase cheio.");
    expect(result).not.toContain(",,");
  });

  it("não altera texto sem conectivos", () => {
    const text = "Confirmado para amanhã às 14h.";
    const result = addSpeechRhythm(text);
    expect(result).toBe(text);
  });
});

// ─── normalizeTtsText — formato Nh (sem dois-pontos) ────────────────────────

describe("normalizeTtsText — formato Nh converte para por extenso", () => {
  it("'15h' → 'quinze horas'", () => {
    expect(normalizeTtsText("quarta 15h")).toContain("quinze horas");
  });

  it("'10h' → 'dez horas'", () => {
    expect(normalizeTtsText("amanhã 10h")).toContain("dez horas");
  });

  it("'9h' → 'nove horas'", () => {
    expect(normalizeTtsText("disponível 9h")).toContain("nove horas");
  });

  it("'1h' usa singular 'hora'", () => {
    expect(normalizeTtsText("dura 1h")).toContain("hora");
    expect(normalizeTtsText("dura 1h")).not.toContain("uma horas");
  });

  it("não converte 'Nh' dentro de palavras como '15h30'", () => {
    // 15h30 should NOT be touched by the Nh rule (it's followed by digit, not word boundary)
    const result = normalizeTtsText("às 15h30");
    expect(result).not.toMatch(/quinze horas30/);
  });

  it("não altera 'horas' já escrito por extenso", () => {
    expect(normalizeTtsText("às dez horas")).toBe("às dez horas");
  });
});

// ─── pipeline completo ────────────────────────────────────────────────────────

describe("pipeline completo: normalizeTtsText + stripForTTS + addSpeechRhythm", () => {
  it("processa uma resposta real da IA de ponta a ponta", () => {
    const iaResponse = [
      "**Ótimo!** 😊 Temos disponibilidade para sua consulta.",
      "Parcelo em 12x sem juros.",
      "O valor é R$ 350,00.",
      "Dr. Carlos estará disponível às 14:30 da tarde.",
      "- Segunda-feira",
      "- Terça-feira",
    ].join("\n");

    const step1 = normalizeTtsText(iaResponse);
    const step2 = stripForTTS(step1);
    const step3 = addSpeechRhythm(step2);

    // Sem emojis
    expect(step3).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    // Sem markdown
    expect(step3).not.toContain("**");
    expect(step3).not.toContain("- ");
    // Parcelamento correto
    expect(step3).toContain("12 vezes");
    // Valor monetário correto
    expect(step3).toContain("350 reais");
    // Doutor
    expect(step3).toContain("Doutor");
    // Horário
    expect(step3).toContain("tarde");
  });
});
