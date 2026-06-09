/**
 * @html-video/core — Gemini Flash TTS client for voiceover generation.
 *
 * Gemini 3.1 Flash TTS generates expressive speech from text with natural
 * prosody. The API returns raw PCM audio (24kHz, 16-bit, mono) as base64,
 * which we convert to WAV for ffmpeg compatibility.
 *
 * API endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent
 *   Auth: x-goog-api-key header
 *
 * Response shape:
 *   { candidates: [{ content: { parts: [{ inlineData: { data: "<base64 PCM>", mimeType: "audio/L16;rate=24000" } }] } }] }
 *
 * Credentials: GEMINI_API_KEY env var (or via Settings UI).
 */

import { HtmlVideoError } from './errors.js';

export const GEMINI_TTS_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const GEMINI_TTS_TIMEOUT_MS = 120_000;

/**
 * Curated voice subset (8 voices: 4M + 4F).
 *
 * Gemini offers 30 voices total. We expose a balanced subset covering the main
 * style categories: informative, firm, warm, gravelly (male) and bright,
 * breezy, youthful, gentle (female). Users can still pass raw Gemini voice
 * names if they want the full set.
 *
 * Full list: Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede,
 * Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina,
 * Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar,
 * Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia,
 * Sadaltager, Sulafat
 */
export const GEMINI_VOICES = {
  // Male voices
  male_informative: 'Charon',
  male_firm: 'Kore',
  male_warm: 'Sulafat',
  male_gravelly: 'Algenib',
  // Female voices
  female_bright: 'Zephyr',
  female_breezy: 'Aoede',
  female_youthful: 'Leda',
  female_gentle: 'Vindemiatrix',
} as const;

export type GeminiVoiceKey = keyof typeof GEMINI_VOICES;

/** PCM audio parameters returned by Gemini TTS. */
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

export interface GeminiCredentials {
  apiKey: string;
}

export interface GeminiTtsOptions {
  /** Text to synthesize. */
  text: string;
  /** Voice name: either a key from GEMINI_VOICES or a raw Gemini voice name. */
  voiceName?: GeminiVoiceKey | string;
  creds: GeminiCredentials;
  signal?: AbortSignal;
}

export interface GeminiTtsResult {
  /** WAV audio bytes (PCM 24kHz/16bit/mono with RIFF header). */
  bytes: Buffer;
  ext: '.wav';
  /** Human-readable note (provider · model · voice · duration · size). */
  providerNote: string;
  /** Computed duration in seconds. */
  durationSec?: number;
}

/**
 * Resolve Gemini credentials from environment. Returns null when no key
 * is set, so callers can show a friendly "configure your key" message.
 *
 * Key precedence: GEMINI_API_KEY
 */
export function resolveGeminiCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GeminiCredentials | null {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return { apiKey };
}

/**
 * Resolve a voice name: if it's a key from GEMINI_VOICES, return the Gemini
 * voice name; otherwise pass through as-is (allows raw Gemini names).
 */
function resolveVoiceName(voiceName?: string): string {
  if (!voiceName) return GEMINI_VOICES.female_bright; // Default voice
  const key = voiceName as GeminiVoiceKey;
  if (key in GEMINI_VOICES) {
    return GEMINI_VOICES[key];
  }
  return voiceName; // Pass through raw name
}

/**
 * Convert raw PCM to WAV format by prepending a 44-byte RIFF header.
 *
 * WAV structure:
 *   - RIFF header (12 bytes): "RIFF" + file size + "WAVE"
 *   - fmt chunk (24 bytes): "fmt " + chunk size + PCM format + channels + sample rate + byte rate + block align + bits per sample
 *   - data chunk (8 + N bytes): "data" + data size + PCM data
 */
function pcmToWav(pcm: Buffer): Buffer {
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize; // 36 = size of header after "RIFF" and size field

  const wav = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  wav.write('RIFF', offset); offset += 4;
  wav.writeUInt32LE(fileSize, offset); offset += 4;
  wav.write('WAVE', offset); offset += 4;

  // fmt chunk
  wav.write('fmt ', offset); offset += 4;
  wav.writeUInt32LE(16, offset); offset += 4; // Chunk size (16 for PCM)
  wav.writeUInt16LE(1, offset); offset += 2; // Audio format (1 = PCM)
  wav.writeUInt16LE(PCM_CHANNELS, offset); offset += 2;
  wav.writeUInt32LE(PCM_SAMPLE_RATE, offset); offset += 4;
  wav.writeUInt32LE(byteRate, offset); offset += 4;
  wav.writeUInt16LE(blockAlign, offset); offset += 2;
  wav.writeUInt16LE(PCM_BITS_PER_SAMPLE, offset); offset += 2;

  // data chunk
  wav.write('data', offset); offset += 4;
  wav.writeUInt32LE(dataSize, offset); offset += 4;

  // Copy PCM data
  pcm.copy(wav, offset);

  return wav;
}

/**
 * Generate spoken narration via Gemini Flash TTS.
 *
 * @param opts.text - Text to synthesize.
 * @param opts.voiceName - Voice key from GEMINI_VOICES or raw Gemini voice name.
 */
export async function generateGeminiTts(
  opts: GeminiTtsOptions,
): Promise<GeminiTtsResult> {
  const text = (opts.text || '').trim();
  if (!text) {
    throw new HtmlVideoError('invalid-input', 'narration text is empty');
  }

  const voiceName = resolveVoiceName(opts.voiceName);

  const body = {
    contents: [{
      parts: [{ text }],
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
    },
  };

  const url = `${GEMINI_TTS_BASE_URL}/models/${GEMINI_TTS_MODEL}:generateContent`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': opts.creds.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError(
      'render-failed',
      isTimeout
        ? `gemini tts timed out after ${Math.round(GEMINI_TTS_TIMEOUT_MS / 1000)}s`
        : `gemini tts request failed: ${msg} (check API key)`,
      true,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `gemini tts ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }

  let data: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
    error?: {
      message?: string;
      code?: number;
    };
  };
  try {
    data = JSON.parse(respText);
  } catch {
    throw new HtmlVideoError('render-failed', `gemini tts non-JSON: ${truncate(respText, 200)}`);
  }

  if (data.error) {
    throw new HtmlVideoError(
      'render-failed',
      `gemini tts error: ${data.error.message || 'unknown'} (code ${data.error.code})`,
    );
  }

  const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    throw new HtmlVideoError('render-failed', 'gemini tts response missing audio data');
  }

  // Decode base64 PCM
  const pcm = Buffer.from(inlineData.data, 'base64');
  if (pcm.length === 0) {
    throw new HtmlVideoError('render-failed', 'gemini tts decoded zero bytes');
  }

  // Convert PCM to WAV
  const wav = pcmToWav(pcm);

  // Compute duration from PCM size: duration = bytes / (sampleRate * channels * bytesPerSample)
  const bytesPerSample = PCM_BITS_PER_SAMPLE / 8;
  const durationSec = pcm.length / (PCM_SAMPLE_RATE * PCM_CHANNELS * bytesPerSample);

  return {
    bytes: wav,
    ext: '.wav',
    providerNote: `gemini/${GEMINI_TTS_MODEL} · ${voiceName} · ${durationSec.toFixed(1)}s · ${wav.length} bytes`,
    durationSec: Math.round(durationSec * 10) / 10,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
