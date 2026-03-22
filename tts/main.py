import torch
from TTS.api import TTS

# Get device
device = "cuda" if torch.cuda.is_available() else "cpu"

# List available 🐸TTS models
print(TTS().list_models())

# Init TTS
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

text = (
    "I see all this struggle in her, and I remember reading the threatening, and harassing messages she would send to strangers online, I remember how she would scream, and throw things because she was mad at me or her siblings, I remember her scamming, and manipulating people out of money."
)

# Run TTS
tts.tts_to_file(
    text=text,
    speaker_wav="./assets/inputs/voice1.wav",
    language="en",
    file_path="voice2.wav",
    speed=0.85,
    temperature=0.8,
    top_p=0.8,
    repetition_penalty=2.0
)
