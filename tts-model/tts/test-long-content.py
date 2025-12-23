from TTS.api import TTS
import textwrap
import wave
import contextlib


tts = TTS(model_name="tts_models/en/vctk/vits")

text = open("scripts/script.txt").read()

chunks = textwrap.wrap(text, 500)

files = []

for i, chunk in enumerate(chunks):
    out = f"temp/chunk_{i}.wav"
    tts.tts_to_file(
        text=chunk,
        speaker="p225",
        file_path=out
    )
    files.append(out)

print("Generated", len(files), "chunks")


def concat_wavs(wav_files, out_file):
    with wave.open(wav_files[0], 'rb') as w:
        params = w.getparams()

    with wave.open(out_file, 'wb') as out:
        out.setparams(params)
        for f in wav_files:
            with wave.open(f, 'rb') as w:
                out.writeframes(w.readframes(w.getnframes()))

concat_wavs(
    [f"temp/chunk_{i}.wav" for i in range(len(chunks))],
    "scripts/final_script.wav"
)