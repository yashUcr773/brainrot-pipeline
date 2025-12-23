from TTS.api import TTS

# You can choose a model (check available ones with TTS().list_models())
tts = TTS("tts_models/en/ljspeech/tacotron2-DDC_ph")

text = """
This is a demo of generating TTS audio
locally on your laptop with Coqui TTS.
""" * 10  # extend for longer audio

# output .wav
tts.tts_to_file(text=text, file_path="outputs/output.wav")
