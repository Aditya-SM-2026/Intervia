# Video analysis worker: ffmpeg for clips, OpenCV + MediaPipe for gaze.
FROM python:3.11-slim

# libgl1 / libglib2.0-0 are required for OpenCV's shared libraries; without
# them `import cv2` fails and the worker reports every clip as unreadable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY worker/ ./

ENV PORT=8080
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
