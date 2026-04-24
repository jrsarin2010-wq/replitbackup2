# Changelog do Tutor IA

Lista cronológica de melhorias do OdontoFlow visíveis ao dentista. As entradas mais recentes (até 10) são injetadas no system prompt do Tutor IA como bloco "NOVIDADES RECENTES", para que o Tutor consiga responder corretamente quando o dentista perguntar "o que mudou?" ou "tem novidade?".

Formato de cada entrada:

```
## YYYY-MM-DD — Título curto
Descrição em 1-3 linhas, em pt-BR, em linguagem para o dentista (não técnica).
```

As entradas devem aparecer **da mais recente para a mais antiga** (topo = mais nova).

---

## 2026-04-17 — Título Dr./Dra. inferido automaticamente pelo nome
Quando o gênero do titular não está configurado, a IA agora tenta identificar pelo nome: terminações como "-in", "-im", "-inho", "-on" e "-o" são reconhecidas como masculinas (→ "Dr."), terminações "-inha" e "-a" como femininas (→ "Dra."). Nomes realmente ambíguos continuam com "Dr(a).". Exemplo: "Robertin" passa a ser tratado como "Dr. Robertin".

## 2026-04-17 — Trava de agenda durante triagem plano/particular
Quando sua clínica aceita convênio, a IA agora não consegue mais oferecer horários para um lead novo antes de perguntar "vai usar plano ou é particular?". A agenda é fisicamente removida do prompt enquanto a triagem não for respondida — assim a IA não tem como inventar horário ou pular a pergunta. Assim que o lead responde "particular" ou cita o nome do plano, os 2 horários voltam normalmente.

## 2026-04-17 — Tutor IA chama o titular como "Dr.", "Dra." ou "Dr(a)." conforme o gênero
Em Configurações → Profissional Titular existe um campo "Gênero do titular" (Masculino / Feminino / Prefiro não informar). O Tutor IA usa essa informação para se dirigir ao titular corretamente em todas as respostas: "Dr." para masculino, "Dra." para feminino e "Dr(a)." quando o gênero não estiver configurado.

## 2026-04-17 — Tutor IA agora cobre pagamento, técnico e primeiros passos
Quando você perguntar sobre planos, créditos de áudio, profissionais extras, PIX ou problemas técnicos (WhatsApp, Telegram, controle manual, performance), o Tutor IA responde com os valores e configurações oficiais da sua conta — sem mais respostas genéricas.

## 2026-04-15 — Triagem plano/particular antes do SPIN
A IA agora pergunta primeiro se você atende particular ou por convênio antes de aplicar técnicas de venda (SPIN). Isso evita que pacientes de convênio recebam mensagens de vendas indevidas.

## 2026-04-10 — Ligações por IA via Vapi.ai
Você pode ativar ligações telefônicas por voz para hot leads, confirmação de consulta e recuperação de pacientes. Disponível no plano Pro.

## 2026-04-05 — Notificações de assinatura via Telegram e e-mail
Você recebe alertas 7 dias e 3 dias antes do vencimento, no dia do vencimento, e na suspensão e reativação automáticas da conta.

## 2026-04-01 — Cobrança via PIX no WhatsApp
Cada profissional pode cadastrar uma chave PIX. A IA informa a chave ao paciente e analisa o comprovante via foto. Status no dashboard: pendente, confirmado pela IA ou confirmado manualmente.

## 2026-03-25 — Aviso discreto sobre limitações da IA
Pequenos avisos em telas relevantes lembrando que a IA é um apoio e não substitui o julgamento clínico.

## 2026-03-20 — Plano por R$ 197 (3 meses promocionais)
Promoção de lançamento: R$ 97/mês nos 3 primeiros meses do plano Básico, R$ 197 depois. Plano Essencial sai por R$ 197/mês nos 3 primeiros meses (depois R$ 297).

## 2026-03-15 — Foto de perfil do dentista
Cada profissional pode subir uma foto de perfil que aparece nas mensagens do WhatsApp.

## 2026-03-10 — Base de conhecimento odontológico para a IA
A IA agora responde 21 perguntas frequentes de pacientes com respostas validadas e contorna 12 objeções comerciais comuns.

## 2026-03-05 — Vídeo e áudio de boas-vindas para novos leads
Cada profissional pode configurar um vídeo e um áudio que são enviados automaticamente quando o lead confirma a primeira consulta.

## 2026-03-01 — Card do Instagram no WhatsApp
Quando a IA menciona o Instagram do profissional, ela envia um card com thumbnail 300×300, gerando mais confiança e cliques.

## 2026-02-25 — Parcelamento e boleto
Novas opções de pagamento: parcelamento e boleto, configuráveis em Configurações → Pagamento.
