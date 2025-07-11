#!/bin/bash
python3 /app/virtual_analytics/main.py &
python3 /app/face_recognition/main.py &
wait