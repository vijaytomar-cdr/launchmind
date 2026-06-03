/**
 * @file elevenLabsClient.ts
 * @description ElevenLabs Text-to-Speech API client.
 *   Generates voiceover MP3 for video and WhatsApp voice note assets.
 *   Returns an empty Buffer and logs a warning when ELEVENLABS_API_KEY is not set
 *   so the rest of the content pipeline continues unblocked.
 * @security API key in env, never logged, never returned to frontend.
 * @dependencies ENV: ELEVENLABS_API_KEY
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

const DEFAULT_VOICES: Record<string, string> = {
  english_india: 'nPczCjzI2devNBz1zQrb',
  hindi:         'XrExE9yKIg1WjnnlVkGX',
  hinglish:      'nPczCjzI2devNBz1zQrb',
  english_usa:   'EXAVITQu4vr4xnSDxMaL',
};

/**
 * Converts a text script to MP3 audio via ElevenLabs.
 * Returns empty Buffer when ELEVENLABS_API_KEY is not configured.
 * @param script        - The text to speak
 * @param language      - Language/locale for voice selection
 * @param voiceCloneId  - Founder's personal voice clone ID (optional)
 * @returns Buffer of MP3 audio data (empty if API key absent)
 */
export async function textToSpeech(
  script: string,
  language = 'english_india',
  voiceCloneId?: string | null
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[elevenLabsClient] ELEVENLABS_API_KEY not set — skipping TTS');
    return Buffer.alloc(0);
  }

  const voiceId = voiceCloneId ?? DEFAULT_VOICES[language] ?? DEFAULT_VOICES.english_india;

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error: ${response.status} ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Creates a voice clone from a founder audio sample.
 * @param audioBuffer - The founder's 60-second recording
 * @param founderName - Used as the clone name in ElevenLabs
 * @returns ElevenLabs voice_id for the clone
 * @throws {Error} When ELEVENLABS_API_KEY is not set or API call fails
 */
export async function createVoiceClone(
  audioBuffer: Buffer,
  founderName: string
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const form = new FormData();
  form.append('name', `${founderName} - LaunchMind Clone`);
  form.append('description', 'Founder voice clone for LaunchMind video generation');
  form.append('files', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'sample.mp3');

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs voice clone error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { voice_id: string };
  return data.voice_id;
}
