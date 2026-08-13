# Recargas · integração com o TakeatOS

Como a fila de recargas de celular é alimentada, para quem for mexer nessa área depois.

## O problema que isso resolve

Recarga se pedia por mensagem no WhatsApp. O Financeiro não tinha fila, nem histórico por
colaborador, nem como saber quem já havia sido atendido — e só cabem ~40 recargas por dia.

Agora o colaborador clica em **Solicitar recarga** no TakeatOS e o pedido chega aqui como
card, na ordem em que foi feito.

## O caminho

```
TakeatOS                                    Hub (este repo)
────────                                    ───────────────
cadastra número  ──linha.sincronizada──▶    recargas_celulares
clica Solicitar  ──recarga.solicitada──▶    recargas_celulares_solicitacoes
marca Concluída  ◀────── callback ──────    recargas-concluir
```

## Tabelas

| Tabela | Papel |
| --- | --- |
| `recargas_celulares` | Cadastro das linhas. Ganhou `origem`, `origem_id` e `solicitado_em`. |
| `recargas_celulares_solicitacoes` | A fila de pedidos. Um pedido nasce e se conclui; a linha existe o ano inteiro. |
| `recargas_celulares_historico` | Cada recarga efetivada, com o titular congelado no momento. |
| `recargas_celulares_titulares` | Quem esteve com o chip, em períodos. Alimentada por trigger. |

As duas últimas respondem perguntas diferentes: recarga é **evento pontual**, titularidade
é **intervalo contínuo**. Um chip passa meses com o mesmo dono sem recarga, e troca de mão
entre duas recargas — uma tabela só não responderia as duas.

## Edge Functions

### `recargas-takeatos-webhook`

Recebe os dois eventos. Roda com **`verify_jwt = false`** — não é descuido: quem prova a
origem é a **assinatura HMAC-SHA256 do corpo**, conferida contra `RECARGAS_WEBHOOK_SECRET`.
Exigir JWT obrigaria o TakeatOS a carregar também a anon key daqui, sem ganho nenhum.

Duas regras que não podem ser quebradas ao mexer nela:

- **Validar sobre o corpo BRUTO.** Reserializar o JSON muda bytes e a assinatura para de bater.
- **Ser idempotente.** O TakeatOS reenvia sozinho o que não entra (cron de 15 min). A chave é
  `(origem, origem_id)` nas duas tabelas — reenvio atualiza, nunca duplica.

Dois cuidados embutidos, fáceis de desfazer sem perceber:

- O `status` da solicitação fica **fora** do upsert. Se o Financeiro já concluiu, um reenvio
  não pode reabrir o card.
- A `situacao` do chip só é definida na **criação**. Ela é gerida aqui, e um reenvio não pode
  reativar um chip que o Financeiro suspendeu.

> O índice de `(origem, origem_id)` **não pode ser parcial**. O Postgres só casa um
> `ON CONFLICT` com índice parcial se a instrução repetir o mesmo predicado, e o upsert do
> supabase-js não emite isso — o webhook passa a responder 500.

### `recargas-concluir`

Marca a solicitação como concluída e avisa o TakeatOS. Sai daqui, e não do navegador, porque
o segredo do callback não pode viver no front. Falha de rede vira estado
(`callback_status`, `callback_erro`), não silêncio.

## Secrets

| Nome | Par no TakeatOS |
| --- | --- |
| `RECARGAS_WEBHOOK_SECRET` | `FINANCEIRO_WEBHOOK_SECRET` |
| `FINANCEIRO_CALLBACK_SECRET` | mesmo nome |

Os valores têm de bater dos dois lados. Se não baterem, o webhook responde **401** e a
integração fica muda — sem erro visível na tela de ninguém.

## Diagnóstico

```sql
-- conclusões que não voltaram ao TakeatOS
select id, colaborador, status, callback_status, callback_erro, callback_em
from recargas_celulares_solicitacoes
where callback_status = 'failed';
```

| Sintoma | Causa provável |
| --- | --- |
| `401 assinatura inválida` | Os segredos não batem entre os dois sistemas |
| Card duplicado | Não deveria ocorrer — a chave é `(origem, origem_id)` |
| Conclusão não volta | `FINANCEIRO_CALLBACK_SECRET` diferente, ou a rota do TakeatOS fora do ar |

Nada se perde por falha de rede: o pedido é gravado no TakeatOS **antes** do despacho, e o
cron reenvia por até 8 tentativas.
