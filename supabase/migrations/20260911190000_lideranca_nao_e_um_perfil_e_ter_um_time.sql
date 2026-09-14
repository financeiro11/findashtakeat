-- LIDERANÇA NÃO É UM PERFIL, É TER UM TIME.
--
-- Em 10/09/2026 a folha ganhou o segundo degrau: `remuneracao_time` abre o
-- painel `/operacional/remuneracao` recortado nos setores da ficha da conta. A
-- capacidade foi ligada em UM perfil — `lideranca` —, e ali estava o engano:
-- perfil descreve QUE TELAS a pessoa opera, não se ela lidera gente.
--
-- O Head de RPA (Victor Brittes) tem o perfil `automacao` porque o trabalho dele
-- É o maquinário: crons, integrações, o catálogo. E lidera as quatro pessoas do
-- setor RPA. Resultado: o único Head da empresa que não via a própria folha era
-- justamente o que cuida das automações — o mesmo formato do bug de 10/09, em
-- que a Head de RH era a única pessoa do Hub sem acesso à folha porque o cargo
-- dela não estava numa lista.
--
-- CONCEDER A CAPACIDADE AO PERFIL NÃO ABRE NADA SOZINHO. Quem recorta é
-- `profiles.setores_folha`, da CONTA, e vazio devolve zero pessoas
-- (`remuneracao_painel()` filtra por `= any(v_setores)`). São duas chaves, e
-- esta migration vira só a primeira para o perfil e a segunda para uma conta.
-- A outra conta `automacao` (`rpa.takeat@gmail.com`) ganha a rota e continua
-- sem ver ninguém, de propósito: ela é conta de operação, não de liderança.
--
-- As outras cinco telas de folha (Colaboradores, Variável, Reembolsos,
-- Proporcionais, Rescisões) seguem exigindo `remuneracao` — a empresa inteira.
-- Espelha `PERFIS.automacao` em src/lib/modules.ts, que é o padrão de quem não
-- tem linha em `acesso_perfil`.

-- ─────────────────────── 1. A capacidade no perfil ───────────────────────

-- Idempotente pelo `not (... = any(...))`: rodar de novo não duplica o item, e
-- não desfaz o que alguém tenha editado pela tela de Perfis de acesso.
update public.acesso_perfil
   set capacidades = capacidades || array['remuneracao_time'],
       atualizado_em = now()
 where perfil = 'automacao'
   and not ('remuneracao_time' = any(capacidades));

-- ─────────────────────── 2. O time do Head de RPA ───────────────────────

-- Por E-MAIL, como todo o backfill de acesso deste módulo: `cargo` é texto livre
-- e é justamente o campo que não resolve. O setor vem do Portal RH e se escreve
-- 'RPA' — não 'Automações', que é o nome da CATEGORIA da DRE
-- ('3.1.1.14 Pessoal - Automações') e do grupo de recargas.
do $$
declare
  v_linhas integer;
begin
  update public.profiles
     set setores_folha = array['RPA']
   where lower(btrim(email)) = 'brittes.takeat@gmail.com'
     and setores_folha is distinct from array['RPA'];
  get diagnostics v_linhas = row_count;

  -- Zero linhas é ambíguo (já estava certo, ou a conta não existe). Só o
  -- segundo caso é problema, e é ele que se confere.
  if not exists (select 1 from public.profiles
                  where lower(btrim(email)) = 'brittes.takeat@gmail.com') then
    raise exception 'a conta do Head de RPA (brittes.takeat@gmail.com) não existe em profiles';
  end if;
  raise notice 'setores_folha do Head de RPA: % linha(s) alterada(s)', v_linhas;
end $$;

-- ─────────────────────── 3. Conferência ───────────────────────

/* Um recorte que devolve a empresa inteira, ou ninguém, é o erro que só aparece
   quando o líder abre a tela e não entende o que vê. Falhar aqui é mais barato.
   A conta é feita com o MESMO `coalesce(r.setor, p.setor)` de
   `remuneracao_painel()` — conferir com outra regra não conferiria nada. */
do $$
declare
  v_rpa    integer;
  v_todos  integer;
  v_outros integer;
begin
  select count(distinct p.id) into v_rpa
    from public.remuneracao_pessoa p
    left join public.rh_colaboradores r on r.codigo = p.codigo_rh
   where coalesce(r.setor, p.setor) = any(array['RPA']);

  select count(*) into v_todos from public.remuneracao_pessoa;

  if v_rpa = 0 then
    raise exception 'o recorte do Head de RPA não achou ninguém — o setor no Portal RH não se chama RPA?';
  end if;
  if v_rpa >= v_todos then
    raise exception 'o recorte do Head de RPA devolveu a folha inteira (% de %)', v_rpa, v_todos;
  end if;

  -- A capacidade chegou ao perfil…
  if not exists (
    select 1 from public.acesso_perfil
     where perfil = 'automacao' and 'remuneracao_time' = any(capacidades)
  ) then
    raise exception 'o perfil automacao continua sem remuneracao_time';
  end if;

  -- …e não veio sozinha com um time de brinde para as outras contas dele.
  select count(*) into v_outros
    from public.profiles
   where perfil = 'automacao'
     and lower(btrim(email)) <> 'brittes.takeat@gmail.com'
     and coalesce(array_length(setores_folha, 1), 0) > 0;
  if v_outros > 0 then
    raise exception '% conta(s) automacao fora do Head de RPA ficaram com time marcado', v_outros;
  end if;

  raise notice 'Head de RPA vê % de % pessoas da folha', v_rpa, v_todos;
end $$;
