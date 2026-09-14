-- Quem recebe o aviso do Radar de compras por WhatsApp.
--
-- Até aqui o destinatário era uma constante na Edge Function (`AVISAR = Renan`).
-- Trocar ou acrescentar alguém exigia deploy — e o time de Facilities, que é quem
-- compra, não tinha como se colocar na lista. Agora é dado, editado na própria
-- tela do radar.
--
-- O Renan entra como semente para o comportamento não mudar no dia do deploy.

create table if not exists public.facilities_radar_destinatarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  /* 55 + DDD + número. O mesmo piso de `digitosDoTelefone` no _shared/whatsapp:
     telefone curto não dá erro na UAZAPI, entrega para OUTRA pessoa. */
  telefone text not null
    check (length(regexp_replace(telefone, '[^0-9]', '', 'g')) between 12 and 13),
  ativo boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now()
);

alter table public.facilities_radar_destinatarios enable row level security;

-- Telefone de gente não fica aberto a qualquer sessão: só quem tem Facilities.
-- `pode_ler` (STABLE, sem escrita) porque policy roda por linha.
drop policy if exists radar_destinatarios_facilities on public.facilities_radar_destinatarios;
create policy radar_destinatarios_facilities on public.facilities_radar_destinatarios
  for all to authenticated
  using (public.pode_ler('facilities'))
  with check (public.pode_ler('facilities'));

revoke all on table public.facilities_radar_destinatarios from anon, public;
grant select, insert, update, delete on table public.facilities_radar_destinatarios to authenticated;

insert into public.facilities_radar_destinatarios (nome, telefone, criado_por)
select 'Renan', '5527988643343', 'migração'
where not exists (
  select 1 from public.facilities_radar_destinatarios where telefone = '5527988643343'
);
