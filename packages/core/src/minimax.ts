/**
 * @html-video/core — MiniMax audio provider.
 *
 * MiniMax exposes speech (`/t2a_v2`) and music (`/music_generation`) under the
 * same host, the same Bearer key, and the same response shape — both wrap the
 * payload in a `base_resp` envelope and return the audio as a hex string in
 * `data.audio`. So one provider + one key covers both narration and music.
 *
 * The request/parse pattern is ported from open-design's `renderMinimaxTTS`
 * (apps/daemon/src/media.ts): fetch → Bearer → check `base_resp.status_code`
 * (an HTTP 200 can still be a logical failure) → `Buffer.from(hex, 'hex')`.
 *
 * Credentials are read from the environment so the studio works without any
 * config file; a missing key yields `null` from {@link resolveMinimaxCredentials}
 * and callers report it gracefully instead of throwing.
 */

import { HtmlVideoError } from './errors.js';

/** Default base URL — matches open-design (`api.minimaxi.chat`). The newer
 *  docs use `api.minimax.io`; override via OD_MINIMAX_BASE_URL when needed. */
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.chat/v1';
/** Fast turbo speech tier (same default open-design ships). */
const MINIMAX_TTS_MODEL = 'speech-02-turbo';
/** Latest music model (supports instrumental-only + auto-lyrics). */
const MINIMAX_MUSIC_MODEL = 'music-2.6';

export interface MinimaxCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface MinimaxAudioResult {
  /** Decoded audio bytes (MP3). */
  bytes: Buffer;
  /** File extension to store under. */
  ext: '.mp3';
  /** Human-readable note of what was produced (provider · model · size). */
  providerNote: string;
  /** Reported duration in seconds, if the API surfaced it. */
  durationSec?: number;
}

/**
 * Resolve MiniMax credentials from the environment. Returns `null` (not throw)
 * when no key is set, so the studio can show a friendly "configure your key"
 * message instead of a 500.
 *
 * Key precedence:  OD_MINIMAX_API_KEY → MINIMAX_API_KEY
 * Base precedence: OD_MINIMAX_BASE_URL → MINIMAX_BASE_URL → default
 */
export function resolveMinimaxCredentials(
  env: NodeJS.ProcessEnv = process.env,
): MinimaxCredentials | null {
  const apiKey = (env.OD_MINIMAX_API_KEY || env.MINIMAX_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = (env.OD_MINIMAX_BASE_URL || env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  return { apiKey, baseUrl };
}

/**
 * Shared POST + decode for both MiniMax audio endpoints. Throws
 * HtmlVideoError('render-failed', …) on transport / API / decode failure.
 */
async function postAndDecode(
  endpoint: string,
  body: unknown,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; extraInfo: Record<string, unknown> }> {
  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} request failed: ${msg} (check OD_MINIMAX_BASE_URL — default is api.minimaxi.chat)`,
      true,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }

  let data: {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: unknown };
    extra_info?: Record<string, unknown>;
  };
  try {
    data = JSON.parse(respText);
  } catch {
    throw new HtmlVideoError('render-failed', `minimax ${label} non-JSON: ${truncate(respText, 200)}`);
  }

  // MiniMax wraps every response in base_resp; an HTTP 200 can still be a
  // logical failure (auth / params), surfaced via a non-zero status_code.
  if (data.base_resp && data.base_resp.status_code !== 0) {
    const code = data.base_resp.status_code;
    const hint = code === 1004 || code === 1008 ? ' (auth / insufficient balance — check the API key)' : '';
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} api error ${code}: ${data.base_resp.status_msg || 'unknown'}${hint}`,
    );
  }

  const hex = data.data?.audio;
  if (typeof hex !== 'string' || !hex) {
    throw new HtmlVideoError('render-failed', `minimax ${label} response missing data.audio`);
  }
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', `minimax ${label} decoded zero bytes`);
  }
  return { bytes, extraInfo: data.extra_info ?? {} };
}

/**
 * Generate spoken narration via MiniMax TTS (`/t2a_v2`).
 * Defaults to a neutral Mandarin male voice that reads both zh + en well.
 */
export async function generateTts(opts: {
  text: string;
  voiceId?: string;
  languageBoost?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  creds: MinimaxCredentials;
  signal?: AbortSignal;
}): Promise<MinimaxAudioResult> {
  const text = (opts.text || '').trim();
  if (!text) {
    throw new HtmlVideoError('invalid-input', 'narration text is empty');
  }
  const voiceId = (opts.voiceId || '').trim() || 'male-qn-qingse';
  const languageBoost = (opts.languageBoost || '').trim();

  const body = {
    model: MINIMAX_TTS_MODEL,
    text,
    stream: false,
    ...(languageBoost ? { language_boost: languageBoost } : {}),
    voice_setting: {
      voice_id: voiceId,
      speed: opts.speed ?? 1.0,
      vol: opts.vol ?? 1.0,
      pitch: opts.pitch ?? 0,
    },
    audio_setting: { sample_rate: 32000, format: 'mp3' },
  };

  const { bytes, extraInfo } = await postAndDecode('t2a_v2', body, opts.creds, 'tts', opts.signal);
  const audioLen = typeof extraInfo.audio_length === 'number' ? extraInfo.audio_length : undefined;
  const durationSec = audioLen ? Math.round(audioLen / 100) / 10 : undefined;
  return {
    bytes,
    ext: '.mp3',
    providerNote: `minimax/${MINIMAX_TTS_MODEL} · ${voiceId} · ${durationSec ?? '?'}s · ${bytes.length} bytes`,
    durationSec,
  };
}

/**
 * Generate background music via MiniMax (`/music_generation`).
 * Instrumental-only by default (a video soundtrack rarely wants vocals).
 */
export async function generateMusic(opts: {
  prompt: string;
  instrumental?: boolean;
  creds: MinimaxCredentials;
  signal?: AbortSignal;
}): Promise<MinimaxAudioResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) {
    throw new HtmlVideoError('invalid-input', 'music prompt is empty');
  }

  const body = {
    model: MINIMAX_MUSIC_MODEL,
    prompt,
    is_instrumental: opts.instrumental ?? true,
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
    output_format: 'hex',
  };

  const { bytes } = await postAndDecode('music_generation', body, opts.creds, 'music', opts.signal);
  return {
    bytes,
    ext: '.mp3',
    providerNote: `minimax/${MINIMAX_MUSIC_MODEL} · ${opts.instrumental ?? true ? 'instrumental' : 'with-vocals'} · ${bytes.length} bytes`,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
