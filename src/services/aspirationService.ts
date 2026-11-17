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

const STORAGE_KEYS = {
  aspirations: 'aspirasi_spensa_aspirations_v1',
  samplesSeeded: 'aspirasi_spensa_samples_seeded_v1',
  media: 'aspirasi_spensa_media_v1',
} as const;

type Listener<T> = (data: T) => void;
type ErrorListener = (err: Error) => void;

const mediaListeners = new Set<{
  onData: Listener<MediaAssets>;
  onError?: ErrorListener;
}>();

let storageEventAttached = false;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function sortByNewest(items: Aspiration[]): Aspiration[] {
  return [...items].sort((a, b) => {
    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    return timeB - timeA;
  });
}

function writeToStorage(key: string, value: string): void {
  if (!hasLocalStorage()) {
    throw new Error('Browser tidak mendukung penyimpanan LocalStorage.');
  }
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      throw new Error(
        'Kapasitas LocalStorage browser penuh. Hapus beberapa foto galeri atau gunakan tautan URL gambar.'
      );
    }
    throw new Error('Gagal menyimpan data ke LocalStorage browser.');
  }
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

function readMediaFromStorage(): MediaAssets {
  if (!hasLocalStorage()) {
    return { ...DEFAULT_MEDIA_ASSETS };
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.media);
  if (raw === null) {
    const defaults = { ...DEFAULT_MEDIA_ASSETS };
    writeToStorage(STORAGE_KEYS.media, JSON.stringify(defaults));
    return defaults;
  }
  try {
    return normalizeMediaAssets(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MEDIA_ASSETS };
  }
}

function notifyMediaListeners(): void {
  try {
    const assets = readMediaFromStorage();
    mediaListeners.forEach((l) => l.onData(assets));
  } catch (err) {
    const wrapped =
      err instanceof Error
        ? err
        : new Error('Gagal membaca pengaturan media dari LocalStorage.');
    mediaListeners.forEach((l) => l.onError?.(wrapped));
  }
}

function ensureStorageSyncListener(): void {
  if (storageEventAttached || typeof window === 'undefined') return;
  storageEventAttached = true;
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.media || event.key === null) {
      notifyMediaListeners();
    }
  });
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
  ensureStorageSyncListener();
  const entry = { onData, onError };
  mediaListeners.add(entry);
  try {
    onData(readMediaFromStorage());
  } catch (err) {
    onError?.(
      err instanceof Error
        ? err
        : new Error('Gagal memuat pengaturan media dari LocalStorage.')
    );
  }
  return () => {
    mediaListeners.delete(entry);
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

export async function updateMediaSettings(assets: MediaAssets): Promise<void> {
  await requireAdminSession();
  const normalized = normalizeMediaAssets(assets);
  writeToStorage(STORAGE_KEYS.media, JSON.stringify(normalized));
  notifyMediaListeners();
}

