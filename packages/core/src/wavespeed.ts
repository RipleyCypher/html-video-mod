/**
 * @html-video/core — WaveSpeed API client for Ace-Step 1.5 music generation.
 *
 * WaveSpeed provides an async API: submit a task, poll for completion, then
 * download the generated audio. Ace-Step 1.5 generates up to 4-minute tracks
 * from style tags and optional lyrics at ultra-low cost.
 *
 * Flow:
 *   1. POST /wavespeed-ai/ace-step-1.5 → { data: { id, status: 'created' } }
 *   2. Poll GET /predictions/{id}/result every 3s until status='completed'
 *   3. Download audio from data.outputs[0]
 *
 * Credentials: WAVESPEED_API_KEY env var (or via Settings UI).
 */

import { HtmlVideoError } from './errors.js';

export const WAVESPEED_DEFAULT_BASE_URL = 'https://api.wavespeed.ai/api/v3';

/** Poll every 3 seconds — music generation typically takes 30-90s. */
const WAVESPEED_POLL_INTERVAL_MS = 3_000;

/** Hard ceiling: 5 minutes. Ace-Step can generate up to 240s of audio, and
 *  generation speed varies. Beyond 5min something is hung, not slow. */
const WAVESPEED_TIMEOUT_MS = 300_000;

export interface WavespeedCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface WavespeedMusicOptions {
  /** Style tags: "lo-fi, chill, ambient, piano" (required by Ace-Step). */
  tags: string;
  /** Lyrics with structure markers ([Verse], [Chorus]). Empty = instrumental. */
  lyrics?: string;
  /** Track length in seconds (5-240, default 60). */
  duration?: number;
  /** Random seed for reproducibility (-1 = random). */
  seed?: number;
  creds: WavespeedCredentials;
  signal?: AbortSignal;
}

export interface WavespeedMusicResult {
  /** Downloaded audio bytes. */
  bytes: Buffer;
  ext: '.mp3' | '.wav' | '.ogg' | '.flac';
  /** Human-readable note (provider · model · duration · size). */
  providerNote: string;
  /** Reported duration in seconds. */
  durationSec?: number;
}

/**
 * Resolve WaveSpeed credentials from environment. Returns null when no key
 * is set, so callers can show a friendly "configure your key" message.
 *
 * Key precedence: WAVESPEED_API_KEY
 * Base precedence: WAVESPEED_BASE_URL → default
 */
export function resolveWavespeedCredentials(
  env: NodeJS.ProcessEnv = process.env,
): WavespeedCredentials | null {
  const apiKey = (env.WAVESPEED_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = (env.WAVESPEED_BASE_URL || WAVESPEED_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  return { apiKey, baseUrl };
}

/**
 * Submit a music generation task to WaveSpeed Ace-Step 1.5.
 * Returns the task ID for polling.
 */
async function submitTask(
  opts: WavespeedMusicOptions,
): Promise<string> {
  const body = {
    tags: opts.tags,
    lyrics: opts.lyrics ?? '[Instrumental]', // Use [Instrumental] marker for instrumental music
    duration: opts.duration ?? 60,
    seed: opts.seed ?? -1,
  };

  let resp: Response;
  try {
    resp = await fetch(`${opts.creds.baseUrl}/wavespeed-ai/ace-step-1.5`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError(
      'render-failed',
      `wavespeed task submission failed: ${msg} (check API key and base URL)`,
      true,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `wavespeed task submission ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }

  let data: {
    code?: number;
    message?: string;
    data?: { id?: string; status?: string };
  };
  try {
    data = JSON.parse(respText);
  } catch {
    throw new HtmlVideoError('render-failed', `wavespeed non-JSON response: ${truncate(respText, 200)}`);
  }

  if (data.code !== 200 || data.message !== 'success') {
    throw new HtmlVideoError(
      'render-failed',
      `wavespeed task error: ${data.message || 'unknown'} (code ${data.code})`,
    );
  }

  const taskId = data.data?.id;
  if (!taskId) {
    throw new HtmlVideoError('render-failed', 'wavespeed response missing task ID');
  }

  return taskId;
}

/**
 * Poll a task until completion or timeout. Returns the result data.
 */
async function pollForResult(
  taskId: string,
  creds: WavespeedCredentials,
  signal?: AbortSignal,
): Promise<{ outputs: string[]; timings?: { inference?: number } }> {
  const startTime = Date.now();

  while (true) {
    // Check timeout
    if (Date.now() - startTime > WAVESPEED_TIMEOUT_MS) {
      throw new HtmlVideoError(
        'render-failed',
        `wavespeed task timed out after ${Math.round(WAVESPEED_TIMEOUT_MS / 1000)}s (task ${taskId})`,
        true,
      );
    }

    // Check if aborted
    if (signal?.aborted) {
      throw new HtmlVideoError('render-failed', 'wavespeed task cancelled', false);
    }

    let resp: Response;
    try {
      resp = await fetch(`${creds.baseUrl}/predictions/${taskId}/result`, {
        headers: {
          authorization: `Bearer ${creds.apiKey}`,
        },
        signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HtmlVideoError(
        'render-failed',
        `wavespeed poll failed: ${msg}`,
        true,
      );
    }

    const respText = await resp.text();
    if (!resp.ok) {
      throw new HtmlVideoError(
        'render-failed',
        `wavespeed poll ${resp.status}: ${truncate(respText, 240)}`,
        resp.status >= 500,
      );
    }

    let data: {
      code?: number;
      message?: string;
      data?: {
        id?: string;
        status?: 'created' | 'processing' | 'completed' | 'failed';
        outputs?: string[];
        error?: string;
        timings?: { inference?: number };
      };
    };
    try {
      data = JSON.parse(respText);
    } catch {
      throw new HtmlVideoError('render-failed', `wavespeed poll non-JSON: ${truncate(respText, 200)}`);
    }

    if (data.code !== 200) {
      throw new HtmlVideoError(
        'render-failed',
        `wavespeed poll error: ${data.message || 'unknown'} (code ${data.code})`,
      );
    }

    const status = data.data?.status;
    if (status === 'completed') {
      const outputs = data.data?.outputs ?? [];
      if (outputs.length === 0) {
        throw new HtmlVideoError('render-failed', 'wavespeed task completed but no outputs');
      }
      return { outputs, timings: data.data?.timings };
    }

    if (status === 'failed') {
      throw new HtmlVideoError(
        'render-failed',
        `wavespeed task failed: ${data.data?.error || 'unknown error'}`,
      );
    }

    // Still processing — wait and poll again
    await sleep(WAVESPEED_POLL_INTERVAL_MS, signal);
  }
}

/**
 * Download audio from a URL. Returns both the audio bytes and content-type header.
 */
async function downloadAudio(
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; contentType: string }> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError(
      'render-failed',
      `wavespeed audio download failed: ${msg}`,
      true,
    );
  }

  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `wavespeed audio download ${resp.status}`,
      resp.status >= 500,
    );
  }

  const contentType = resp.headers.get('content-type') || '';
  const arrayBuffer = await resp.arrayBuffer();
  return { bytes: Buffer.from(arrayBuffer), contentType };
}

/**
 * Detect audio format from content-type header and/or magic bytes.
 * Returns the file extension including the dot.
 */
function detectAudioFormat(contentType: string, bytes: Buffer): '.mp3' | '.wav' | '.ogg' | '.flac' {
  // Check content-type first
  const ct = contentType.toLowerCase();
  if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) {
    return '.mp3';
  }
  if (ct.includes('audio/wav') || ct.includes('audio/wave') || ct.includes('audio/x-wav')) {
    return '.wav';
  }
  if (ct.includes('audio/ogg')) {
    return '.ogg';
  }
  if (ct.includes('audio/flac')) {
    return '.flac';
  }

  // Fallback: check magic bytes
  if (bytes.length >= 4) {
    // RIFF header (WAV)
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return '.wav';
    }
    // ID3 tag (MP3)
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return '.mp3';
    }
    // MP3 sync word
    if (bytes[0] === 0xFF && (bytes[1]! & 0xE0) === 0xE0) {
      return '.mp3';
    }
    // OggS header
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return '.ogg';
    }
    // fLaC header
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
      return '.flac';
    }
  }

  // Default to wav if we can't detect (safer for ffmpeg)
  return '.wav';
}

/**
 * Generate background music via WaveSpeed Ace-Step 1.5.
 *
 * @param opts.tags - Style tags (required): "lo-fi, chill, ambient, piano"
 * @param opts.lyrics - Optional lyrics with structure markers. Empty = instrumental.
 * @param opts.duration - Track length in seconds (5-240, default 60).
 * @param opts.seed - Random seed (-1 = random).
 */
export async function generateWavespeedMusic(
  opts: WavespeedMusicOptions,
): Promise<WavespeedMusicResult> {
  const tags = (opts.tags || '').trim();
  if (!tags) {
    throw new HtmlVideoError('invalid-input', 'music tags are empty (required for Ace-Step)');
  }

  const duration = opts.duration ?? 60;
  if (duration < 5 || duration > 240) {
    throw new HtmlVideoError('invalid-input', `duration ${duration}s out of range (5-240s)`);
  }

  // Step 1: Submit task
  const taskId = await submitTask(opts);

  // Step 2: Poll for result
  const { outputs, timings } = await pollForResult(taskId, opts.creds, opts.signal);

  // Step 3: Download audio
  const audioUrl = outputs[0];
  if (!audioUrl) {
    throw new HtmlVideoError('render-failed', 'wavespeed result missing audio URL');
  }

  const { bytes, contentType } = await downloadAudio(audioUrl, opts.signal);
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', 'wavespeed downloaded zero bytes');
  }

  // Step 4: Detect actual audio format from content-type and magic bytes
  const ext = detectAudioFormat(contentType, bytes);

  const inferenceSec = timings?.inference ? Math.round(timings.inference / 1000) : undefined;
  const isInstrumental = !opts.lyrics || opts.lyrics.trim() === '' || opts.lyrics.toLowerCase().includes('[instrumental]');

  return {
    bytes,
    ext,
    providerNote: `wavespeed/ace-step-1.5 · ${duration}s · ${ext.slice(1)} · ${isInstrumental ? 'instrumental' : 'with-vocals'} · ${inferenceSec ? `in ${inferenceSec}s · ` : ''}${bytes.length} bytes`,
    durationSec: duration,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new HtmlVideoError('render-failed', 'cancelled', false));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new HtmlVideoError('render-failed', 'cancelled', false));
    }, { once: true });
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
