# Use Ubuntu 20.04 base image (no CUDA)
FROM ubuntu:20.04

WORKDIR /app

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/virtual_analytics:/app/face_recognition

# Install Python 3.8 and system dependencies
RUN apt-get update && apt-get install -y \
    python3.8 \
    python3-pip \
    python3-dev \
    libzmq3-dev \
    ffmpeg \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements files for both projects
COPY virtual_analytics/requirements.txt /app/virtual_analytics/requirements.txt
COPY face_recognition/requirements.txt /app/face_recognition/requirements.txt

# Install Python dependencies for both projects
RUN pip install --no-cache-dir -r /app/virtual_analytics/requirements.txt && \
    pip install --no-cache-dir -r /app/face_recognition/requirements.txt

# Install CPU-only PyTorch
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Copy project files
COPY virtual_analytics /app/virtual_analytics
COPY face_recognition /app/face_recognition
COPY run.sh /app/run.sh
COPY config.json /app/config.json
COPY license.bin /app/license.bin

# Create necessary directories
RUN mkdir -p /app/virtual_analytics/LOGS \
    /app/virtual_analytics/intrusion \
    /app/virtual_analytics/intrusion_attributes \
    /app/face_recognition/detected_faces \
    /app/face_recognition/faces \
    /app/face_recognition/FullFrames \
    /app/face_recognition/TempMultipleFaces \
    /app/face_recognition/TempSinglePerson && \
    chmod -R 777 /app

# Expose ports
EXPOSE 5010 5020 5000 8554 554

# Set executable permissions
RUN chmod +x /app/run.sh

# Run script
CMD ["/app/run.sh"]