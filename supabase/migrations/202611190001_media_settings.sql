-- Shared gallery and school logo settings for Ruang Aspirasi.
create table if not exists public.media_settings (
  id text primary key check (id = 'global'),
  school_logo_url text,
  explore_gallery_urls text[] not null default '{}',
  write_gallery_urls text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.media_settings enable row level security;

drop policy if exists "Public can read media settings" on public.media_settings;
create policy "Public can read media settings"
  on public.media_settings
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert media settings" on public.media_settings;
create policy "Admins can insert media settings"
  on public.media_settings
  for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update media settings" on public.media_settings;
create policy "Admins can update media settings"
  on public.media_settings
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select on public.media_settings to anon, authenticated;
grant insert, update on public.media_settings to authenticated;

-- Dedicated public bucket for school branding and gallery images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aspiration-media',
  'aspiration-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view aspiration media" on storage.objects;
create policy "Public can view aspiration media"
  on storage.objects
  for select
  to public
  using (bucket_id = 'aspiration-media');

drop policy if exists "Admins can upload aspiration media" on storage.objects;
create policy "Admins can upload aspiration media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'aspiration-media'
    and (select public.is_admin())
  );

drop policy if exists "Admins can update aspiration media" on storage.objects;
create policy "Admins can update aspiration media"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'aspiration-media'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'aspiration-media'
    and (select public.is_admin())
  );

drop policy if exists "Admins can delete aspiration media" on storage.objects;
create policy "Admins can delete aspiration media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'aspiration-media'
    and (select public.is_admin())
  );

-- Enable realtime updates for settings so all open devices refresh together.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'media_settings'
  ) then
    alter publication supabase_realtime add table public.media_settings;
  end if;
end;
$$;
