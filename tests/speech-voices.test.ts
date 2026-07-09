import { describe, expect, it } from 'vitest';
import { pickDefaultVoice, voicesForLang } from '@/lib/speech';

/** Minimal fake — pickDefaultVoice/voicesForLang only read these fields. */
function voice(
  name: string,
  lang: string,
  over: Partial<SpeechSynthesisVoice> = {},
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: `uri:${name}`,
    default: false,
    localService: true,
    ...over,
  } as SpeechSynthesisVoice;
}

const IOS_LIKE = [
  voice('Samantha', 'en-US', { default: true }), // the robotic compact one
  voice('Samantha (Enhanced)', 'en-US'),
  voice('Daniel', 'en-GB'),
  voice('Amélie', 'fr-CA'),
  voice('Anna', 'de-DE'),
];

describe('voicesForLang', () => {
  it('filters by primary language subtag', () => {
    const en = voicesForLang(IOS_LIKE, 'en-GB');
    expect(en.map((v) => v.name)).toEqual([
      'Samantha',
      'Samantha (Enhanced)',
      'Daniel',
    ]);
  });

  it('falls back to all voices when none match', () => {
    expect(voicesForLang(IOS_LIKE, 'ja')).toHaveLength(IOS_LIKE.length);
  });
});

describe('pickDefaultVoice', () => {
  it('prefers a quality-hinted voice over the platform default', () => {
    expect(pickDefaultVoice(IOS_LIKE, 'en-US')?.name).toBe(
      'Samantha (Enhanced)',
    );
  });

  it('prefers local quality voices over remote ones', () => {
    const voices = [
      voice('Google US English', 'en-US', { localService: false }),
      voice('Ava (Premium)', 'en-US'),
    ];
    expect(pickDefaultVoice(voices, 'en')?.name).toBe('Ava (Premium)');
  });

  it('falls back to the platform default without quality hints', () => {
    const voices = [voice('Alex', 'en-US'), voice('Fred', 'en-US', { default: true })];
    expect(pickDefaultVoice(voices, 'en')?.name).toBe('Fred');
  });

  it('returns null on an empty list', () => {
    expect(pickDefaultVoice([], 'en')).toBeNull();
  });
});
