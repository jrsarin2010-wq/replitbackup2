# Prompt — Simulação E2E Clínica Multi-Especialidade (v2)

## Objetivo
Criar um novo arquivo de simulação E2E que testa o fluxo completo de atendimento de uma
clínica odontológica realista com múltiplos dentistas, especialidades, consultas com valores
diferentes, convênio em dias específicos e PIX antecipado em alguns dentistas.
A Replit deve rodar a simulação e gerar um relatório de diagnóstico completo.

## Regra de preços — NOVA (aplicar em todos os cenários)
A IA fala APENAS o valor da consulta de cada dentista.
NUNCA fala preço de procedimento (clareamento, implante, aparelho, limpeza etc).
Se perguntarem preço de procedimento → "Para valores de procedimentos específicos,
nossa equipe informa após a avaliação presencial."

---

## A Clínica de Teste — "Clínica OdontoVida"

### Configurações gerais
```
Nome: Clínica OdontoVida
IA: Sofia
Aceita convênio: SIM (parcialmente — depende do dentista)
WhatsApp: MockProvider (sem WhatsApp real)
Plano: professional
```

### Profissional 1 — Dra. Ana Beatriz (Clínico Geral + Estética)
```
Especialidades: Clínico Geral, Estética Dental
Atende convênio: NÃO (somente particular)
consultationFee: R$150
chargesConsultation: true
pixEnabled: true
pixMode: "required"  ← PIX OBRIGATÓRIO antes da consulta
Horários:
  - Segunda, Quarta, Sexta: 08:00–12:00 e 14:00–18:00
  - Sábado: 08:00–12:00
Procedimentos cadastrados (sem preço visível para IA):
  - Limpeza Dental, Clareamento Dental, Restauração
```

### Profissional 2 — Dr. Marcos Oliveira (Ortodontia)
```
Especialidades: Ortodontia, Aparelho Dental
Atende convênio: SIM — apenas Segunda e Quarta
consultationFee: R$200
chargesConsultation: true
pixEnabled: false  ← pagamento presencial
Horários:
  - Segunda, Quarta: 09:00–17:00 (convênio e particular)
  - Quinta, Sexta: 13:00–19:00 (somente particular)
Procedimentos cadastrados (sem preço visível para IA):
  - Aparelho Metálico, Aparelho Estético, Manutenção Aparelho
```

### Profissional 3 — Dr. Roberto Santos (Implantodontia)
```
Especialidades: Implante Dental, Cirurgia
Atende convênio: NÃO
consultationFee: R$300
chargesConsultation: true
pixEnabled: true
pixMode: "optional"  ← PIX aceito mas opcional
Horários:
  - Terça, Quinta: 08:00–17:00
Procedimentos cadastrados (sem preço visível para IA):
  - Implante Unitário, Implante com Enxerto, Extração Cirúrgica
```

---

## Setup da clínica de teste

```typescript
// Criar 1 tenant com 3 profissionais via banco direto
// Seguir exatamente o padrão do setup() existente no e2e-test.ts

const scheduleAnaBeatriz = JSON.stringify([
  { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
  { dayOfWeek: 1, startTime: "14:00", endTime: "18:00" },
  { dayOfWeek: 3, startTime: "08:00", endTime: "12:00" },
  { dayOfWeek: 3, startTime: "14:00", endTime: "18:00" },
  { dayOfWeek: 5, startTime: "08:00", endTime: "12:00" },
  { dayOfWeek: 5, startTime: "14:00", endTime: "18:00" },
  { dayOfWeek: 6, startTime: "08:00", endTime: "12:00" },
]);

const scheduleMarcos = JSON.stringify([
  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", acceptsInsurance: true },
  { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", acceptsInsurance: true },
  { dayOfWeek: 4, startTime: "13:00", endTime: "19:00", acceptsInsurance: false },
  { dayOfWeek: 5, startTime: "13:00", endTime: "19:00", acceptsInsurance: false },
]);

const scheduleRoberto = JSON.stringify([
  { dayOfWeek: 2, startTime: "08:00", endTime: "17:00" },
  { dayOfWeek: 4, startTime: "08:00", endTime: "17:00" },
]);

// Inserir profissionais com os campos corretos:
// consultationFee, chargesConsultation, pixEnabled, pixMode, acceptsInsurance
```

---

## Os 20 cenários de teste

### BLOCO 1 — Lead Particular com PIX obrigatório (Dra. Ana Beatriz)

**Cenário 1 — Primeiro contato, apresentação correta**
```
Lead: "oi"
Esperado: IA se apresenta como Sofia, menciona Clínica OdontoVida,
          pergunta como pode ajudar
          NÃO menciona preços nem procedimentos no primeiro contato
```

**Cenário 2 — Lead quer clareamento, IA não fala preço do procedimento**
```
Lead: "quero fazer clareamento dental"
Esperado: IA menciona Dra. Ana Beatriz, oferece horários disponíveis,
          informa valor da CONSULTA R$150 e que pagamento é via PIX antecipado
          NÃO deve mencionar preço do clareamento
          NÃO deve inventar valor do procedimento
```

**Cenário 3 — Lead pergunta diretamente preço do clareamento**
```
Lead: "quanto custa o clareamento?"
Esperado: IA responde que valores de procedimentos são informados
          após avaliação presencial, menciona que a CONSULTA custa R$150
          e convida para agendar
          NUNCA inventa ou menciona R$1.200 ou qualquer valor de procedimento
```

**Cenário 4 — Lead aceita e quer agendar, IA informa PIX obrigatório**
```
Lead: "tudo bem, quero marcar uma consulta com a Dra. Ana na quarta às 14h"
Esperado: IA confirma disponibilidade, informa PROATIVAMENTE:
          "A consulta custa R$150 e o pagamento é feito com antecedência
          via PIX antes do atendimento"
          Agendamento criado no banco com professionalId da Dra. Ana
```

**Cenário 5 — Lead pergunta sobre PIX**
```
Lead: "preciso pagar antes mesmo?"
Esperado: IA confirma que sim, o pagamento via PIX é necessário
          antes da consulta com a Dra. Ana
          NÃO deve tratar como opcional (pixMode = required)
```

### BLOCO 2 — Lead Convênio (Dr. Marcos Oliveira)

**Cenário 6 — Lead com convênio, IA não cobra consulta via plano**
```
Lead: "bom dia, uso plano odontológico, quero fazer aparelho"
Esperado: IA detecta convênio, menciona Dr. Marcos,
          informa que atende convênio Segunda e Quarta
          NÃO menciona valor da consulta (convênio cobre)
          NÃO menciona preço do aparelho
```

**Cenário 7 — Lead particular quer ortodontia, IA informa consulta**
```
Lead: "quero fazer aparelho, pago particular"
Esperado: IA menciona Dr. Marcos, informa consulta R$200,
          NÃO menciona preço do aparelho
          Oferece horários (Segunda, Quarta, Quinta, Sexta)
          Dr. Marcos não tem PIX — sem menção a pagamento antecipado
```

**Cenário 8 — Lead convênio tenta marcar quinta (dia sem convênio)**
```
Lead: "uso plano, quero aparelho, pode ser quinta?"
Esperado: IA informa que Dr. Marcos atende convênio apenas
          Segunda e Quarta, oferece esses dias como alternativa
          NÃO deve marcar quinta como convênio
          NÃO menciona preço de aparelho
```

**Cenário 9 — Lead convênio, especialidade sem cobertura (implante)**
```
Lead: "tenho plano odontológico, quero fazer implante"
Esperado: IA informa que implantes não são cobertos pelo convênio,
          menciona Dr. Roberto, informa consulta R$300 (particular)
          NÃO menciona preço do implante
```

### BLOCO 3 — Lead Implante com PIX opcional (Dr. Roberto Santos)

**Cenário 10 — Primeiro contato para implante**
```
Lead: "perdi um dente, quero colocar implante"
Esperado: IA menciona Dr. Roberto Santos, implantodontista,
          informa consulta R$300, disponibilidade Terça e Quinta
          NÃO menciona preço do implante
          Menciona que aceita PIX (opcional, não obrigatório)
```

**Cenário 11 — Lead pergunta preço do implante diretamente**
```
Lead: "quanto custa o implante?"
Esperado: IA responde que valores são informados após avaliação,
          menciona que a consulta de avaliação custa R$300
          NUNCA inventa ou menciona R$3.500 ou qualquer valor
```

**Cenário 12 — Lead com medo de cirurgia**
```
Lead: "preciso arrancar um siso mas tenho muito medo"
Esperado: IA usa empatia, menciona que Dr. Roberto é especialista,
          informa consulta R$300 para avaliação
          NÃO menciona preço da extração (R$800)
          NÃO minimiza o medo
```

**Cenário 13 — Agendamento com Dr. Roberto, PIX opcional**
```
Lead: "quero marcar a consulta de avaliação, terça às 9h"
Esperado: Agendamento criado com Dr. Roberto, Terça 09:00
          IA menciona que aceita PIX mas não é obrigatório
          (pixMode = optional — tom diferente do obrigatório)
```

### BLOCO 4 — Pacientes existentes

**Cenário 14 — Paciente remarca consulta**
```
[Criar paciente com consulta agendada para Dra. Ana, quarta 10h]
Paciente: "preciso remarcar minha consulta de quarta"
Esperado: IA reconhece o paciente, NÃO faz triagem de convênio,
          oferece outros horários com Dra. Ana,
          remarca no banco, lembra do PIX obrigatório
```

**Cenário 15 — Paciente cancela consulta**
```
Paciente: "não vou conseguir ir amanhã"
Esperado: IA cancela a consulta, status = "cancelled" no banco,
          confirmação de cancelamento enviada
```

**Cenário 16 — Paciente pergunta horário da consulta**
```
Paciente: "que horas é minha consulta amanhã?"
Esperado: IA informa o horário correto do banco,
          NÃO inventa informação
```

### BLOCO 5 — Follow-ups automáticos

**Cenário 17 — Lembrete 24h com nome do dentista**
```
[Criar consulta com data = amanhã, Dra. Ana]
[Rodar processFollowUps()]
Esperado: Mensagem de lembrete enviada com nome da paciente,
          horário, nome da Dra. Ana
          NÃO deve enviar para consultas canceladas
```

**Cenário 18 — Lembrete não enviado para consulta cancelada**
```
[Criar consulta amanhã, status = cancelled]
[Rodar processFollowUps()]
Esperado: NENHUMA mensagem enviada para esse número
```

### BLOCO 6 — Quota de conversas

**Cenário 19 — Quota esgotada bloqueia e mensagem amigável**
```
[Forçar no banco: monthlyConversationsUsed = 800, rechargeBalance = 0]
[Lead novo envia mensagem]
Esperado: IA NÃO responde,
          lead recebe "em breve um atendente entrará em contato",
          conversa marcada como quota_blocked no banco
```

**Cenário 20 — IA não oferece horário já ocupado**
```
[Criar agendamento: Dra. Ana, quarta 14:00]
Lead: "quero marcar consulta na quarta às 14h com a Dra. Ana"
Esperado: IA informa que esse horário está ocupado,
          oferece próximo slot disponível
          NÃO confirma agendamento em horário cheio
```

---

## Verificações específicas de preço em cada cenário

Para cada cenário onde a IA menciona algum valor, o teste deve verificar:

```typescript
// Helper a criar no arquivo de teste:
function assertNoProcedurePrice(aiResponse: string): void {
  // Lista de valores de procedimento que NUNCA devem aparecer
  const forbiddenPrices = [
    "1.200", "1200",   // clareamento
    "2.800", "2800",   // aparelho metálico
    "4.500", "4500",   // aparelho estético
    "3.500", "3500",   // implante
    "5.500", "5500",   // implante com enxerto
    "800",             // extração (cuidado — R$800 da extração vs consultas)
    "250",             // limpeza
    "350",             // restauração
    "180",             // manutenção aparelho
  ];
  for (const price of forbiddenPrices) {
    assert(
      !aiResponse.includes(price),
      `IA mencionou preço proibido de procedimento: R$${price}`
    );
  }
}

// Valores PERMITIDOS que devem aparecer nos cenários corretos:
// R$150 → consulta Dra. Ana
// R$200 → consulta Dr. Marcos (particular)
// R$300 → consulta Dr. Roberto
```

---

## Formato do relatório de diagnóstico

```
╔══════════════════════════════════════════════════════════════════╗
║        OdontoFlow — Simulação Clínica Multi-Especialidade v2     ║
╚══════════════════════════════════════════════════════════════════╝

🏥 Clínica OdontoVida
👩‍⚕️ Dra. Ana Beatriz (PIX obrigatório R$150)
🦷 Dr. Marcos Oliveira (sem PIX, R$200 particular / convênio Seg+Qua)
🔬 Dr. Roberto Santos (PIX opcional, R$300)

────────────────────────────────────────────────────────────────────
BLOCO 1 — Lead Particular com PIX obrigatório (Dra. Ana)
  ✅ PASS: Cenário 1 — Apresentação sem preços (1.2s)
  ✅ PASS: Cenário 2 — Clareamento: consulta R$150 + PIX, sem preço proc. (2.8s)
  ✅ PASS: Cenário 3 — Pergunta preço clareamento: redirecionou corretamente (1.9s)
  ✅ PASS: Cenário 4 — Agendamento com PIX obrigatório informado (3.1s)
  ✅ PASS: Cenário 5 — Confirmação PIX obrigatório (1.4s)

BLOCO 2 — Lead Convênio (Dr. Marcos)
  ...

BLOCO 3 — Lead Implante (Dr. Roberto)
  ...

BLOCO 4 — Pacientes
  ...

BLOCO 5 — Follow-ups
  ...

BLOCO 6 — Quota e horários
  ...

════════════════════════════════════════════════════════════════════
                    DIAGNÓSTICO FINAL
════════════════════════════════════════════════════════════════════

Total: 20  |  ✅ Pass: ?  |  ❌ Fail: ?  |  Taxa: ?%

🔴 FALHAS CRÍTICAS: (listar com input real + resposta real da IA + esperado)
⚠️ ALERTAS: (falhas parciais)
📊 PERFORMANCE: tempo médio, mais lento, mais rápido
💡 RECOMENDAÇÕES: o que precisa corrigir no código
```

Salvar em `test-results/e2e-clinica-completa.json`.

---

## Como rodar

```bash
# Primeiro — confirmar base saudável
pnpm --filter @workspace/api-server run test

# Rodar a simulação completa
pnpm --filter @workspace/api-server exec tsx src/tests/e2e-clinica-completa.ts

# Ver resumo do relatório
cat test-results/e2e-clinica-completa.json | jq '.summary'
```

---

## Instruções para a Replit

1. Seguir EXATAMENTE o padrão do `e2e-test.ts` existente

2. Setup deve criar o tenant e os 3 profissionais via banco direto com
   todos os campos: `consultationFee`, `chargesConsultation`, `pixEnabled`,
   `pixMode`, `acceptsInsurance`, `scheduleConfig`

3. Teardown apaga TUDO do tenant de teste incluindo `dental_conversation_quotas`

4. Usar o helper `assertNoProcedurePrice()` em TODOS os cenários onde
   a IA responde sobre procedimentos ou preços

5. Nos cenários de PIX obrigatório (Dra. Ana), verificar se a palavra
   "PIX" ou "pix" aparece na resposta ao agendar

6. Nos cenários de convênio, verificar campo `paymentType` no banco

7. Após criar o arquivo, rodar imediatamente e reportar o diagnóstico
   completo com as respostas reais da IA para cada cenário
