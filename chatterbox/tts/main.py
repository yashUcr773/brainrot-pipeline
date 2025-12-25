
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
# from chatterbox.mtl_tts import ChatterboxMultilingualTTS

# English example
model = ChatterboxTTS.from_pretrained(device="cpu")

text = """[emotion: subdued_sadness | intensity: low | pace: slow]
The last message my mother sent me was simple. Did you eat.
I read it too late.

[emotion: quiet_grief | intensity: medium | pace: slow]
Grief did not arrive loudly. It settled, heavy and patient, changing how silence sounded.

[emotion: reflective | intensity: medium | pace: steady]
At the funeral, people spoke gently. I nodded. Something essential had already left.

[emotion: restrained_longing | intensity: medium | pace: slow]
Days later, I cooked her recipe and failed. The taste was wrong, but familiar.

[emotion: acceptance | intensity: low | pace: calm]
I ate anyway.

[emotion: tender_resolution | intensity: low | pace: slow]
Now, when I eat alone, I answer her. Yes."""
wav = model.generate(text, exaggeration=0.7,cfg_weight=0.3)
ta.save("test-english2.wav", wav, model.sr)

# # Multilingual examples
# multilingual_model = ChatterboxMultilingualTTS.from_pretrained(device=device)

# french_text = "Bonjour, comment ça va? Ceci est le modèle de synthèse vocale multilingue Chatterbox, il prend en charge 23 langues."
# wav_french = multilingual_model.generate(spanish_text, language_id="fr")
# ta.save("test-french.wav", wav_french, model.sr)

# chinese_text = "你好，今天天气真不错，希望你有一个愉快的周末。"
# wav_chinese = multilingual_model.generate(chinese_text, language_id="zh")
# ta.save("test-chinese.wav", wav_chinese, model.sr)

# # If you want to synthesize with a different voice, specify the audio prompt
# AUDIO_PROMPT_PATH = "YOUR_FILE.wav"
# wav = model.generate(text, audio_prompt_path=AUDIO_PROMPT_PATH)
# ta.save("test-2.wav", wav, model.sr)