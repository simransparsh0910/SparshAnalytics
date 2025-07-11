import cv2
import time
import os
import torch
from ultralytics import YOLO

# ✅ Load YOLOv8 Pose model
device = "cuda" if torch.cuda.is_available() else "cpu"  # Use GPU if available
model = YOLO("yolov8s-pose.pt").to(device)

# ✅ Open Webcam (0 for default camera)
rtsp=0
cap = cv2.VideoCapture(rtsp)

# ✅ Resize frame to 640x640
TARGET_SIZE = (640, 640)

# ✅ Create folder to save frames
save_folder = "waving_frames"
os.makedirs(save_folder, exist_ok=True)

# ✅ Store hand movements per person
hand_movement = {}

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    # Resize frame to 640x640
    frame = cv2.resize(frame, TARGET_SIZE)

    # Convert frame to tensor (HWC → BCHW)
    # tensor_frame = torch.tensor(frame).permute(2, 0, 1).unsqueeze(0).float().to(device)

    # ✅ Run YOLO Pose Estimation
    results = model(frame,verbose=False)

    for result in results:
        keypoints = result.keypoints.xy.cpu().numpy()  # Extract keypoints
        boxes = result.boxes.xyxy.cpu().numpy()  # Get bounding boxes

        for i, (keypoint, box) in enumerate(zip(keypoints, boxes)):
            # ✅ Extract keypoints (shoulder, elbow, wrist)
            left_shoulder = keypoint[5] if keypoint[5][0] > 0 else None
            right_shoulder = keypoint[6] if keypoint[6][0] > 0 else None
            left_elbow = keypoint[7] if keypoint[7][0] > 0 else None
            right_elbow = keypoint[8] if keypoint[8][0] > 0 else None
            left_wrist = keypoint[9] if keypoint[9][0] > 0 else None
            right_wrist = keypoint[10] if keypoint[10][0] > 0 else None

            # ✅ Draw bounding box around person
            x1, y1, x2, y2 = map(int, box)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # ✅ Draw keypoints (shoulder, elbow, wrist)
            for pt in [left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist]:
                if pt is not None:
                    cv2.circle(frame, (int(pt[0]), int(pt[1])), 5, (0, 0, 255), -1)

            # ✅ Check if elbow is above shoulder
            left_elbow_above = left_elbow is not None and left_shoulder is not None and left_elbow[1] < left_shoulder[1]
            right_elbow_above = right_elbow is not None and right_shoulder is not None and right_elbow[1] < right_shoulder[1]

            if i not in hand_movement:
                hand_movement[i] = {
                    "positions": [],
                    "start_time": None,
                    "wave_detected": False,
                    "hand_down_time": None
                }

            # ✅ Save wrist positions for movement detection
            if left_wrist is not None:
                hand_movement[i]["positions"].append(left_wrist[0])
            if right_wrist is not None:
                hand_movement[i]["positions"].append(right_wrist[0])

            # Keep only last 40 positions (~2 seconds if 20 FPS)
            if len(hand_movement[i]["positions"]) > 40:
                hand_movement[i]["positions"].pop(0)

            # ✅ Detect waving movement
            if len(hand_movement[i]["positions"]) >= 30:
                movement_range = max(hand_movement[i]["positions"]) - min(hand_movement[i]["positions"])

                # ✅ Increase movement threshold to 50 pixels to avoid false detections
                if movement_range > 50 and (left_elbow_above or right_elbow_above):
                    if hand_movement[i]["start_time"] is None:
                        hand_movement[i]["start_time"] = time.time()

                    # ✅ Save frame if waving for at least 2 seconds
                    if time.time() - hand_movement[i]["start_time"] >= 2 and not hand_movement[i]["wave_detected"]:
                        alert_text = f"!!Person {i+1} Waved for 2 sec!!"
                        print(alert_text)

                        # ✅ Display alert on the frame
                        cv2.putText(frame, alert_text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

                        # ✅ Save frame
                        filename = f"{save_folder}/wave_{int(time.time())}_ID{i+1}.jpg"
                        cv2.imwrite(filename, frame, [cv2.IMWRITE_JPEG_QUALITY, 80])

                        # ✅ Mark wave as detected
                        hand_movement[i]["wave_detected"] = True
                        hand_movement[i]["hand_down_time"] = None  # Reset hand-down timer

                else:
                    hand_movement[i]["start_time"] = None  # Reset if no wave detected

            # ✅ Detect when hand goes down
            if not (left_elbow_above or right_elbow_above):
                if hand_movement[i]["hand_down_time"] is None:
                    hand_movement[i]["hand_down_time"] = time.time()

                # If hand has been down for 1 sec, reset wave detection
                if time.time() - hand_movement[i]["hand_down_time"] >= 1:
                    hand_movement[i]["wave_detected"] = False  # Allow new wave detection
                    hand_movement[i]["positions"].clear()  # Reset movement history
                    hand_movement[i]["start_time"] = None  # Reset start time

            else:
                hand_movement[i]["hand_down_time"] = None  # Reset hand-down timer if hand is up

    # ✅ Display frame
    cv2.imshow("Wave Detection", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
