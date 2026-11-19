import { supabase } from '../lib/supabase';
import {
  ASPIRATION_CATEGORIES,
  DEFAULT_MEDIA_ASSETS,
  FORM_LIMITS,
  SAMPLE_ASPIRATIONS,
} from '../config/appConfig';
import type {
  Aspiration,
  CreateAspirationInput,
  MediaAssets,
} from '../types/aspiration';

export interface AdminSessionUser {
  uid: string;
  email: string | null;
}

function normalizeMediaAssets(raw: unknown): MediaAssets {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MEDIA_ASSETS };
  }
  const obj = raw as Partial<MediaAssets>;
  const exploreGalleryUrls =
    Array.isArray(obj.exploreGalleryUrls) &&
    obj.exploreGalleryUrls.length > 0
      ? obj.exploreGalleryUrls
          .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
          .slice(0, 10)
      : [...DEFAULT_MEDIA_ASSETS.exploreGalleryUrls];

  const writeGalleryUrls =
    Array.isArray(obj.writeGalleryUrls) && obj.writeGalleryUrls.length > 0
      ? obj.writeGalleryUrls
          .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
          .slice(0, 10)
      : [...DEFAULT_MEDIA_ASSETS.writeGalleryUrls];

  return {
    schoolLogoUrl:
      typeof obj.schoolLogoUrl === 'string' && obj.schoolLogoUrl.trim().length > 0
        ? obj.schoolLogoUrl
        : null,
    exploreGalleryUrls:
      exploreGalleryUrls.length > 0
        ? exploreGalleryUrls
        : [...DEFAULT_MEDIA_ASSETS.exploreGalleryUrls],
    writeGalleryUrls:
      writeGalleryUrls.length > 0
        ? writeGalleryUrls
        : [...DEFAULT_MEDIA_ASSETS.writeGalleryUrls],
  };
}

export async function getCurrentAdminSession(): Promise<AdminSessionUser | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin') return null;
  return { uid: user.id, email: user.email ?? null };
}

export async function signInAdminWithCredentials(
  email: string,
  password: string
): Promise<AdminSessionUser> {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error || !data.user) {
    throw new Error(error?.message || 'Email atau password admin tidak sesuai.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin') {
    await supabase.auth.signOut();
    throw new Error('Akun ini belum memiliki hak akses admin. Hubungi pengelola aplikasi.');
  }

  return { uid: data.user.id, email: data.user.email ?? null };
}

export async function logoutAdmin(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`Gagal keluar dari akun admin: ${error.message}`);
}

function mapSupabaseAspiration(row: {
  id: string;
  category: Aspiration['category'];
  message: string;
  author: string;
  created_at: string;
  is_hidden: boolean;
  admin_reply: string | null;
  admin_replied_at: string | null;
}): Aspiration {
  return {
    id: row.id,
    category: row.category,
    message: row.message,
    author: row.author,
    createdAt: row.created_at,
    isHidden: row.is_hidden,
    isSample: false,
    ...(row.admin_reply ? { adminReply: row.admin_reply } : {}),
    ...(row.admin_replied_at ? { adminRepliedAt: row.admin_replied_at } : {}),
  };
}

export function subscribePublicAspirations(
  onData: (items: Aspiration[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const load = async () => {
    const { data, error } = await supabase
      .from('aspirations')
      .select('*')
      .eq('is_hidden', false)
      .order('created_at', { ascending: false });

    if (!active) return;
    if (error) {
      onError?.(new Error(`Gagal memuat aspirasi dari Supabase: ${error.message}`));
      return;
    }

    onData((data ?? []).map((row) => mapSupabaseAspiration(row)));
  };

  void load();

  const channel = supabase
    .channel(`public-aspirations-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'aspirations' },
      () => { void load(); }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new Error('Koneksi pembaruan langsung Supabase gagal. Periksa pengaturan Realtime untuk tabel aspirations.'));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export function subscribeAllAspirations(
  onData: (items: Aspiration[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const load = async () => {
    const { data, error } = await supabase
      .from('aspirations')
      .select('*')
      .order('created_at', { ascending: false });

    if (!active) return;
    if (error) {
      onError?.(new Error(`Gagal memuat dashboard admin: ${error.message}`));
      return;
    }
    onData((data ?? []).map((row) => mapSupabaseAspiration(row)));
  };

  void load();
  const channel = supabase
    .channel(`admin-aspirations-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aspirations' }, () => {
      void load();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new Error('Koneksi pembaruan langsung dashboard admin gagal.'));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export function subscribeMediaSettings(
  onData: (assets: MediaAssets) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const load = async () => {
    const { data, error } = await supabase
      .from('media_settings')
      .select('school_logo_url, explore_gallery_urls, write_gallery_urls')
      .eq('id', 'global')
      .maybeSingle();

    if (!active) return;
    if (error) {
      onError?.(new Error(`Gagal memuat pengaturan galeri dari Supabase: ${error.message}`));
      return;
    }

    onData(normalizeMediaAssets(data ? {
      schoolLogoUrl: data.school_logo_url,
      exploreGalleryUrls: data.explore_gallery_urls,
      writeGalleryUrls: data.write_gallery_urls,
    } : DEFAULT_MEDIA_ASSETS));
  };

  void load();
  const channel = supabase
    .channel('global-media-settings')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'media_settings',
      filter: 'id=eq.global',
    }, () => { void load(); })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(new Error('Koneksi sinkronisasi pengaturan galeri Supabase gagal.'));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export async function publishAspiration(
  input: CreateAspirationInput
): Promise<Aspiration> {
  if (!ASPIRATION_CATEGORIES.includes(input.category)) {
    throw new Error('Kategori aspirasi tidak valid.');
  }

  const cleanMessage = input.message
    .trim()
    .slice(0, FORM_LIMITS.maxMessageLength);

  if (cleanMessage.length < FORM_LIMITS.minMessageLength) {
    throw new Error(
      `Isi aspirasi minimal ${FORM_LIMITS.minMessageLength} karakter.`
    );
  }

  const trimmedAuthor = (input.author ?? '')
    .trim()
    .slice(0, FORM_LIMITS.maxAuthorLength);
  const cleanAuthor = trimmedAuthor.length > 0 ? trimmedAuthor : 'Anonim';

  const { data, error } = await supabase
    .from('aspirations')
    .insert({
      category: input.category,
      message: cleanMessage,
      author: cleanAuthor,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Gagal mengirim aspirasi ke Supabase: ${error.message}`);
  }
  if (!data) {
    throw new Error('Aspirasi terkirim, tetapi data balasan dari Supabase kosong.');
  }

  return mapSupabaseAspiration(data);
}

async function requireAdminSession(): Promise<void> {
  const session = await getCurrentAdminSession();
  if (!session) throw new Error('Sesi admin tidak aktif atau akun tidak memiliki hak admin. Silakan masuk kembali.');
}

export async function toggleAspirationVisibility(
  id: string,
  nextHidden: boolean
): Promise<void> {
  await requireAdminSession();
  const { error } = await supabase
    .from('aspirations')
    .update({ is_hidden: nextHidden })
    .eq('id', id);
  if (error) throw new Error(`Gagal memperbarui status aspirasi: ${error.message}`);
}

export async function replyToAspiration(
  id: string,
  replyText: string
): Promise<void> {
  await requireAdminSession();
  const cleanReply = replyText.trim().slice(0, 400);
  const { error } = await supabase
    .from('aspirations')
    .update({
      admin_reply: cleanReply || null,
      admin_replied_at: cleanReply ? new Date().toISOString() : null,
    })
    .eq('id', id);
  if (error) throw new Error(`Gagal menyimpan balasan admin: ${error.message}`);
}

export async function removeAspiration(id: string): Promise<void> {
  await requireAdminSession();
  const { error } = await supabase.from('aspirations').delete().eq('id', id);
  if (error) throw new Error(`Gagal menghapus aspirasi: ${error.message}`);
}

export async function seedSampleAspirations(): Promise<void> {
  await requireAdminSession();
  const { data: existing, error: readError } = await supabase
    .from('aspirations')
    .select('message');
  if (readError) throw new Error(`Gagal memeriksa aspirasi contoh: ${readError.message}`);

  const existingMessages = new Set((existing ?? []).map((item) => item.message));
  const missingSamples = SAMPLE_ASPIRATIONS.filter(
    (item) => !existingMessages.has(item.message)
  );
  if (missingSamples.length === 0) return;

  const samples = missingSamples.map((item) => ({
    category: item.category,
    message: item.message,
    author: item.author,
    created_at: item.createdAt,
    is_hidden: Boolean(item.isHidden),
    admin_reply: item.adminReply ?? null,
    admin_replied_at: item.adminRepliedAt ?? null,
  }));
  const { error } = await supabase.from('aspirations').insert(samples);
  if (error) throw new Error(`Gagal menambahkan aspirasi contoh: ${error.message}`);
}

async function uploadMediaDataUrl(dataUrl: string, folder: string): Promise<string> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Gagal memproses foto yang akan diunggah.');
  const blob = await response.blob();
  const extension = blob.type === 'image/png' ? 'png'
    : blob.type === 'image/webp' ? 'webp'
    : blob.type === 'image/gif' ? 'gif' : 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const { error } = await supabase.storage
    .from('aspiration-media')
    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(`Gagal mengunggah foto ke Supabase Storage: ${error.message}`);
  return supabase.storage.from('aspiration-media').getPublicUrl(path).data.publicUrl;
}

async function persistMediaUrl(url: string | null, folder: string): Promise<string | null> {
  if (!url || !url.startsWith('data:')) return url;
  return uploadMediaDataUrl(url, folder);
}

export async function updateMediaSettings(assets: MediaAssets): Promise<void> {
  await requireAdminSession();
  const normalized = normalizeMediaAssets(assets);

  const schoolLogoUrl = await persistMediaUrl(normalized.schoolLogoUrl, 'school-logo');
  const exploreGalleryUrls = await Promise.all(
    normalized.exploreGalleryUrls.map((url) => persistMediaUrl(url, 'explore-gallery'))
  ) as string[];
  const writeGalleryUrls = await Promise.all(
    normalized.writeGalleryUrls.map((url) => persistMediaUrl(url, 'write-gallery'))
  ) as string[];

  const { error } = await supabase
    .from('media_settings')
    .upsert({
      id: 'global',
      school_logo_url: schoolLogoUrl,
      explore_gallery_urls: exploreGalleryUrls,
      write_gallery_urls: writeGalleryUrls,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    throw new Error(`Gagal menyimpan pengaturan galeri ke database: ${error.message}`);
  }
}

