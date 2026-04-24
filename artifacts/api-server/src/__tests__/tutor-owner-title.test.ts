/**
 * BLINDAGEM: Tutor IA chama o titular como Dr./Dra./Dr(a). conforme professionalGender.
 *
 * Trava:
 *   1. Helper resolveOwnerTitle mapeia "male"->"Dr.", "female"->"Dra.", outros->null.
 *   2. stripOwnerTitlePrefix normaliza nomes que já vêm com "Dr."/"Dra.".
 *   3. buildOwnerTitleContextLine emite a linha "Tratamento do titular: ..." correta.
 *   4. buildSystemPrompt injeta a linha no CONTEXTO DA CLÍNICA ATUAL.
 *   5. tutor-knowledge 12-comportamento.md mantém a regra explícita de tratamento.
 */
import { describe, it, expect } from "vitest";
import {
  resolveOwnerTitle,
  stripOwnerTitlePrefix,
  inferTitleFromName,
  inferGenderFromNameEnding,
  buildOwnerTitleContextLine,
} from "../lib/owner-title";
import { buildSystemPrompt } from "../routes/dental/support-chat";
import { getSystemPromptBase } from "../lib/tutor-knowledge";

describe("resolveOwnerTitle", () => {
  it("retorna Dr. para male", () => {
    expect(resolveOwnerTitle("male")).toBe("Dr.");
  });
  it("retorna Dra. para female", () => {
    expect(resolveOwnerTitle("female")).toBe("Dra.");
  });
  it("retorna null para unspecified, null e undefined", () => {
    expect(resolveOwnerTitle("unspecified")).toBeNull();
    expect(resolveOwnerTitle(null)).toBeNull();
    expect(resolveOwnerTitle(undefined)).toBeNull();
  });
});

describe("stripOwnerTitlePrefix", () => {
  it("remove Dr./Dra. já presentes no nome", () => {
    expect(stripOwnerTitlePrefix("Dr. João Silva")).toBe("João Silva");
    expect(stripOwnerTitlePrefix("Dra Maria Souza")).toBe("Maria Souza");
    expect(stripOwnerTitlePrefix("dra. carla")).toBe("carla");
  });
  it("preserva nomes sem prefixo", () => {
    expect(stripOwnerTitlePrefix("João Silva")).toBe("João Silva");
  });
});

describe("inferTitleFromName", () => {
  it("infere Dr. de nomes com prefixo 'Dr.'", () => {
    expect(inferTitleFromName("Dr. João Silva")).toBe("Dr.");
    expect(inferTitleFromName("Dr João")).toBe("Dr.");
  });
  it("infere Dra. de nomes com prefixo 'Dra.'", () => {
    expect(inferTitleFromName("Dra. Maria Souza")).toBe("Dra.");
    expect(inferTitleFromName("dra Maria")).toBe("Dra.");
  });
  it("retorna null para nomes sem prefixo", () => {
    expect(inferTitleFromName("João Silva")).toBeNull();
    expect(inferTitleFromName("")).toBeNull();
  });
});

describe("inferGenderFromNameEnding", () => {
  it("infere masculino para terminação -in (ex: Robertin)", () => {
    expect(inferGenderFromNameEnding("Robertin")).toBe("male");
  });
  it("infere masculino para terminação -im (ex: Assim)", () => {
    expect(inferGenderFromNameEnding("Assim")).toBe("male");
  });
  it("infere masculino para terminação -on (ex: Wilson)", () => {
    expect(inferGenderFromNameEnding("Wilson")).toBe("male");
  });
  it("infere masculino para terminação -o (ex: Roberto)", () => {
    expect(inferGenderFromNameEnding("Roberto")).toBe("male");
  });
  it("infere masculino para diminutivo -inho (ex: Marcinho)", () => {
    expect(inferGenderFromNameEnding("Marcinho")).toBe("male");
  });
  it("infere feminino para diminutivo -inha (ex: Marcelinha)", () => {
    expect(inferGenderFromNameEnding("Marcelinha")).toBe("female");
  });
  it("infere feminino para terminação -a (ex: Maria)", () => {
    expect(inferGenderFromNameEnding("Maria")).toBe("female");
  });
  it("retorna null para nomes ambíguos (ex: Alex, Raquel)", () => {
    expect(inferGenderFromNameEnding("Alex")).toBeNull();
    expect(inferGenderFromNameEnding("Raquel")).toBeNull();
    expect(inferGenderFromNameEnding("Isabel")).toBeNull();
  });
});

describe("buildOwnerTitleContextLine", () => {
  it("emite linha Dr. para male", () => {
    const line = buildOwnerTitleContextLine("Dr. João Silva", "male");
    expect(line).toContain("Tratamento do titular: Dr. João Silva");
    expect(line).toContain("sempre se refira");
  });
  it("emite linha Dra. para female", () => {
    const line = buildOwnerTitleContextLine("Maria Souza", "female");
    expect(line).toContain("Tratamento do titular: Dra. Maria Souza");
  });
  it("infere Dr. pelo prefixo do nome quando gênero não configurado", () => {
    const line = buildOwnerTitleContextLine("Dr. João Silva", null);
    expect(line).toContain("Tratamento do titular: Dr. João Silva");
    expect(line).toContain("sempre se refira");
  });
  it("infere Dra. pelo prefixo do nome quando gênero não configurado", () => {
    const line = buildOwnerTitleContextLine("Dra. Maria Souza", "unspecified");
    expect(line).toContain("Tratamento do titular: Dra. Maria Souza");
  });
  it("infere Dr. para 'Robertin' sem gênero configurado", () => {
    const line = buildOwnerTitleContextLine("Robertin", null);
    expect(line).toContain("Tratamento do titular: Dr. Robertin");
    expect(line).toContain("sempre se refira");
  });
  it("infere Dra. para 'Carla' sem gênero configurado", () => {
    const line = buildOwnerTitleContextLine("Carla Souza", null);
    expect(line).toContain("Tratamento do titular: Dra. Carla Souza");
  });
  it("emite 'Dr(a).' quando gênero não informado e nome sem prefixo e terminação ambígua", () => {
    const line = buildOwnerTitleContextLine("Alex Lima", "unspecified");
    expect(line).toContain("Tratamento do titular: Dr(a). Alex Lima");
    expect(line).toContain("Dr(a).");
  });
  it("retorna null quando nome ausente", () => {
    expect(buildOwnerTitleContextLine(null, "male")).toBeNull();
    expect(buildOwnerTitleContextLine("", "female")).toBeNull();
  });
});

describe("buildSystemPrompt — injeção do tratamento", () => {
  it("inclui Dr. {nome} quando ownerGender=male", () => {
    const prompt = buildSystemPrompt({
      clinicName: "Clínica Teste",
      ownerName: "João Silva",
      ownerGender: "male",
    });
    expect(prompt).toContain("Tratamento do titular: Dr. João Silva");
  });
  it("inclui Dra. {nome} quando ownerGender=female", () => {
    const prompt = buildSystemPrompt({
      clinicName: "Clínica Teste",
      ownerName: "Maria Souza",
      ownerGender: "female",
    });
    expect(prompt).toContain("Tratamento do titular: Dra. Maria Souza");
  });
  it("usa Dr(a). quando ownerGender=unspecified", () => {
    const prompt = buildSystemPrompt({
      clinicName: "Clínica Teste",
      ownerName: "Alex Lima",
      ownerGender: "unspecified",
    });
    expect(prompt).toContain("Tratamento do titular: Dr(a). Alex Lima");
  });
  it("não injeta ctx-line dinâmica quando ownerName ausente", () => {
    const prompt = buildSystemPrompt({
      clinicName: "Clínica Teste",
      ownerName: null,
      ownerGender: "male",
    });
    // A regra estática em 12-comportamento.md contém "Tratamento do titular:",
    // mas a ctx-line do CONTEXTO DA CLÍNICA ATUAL ("• Tratamento do titular: Dr. ...") não deve aparecer.
    expect(prompt).not.toMatch(/•\s*Tratamento do titular:\s*Dr\./);
    expect(prompt).not.toMatch(/•\s*Tratamento do titular:\s*Dra\./);
  });
});

describe("Invariante #9 — Regra de tratamento Dr./Dra./Dr(a). no prompt base", () => {
  it("12-comportamento.md mantém regra explícita de tratamento do titular", () => {
    const base = getSystemPromptBase();
    expect(base).toMatch(/Tratamento do titular:\s*SEMPRE/);
    expect(base).toContain("\"Dr.\"");
    expect(base).toContain("\"Dra.\"");
    expect(base).toContain("\"Dr(a).\"");
  });
});
