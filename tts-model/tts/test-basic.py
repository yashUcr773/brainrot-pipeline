import torch
from TTS.api import TTS

# Get device
device = "cuda" if torch.cuda.is_available() else "cpu"
print (device)

# List available 🐸TTS models
print(TTS().list_models())

tts = TTS(
    model_name="tts_models/en/vctk/vits",
    progress_bar=True
)
print(tts.speakers)

