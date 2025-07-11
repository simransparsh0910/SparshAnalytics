import os
import cv2
import numpy as np
import onnxruntime
from typing import Tuple

def distance2bbox(points, distance):
    """Convert distance to bounding box."""
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)

def distance2kps(points, distance):
    """Convert distance to keypoints."""
    preds = []
    for i in range(5):  # Assuming 5 keypoints (eyes, nose, mouth)
        px = points[:, 0] + distance[:, i * 2]
        py = points[:, 1] + distance[:, i * 2 + 1]
        preds.append(px)
        preds.append(py)
    return np.stack(preds, axis=-1)

class SCRFD:
    def __init__(self, model_path: str, input_size: Tuple[int] = (640, 640), conf_thres: float = 0.6, iou_thres: float = 0.4) -> None:
        self.input_size = input_size
        self.conf_thres = conf_thres
        self.iou_thres = iou_thres

        self.fmc = 3
        self._feat_stride_fpn = [8, 16, 32]
        self._num_anchors = 2
        self.use_kps = True

        self.mean = 127.5
        self.std = 128.0

        self.center_cache = {}
        self._initialize_model(model_path=model_path)

    def _initialize_model(self, model_path: str):
        try:
            self.session = onnxruntime.InferenceSession(
                model_path, providers=["CUDAExecutionProvider","CPUExecutionProvider"]
            )
            self.output_names = [x.name for x in self.session.get_outputs()]
            self.input_names = [x.name for x in self.session.get_inputs()]
        except Exception as e:
            print(f"Failed to load the model: {e}")
            raise

    def forward(self, image, threshold):
        scores_list = []
        bboxes_list = []
        kpss_list = []  # To store keypoints
        input_size = tuple(image.shape[0:2][::-1])

        blob = cv2.dnn.blobFromImage(
            image, 1.0 / self.std, input_size, (self.mean, self.mean, self.mean), swapRB=True
        )
        outputs = self.session.run(self.output_names, {self.input_names[0]: blob})

        input_height = blob.shape[2]
        input_width = blob.shape[3]

        fmc = self.fmc
        for idx, stride in enumerate(self._feat_stride_fpn):
            scores = outputs[idx]
            bbox_preds = outputs[idx + fmc]
            bbox_preds = bbox_preds * stride
            if self.use_kps:
                kps_preds = outputs[idx + fmc * 2] * stride

            height = input_height // stride
            width = input_width // stride
            key = (height, width, stride)
            if key in self.center_cache:
                anchor_centers = self.center_cache[key]
            else:
                anchor_centers = np.stack(np.mgrid[:height, :width][::-1], axis=-1).astype(np.float32)
                anchor_centers = (anchor_centers * stride).reshape((-1, 2))
                if self._num_anchors > 1:
                    anchor_centers = np.stack([anchor_centers] * self._num_anchors, axis=1).reshape((-1, 2))
                if len(self.center_cache) < 100:
                    self.center_cache[key] = anchor_centers

            pos_inds = np.where(scores >= threshold)[0]
            bboxes = distance2bbox(anchor_centers, bbox_preds)
            pos_scores = scores[pos_inds]
            pos_bboxes = bboxes[pos_inds]
            scores_list.append(pos_scores)
            bboxes_list.append(pos_bboxes)

            if self.use_kps:
                kpss = distance2kps(anchor_centers, kps_preds)
                pos_kpss = kpss[pos_inds]
                kpss_list.append(pos_kpss)

        return scores_list, bboxes_list, kpss_list

    def detect(self, image, max_num=0, metric="max"):
        width, height = self.input_size

        im_ratio = float(image.shape[0]) / image.shape[1]
        model_ratio = height / width
        if im_ratio > model_ratio:
            new_height = height
            new_width = int(new_height / im_ratio)
        else:
            new_width = width
            new_height = int(new_width * im_ratio)

        det_scale = float(new_height) / image.shape[0]
        resized_image = cv2.resize(image, (new_width, new_height))

        det_image = np.zeros((height, width, 3), dtype=np.uint8)
        det_image[:new_height, :new_width, :] = resized_image

        scores_list, bboxes_list, kpss_list = self.forward(det_image, self.conf_thres)

        scores = np.vstack(scores_list)
        scores_ravel = scores.ravel()
        order = scores_ravel.argsort()[::-1]
        bboxes = np.vstack(bboxes_list) / det_scale
        kpss = np.vstack(kpss_list) / det_scale if self.use_kps else None

        pre_det = np.hstack((bboxes, scores)).astype(np.float32, copy=False)
        pre_det = pre_det[order, :]
        keep = self.nms(pre_det, iou_thres=self.iou_thres)
        det = pre_det[keep, :]
        if kpss is not None:
            kpss = kpss[order, :]
            kpss = kpss[keep, :]
        return det, kpss


    def nms(self, dets, iou_thres):
        x1 = dets[:, 0]
        y1 = dets[:, 1]
        x2 = dets[:, 2]
        y2 = dets[:, 3]
        scores = dets[:, 4]

        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1 + 1)
            h = np.maximum(0.0, yy2 - yy1 + 1)
            inter = w * h
            ovr = inter / (areas[i] + areas[order[1:]] - inter)

            indices = np.where(ovr <= iou_thres)[0]
            order = order[indices + 1]

        return keep


def draw_corners(image, bbox):
    if len(bbox) == 5:  # Ensure bbox contains the correct number of values
        x1, y1, x2, y2, score = bbox.astype(int)
        cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(image, f"{score:.2f}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
    else:
        print("Bounding box does not have enough values to draw")


if __name__ == "__main__":
    detector = SCRFD(model_path="det_2.5g.onnx")  # Ensure the correct model path
    cap = cv2.VideoCapture(r"C:\Users\spars\Downloads\payback.ts")  # Open the webcam

    while True:
        ret, frame = cap.read()
        if not cap.isOpened() or not ret:
            break
        frame = cv2.resize(frame,(640,640))
        # Detect faces and keypoints
        boxes_list, kpss_list = detector.detect(frame)
        print(f"Detected {len(boxes_list)} faces")

        if len(boxes_list) > 0:
            for i, boxes in enumerate(boxes_list):
                draw_corners(frame, boxes)  # Pass the bounding boxes
                # Optionally, handle keypoints with kpss_list[i]

        else:
            print("No faces detected")

        cv2.imshow("Face Detection", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
