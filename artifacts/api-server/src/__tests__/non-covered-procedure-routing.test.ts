import { describe, it, expect } from "vitest";
import {
  detectNonCoveredProcedureRouting,
  buildNonCoveredRoutingHint,
} from "../lib/prompt-helpers";

const ana = {
  name: "Dra. Ana Beatriz",
  specialties: "Clínico Geral, Estética",
  acceptsInsurance: false,
  chargesConsultation: true,
  consultationFee: "150.00",
  isActive: true,
};

const marcos = {
  name: "Dr. Marcos Oliveira",
  specialties: "Ortodontia, Aparelho Dental",
  acceptsInsurance: true,
  chargesConsultation: true,
  consultationFee: "200.00",
  isActive: true,
};

const roberto = {
  name: "Dr. Roberto Santos",
  specialties: "Implantodontia, Implante Dental",
  acceptsInsurance: false,
  chargesConsultation: false,
  consultationFee: "300.00",
  isActive: true,
};

const profs = [ana, marcos, roberto];

describe("detectNonCoveredProcedureRouting", () => {
  it("routes implante request to Roberto (free consultation)", () => {
    const result = detectNonCoveredProcedureRouting(
      "uso plano, quero fazer implante dental",
      profs,
    );
    expect(result).not.toBeNull();
    expect(result!.procedureLabel).toBe("implante");
    expect(result!.privateProfs.map((p) => p.name)).toEqual(["Dr. Roberto Santos"]);
    expect(result!.privateProfs[0].chargesConsultation).toBe(false);
  });

  it("routes clareamento request to Ana (R$150)", () => {
    const result = detectNonCoveredProcedureRouting(
      "uso convênio mas meu plano não cobre clareamento, posso pagar particular?",
      profs,
    );
    expect(result).not.toBeNull();
    expect(result!.procedureLabel).toBe("clareamento");
    expect(result!.privateProfs.map((p) => p.name)).toEqual(["Dra. Ana Beatriz"]);
    expect(result!.privateProfs[0].chargesConsultation).toBe(true);
    expect(result!.privateProfs[0].consultationFee).toBe("150.00");
  });

  it("returns null when message asks about a covered procedure (aparelho → Marcos covers via insurance)", () => {
    const result = detectNonCoveredProcedureRouting(
      "uso plano, quero colocar aparelho",
      profs,
    );
    // Marcos has Ortodontia AND acceptsInsurance=true → covered
    expect(result).toBeNull();
  });

  it("returns null when no professional handles that specialty at all", () => {
    const result = detectNonCoveredProcedureRouting(
      "quero fazer harmonização facial",
      [marcos, roberto], // none has estetica/harmonizacao specialty
    );
    expect(result).toBeNull();
  });

  it("returns null on empty message", () => {
    expect(detectNonCoveredProcedureRouting("", profs)).toBeNull();
  });

  it("ignores inactive professionals", () => {
    const result = detectNonCoveredProcedureRouting(
      "quero fazer implante",
      [ana, marcos, { ...roberto, isActive: false }],
    );
    expect(result).toBeNull();
  });
});

describe("buildNonCoveredRoutingHint", () => {
  it("includes procedure label, professional name, and GRATUITA flag for free consultation", () => {
    const hint = buildNonCoveredRoutingHint({
      procedureLabel: "implante",
      privateProfs: [{ name: "Dr. Roberto Santos", chargesConsultation: false, consultationFee: "300.00" }],
    });
    expect(hint).toContain("implante");
    expect(hint).toContain("Dr. Roberto Santos");
    expect(hint).toContain("GRATUITA");
    expect(hint).toContain("ROTEAMENTO POR PROCEDIMENTO NAO COBERTO");
    expect(hint).toContain("PROIBIDO");
  });

  it("includes consultation fee + PIX for paid private professional", () => {
    const hint = buildNonCoveredRoutingHint({
      procedureLabel: "clareamento",
      privateProfs: [{ name: "Dra. Ana Beatriz", chargesConsultation: true, consultationFee: "150.00" }],
    });
    expect(hint).toContain("Dra. Ana Beatriz");
    expect(hint).toContain("R$150.00");
    expect(hint).toContain("PIX");
  });

  it("joins multiple professionals with 'ou'", () => {
    const hint = buildNonCoveredRoutingHint({
      procedureLabel: "implante",
      privateProfs: [
        { name: "Dr. A", chargesConsultation: false, consultationFee: null },
        { name: "Dr. B", chargesConsultation: true, consultationFee: "200.00" },
      ],
    });
    expect(hint).toContain("Dr. A");
    expect(hint).toContain("Dr. B");
    expect(hint).toContain(" ou ");
  });
});
