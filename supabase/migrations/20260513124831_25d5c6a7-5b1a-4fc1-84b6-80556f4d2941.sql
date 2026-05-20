
create table public.workspace_pages (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.workspace_pages(id) on delete cascade,
  title text not null default 'Sem título',
  icon text default '📄',
  cover_url text,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  archived boolean not null default false,
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  last_edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_pages_parent_idx on public.workspace_pages(parent_id);
create index workspace_pages_updated_idx on public.workspace_pages(updated_at desc);

alter table public.workspace_pages enable row level security;

create policy "auth read workspace_pages"
  on public.workspace_pages for select
  to authenticated using (true);

create policy "auth insert workspace_pages"
  on public.workspace_pages for insert
  to authenticated with check (true);

create policy "auth update workspace_pages"
  on public.workspace_pages for update
  to authenticated using (true) with check (true);

create policy "auth delete workspace_pages"
  on public.workspace_pages for delete
  to authenticated using (true);

create trigger workspace_pages_updated_at
  before update on public.workspace_pages
  for each row execute function public.update_updated_at_column();

insert into storage.buckets (id, name, public)
values ('workspace-assets', 'workspace-assets', true)
on conflict (id) do nothing;

create policy "auth read workspace-assets"
  on storage.objects for select
  to authenticated using (bucket_id = 'workspace-assets');

create policy "public read workspace-assets"
  on storage.objects for select
  to anon using (bucket_id = 'workspace-assets');

create policy "auth upload workspace-assets"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'workspace-assets');

create policy "auth update workspace-assets"
  on storage.objects for update
  to authenticated using (bucket_id = 'workspace-assets');

create policy "auth delete workspace-assets"
  on storage.objects for delete
  to authenticated using (bucket_id = 'workspace-assets');
