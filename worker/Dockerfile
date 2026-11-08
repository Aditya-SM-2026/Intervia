# Video analysis worker: ffmpeg for clips and audio, OpenCV + MediaPipe for
# face, eyes and lips, faster-whisper for verbatim speech timing, WeSpeaker
# for voice consistency, YOLOX-Nano for phones and extra people.
FROM python:3.11-slim

# libgl1 / libglib2.0-0 are required for OpenCV's shared libraries; without
# them `import cv2` fails and the worker reports every clip as unreadable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Models are baked into the image so a job never waits on a download.
# - faster-whisper base (MIT), from the faster-whisper authors (Systran)
# - WeSpeaker ResNet34 speaker model (CC-BY-4.0), from the WeSpeaker project
# - YOLOX-Nano COCO detector (Apache 2.0), from the YOLOX release
RUN mkdir -p /models \
  && python -c "from faster_whisper.utils import download_model; download_model('base', output_dir='/models/whisper-base')" \
  && curl -fsSL -o /models/voxceleb_resnet34_LM.onnx \
       https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx \
  && curl -fsSL -o /models/yolox_nano.onnx \
       https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx \
  && rm -rf /root/.cache

COPY worker/ ./

ENV PORT=8080 \
    WHISPER_MODEL_DIR=/models/whisper-base \
    SPEAKER_MODEL=/models/voxceleb_resnet34_LM.onnx \
    PHONE_MODEL=/models/yolox_nano.onnx
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
