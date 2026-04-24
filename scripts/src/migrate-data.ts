import { db, pool } from "@workspace/db";
import {
  dentalSettingsTable,
  dentalProfessionalsTable,
  aiKnowledgeBaseTable,
  aiObjectionPatternsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

async function migrateProfessionals() {
  const allSettings = await db.query.dentalSettingsTable.findMany();
  let migrated = 0;
  for (const s of allSettings) {
    if (!s.professionalName) continue;
    const existing = await db.query.dentalProfessionalsTable.findFirst({
      where: eq(dentalProfessionalsTable.tenantId, s.tenantId),
    });
    if (existing) continue;
    await db.insert(dentalProfessionalsTable).values({
      tenantId: s.tenantId,
      name: s.professionalName,
      specialty: s.specialties ?? null,
      workingDays: s.workingDays,
      workingHoursStart: s.workingHoursStart,
      workingHoursEnd: s.workingHoursEnd,
      lunchStart: s.lunchStart,
      lunchEnd: s.lunchEnd,
      slotDurationMinutes: s.slotDurationMinutes,
      isActive: true,
    });
    console.log(`  migrateProfessionals: tenant=${s.tenantId} name=${s.professionalName}`);
    migrated++;
  }
  console.log(`migrateProfessionals: ${migrated} profissionais criados.`);
}

async function ensureOwnerProfessional() {
  const allSettings = await db.query.dentalSettingsTable.findMany();
  let fixed = 0;
  for (const s of allSettings) {
    if (!s.professionalName) continue;
    const allProfs = await db.query.dentalProfessionalsTable.findMany({
      where: eq(dentalProfessionalsTable.tenantId, s.tenantId),
    });
    if (!allProfs.length) continue;

    const ownerName = s.professionalName.trim().toLowerCase();
    const ownerProf = allProfs.find((p) => p.name.trim().toLowerCase() === ownerName);

    if (!ownerProf) {
      await db.insert(dentalProfessionalsTable).values({
        tenantId: s.tenantId,
        name: s.professionalName,
        specialty: s.specialties ?? s.professionalSpecialties ?? null,
        specialties: s.specialties ?? s.professionalSpecialties ?? null,
        cro: s.professionalCro ?? null,
        workingDays: s.workingDays,
        workingHoursStart: s.workingHoursStart,
        workingHoursEnd: s.workingHoursEnd,
        lunchStart: s.lunchStart,
        lunchEnd: s.lunchEnd,
        slotDurationMinutes: s.slotDurationMinutes,
        acceptsInsurance: s.acceptsInsurance ?? false,
        insurancePlans: s.insurancePlans ?? null,
        insuranceDays: s.insuranceDays ?? null,
        insuranceHoursStart: s.insuranceHoursStart ?? null,
        insuranceHoursEnd: s.insuranceHoursEnd ?? null,
        chargesConsultation: s.chargesConsultation ?? true,
        consultationFee: s.consultationFee ?? null,
        defaultLeadDurationMinutes: s.defaultLeadDurationMinutes,
        defaultPatientDurationMinutes: s.defaultPatientDurationMinutes,
        isOwner: true,
        isActive: true,
      });
      console.log(`  ensureOwnerProfessional: tenant=${s.tenantId} inserido owner=${s.professionalName}`);
      for (const p of allProfs) {
        if (p.isOwner) {
          await db.execute(sql`UPDATE dental_professionals SET is_owner = false WHERE id = ${p.id}`);
        }
      }
      fixed++;
    } else if (!ownerProf.isOwner) {
      await db.execute(sql`UPDATE dental_professionals SET is_owner = true WHERE id = ${ownerProf.id}`);
      console.log(`  ensureOwnerProfessional: tenant=${s.tenantId} promovido owner=${ownerProf.name}`);
      for (const p of allProfs) {
        if (p.id !== ownerProf.id && p.isOwner) {
          await db.execute(sql`UPDATE dental_professionals SET is_owner = false WHERE id = ${p.id}`);
        }
      }
      fixed++;
    } else {
      for (const p of allProfs) {
        if (p.id !== ownerProf.id && p.isOwner) {
          await db.execute(sql`UPDATE dental_professionals SET is_owner = false WHERE id = ${p.id}`);
          fixed++;
        }
      }
    }
  }
  console.log(`ensureOwnerProfessional: ${fixed} correções aplicadas.`);
}

const DENTAL_KNOWLEDGE_SEED: Array<{ question: string; answer: string; category: string }> = [
  { question: "Qual a diferenca entre lente de resina e lente de ceramica?", answer: "As lentes de resina sao feitas com um material mais acessivel e o tratamento costuma ser mais rapido e sem desgaste do dente. Ja as de ceramica sao feitas em laboratorio especializado, dao um resultado ainda mais natural e brilhoso, e duram muito mais tempo. Pra saber qual e a melhor pra voce, o(a) Dr(a) avalia direitinho na consulta.", category: "lente_resina" },
  { question: "Quanto tempo duram as lentes de resina?", answer: "As lentes de resina costumam durar entre 3 e 5 anos com os devidos cuidados, como evitar morder objetos duros e manter uma boa higiene. Com manutencao certinha, dao um resultado lindo por bastante tempo.", category: "lente_resina" },
  { question: "Lente de resina doi? Vai mexer no meu dente?", answer: "Nao doi nao, fica bem tranquilo. Na maioria dos casos a resina e aplicada direto no dente sem precisar desgastar nada, entao o procedimento e super conservador. O(a) Dr(a) explica tudo direitinho na avaliacao.", category: "lente_resina" },
  { question: "O que sao lentes de contato de ceramica?", answer: "As lentes de ceramica sao finas laminas de porcelana feitas sob medida pra cobrir a frente do dente. Elas imitam o esmalte natural com perfeicao, dao um branco bonito e duradouro, e o resultado e realmente lindo. Tem uma durabilidade muito maior que a resina — podem durar 10 a 15 anos bem cuidadas.", category: "lente_ceramica" },
  { question: "Lente de ceramica desgasta o dente?", answer: "Precisa de um desgaste minimo e controlado no esmalte pra a lente encaixar perfeitamente, mas e bem pequeno. O(a) Dr(a) faz uma avaliacao pra ver se o seu caso precisa de desgaste ou nao. Vale muito a pena pelo resultado final.", category: "lente_ceramica" },
  { question: "Lente de ceramica e melhor que resina?", answer: "Cada uma tem sua vantagem. A ceramica dura mais, e mais resistente e o resultado e mais proximo do natural. A resina e mais acessivel e pode ser feita na mesma consulta. O ideal e o(a) Dr(a) avaliar seu sorriso pra indicar o melhor caminho pra voce.", category: "lente_ceramica" },
  { question: "O que e harmonizacao facial?", answer: "Harmonizacao facial e um conjunto de procedimentos esteticos que equilibram os tracos do rosto — botox, preenchimento labial, rinomodelacao, entre outros. O objetivo e deixar o rosto mais harmonico e natural, sem parecer forcado. O resultado e bem personalizado pra cada pessoa.", category: "harmonizacao_facial" },
  { question: "Botox doi muito?", answer: "Nao, a maioria das pessoas sente so um leve desconforto na hora da aplicacao, que passa rapidinho. O procedimento e bem rapido e o resultado ja comeca a aparecer nos primeiros dias.", category: "harmonizacao_facial" },
  { question: "Quanto tempo dura o botox?", answer: "O botox costuma durar entre 4 a 6 meses, dependendo de cada pessoa. Com o tempo, muita gente percebe que vai precisando menos porque o musculo se readapta.", category: "harmonizacao_facial" },
  { question: "Preenchimento labial incha muito?", answer: "Pode ter um inchaco leve nos primeiros dias, que e completamente normal. Ja depois disso o resultado fica natural e os labios ficam bonitos. O(a) profissional faz com cuidado pra o resultado ser bem natural.", category: "harmonizacao_facial" },
  { question: "Como funciona o clareamento dental?", answer: "O clareamento usa um gel especifico que clareia o esmalte do dente de forma segura. Pode ser feito aqui na clinica — com laser, que e mais rapido — ou com moldeirinha pra usar em casa. O resultado aparece em pouco tempo e transforma o sorriso.", category: "clareamento" },
  { question: "Clareamento dental machuca os dentes?", answer: "Feito do jeito certo, o clareamento e seguro e nao machuca. Pode ter uma sensibilidade leve durante ou logo apos o tratamento, mas passa rapido. O importante e fazer com profissional qualificado pra garantir o resultado sem prejudicar o esmalte.", category: "clareamento" },
  { question: "Quanto tempo dura o resultado do clareamento?", answer: "Com os cuidados certos, como evitar cafe, vinho e cigarro logo apos, o resultado dura em media 1 a 2 anos. E depois e so uma manutencao simples pra manter o sorriso branquinho.", category: "clareamento" },
  { question: "Como funciona o implante dental?", answer: "O implante e um parafuso de titanio colocado no osso do maxilar que serve de raiz artificial pro dente. Em cima dele vai uma coroa que parece um dente natural. E a solucao mais proxima de ter o dente de volta de verdade.", category: "implante" },
  { question: "Implante dental doi?", answer: "O procedimento e feito com anestesia, entao na hora voce nao sente nada. Depois pode ter um desconforto leve por alguns dias, normal de qualquer cirurgia pequena. A maioria das pessoas fica surpresa como e tranquilo.", category: "implante" },
  { question: "Quanto tempo leva o implante dental?", answer: "O processo completo leva em media 3 a 6 meses, porque o implante precisa se integrar ao osso antes de colocar o dente definitivo. Mas tem casos em que ja sai com um dente provisorio no mesmo dia. O(a) Dr(a) avalia seu caso na consulta.", category: "implante" },
  { question: "Implante dental e melhor que protese?", answer: "O implante e considerado a melhor solucao porque e fixo, funciona como um dente natural, nao mexe, nao precisa tirar pra limpar e preserva o osso. A protese convencional tem suas indicacoes, mas o implante e o padrao ouro quando possivel.", category: "implante" },
  { question: "Alinhador invisivel funciona mesmo?", answer: "Sim, funciona muito bem! Os alinhadores sao aprovados e usados no mundo todo com otimos resultados. Corrigem desde casos simples ate problemas mais complexos. A grande vantagem e que quase nao aparecem e voce pode tirar pra comer e escovar os dentes.", category: "alinhador" },
  { question: "Alinhador invisivel ou aparelho fixo, qual e melhor?", answer: "Depende muito do caso. O alinhador e mais estetico, confortavel e discreto. O aparelho fixo pode ser indicado em casos mais complexos ou quando a pessoa precisa de mais controle. O(a) Dr(a) avalia qual e o melhor pra voce na consulta.", category: "alinhador" },
  { question: "Quanto tempo leva o tratamento com alinhador?", answer: "Varia bastante de caso pra caso — pode ser de 6 meses a 2 anos. Casos mais simples costumam ser mais rapidos. O(a) Dr(a) consegue dar uma estimativa melhor depois da avaliacao.", category: "alinhador" },
  { question: "Alinhador doi?", answer: "No inicio pode ter uma pressao leve quando voce muda pra um novo alinhador, que e o dente se movendo. Mas e bem diferente do aparelho fixo, a maioria das pessoas acha muito mais confortavel.", category: "alinhador" },
];

const DENTAL_OBJECTION_SEED: Array<{ category: string; objection: string; counterArgument: string }> = [
  { category: "preco", objection: "lente de ceramica e muito cara", counterArgument: "Entendo! O investimento e maior, mas a ceramica dura 10 a 15 anos e o resultado e praticamente permanente — acaba saindo bem mais em conta no longo prazo. Alem disso, o(a) Dr(a) tem formas de parcelamento que facilitam bastante. Vale muito a pena pelo sorriso que voce vai ter." },
  { category: "preco", objection: "lente de resina e muito cara", counterArgument: "Entendo a preocupacao! A resina e justamente a opcao mais acessivel pra transformar o sorriso, e o resultado e lindo. Trabalhamos com parcelamento pra facilitar. O(a) Dr(a) faz uma avaliacao sem compromisso pra voce ver o que ficaria melhor no seu caso." },
  { category: "medo", objection: "tenho medo do botox", counterArgument: "Faz todo sentido ter essa duvida! O botox e um dos procedimentos mais seguros e realizados no mundo quando feito por profissional qualificado. A aplicacao e rapidinha e a maioria das pessoas fica surpresa como e tranquilo. O(a) Dr(a) vai tirar todas as suas duvidas antes de qualquer coisa." },
  { category: "medo", objection: "medo de ficar com cara de plastico com preenchimento", counterArgument: "Esse medo e super comum! Quando feito com tecnica certa e quantidade adequada, o resultado e muito natural — a ideia e realcar, nao transformar. O(a) Dr(a) trabalha sempre com naturalidade e personaliza pro seu rosto. Voce vai amar o resultado." },
  { category: "confianca", objection: "alinhador funciona mesmo", counterArgument: "Funciona sim! Os alinhadores sao aprovados e tem resultados comprovados em milhoes de pacientes no mundo todo. O segredo e usar as horas recomendadas por dia. O(a) Dr(a) avalia seu caso e ja te mostra uma simulacao do resultado esperado. Muita gente fica surpresa como e eficaz e discreto." },
  { category: "confianca", objection: "prefiro aparelho fixo", counterArgument: "Otimo que voce tem essa referencia! O aparelho fixo e otimo mesmo. Mas o alinhador ja consegue tratar a maioria dos casos com a vantagem de ser invisivel e mais confortavel. O(a) Dr(a) vai avaliar qual e o mais indicado pro seu caso e explicar as diferencas. Voce decide com mais seguranca depois." },
  { category: "medo", objection: "tenho medo de fazer implante", counterArgument: "Entendo completamente! Mas saiba que e uma das cirurgias mais tranquilas que existem na odontologia, toda feita com anestesia. A maioria dos pacientes fica surpresa como a recuperacao e rapida. O(a) Dr(a) vai te explicar cada passo e voce se sente muito mais seguro(a) depois da avaliacao." },
  { category: "tempo", objection: "implante demora muito", counterArgument: "O processo leva alguns meses pro implante se integrar ao osso, mas voce ja sai com um dente provisorio bonito logo apos a cirurgia. Ninguem vai notar que voce fez nada. E o resultado final e definitivo — vale muito o investimento de tempo." },
  { category: "necessidade", objection: "nao sei se clareamento vai fazer diferenca nos meus dentes", counterArgument: "Entendo a duvida! O resultado depende do tom inicial dos dentes, mas quase todo mundo percebe uma diferenca visivel. O(a) Dr(a) consegue te dar uma estimativa real na avaliacao. Muitas pessoas ficam impressionadas com quantos tons clareia — e transforma o sorriso." },
  { category: "medo", objection: "tenho medo de sensibilidade no clareamento", counterArgument: "E um medo muito comum! Pode ter uma sensibilidade leve durante o tratamento, mas passa rapido e e bem toleravel. O(a) Dr(a) usa produtos que minimizam esse desconforto e adapta o protocolo pro seu caso. A grande maioria das pessoas termina sem nenhuma intercorrencia." },
  { category: "financeiro", objection: "nao tenho dinheiro agora para fazer o procedimento", counterArgument: "Entendo! A clinica tem opcoes de parcelamento justamente pra facilitar o acesso ao tratamento. O(a) Dr(a) pode montar um plano que caiba no seu orcamento. Que tal fazer a avaliacao primeiro — assim voce ja sabe exatamente o que precisa e como pode encaixar no seu planejamento?" },
  { category: "tempo", objection: "vou pensar mais um pouco antes de decidir", counterArgument: "Claro, faz sentido! So fica de olho porque a agenda do(a) Dr(a) costuma ficar bastante disputada. Que tal a gente ja reservar uma avaliacao sem compromisso? Ai voce conhece a clinica, tira todas as duvidas e decide com calma. Nao custa nada." },
];

async function seedDentalKnowledgeBase() {
  const tenants = await db.query.tenantsTable.findMany({ columns: { id: true } });
  if (!tenants.length) {
    console.log("seedDentalKnowledgeBase: nenhum tenant encontrado, pulando.");
    return;
  }

  for (const tenant of tenants) {
    let kbInserted = 0;
    for (const entry of DENTAL_KNOWLEDGE_SEED) {
      const exists = await db.query.aiKnowledgeBaseTable.findFirst({
        where: and(
          eq(aiKnowledgeBaseTable.tenantId, tenant.id),
          eq(aiKnowledgeBaseTable.question, entry.question)
        ),
        columns: { id: true },
      });
      if (!exists) {
        await db.insert(aiKnowledgeBaseTable).values({
          tenantId: tenant.id,
          question: entry.question,
          answer: entry.answer,
          category: entry.category,
          frequency: 10,
        });
        kbInserted++;
      }
    }
    if (kbInserted > 0) {
      console.log(`  tenant=${tenant.id}: ${kbInserted} conhecimentos inseridos`);
    }

    let objInserted = 0;
    for (const entry of DENTAL_OBJECTION_SEED) {
      const exists = await db.query.aiObjectionPatternsTable.findFirst({
        where: and(
          eq(aiObjectionPatternsTable.tenantId, tenant.id),
          eq(aiObjectionPatternsTable.objection, entry.objection)
        ),
        columns: { id: true },
      });
      if (!exists) {
        await db.insert(aiObjectionPatternsTable).values({
          tenantId: tenant.id,
          category: entry.category,
          objection: entry.objection,
          counterArgument: entry.counterArgument,
          successCount: 5,
          totalCount: 8,
        });
        objInserted++;
      }
    }
    if (objInserted > 0) {
      console.log(`  tenant=${tenant.id}: ${objInserted} objeções inseridas`);
    }
  }
}

async function main() {
  console.log("migrate-data: iniciando migrações de dados...");

  console.log("\n[1/3] migrateProfessionals");
  await migrateProfessionals();

  console.log("\n[2/3] ensureOwnerProfessional");
  await ensureOwnerProfessional();

  console.log("\n[3/3] seedDentalKnowledgeBase");
  await seedDentalKnowledgeBase();

  await pool.end();
  console.log("\nmigrate-data: concluído.");
}

main().catch((err) => {
  console.error("migrate-data falhou:", err);
  process.exit(1);
});
