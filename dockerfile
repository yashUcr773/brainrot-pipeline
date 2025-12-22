FROM python:3.10

WORKDIR /app

RUN pip install --upgrade pip
RUN pip install coqui-tts

RUN RUN apt-get update && apt-get install -y espeak-ng && rm -rf /var/lib/apt/lists/*

COPY . .

CMD ["bash"]

# docker build -t tts .
# docker run -it --rm --gpus all -v ${PWD}/app:/app tts

# python --version
# tts --list_models