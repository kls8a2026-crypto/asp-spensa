-- Ruang Aspirasi SMP Negeri 1 Ungaran
-- Initial schema: profiles and aspirations
-- Apply this migration in the Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'student'
    check (role in ('student', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.aspirations (
  id uuid primary key default gen_random_uuid(),
  category text not null check (
    category in (
      'Lingkungan dan Kebersihan',
      'Pembelajaran',
      'Fasilitas Sekolah',
      'Keamanan dan Anti-Bullying',
      'Kegiatan dan Ekstrakurikuler',
      'OSIS dan Organisasi',
      'Lainnya'
    )
  ),
  message text not null check (char_length(trim(message)) between 1 and 5000),
  author text not null default 'Anonim'
    check (char_length(author) <= 80),
  created_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  admin_reply text,
  admin_replied_at timestamptz
);

-- Create a non-admin profile automatically for each new Auth user.
-- Promote the intended administrator manually in the SQL Editor.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'student')
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Security-definer helper avoids recursive profiles RLS checks.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.aspirations enable row level security;

-- Profiles: signed-in users can read only their own profile.
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- Aspirations: everyone can read published items; admins can read all.
drop policy if exists "Public can read visible aspirations" on public.aspirations;
create policy "Public can read visible aspirations"
  on public.aspirations
  for select
  to anon, authenticated
  using (is_hidden = false or (select public.is_admin()));

-- Students can submit immediately, but cannot set moderation/admin fields.
drop policy if exists "Anyone can submit an aspiration" on public.aspirations;
create policy "Anyone can submit an aspiration"
  on public.aspirations
  for insert
  to anon, authenticated
  with check (
    is_hidden = false
    and admin_reply is null
    and admin_replied_at is null
  );

-- Only admins can edit moderation and reply fields.
drop policy if exists "Admins can update aspirations" on public.aspirations;
create policy "Admins can update aspirations"
  on public.aspirations
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete aspirations" on public.aspirations;
create policy "Admins can delete aspirations"
  on public.aspirations
  for delete
  to authenticated
  using ((select public.is_admin()));

-- Grant only the operations/columns needed by the app.
grant usage on schema public to anon, authenticated;
grant select on public.aspirations to anon, authenticated;
grant insert (category, message, author) on public.aspirations to anon, authenticated;
grant update (is_hidden, admin_reply, admin_replied_at) on public.aspirations to authenticated;
grant delete on public.aspirations to authenticated;
grant select on public.profiles to authenticated;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
