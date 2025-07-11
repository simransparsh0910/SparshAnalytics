import numpy as np
import base64
import cv2
import json
import zmq
import logging
from datetime import datetime, timedelta,date
from PersonTracker import Tracker
import os
import torch
from ultralytics import YOLO
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
from model import CSRNet
from torchvision import transforms
from collections import deque
from PIL import Image 
from helpers import detect_dominant_color_hsv,load_person_attributes_resnet_model,extract_attributes,load_csrnet_model,crowd_estimation_with_csrnet,load_config
from sort import Sort
import requests
from queue import Queue
from cryptography.fernet import Fernet
import pickle 
import sys
from api import APIHandler
api_queue = Queue()

# Licensing variables
license_data = {}
license_valid = False
license_lock = threading.Lock()
LICENSE_KEY = b'wLDjLQ5ADsIor-anRTvyKIX38fXdkkdYk31TqEQ2grA='  # Must match the key used in generate_license.py
cipher_suite = Fernet(LICENSE_KEY)
LICENSE_FILE_PATH = 'license.bin'

# config 
config = load_config()
path = config["data"]["path_VA"]
port = config["data"]["port"]
api_config = config.get("api", {})
api_url = api_config.get("url", "").strip()
vms_ip = config.get("vms", {}).get("ip", "").strip()

# Initialize ZeroMQ Context for Publisher and Subscriber
context = zmq.Context()
zmq_socket = context.socket(zmq.PUB)
zmq_socket.connect(config['zmq']['publisher']['address'])

# license_zmq_socket = context.socket(zmq.PUB)
# license_zmq_socket.connect(config['zmq']['subscriber']['address_FRS'])

if vms_ip:
    print("VMS IP is set, will send alerts on VMS.")
    vms_zmq_socket = context.socket(zmq.PUB)
    vms_zmq_socket.connect(f"tcp://{vms_ip}:9907")

# Models
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

model = YOLO('yolov8s.pt')
model.to(device)

csrnet_model_path = "CSRNET_PartAmodel_best.pth"
csrnet_model = load_csrnet_model(csrnet_model_path,device)

pose_model = YOLO("yolov8s-pose.pt").to(device)

person_attributes_model_path = "Person_attributes_resnet50_peta.pth"
person_attributes_model = load_person_attributes_resnet_model(person_attributes_model_path,device)

fire_smoke_model = YOLO("fireandsmoke.pt")
fire_smoke_model.to(device)

fall_detection_model = YOLO("fall_model.pt").to(device)

intrusion_classes = config['data'].get('intrusion_classes', [0])

print(intrusion_classes)

CLASS_NAMES = {
    "0": "person",
    "1": "bicycle",
    "2": "car",
    "3": "motorcycle",
    "4": "airplane",
    "5": "bus",
    "6": "train",
    "7": "truck",
    "8": "boat",
    "9": "traffic light",
    "10": "fire hydrant",
    "11": "stop sign",
    "12": "parking meter",
    "13": "bench",
    "14": "bird",
    "15": "cat",
    "16": "dog",
    "17": "horse",
    "18": "sheep",
    "19": "cow",
    "20": "elephant",
    "21": "bear",
    "22": "zebra",
    "23": "giraffe",
    "24": "backpack",
    "25": "umbrella",
    "26": "handbag",
    "27": "tie",
    "28": "suitcase",
    "29": "frisbee",
    "30": "skis",
    "31": "snowboard",
    "32": "sports ball",
    "33": "kite",
    "34": "baseball bat",
    "35": "baseball glove",
    "36": "skateboard",
    "37": "surfboard",
    "38": "tennis racket",
    "39": "bottle",
    "40": "wine glass",
    "41": "cup",
    "42": "fork",
    "43": "knife",
    "44": "spoon",
    "45": "bowl",
    "46": "banana",
    "47": "apple",
    "48": "sandwich",
    "49": "orange",
    "50": "brocolli",
    "51": "carrot",
    "52": "hot dog",
    "53": "pizza",
    "54": "donut",
    "55": "cake",
    "56": "chair",
    "57": "couch",
    "58": "potted plant",
    "59": "bed",
    "60": "dining table",
    "61": "toilet",
    "62": "tv",
    "63": "laptop",
    "64": "mouse",
    "65": "remote",
    "66": "keyboard",
    "67": "cell phone",
    "68": "microwave",
    "69": "oven",
    "70": "toaster",
    "71": "sink",
    "72": "refrigerator",
    "73": "book",
    "74": "clock",
    "75": "vase",
    "76": "scissors",
    "77": "teddy bear",
    "78": "hair drier",
    "79": "toothbrush"
  }

FIRE_SMOKE_CLASS_NAMES = {
    "0": "fire",
    "1": "smoke"
}

FALL_CLASS_NAMES = {"0": "fall"}

# Dictionaries for managing alerts and initial frames
stream_flags = {}
entry_times={}
stream_threads= {}
crowd_formation_alert_time = {}
crowd_estimation_alert_time = {}
person_last_states = {}
waving_keypoint_history = {}  
waving_alert_time = {}
fire_smoke_alert_time = {}
waving_keypoint_history = {}  
waving_alert_time = {}
fall_alert_time = {}  
consecutive_fall_count = {}
wrong_direction_alert_time = {}
wrong_direction_history = {}
waiting_time_entry = {}  
waiting_time_alert_time = {}
directional_arrow_history = {}
directional_arrow_alert_time = {}

lock = threading.Lock()
json_lock = threading.Lock()

class LicenseError(Exception):
    """Custom exception for license-related errors."""
    pass

# Create LOGS directory if not exists
if not os.path.exists('LOGS'):
    os.makedirs('LOGS')


# Function to configure logging for a specific RTSP stream
def configure_logging(rtsp_id):
    logger = logging.getLogger(rtsp_id)
    logger.setLevel(logging.DEBUG)
    
    if not logger.handlers:
        fh = logging.FileHandler(f'LOGS/{rtsp_id}.log')
        fh.setLevel(logging.DEBUG)
        
        ch = logging.StreamHandler()
        ch.setLevel(logging.ERROR)
        
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        fh.setFormatter(formatter)
        ch.setFormatter(formatter)
        
        logger.addHandler(fh)
        logger.addHandler(ch)
    
    return logger

def load_license_file(file_path='/app/license.bin'):
    global license_data, license_valid
    logger = configure_logging('license_loader')
    try:
        with open(file_path, 'rb') as f:
            encrypted_data = f.read()
        serialized_data = cipher_suite.decrypt(encrypted_data)
        license_info = pickle.loads(serialized_data)

        if not all(key in license_info for key in ['num_cameras', 'num_analytics', 'expiry_date']):
            raise ValueError("Invalid license file format")
        
        with license_lock:
            license_data.update(license_info)
            license_valid = True
        logger.info("License file loaded successfully")
        return license_info
    except Exception as e:
        logger.error(f"Error loading license file: {e}")
        with license_lock:
            license_valid = False
        raise LicenseError(f"Failed to load or validate license file: {e}")


            
def load_streams_from_json(file_path):
    try:
        with open(file_path, 'r') as file:
            data = json.load(file)

            streams = {}
            analytics_dict = {}
            stream_metadata = {}  # New dictionary for storing additional fields

            for stream in data['streams']:
                rtsp_id = stream['id']
                streams[rtsp_id] = stream['url']
                analytics_dict[rtsp_id] = stream.get('analytics', [])
                
                # Save additional metadata
                stream_metadata[rtsp_id] = {
                    "name": stream.get('name', f"Stream {rtsp_id}"),
                    "fps": stream.get('fps', 2),  # Default FPS to 30 if not provided
                    "username": stream.get('username', ''),
                    "password": stream.get('password', ''),
                    "loitering_threshold" : stream.get("loitering_threshold",30),
                    "crowd_formation_threshold" : stream.get("crowd_formation_threshold", 5),
                    "crowd_formation_duration" : stream.get("crowd_formation_duration",10),
                    "crowd_estimation_threshold" : stream.get("crowd_estimation_threshold",15),
                    "crowd_estimation_duration" : stream.get("crowd_estimation_duration",10),
                    "entry_line_type" : stream.get("entry_line_type"),
                    "exit_line_type" : stream.get("exit_line_type"),
                    "direction": stream.get("direction", "Left to Right"),
                    "crowd_dispersion_threshold" : stream.get("crowd_dispersion_threshold",10),
                    "crowd_dispersion_duration" : stream.get("crowd_dispersion_duration",10)
                }

            return streams, analytics_dict, stream_metadata
    except Exception as e:
        print(f"Error loading JSON file: {e}")
        return {}, {}, {}


def save_streams_to_json(file_path, streams, analytics_dict, stream_metadata):
    try:
        with json_lock:
            data = {"streams": []}
            for rtsp_id, rtsp_url in streams.items():
                stream_data = {
                    "id": rtsp_id,
                    "url": rtsp_url,
                    "analytics": analytics_dict.get(rtsp_id, []),
                    "name": stream_metadata.get(rtsp_id, {}).get("name", f"Stream {rtsp_id}"),
                    "fps": stream_metadata.get(rtsp_id, {}).get("fps", 3),
                    "username": stream_metadata.get(rtsp_id, {}).get("username", ""),
                    "password": stream_metadata.get(rtsp_id, {}).get("password", ""),
                    "loitering_threshold" : stream_metadata.get(rtsp_id, {}).get("loitering_threshold") ,
                    "crowd_formation_threshold" : stream_metadata.get(rtsp_id, {}).get("crowd_formation_threshold"),
                    "crowd_formation_duration" : stream_metadata.get(rtsp_id, {}).get("crowd_formation_duration"),
                    "crowd_estimation_threshold": stream_metadata.get(rtsp_id, {}).get("crowd_estimation_threshold"),
                    "crowd_estimation_duration" : stream_metadata.get(rtsp_id, {}).get("crowd_estimation_duration"),
                    "entry_line_type" : stream_metadata.get(rtsp_id,{}).get("entry_line_type"),
                    "exit_line_type" : stream_metadata.get(rtsp_id,{}).get("exit_line_type"),
                    "direction" : stream_metadata.get(rtsp_id,{}).get("direction"),
                    "crowd_dispersion_threshold" : stream_metadata.get(rtsp_id,{}).get("crowd_dispersion_threshold"),
                    "crowd_dispersion_duration" : stream_metadata.get(rtsp_id,{}).get("crowd_dispersion_duration")
                }
                data["streams"].append(stream_data)

            with open(file_path, 'w') as file:
                json.dump(data, file, indent=4)
    except Exception as e:
        print(f"Error saving to JSON file: {e}")

def stop_stream(rtsp_id):
    """Stop the stream if it's running."""
    stream_flags[rtsp_id] = False
    if rtsp_id in stream_threads:
        future = stream_threads[rtsp_id]
        future.result()  
        del stream_threads[rtsp_id]

def start_stream(rtsp_id, rtsp_url, analytics_dict, metadata, executor):
    """Start the stream in a separate thread."""
    stream_flags[rtsp_id] = True  # Set the flag to True to allow processing
    stream_thread = executor.submit(process_stream, rtsp_id, rtsp_url, analytics_dict, metadata)
    stream_threads[rtsp_id] = stream_thread
    

def save_frame_and_send_intrusion_alert(rtsp_id, frame, person_id, folder_path='intrusion', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        
        filename = f'Intrusion_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        
        relative_path = os.path.join('intrusion', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url,  
            "PersonName": "Intrusion Detected",
            "Type": None,
            "Remark": None,
            "Event": "Intrusion_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : None
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Intrusion_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                print(json_vms)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms")
                
            if api_url:
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Intrusion_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "filename" : filename,
                    "Parameters": None
                }
                api_queue.put(api_payload)
                
            if logger:
                logger.info(f"Intrusion alert sent for {rtsp_id}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send Intrusion alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_intrusion_alert: {e}")
      
def save_frame_and_send_intrusion_attribute_alert(rtsp_id, frame, person_id, additional_data, folder_path='intrusion_attributes' , logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        
        filename = f'Intrusion_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        
        relative_path = os.path.join('intrusion_attributes', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url,   # Will be None if not found
            "PersonName": "Intrusion Detected",
            "Type": None,
            "Remark": None,
            "Event": "Intrusion_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : additional_data
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Intrusion_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                print(json_vms)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms")
                
            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Intrusion_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": additional_data
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Intrusion Attribute  alert sent for {rtsp_id}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send Intrusion Attribute alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_intrusion_attribute_alert: {e}")
                  
def save_frame_and_send_loitering_alert(rtsp_id, frame, person_id, folder_path='loitering', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
            
        filename = f'loitering_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)

        relative_path = os.path.join('loitering', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url,   # Will be None if not found
            "PersonName": "Loitering Detected",
            "Type": None,
            "Remark": None,
            "Event": "Loitering_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : None
        }
        json_data = json.dumps(payload)
        
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Loitering_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                print(json_vms)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms")
            
            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Loitering_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": None
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Loitering alert sent for {rtsp_id}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send loitering alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_loitering_alert: {e}")

def save_frame_and_send_crowd_formation_alert(rtsp_id, frame, count, folder_path='crowdformation_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
            
        filename = f'crowdformation_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)

        relative_path = os.path.join('crowdformation_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url,   # Will be None if not found
            "PersonName": "Crowd Formation Detected",
            "Type": None,
            "Remark": None,
            "Event": "Crowd_Formation_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
        }
        json_data = json.dumps(payload)
        
        try:
            zmq_socket.send_string(json_data)
            
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Crowd_Formation_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms")
                
            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Crowd_Formation_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Crowd Formation alert sent for {rtsp_id} with {count} persons.")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send crowd Formation alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_crowd_formation_alert: {e}")

def save_frame_and_send_crowd_estimation_alert(rtsp_id, frame, count,density_map_resized, folder_path='crowdestimation_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        density_map_path = os.path.join(folder_path,today_date,"density_maps")
        
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
            
        if not os.path.exists(density_map_path):
            os.makedirs(density_map_path)
            
        filename = f'crowdestimation_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)

        density_file_name = f'crowdestimation_densitymap_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        density_filepath = os.path.join(density_map_path, density_file_name)
        cv2.imwrite(density_filepath, density_map_resized)
        
        relative_path = os.path.join('crowdestimation_alerts', today_date, filename).replace(os.sep, '/')
        density_relative_path = os.path.join('crowdestimation_alerts',today_date,"density_maps",density_file_name ).replace(os.sep, '/')
        
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        original_image_url = f"https://{port}/api/images/{path}/{density_relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": original_image_url,
            "FullframeImage": detected_image_url,   # Will be None if not found
            "PersonName": "Crowd Estimation Detected",
            "Type": None,
            "Remark": None,
            "Event": "Crowd_Estimation_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
        }
        
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Crowd_Estimation_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for crowd estimation")
                
            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Crowd_Estimation_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Crowd Estimation alert sent for {rtsp_id} with {count} persons.")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send crowd Estimation alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_crowd_estimation_alert: {e}")
            
def save_frame_and_send_crowd_dispersion_alert(rtsp_id, frame, count, folder_path='crowd_dispersion_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
       
        
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
            
        filename = f'crowd_dispersion_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)

        relative_path = os.path.join('crowd_dispersion_alerts', today_date, filename).replace(os.sep, '/')
        
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": detected_image_url, 
            "FullframeImage": detected_image_url,  # Will be None if not found
            "PersonName": "Crowd Dispersion Detected",
            "Type": None,
            "Remark": None,
            "Event": "Crowd_Dispersion_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
        }
        
        json_data = json.dumps(payload)
       
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Crowd_Dispersion_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for crowd dispersion")
                
            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Crowd_Dispersion_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": {
                "type": "Person",
                "attributes": {
                    "count" : count
                }
            }
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Crowd Dispersion alert sent for {rtsp_id} with {count} persons.")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send crowd Dispersion alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_crowd_dispersion_alert: {e}")
  
def save_frame_and_send_fire_smoke_alert(rtsp_id, frame, detection_type, folder_path='fire_smoke_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
            
        filename = f'fire_smoke_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)

        relative_path = os.path.join('fire_smoke_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": f"{detection_type} Detected",
            "Type": None,
            "Remark": None,
            "Event": "Fire_Smoke_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": None
        }
        json_data = json.dumps(payload)
        zmq_socket.send_string(json_data)
        
        _, buffer = cv2.imencode('.jpg', frame)
        base64_image = base64.b64encode(buffer).decode('utf-8')
        
        if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Fire_Smoke_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Fire_Smoke_Detected")
                
        if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Fire_Smoke_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": None
                }
                api_queue.put(api_payload)
        if logger:
            logger.info(f"Fire/Smoke alert sent for {rtsp_id} ({detection_type} detected)")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_fire_smoke_alert: {e}")

def save_frame_and_send_waving_alert(rtsp_id, frame, person_id, folder_path='waving_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        filename = f'waving_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        relative_path = os.path.join('waving_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": "Waving Detected",
            "Type": None,
            "Remark": None,
            "Event": "Waving_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": None
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Waving_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Waving_Detected")
                
            if api_url:
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Waving_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": None
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Waving alert sent for {rtsp_id}, Person ID: {person_id}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send waving alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_waving_alert: {e}")

def save_frame_and_send_fall_alert(rtsp_id, frame, detection_type, folder_path='fall_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        filename = f'fall_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        relative_path = os.path.join('fall_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": f"{detection_type} Detected",
            "Type": None,
            "Remark": None,
            "Event": "Fall_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": None
        }
        json_data = json.dumps(payload)
        zmq_socket.send_string(json_data)
        
        _, buffer = cv2.imencode('.jpg', frame)
        base64_image = base64.b64encode(buffer).decode('utf-8')
        
        if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Fall_Detected",
                "Detection": "True"
                }
                
                json_vms = json.dumps(vms_payload)
                
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Fall_Detected")

        if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Fall_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": None
                }
                api_queue.put(api_payload)
        if logger:
            logger.info(f"Fall alert sent for {rtsp_id} ({detection_type} detected)")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_fall_alert: {e}")
            
def save_frame_and_send_wrong_direction_alert(rtsp_id, frame, person_id, direction, folder_path='wrong_direction_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        filename = f'wrong_direction_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        relative_path = os.path.join('wrong_direction_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": "Wrong Direction Detected",
            "Type": None,
            "Remark": f"Moving in wrong direction: {direction}",
            "Event": "Wrong_Direction_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": None
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Wrong_Direction_Detected",
                "Detection": "True"
                }
                json_vms = json.dumps(vms_payload)
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Wrong_Direction_Detected")

            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Wrong_Direction_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": None
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Wrong Direction alert sent for {rtsp_id}, Person ID: {person_id}, Direction: {direction}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send wrong direction alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_wrong_direction_alert: {e}")

def save_frame_and_send_waiting_time_alert(rtsp_id, frame, person_id, waiting_time, folder_path='waiting_time_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        
        filename = f'waiting_time_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        
        relative_path = os.path.join('waiting_time_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        additional_data = {
            "type": "Person",
            "attributes": {
                "person_id": int(person_id),
                "waiting_time_seconds": round(waiting_time, 2)
            }
        }
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": "Waiting Time Detected",
            "Type": None,
            "Remark": f"Person ID {person_id} waited for {round(waiting_time, 2)} seconds",
            "Event": "Waiting_Time_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": additional_data
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Waiting_Time_Detected",
                "Detection": "True"
                }
                json_vms = json.dumps(vms_payload)
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Waiting_Time_Detected")

            if api_url:
                
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Waiting_Time_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": additional_data
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Waiting Time alert sent for {rtsp_id}, Person ID: {person_id}, Waiting Time: {round(waiting_time, 2)} seconds")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send waiting time alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_waiting_time_alert: {e}")

def save_frame_and_send_directional_arrow_alert(rtsp_id, frame, person_id, direction, folder_path='directional_arrow_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        
        filename = f'directional_arrow_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        
        relative_path = os.path.join('directional_arrow_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": "Directional Alarms",
            "Type": None,
            "Remark": f"Person ID {person_id} moving in direction: {direction}",
            "Event": "Directional_Arrow_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": {
                "type": "Person",
                "attributes": {
                    "person_id": int(person_id),
                    "direction": direction
                }
            }
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')

            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Directional_Arrow_Detected",
                "Detection": "True"
                }
                json_vms = json.dumps(vms_payload)
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Directional_Arrow_Detected")

            if api_url:
               
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "Directional_Arrow_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": {
                "type": "Person",
                "attributes": {
                    "person_id": int(person_id),
                    "direction": direction
                }
            }
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"Directional Arrow alert sent for {rtsp_id}, Person ID: {person_id}, Direction: {direction}")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send directional arrow alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in save_frame_and_send_directional_arrow_alert: {e}")

def send_in_out_alert(rtsp_id, frame, entry_count, exit_count, folder_path='in_out_alerts', logger=None):
    try:
        today_date = datetime.now().strftime("%Y%m%d")
        date_folder_path = os.path.join(folder_path, today_date)
        if not os.path.exists(date_folder_path):
            os.makedirs(date_folder_path)
        
        filename = f'in_out_{rtsp_id}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jpg'
        filepath = os.path.join(date_folder_path, filename)
        cv2.imwrite(filepath, frame)
        
        relative_path = os.path.join('in_out_alerts', today_date, filename).replace(os.sep, '/')
        detected_image_url = f"https://{port}/api/images/{path}/{relative_path}"
        
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url,
            "OriginalImage": detected_image_url,
            "FullframeImage": detected_image_url, 
            "PersonName": "In Out Count",
            "Type": None,
            "Remark": f"",
            "Event": "In_Out_Detected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters": {
                "type": "Person",
                "attributes": {
                    "entry_count" : entry_count,
                    "exit_count" : exit_count
                }
            }
        }
        json_data = json.dumps(payload)
        print(json_data)
        try:
            zmq_socket.send_string(json_data)
            _, buffer = cv2.imencode('.jpg', frame)
            base64_image = base64.b64encode(buffer).decode('utf-8')

            if vms_ip:
                vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "In_Out_Detected",
                "Detection": "True"
                }
                json_vms = json.dumps(vms_payload)
                vms_zmq_socket.send_string(json_vms)
                print("sent data to vms for Directional_Arrow_Detected")

            if api_url:
               
                api_payload = {
                    "device_id": rtsp_id,
                    "image_url": detected_image_url,
                    "event_type": "In_Out_Detected",
                    "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "base64_image": base64_image,
                    "Parameters": {
                "type": "Person",
                "attributes": {
                    "entry_count" : entry_count,
                    "exit_count" : exit_count
                }
            }
                }
                api_queue.put(api_payload)
            if logger:
                logger.info(f"In Out alert sent ")
        except Exception as e:
            if logger:
                logger.error(f"Failed to send in out alert to ZeroMQ socket: {e}")
    except Exception as e:
        if logger:
            logger.error(f"Error in in_out_alert: {e}")
            
def process_stream(rtsp_id, rtsp_url, analytics_dict ,metadata):
    print(f"starting main thread for rtsp_id : {rtsp_id}: {rtsp_url}")
    logger = configure_logging(rtsp_id)
    logger.info(f"Starting processing stream {rtsp_id} URL: {rtsp_url}")
    stream_flags[rtsp_id] = True
    
    loitering_threshold = metadata.get("loitering_threshold")
    crowd_formation_threshold = metadata.get("crowd_formation_threshold")
    crowd_formation_duration = metadata.get("crowd_formation_duration")
    crowd_estimation_threshold = metadata.get("crowd_estimation_threshold")
    crowd_estimation_duration = metadata.get("crowd_estimation_duration")
    crowd_dispersion_threshold = metadata.get("crowd_dispersion_threshold")
    crowd_dispersion_duration = metadata.get("crowd_dispersion_duration")
    entry_count = 0
    exit_count = 0
    prev_entry_count = 0
    prev_exit_count = 0
    consecutive_fire_smoke_count = 0
    consecutive_fall_count[rtsp_id] = 0
    
    Intrusion_alert_time = datetime.now() - timedelta(seconds=5)
    Intrusion_attributes_alert_time = datetime.now() - timedelta(seconds=5)# Initialize loitering alert time
    crowd_alert_time  = datetime.now() - timedelta(seconds=5)
    loitering_alert_time = datetime.now() - timedelta(seconds=5)
    crowd_formation_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=crowd_formation_duration)
    crowd_estimation_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=crowd_estimation_duration)
    crowd_dispersion_alert_time = datetime.now() - timedelta(seconds = crowd_dispersion_duration)
    fire_smoke_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=5)
    fall_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=5)
    wrong_direction_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=5)
    waiting_time_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=5)
    directional_arrow_alert_time[rtsp_id] = datetime.now() - timedelta(seconds=5)
    
    Intrusion_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "intrusion"), []), dtype=np.int32
    ).reshape((-1, 1, 2))

    intrusion_with_attributes_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "intrusion_with_attributes"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    loitering_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "loitering"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    crowd_formation_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "crowd_formation"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    crowd_dispersion_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "crowd_dispersion"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    fire_smoke_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "fire_smoke_detection"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    waving_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "person_waving_hand"), []),
        dtype=np.int32
    ).reshape((-1, 1, 2))
    
    fall_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "fall_detection"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    wrong_direction_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "wrong_direction"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    waiting_time_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "waiting_time_in_roi"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    directional_arrow_roi = np.array(
        next((analytic["roi"] for analytic in analytics_dict if analytic["type"] == "Directional_arrow"), []), dtype=np.int32
    ).reshape((-1, 1, 2))
    
    while stream_flags[rtsp_id]:  # Check if the stream should keep running
        try:
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

            if not cap.isOpened():
                logger.error(f"Failed to open stream {rtsp_id}. Retrying...")
                cap.release()
                time.sleep(5)  # Wait 5 seconds before retrying
                continue
            
            last_alert_time = datetime.now() - timedelta(seconds=5)
            fps = cap.get(cv2.CAP_PROP_FPS)
            stream_fps  = metadata.get('fps',2)
            frame_interval = max(int(fps / stream_fps), 1)
            frame_count = 0
            
            person_tracker = Sort(max_age=30,min_hits=3,iou_threshold = 0.3)
            waving_tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
            in_out_tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
            wrong_direction_tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
            waiting_time_tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
            directional_arrow_tracker = Sort(max_age=30, min_hits=3, iou_threshold=0.3)
            
            while cap.isOpened() and stream_flags[rtsp_id]:  # Check flag in frame processing loop as well
                try:
                    ret, frame = cap.read()
                    if not ret:
                        logger.error(f"Frame not received for {rtsp_id}. Attempting to reconnect...")
                        break

                    frame_count += 1
                    if frame_count % frame_interval != 0:
                        continue
                    
                    frame = cv2.resize(frame, (640, 640))

                    results = model(frame, classes=intrusion_classes, iou=0.25, conf=0.3,verbose=False)
                    
                    person_bboxes = [box.xyxy[0] for box in results[0].boxes if int(box.cls[0]) == 0]
                    
                    detected_objects = [
                    {"bbox": box.xyxy[0], "class_id": int(box.cls[0])} for box in results[0].boxes
                    ]
                    
                    # Loitering Detection
                    if "intrusion" in [analytic["type"] for analytic in analytics_dict]:
                        for obj in detected_objects:
                            x1, y1, x2, y2 = map(int, obj["bbox"])
                            class_id = obj["class_id"]
                            class_name = CLASS_NAMES.get(str(class_id), f"Class {class_id}")

                            # Draw bounding box and label
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0,0,255), 2)
                            text = f"{class_name}"
                            (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                            cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                            cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                            # Check if object is inside the ROI
                            point_to_check = ((x1 + x2) // 2, (y1 + y2) // 2)
                            is_inside_roi = cv2.pointPolygonTest(Intrusion_roi, point_to_check, False) >= 0

                            # Check if the object belongs to loitering classes
                            if is_inside_roi and class_id in intrusion_classes:
                                current_time = datetime.now()
                                if current_time - Intrusion_alert_time >= timedelta(seconds=5):  # Alert interval of 5 seconds
                                    
                                    save_frame_and_send_intrusion_alert(rtsp_id, frame, f'{class_name}_{rtsp_id}', logger=logger)
                                    Intrusion_alert_time = current_time
                    
                    if "intrusion_with_attributes" in [analytic["type"] for analytic in analytics_dict]:
                        for obj in detected_objects:
                            x1, y1, x2, y2 = map(int, obj["bbox"])
                            class_id = obj["class_id"]
                            class_name = CLASS_NAMES.get(str(class_id))

                            # Draw bounding box and label
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                            text = f"{class_name}"
                            (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                            cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                            cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                            # Check if object is inside the ROI
                            point_to_check = ((x1 + x2) // 2, (y1 + y2) // 2)
                            is_inside_roi = cv2.pointPolygonTest(intrusion_with_attributes_roi, point_to_check, False) >= 0

                            # Check if the object belongs to intrusion classes
                            if is_inside_roi and class_id in intrusion_classes:
                                current_time = datetime.now()
                                if current_time - Intrusion_attributes_alert_time >= timedelta(seconds=5):  # Alert interval of 5 seconds
                                    # Initialize additional data for the alert
                                    
                                    attributes_data = {}

                                    # Detect color for all intrusion classes
                                    color_info = detect_dominant_color_hsv(frame, [x1, y1, x2, y2])
                                    attributes_data["color"] = color_info

                                    # Extract attributes only if the class is 'person' (class_id == 0)
                                    if class_id == 0:  # Person
                                        person_attributes = extract_attributes(person_attributes_model, frame, [x1, y1, x2, y2], device)
                                        attributes_data.update(person_attributes)

                                    additional_data = {
                                        "type": class_name,
                                        "attributes": attributes_data
                                    }
                                    print(additional_data)
                                    save_frame_and_send_intrusion_attribute_alert(rtsp_id, frame, f'{class_name}_{rtsp_id}', additional_data,logger=logger)
                                    Intrusion_attributes_alert_time = current_time
                                       
                    if "loitering" in [analytic["type"] for analytic in analytics_dict]:
                        loit_dets = []
                        for box in results[0].boxes:
                            class_id = int(box.cls[0].cpu()) 
                            if class_id == 0:  
                                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                                score = float(box.conf[0].cpu().numpy())
                                loit_dets.append([x1, y1, x2, y2, score])
                        
                        loit_dets = np.array(loit_dets, dtype=np.float32) if len(loit_dets) > 0 else np.empty((0, 5), dtype=np.float32)
                        tracked_objects = person_tracker.update(loit_dets)
                        current_time = datetime.now()
                        
                        for obj in tracked_objects:
                            x1, y1, x2, y2, person_id = map(int, obj)  
                            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2  
                            
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                            text = f"Person, ID: {person_id}"
                            cv2.putText(frame, text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                           
                            if cv2.pointPolygonTest(loitering_roi, (cx, cy), False) >= 0:
                                if person_id not in entry_times:
                                    entry_times[person_id] = current_time
                                    
                                time_in_roi = current_time - entry_times[person_id]
                                loitering_threshold_timedelta = timedelta(seconds=loitering_threshold)
                                if time_in_roi >= loitering_threshold_timedelta:
                                    
                                    if current_time - loitering_alert_time >= timedelta(seconds=5):
                                        logger.info(f"Loitering detected for person ID {person_id} in stream {rtsp_id} (time in ROI: {time_in_roi})")
                                        save_frame_and_send_loitering_alert(rtsp_id, frame, person_id, logger=logger)
                                        loitering_alert_time = current_time
                            else:
                                
                                if person_id in entry_times:
                                    del entry_times[person_id]


                    if "crowd_formation" in [analytic["type"] for analytic in analytics_dict]:
                        person_in_roi = 0 
                        for x1_p, y1_p, x2_p, y2_p in person_bboxes:
                            point_to_check = (int((x1_p + x2_p)/2), int((y1_p + y2_p ) / 2))
                            is_person_inside_roi = cv2.pointPolygonTest(crowd_formation_roi,point_to_check,False) >= 0 
                            if is_person_inside_roi :
                                person_in_roi +=1 
                        print(person_in_roi)
                        if person_in_roi > crowd_formation_threshold:
                            current_time = datetime.now()
                            if current_time - crowd_formation_alert_time[rtsp_id] >= timedelta(seconds=crowd_formation_duration):
                                print(f" crowd_formation detected at {rtsp_id}")
                                logger.info(f"Crowd formation detected with {person_in_roi} persons in ROI for {rtsp_id}")
                                save_frame_and_send_crowd_formation_alert(rtsp_id, frame, person_in_roi, logger=logger)
                                crowd_formation_alert_time[rtsp_id] = current_time
                    
                    if "crowd_estimation" in [analytic["type"] for analytic in analytics_dict]:
                        
                        crowd_count_in_roi, density_map = crowd_estimation_with_csrnet(frame, csrnet_model, device)
                        print(crowd_count_in_roi)
                        
                        density_map_normalized = (density_map / density_map.max() * 255).astype(np.uint8)
                        density_map_colored = cv2.applyColorMap(density_map_normalized, cv2.COLORMAP_JET)

                        density_map_resized = cv2.resize(density_map_colored, (640, 640))
                        # combined_frame = np.hstack((frame, density_map_resized))  # Combine frame and density map side by side
                        # cv2.imshow(f"Density Map - {rtsp_id}", combined_frame)

                        if crowd_count_in_roi > crowd_estimation_threshold:
                            current_time = datetime.now()
                            if current_time - crowd_estimation_alert_time[rtsp_id] >= timedelta(seconds=crowd_estimation_duration):
                                logger.info(f"Crowd estimation detected with {crowd_count_in_roi} persons in ROI for {rtsp_id}.")
                                save_frame_and_send_crowd_estimation_alert(rtsp_id, frame, crowd_count_in_roi, density_map_resized,logger=logger)
                                crowd_estimation_alert_time[rtsp_id] = current_time   
                                
                    if "crowd_dispersion" in [analytic["type"] for analytic in analytics_dict]:
                        dis_person_in_roi = 0
                        for x1_p,y1_p,x2_p,y2_p in person_bboxes:
                            point_to_check = (int((x1_p+x2_p)/2) , int((y1_p+y2_p) /2))
                            is_person_inside_roi = cv2.pointPolygonTest(crowd_dispersion_roi,point_to_check,False) >= 0
                            if is_person_inside_roi:
                                dis_person_in_roi +=1
                            
                        current_time = datetime.now()
                        if dis_person_in_roi < crowd_dispersion_threshold:
                            if current_time - crowd_dispersion_alert_time >=timedelta(seconds=crowd_dispersion_duration):
                                logger.info(f"Crowd Dispersion detected with {dis_person_in_roi} persons in ROI for {rtsp_id}.")
                                save_frame_and_send_crowd_dispersion_alert(rtsp_id,frame,dis_person_in_roi,logger=logger)
                                crowd_dispersion_alert_time = current_time
                        else:
                            crowd_dispersion_alert_time = current_time
                            
                    if "fire_smoke_detection" in [analytic["type"] for analytic in analytics_dict]:
                            fire_smoke_results = fire_smoke_model(frame, iou=0.25, conf=0.5, verbose=False)
                            fire_smoke_detections = [
                                {"bbox": box.xyxy[0], "class_id": int(box.cls[0])} for box in fire_smoke_results[0].boxes
                            ]
                            
                            # Check if any fire/smoke detection is within ROI
                            detection_in_roi = False
                            last_class_name = None  # Track the class name for the alert
                            for detection in fire_smoke_detections:
                                x1, y1, x2, y2 = map(int, detection["bbox"])
                                class_id = detection["class_id"]
                                class_name = FIRE_SMOKE_CLASS_NAMES.get(str(class_id), f"Class {class_id}")

                                # Draw bounding box and label
                                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 165, 0), 2)  # Orange color for fire/smoke
                                text = f"{class_name}"
                                (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                                cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                                cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                                # Check if detection is inside the ROI
                                point_to_check = ((x1 + x2) // 2, (y1 + y2) // 2)
                                is_inside_roi = cv2.pointPolygonTest(fire_smoke_roi, point_to_check, False) >= 0

                                if is_inside_roi:
                                    detection_in_roi = True
                                    last_class_name = class_name 
                                    break  
                            
                            current_time = datetime.now()
                            if detection_in_roi:
                                consecutive_fire_smoke_count += 1
                                
                                # Check if 4 consecutive detections have occurred
                                if consecutive_fire_smoke_count >= 4:
                                    if current_time - fire_smoke_alert_time[rtsp_id] >= timedelta(seconds=5):
                                        logger.info(f"{last_class_name} detected for 4 consecutive frames in stream {rtsp_id}")
                                        save_frame_and_send_fire_smoke_alert(rtsp_id, frame, last_class_name, logger=logger)
                                        fire_smoke_alert_time[rtsp_id] = current_time
                                        consecutive_fire_smoke_count = 0 
                            else:
                                
                                consecutive_fire_smoke_count = 0
                                
                        
                    if "person_in_out_count" in [analytic["type"] for analytic in analytics_dict]:
                        # Get analytics data
                        in_out_analytic = next((a for a in analytics_dict if a["type"] == "person_in_out_count"), None)

                        if in_out_analytic:
                            entry_line_points = np.array(in_out_analytic.get("entry_line", []), dtype=np.int32)
                            exit_line_points = np.array(in_out_analytic.get("exit_line", []), dtype=np.int32)

                            # Get line types from metadata
                            entry_line_type = metadata.get("entry_line_type", "horizontal")  # From stream metadata
                            exit_line_type = metadata.get("exit_line_type", "horizontal")      # From stream metadata

                            # Compute reference values based on line type
                            if entry_line_type == 'horizontal':
                                entry_ref = (entry_line_points[0][1] + entry_line_points[1][1]) // 2
                                cv2.line(frame, (0, entry_ref), (frame.shape[1], entry_ref), (0, 255, 0), 2)
                            elif entry_line_type == 'vertical':
                                entry_ref = (entry_line_points[0][0] + entry_line_points[1][0]) // 2
                                cv2.line(frame, (entry_ref, 0), (entry_ref, frame.shape[0]), (0, 255, 0), 2)

                            if exit_line_type == 'horizontal':
                                exit_ref = (exit_line_points[0][1] + exit_line_points[1][1]) // 2
                                cv2.line(frame, (0, exit_ref), (frame.shape[1], exit_ref), (0, 0, 255), 2)
                            elif exit_line_type == 'vertical':
                                exit_ref = (exit_line_points[0][0] + exit_line_points[1][0]) // 2
                                cv2.line(frame, (exit_ref, 0), (exit_ref, frame.shape[0]), (0, 0, 255), 2)

                            # Prepare detection boxes for SORT
                            dets = []
                            for box in person_bboxes:
                                x1, y1, x2, y2 = map(int, box)
                                dets.append([x1, y1, x2, y2, 0.9])  # Assuming high confidence
                            dets = np.array(dets, dtype=np.float32) if len(dets) > 0 else np.empty((0, 5), dtype=np.float32)

                            # Update SORT tracker
                            tracked_objects = in_out_tracker.update(dets)

                            # Loop over tracked objects
                            for obj in tracked_objects:
                                x1, y1, x2, y2, person_id = map(int, obj)
                                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2  # Center point

                                # Initialize state
                                if person_id not in person_last_states:
                                    person_last_states[person_id] = {
                                        'crossed_entry': False,
                                        'crossed_exit': False
                                    }

                                # Entry Detection
                                if entry_line_type == 'horizontal' and cy < entry_ref and not person_last_states[person_id]['crossed_entry']:
                                    entry_count += 1
                                    person_last_states[person_id]['crossed_entry'] = True
                                elif entry_line_type == 'vertical' and cx < entry_ref and not person_last_states[person_id]['crossed_entry']:
                                    entry_count += 1
                                    person_last_states[person_id]['crossed_entry'] = True

                                # Exit Detection
                                if exit_line_type == 'horizontal' and cy < exit_ref and not person_last_states[person_id]['crossed_exit']:
                                    exit_count += 1
                                    person_last_states[person_id]['crossed_exit'] = True
                                elif exit_line_type == 'vertical' and cx > exit_ref and not person_last_states[person_id]['crossed_exit']:
                                    exit_count += 1
                                    person_last_states[person_id]['crossed_exit'] = True

                                # Draw bounding box and ID
                                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
                                cv2.putText(frame, f'ID: {person_id}', (x1, y1 - 5),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

                            # Draw count overlay
                            count_text = f"Entered: {entry_count} | Exited: {exit_count}"
                            cv2.putText(frame, count_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2, cv2.LINE_AA)

                            # Optional: Send alert when counts change
                            if entry_count > prev_entry_count or exit_count > prev_exit_count:
                                print(f"Entry: {entry_count}, Exit: {exit_count}")
                                send_in_out_alert(rtsp_id, frame, entry_count, exit_count)
                            
                            # Update previous counts
                            prev_entry_count = entry_count
                            prev_exit_count = exit_count
                    
                    # --- Waving Hand Detection ---
                    if "person_waving_hand" in [analytic["type"] for analytic in analytics_dict]:
                        pose_results = pose_model(frame,conf=0.3,iou=0.3, verbose=False)

                        # Prepare detections for SORT
                        wave_dets = []
                        for result in pose_results:
                            keypoints = result.keypoints.xy.cpu().numpy()
                            boxes = result.boxes.xyxy.cpu().numpy()

                            for idx, (keypoint, box) in enumerate(zip(keypoints, boxes)):
                                x1, y1, x2, y2 = map(int, box)
                                conf = result.boxes.conf[idx].cpu().numpy() if result.boxes.conf is not None else 0.5
                                wave_dets.append([x1, y1, x2, y2, conf])
                        
                        wave_dets = np.array(wave_dets, dtype=np.float32) if len(wave_dets) > 0 else np.empty((0, 5), dtype=np.float32)
                        # Update SORT tracker with new detections
                        tracked_objects = waving_tracker.update(wave_dets)

                        # Loop through tracked objects
                        for obj in tracked_objects:
                            x1, y1, x2, y2, person_id = map(int, obj)

                            # Find matching keypoint for this tracked object
                            matched_keypoint = None
                            for result in pose_results:
                                keypoints_list = result.keypoints.xy.cpu().numpy()
                                boxes_list = result.boxes.xyxy.cpu().numpy()
                                for kp, box in zip(keypoints_list, boxes_list):
                                    kpx1, kpy1, kpx2, kpy2 = map(int, box)
                                    if abs(kpx1 - x1) < 10 and abs(kpy1 - y1) < 10:  # simple IoU proxy
                                        matched_keypoint = kp
                                        break
                                if matched_keypoint is not None:
                                    break

                            if matched_keypoint is None:
                                continue

                            left_shoulder = matched_keypoint[5] if len(matched_keypoint) > 5 else None
                            right_shoulder = matched_keypoint[6] if len(matched_keypoint) > 6 else None
                            left_elbow = matched_keypoint[7] if len(matched_keypoint) > 7 else None
                            right_elbow = matched_keypoint[8] if len(matched_keypoint) > 8 else None
                            left_wrist = matched_keypoint[9] if len(matched_keypoint) > 9 else None
                            right_wrist = matched_keypoint[10] if len(matched_keypoint) > 10 else None

                            # Draw Bounding Box
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

                            # Draw Person ID Text
                            id_text = f"ID: {person_id}"
                            (text_width, text_height), _ = cv2.getTextSize(id_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                            cv2.rectangle(frame, (x1, y1 - 30), (x1 + text_width + 10, y1), (0, 255, 0), -1)
                            cv2.putText(frame, id_text, (x1 + 5, y1 - 10),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                            # Draw Keypoints
                            for pt in [left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist]:
                                if pt is not None:
                                    cv2.circle(frame, (int(pt[0]), int(pt[1])), 5, (0, 0, 255), -1)

                            # ROI Check
                            point_to_check = ((x1 + x2) // 2, (y1 + y2) // 2)
                            in_waving_roi = cv2.pointPolygonTest(waving_roi, point_to_check, False) >= 0
                            if not in_waving_roi:
                                continue

                            # Initialize history for this person
                            if person_id not in waving_keypoint_history:
                                waving_keypoint_history[person_id] = {
                                    'positions': [],
                                    'start_time': None,
                                    'alert_sent': False
                                }

                            wrist_positions = []
                            if left_wrist is not None:
                                wrist_positions.append(left_wrist[0])
                            if right_wrist is not None:
                                wrist_positions.append(right_wrist[0])

                            if wrist_positions:
                                waving_keypoint_history[person_id]['positions'].extend(wrist_positions)
                                waving_keypoint_history[person_id]['positions'] = waving_keypoint_history[person_id]['positions'][-30:]

                            positions = waving_keypoint_history[person_id]['positions']
                            if len(positions) >= 20:
                                movement_range = max(positions) - min(positions)
                                elbow_above = False
                                if left_elbow is not None and left_shoulder is not None and left_elbow[1] < left_shoulder[1]:
                                    elbow_above = True
                                elif right_elbow is not None and right_shoulder is not None and right_elbow[1] < right_shoulder[1]:
                                    elbow_above = True

                                if movement_range > 50 and elbow_above:
                                    if waving_keypoint_history[person_id]['start_time'] is None:
                                        waving_keypoint_history[person_id]['start_time'] = time.time()

                                    if time.time() - waving_keypoint_history[person_id]['start_time'] >= 2 and not waving_keypoint_history[person_id]['alert_sent']:
                                        current_time = datetime.now()
                                        if current_time - waving_alert_time.get(person_id, datetime.min) >= timedelta(seconds=5):
                                            save_frame_and_send_waving_alert(rtsp_id, frame, person_id, logger=logger)
                                            waving_alert_time[person_id] = current_time
                                            waving_keypoint_history[person_id]['alert_sent'] = True
                                            waving_keypoint_history[person_id]['positions'] = []  # Reset after alert
                                            waving_keypoint_history[person_id]['start_time'] = None
                                else:
                                    waving_keypoint_history[person_id]['start_time'] = None
                    
                    if "fall_detection" in [analytic["type"] for analytic in analytics_dict]:
                        fall_results = fall_detection_model(frame, iou=0.25, conf=0.5, verbose=False)
                        fall_detections = [
                            {"bbox": box.xyxy[0], "class_id": int(box.cls[0])} for box in fall_results[0].boxes
                        ]
                        detection_in_roi = False
                        last_class_name = None
                        for detection in fall_detections:
                            x1, y1, x2, y2 = map(int, detection["bbox"])
                            class_id = detection["class_id"]
                            class_name = FALL_CLASS_NAMES.get(str(class_id), f"Class {class_id}")
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 0), 2)  # Blue for fall
                            text = f"{class_name}"
                            (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                            cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                            cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                            point_to_check = ((x1 + x2) // 2, (y1 + y2) // 2)
                            is_inside_roi = cv2.pointPolygonTest(fall_roi, point_to_check, False) >= 0
                            if is_inside_roi:
                                detection_in_roi = True
                                last_class_name = class_name
                                break
                        current_time = datetime.now()
                        if detection_in_roi:
                            consecutive_fall_count[rtsp_id] += 1
                            if consecutive_fall_count[rtsp_id] >= 4:
                                if current_time - fall_alert_time[rtsp_id] >= timedelta(seconds=5):
                                    logger.info(f"{last_class_name} detected for 4 consecutive frames in stream {rtsp_id}")
                                    save_frame_and_send_fall_alert(rtsp_id, frame, last_class_name, logger=logger)
                                    fall_alert_time[rtsp_id] = current_time
                                    consecutive_fall_count[rtsp_id] = 0
                        else:
                            consecutive_fall_count[rtsp_id] = 0                                
                                           
                    if "wrong_direction" in [analytic["type"] for analytic in analytics_dict]:
                        expected_direction = metadata.get("direction", "Left to Right")
                        wrong_dets = []
                        for box in person_bboxes:
                            x1, y1, x2, y2 = map(int, box)
                            wrong_dets.append([x1, y1, x2, y2, 0.9])
                        wrong_dets = np.array(wrong_dets, dtype=np.float32) if len(wrong_dets) > 0 else np.empty((0, 5), dtype=np.float32)

                        tracked_objects = wrong_direction_tracker.update(wrong_dets)

                        for obj in tracked_objects:
                            x1, y1, x2, y2, person_id = map(int, obj)
                            cx = (x1 + x2) // 2
                            point_to_check = (cx, (y1 + y2) // 2)
                            is_inside_roi = cv2.pointPolygonTest(wrong_direction_roi, point_to_check, False) >= 0

                            if not is_inside_roi:
                                continue

                            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 0), 2)
                            cv2.putText(frame, f'ID: {person_id}', (x1, y1 - 5),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

                            if person_id not in wrong_direction_history:
                                wrong_direction_history[person_id] = deque(maxlen=30)

                            wrong_direction_history[person_id].append(cx)

                            detected_direction = "Stationary"
                            if len(wrong_direction_history[person_id]) >= 10:
                                movement = wrong_direction_history[person_id][-1] - wrong_direction_history[person_id][0]
                                detected_direction = "Right to Left" if movement < 0 else "Left to Right"

                                if detected_direction != expected_direction:
                                    current_time = datetime.now()
                                    if current_time - wrong_direction_alert_time[rtsp_id] >= timedelta(seconds=5):
                                        logger.info(f"Wrong direction detected for person ID {person_id} in stream {rtsp_id}: Expected {expected_direction}, Detected {detected_direction}")
                                        save_frame_and_send_wrong_direction_alert(rtsp_id, frame, person_id, detected_direction, logger=logger)
                                        wrong_direction_alert_time[rtsp_id] = current_time

                            direction_text = f"Dir: {detected_direction}"
                            (text_w, text_h), _ = cv2.getTextSize(direction_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                            cv2.rectangle(frame, (x1, y1 - text_h - 25), (x1 + text_w, y1 - 15), (0, 0, 0), -1)
                            cv2.putText(frame, direction_text, (x1, y1 - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                    
                    if "waiting_time_in_roi" in [analytic["type"] for analytic in analytics_dict]:
                        wait_time_dets = []
                        for box in results[0].boxes:
                            class_id = int(box.cls[0].cpu())
                            if class_id == 0:
                                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                                score = float(box.conf[0].cpu().numpy())
                                wait_time_dets.append([x1, y1, x2, y2, score])
                        
                        wait_time_dets = np.array(wait_time_dets, dtype=np.float32) if len(wait_time_dets) > 0 else np.empty((0, 5), dtype=np.float32)
                        tracked_objects = waiting_time_tracker.update(wait_time_dets)
                        current_time = datetime.now()
                        
                        for obj in tracked_objects:
                            x1, y1, x2, y2, person_id = map(int, obj)
                            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                            
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 2)
                            
                            is_inside_roi = cv2.pointPolygonTest(waiting_time_roi, (cx, cy), False) >= 0
                            
                            if is_inside_roi:
                                if person_id not in waiting_time_entry:
                                    waiting_time_entry[person_id] = current_time
                                
                                time_in_roi = (current_time - waiting_time_entry[person_id]).total_seconds()
                                
                                text = f"ID: {person_id}, Time: {round(time_in_roi, 1)}s"
                                (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                                cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                                cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                            else:
                                if person_id in waiting_time_entry:
                                    time_in_roi = (current_time - waiting_time_entry[person_id]).total_seconds()
                                    
                                    text = f"ID: {person_id}, Time: {round(time_in_roi, 1)}s"
                                    (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                                    cv2.rectangle(frame, (x1, y1 - text_h - 10), (x1 + text_w, y1), (0, 0, 0), -1)
                                    cv2.putText(frame, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                                    
                                    if current_time - waiting_time_alert_time.get(rtsp_id, datetime.min) >= timedelta(seconds=5):
                                        logger.info(f"Person ID {person_id} exited ROI in stream {rtsp_id} after {round(time_in_roi, 2)} seconds")
                                        save_frame_and_send_waiting_time_alert(rtsp_id, frame, person_id, time_in_roi, logger=logger)
                                        waiting_time_alert_time[rtsp_id] = current_time
                                    
                                    del waiting_time_entry[person_id]
                    
                    if "Directional_arrow" in [analytic["type"] for analytic in analytics_dict]:
                        arrow_dets = []
                        for box in person_bboxes:
                            x1, y1, x2, y2 = map(int, box)
                            arrow_dets.append([x1, y1, x2, y2, 0.9])
                        arrow_dets = np.array(arrow_dets, dtype=np.float32) if len(arrow_dets) > 0 else np.empty((0, 5), dtype=np.float32)
                        tracked_objects = directional_arrow_tracker.update(arrow_dets)
                        current_time = datetime.now()
                        for obj in tracked_objects:
                            x1, y1, x2, y2, person_id = map(int, obj)
                            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                            point_to_check = (cx, cy)
                            is_inside_roi = cv2.pointPolygonTest(directional_arrow_roi, point_to_check, False) >= 0
                            if not is_inside_roi:
                                continue
                            if person_id not in directional_arrow_history:
                                directional_arrow_history[person_id] = deque(maxlen=10)
                            directional_arrow_history[person_id].append((cx, cy))
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 255), 2)
                            cv2.putText(frame, f'ID: {person_id}', (x1, y1 - 5),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                            if len(directional_arrow_history[person_id]) >= 2:
                                prev_cx, prev_cy = directional_arrow_history[person_id][-2]
                                curr_cx, curr_cy = directional_arrow_history[person_id][-1]
                                # Scale arrow length by 3x
                                arrow_dx = curr_cx - prev_cx
                                arrow_dy = curr_cy - prev_cy
                                arrow_end_x = int(curr_cx + arrow_dx * 2)  # Extend by 200% (3x total length)
                                arrow_end_y = int(curr_cy + arrow_dy * 2)
                                cv2.arrowedLine(frame, (prev_cx, prev_cy), (arrow_end_x, arrow_end_y),
                                                (255, 0, 255), 3, tipLength=0.5)
                                dx = curr_cx - prev_cx
                                dy = curr_cy - prev_cy
                                direction = "Stationary"
                                if abs(dx) > abs(dy):
                                    direction = "Right" if dx > 0 else "Left"
                                else:
                                    direction = "Down" if dy > 0 else "Up"
                                if direction != "Stationary" and current_time - directional_arrow_alert_time[rtsp_id] >= timedelta(seconds=5):
                                    logger.info(f"Directional arrow detected for person ID {person_id} in stream {rtsp_id}: Direction {direction}")
                                    save_frame_and_send_directional_arrow_alert(rtsp_id, frame, person_id, direction, logger=logger)
                                    directional_arrow_alert_time[rtsp_id] = current_time
                                logger.debug(f"Person ID {person_id} moving {direction} in stream {rtsp_id}")                
                        
                    cv2.polylines(frame, [waiting_time_roi], isClosed=True, color=(0,255,255), thickness=2)
                    
                    logger.debug(f"Processed frame {frame_count} for stream {rtsp_id}")

                    # Clean up frame resources to avoid memory build-up
                except Exception as e:
                    logger.error(f"Error while processing frame in {rtsp_id}: {e}")

            cap.release()
            cv2.destroyAllWindows()
        except Exception as e:
            logger.error(f"Error in processing stream {rtsp_id}: {e}. Retrying...",exc_info=True)
            cv2.waitKey(5000)  # Wait 5 seconds before retrying

    logger.info(f"Stream {rtsp_id} has stopped.")


def zmq_listener(streams, analytics_dict,stream_metadata, executor):
    global license_valid
    context_recv = zmq.Context()
    recv_socket = context_recv.socket(zmq.SUB)
    recv_socket.bind(config['zmq']['subscriber']['address_VA'])
    recv_socket.setsockopt_string(zmq.SUBSCRIBE,"")
    print("starting listener Thread")
    while True:
        try:
            # Receive and parse the message
            message = recv_socket.recv_string()
            print(f"Received Message for VA : {message}")
            message = json.loads(message)
            action = message.get("action")
            data_list = message.get("data",[])
            
            with lock: 

                if action == "add_device":
                    for data in data_list:
                        rtsp_id = data.get("id")
                        rtsp_url = data.get("url")
                        analytics = data.get("analytics",[])
                        name = data.get("name",f"Stream {rtsp_id}")
                        fps = data.get("fps",3)
                        username = data.get("username","")
                        password = data.get("password","")
                        loitering_threshold = data.get("loitering_threshold",30)
                        crowd_formation_threshold = data.get("crowd_formation_threshold",5)
                        crowd_formation_duration = data.get("crowd_formation_duration",10)
                        crowd_estimation_threshold = data.get("crowd_estimation_threshold",15)
                        crowd_estimation_duration = data.get("crowd_estimation_duration",10)
                        entry_line_type = data.get("entry_line_type")
                        exit_line_type = data.get("exit_line_type")
                        direction = data.get("direction")
                        crowd_dispersion_threshold = data.get("crowd_dispersion_threshold")
                        crowd_dispersion_duration = data.get("crowd_dispersion_duration")
                        
                        if not license_valid:
                                error_msg = "License is invalid or not loaded."
                                print(error_msg)
                                continue

                            # Check number of cameras
                        num_active_streams = len(streams)
                        if rtsp_id not in streams and num_active_streams >= license_data['num_cameras']:
                                error_msg = f"Cannot add stream {rtsp_id}. Number of active streams ({num_active_streams}) would exceed licensed cameras ({license_data['num_cameras']})."
                                print(error_msg)
                                continue

                            # Check number of analytics
                        total_analytics = sum(len(analytics_dict.get(rtsp_id, [])) for rtsp_id in streams)
                        total_analytics += len(analytics)
                        if total_analytics > license_data['num_analytics']:
                                error_msg = f"Cannot add stream {rtsp_id}. Total analytics ({total_analytics}) would exceed licensed analytics ({license_data['num_analytics']})."
                                print(error_msg)
                                
                                continue
                            
                        if rtsp_id in streams:
                            print(f"Stream with ID {rtsp_id} already exists. Skipping addition.")
                            
                        else:
                            
                            streams[rtsp_id] = rtsp_url
                            analytics_dict[rtsp_id] = analytics
                            stream_flags[rtsp_id] = True

                            stream_metadata[rtsp_id] = {
                                "name": name,
                                "fps": fps,
                                "username": username,
                                "password": password,
                                "loitering_threshold" : loitering_threshold,
                                "crowd_formation_threshold" : crowd_formation_threshold,
                                "crowd_formation_duration" : crowd_formation_duration,
                                "crowd_estimation_threshold": crowd_estimation_threshold,
                                "crowd_estimation_duration" : crowd_estimation_duration,
                                "entry_line_type" : entry_line_type,
                                "exit_line_type" : exit_line_type,
                                "direction" : direction, 
                                "crowd_dispersion_threshold" : crowd_dispersion_threshold,
                                "crowd_dispersion_duration" : crowd_dispersion_duration
                                
                            } 
                        
                            try:
                                start_stream(rtsp_id, streams[rtsp_id], analytics, stream_metadata.get(rtsp_id,{}), executor)
                                print(f"Stream {rtsp_id} task submitted")
                               
                            except Exception as e:
                                print(f"Error while submitting stream {rtsp_id}: {e}")
                               

                            save_streams_to_json('streams.json', streams, analytics_dict,stream_metadata)
                            print(f"Stream {rtsp_id} added with analytics: {analytics}")

                elif action == "delete_device":
                    for data in data_list:
                        rtsp_id = data.get("id")
                        if rtsp_id in streams:  # Check if the stream exists
                            del streams[rtsp_id]
                            del analytics_dict[rtsp_id]
                            del stream_metadata[rtsp_id]
                            
                            stop_stream(rtsp_id)  # Stop the current stream
                            
                            save_streams_to_json('streams.json', streams, analytics_dict,stream_metadata)
                            print(f"Stream {rtsp_id} removed.")
                            
                        else:
                            
                            print(f"Stream {rtsp_id} not found. Skipping delete.")

                elif action == "update_device":
                    for data in data_list:
                        rtsp_id = data.get("id")
                        if rtsp_id in streams:
                            # Stop the current stream
                            print(f"Updating stream {rtsp_id}. Stopping current stream...")
                            stop_stream(rtsp_id)
                            del streams[rtsp_id]
                            del analytics_dict[rtsp_id]
                            del stream_metadata[rtsp_id]

                            # Get updated stream details
                            rtsp_url = data.get("url")
                            analytics = data.get("analytics", [])
                            name = data.get("name",f"Stream {rtsp_id}")
                            fps = data.get("fps",3)
                            username = data.get("username","")
                            password = data.get("password","")

                            # Add the updated details
                            streams[rtsp_id] = rtsp_url
                            analytics_dict[rtsp_id] = analytics
                            stream_metadata[rtsp_id] = {
                                "name": name,
                                "fps" : fps,
                                "username" : username,
                                "password": password
                            }
                    # Save updated details to JSON
                            save_streams_to_json('streams.json', streams, analytics_dict,stream_metadata)

                    # Restart the stream
                            try:
                                print(f"Starting updated stream {rtsp_id}...")
                                start_stream(rtsp_id, rtsp_url, analytics, stream_metadata.get(rtsp_id,{}), executor)
                                print(f"Stream {rtsp_id} updated and restarted.")
                               
                            except Exception as e:
                               
                                print(f"Error restarting stream {rtsp_id}: {e}")

                elif action == "add_analytic":
                    for data in data_list:
                        rtsp_id = data.get("id")
                        analytics = data.get("analytics",[])
                        
                        if rtsp_id in analytics_dict:
                            for new_analytic in analytics:
                                analytic_type = new_analytic.get("type")
                                existing_analytics = analytics_dict[rtsp_id]
                                if any(analytic.get("type") == analytic_type for analytic in existing_analytics):
                                    
                                    print(f"Analytics of type {analytic_type} already exists for stream {rtsp_id}.")
                                else:
                                    existing_analytics.append(new_analytic)
                                    analytics_dict[rtsp_id] = existing_analytics
                            
                            stop_stream(rtsp_id)
                            print(f"Stopping current Stream {rtsp_id}")
                            
                            analytics_dict[rtsp_id] = existing_analytics
                            
                            save_streams_to_json('streams.json',streams,analytics_dict,stream_metadata)
                            
                            try:
                                print(f"Restarting stream {rtsp_id} with updated analytics...")
                                start_stream(rtsp_id, streams[rtsp_id], analytics_dict[rtsp_id], stream_metadata.get(rtsp_id, {}), executor)
                                print(f"Stream {rtsp_id} restarted with updated analytics.")
                               
                            except Exception as e:
                               
                                print(f"Error restarting stream {rtsp_id}: {e}")
                        else:
                           
                            print(f"Stream {rtsp_id} not found. Cannot add analytics.")
                            
                            
                elif action == "delete_analytic":
                    for data in data_list:
                        rtsp_id = data.get("id")
                        analytic_type_to_delete = data.get("analytic_type")

                        if rtsp_id in streams:
                            # Get the existing analytics for this stream
                            existing_analytics = analytics_dict.get(rtsp_id, [])

                            # Find the analytic with the specified type and remove it
                            analytic_found = False
                            for analytic in existing_analytics:
                                if analytic.get("type") == analytic_type_to_delete:
                                    existing_analytics.remove(analytic)
                                    analytic_found = True
                                    print(f"Deleted analytic of type '{analytic_type_to_delete}' from stream {rtsp_id}.")
                                    break
                            
                            if analytic_found:
                                # Stop the current stream by setting the stream_flag to False
                                stop_stream(rtsp_id)
                                print(f"Stopping current stream {rtsp_id}...")

                                # Update the analytics_dict with the updated analytics
                                analytics_dict[rtsp_id] = existing_analytics

                                # Save the updated streams and analytics to JSON
                                save_streams_to_json('streams.json', streams, analytics_dict, stream_metadata)

                                # Restart the stream with updated analytics (without the deleted analytic)
                                try:
                                    print(f"Restarting stream {rtsp_id} with updated analytics...")
                                    start_stream(rtsp_id, streams[rtsp_id], analytics_dict[rtsp_id], stream_metadata.get(rtsp_id, {}), executor)
                                    print(f"Stream {rtsp_id} restarted with updated analytics.")
                                   
                                except Exception as e:
                                    
                                    print(f"Error restarting stream {rtsp_id}: {e}")
                            else:
                                
                                print(f"Analytic of type '{analytic_type_to_delete}' not found for stream {rtsp_id}. Cannot delete.")
                        else:
                            
                            print(f"Stream {rtsp_id} not found. Cannot delete analytic.")
                    
                                
                elif action == "update_analytic":
                        for data in data_list:
                            rtsp_id = data.get("id")
                            updated_analytics = data.get("analytics", [])

                            if rtsp_id in streams:
                                # Get the existing analytics for this stream
                                existing_analytics = analytics_dict.get(rtsp_id, [])

                                # Flag to check if we found and updated the analytic
                                analytic_updated = False

                                # Loop through existing analytics and update the specified ones
                                for updated_analytic in updated_analytics:
                                    updated_type = updated_analytic.get("type")
                                    updated_roi = updated_analytic.get("roi")

                                    # Check if the analytic type exists
                                    for existing_analytic in existing_analytics:
                                        if existing_analytic.get("type") == updated_type:
                                            # Update the 'roi' of the found analytic
                                            existing_analytic["roi"] = updated_roi
                                            analytic_updated = True
                                            print(f"Updated '{updated_type}' analytic for stream {rtsp_id}.")
                                            break

                                if analytic_updated:
                                    # Stop the current stream
                                    stop_stream(rtsp_id)
                                    print(f"Stopping current stream {rtsp_id}...")

                                    # Update the analytics_dict with the new analytics
                                    analytics_dict[rtsp_id] = existing_analytics

                                    # Save the updated streams and analytics to JSON
                                    save_streams_to_json('streams.json', streams, analytics_dict, stream_metadata)

                                    # Restart the stream with updated analytics
                                    try:
                                        print(f"Restarting stream {rtsp_id} with updated analytics...")
                                        start_stream(rtsp_id, streams[rtsp_id], analytics_dict[rtsp_id], stream_metadata.get(rtsp_id,{}), executor)
                                        print(f"Stream {rtsp_id} restarted with updated analytics.")
                                        
                                    except Exception as e:
                                       
                                        print(f"Error restarting stream {rtsp_id}: {e}")
                                else:
                                    
                                    print(f"Analytics of type(s) {', '.join([analytic.get('type') for analytic in updated_analytics])} not found for stream {rtsp_id}. Cannot update.")
                            else:
                                
                                print(f"Stream {rtsp_id} not found. Cannot update analytics.")

                elif action == "delete_all":
                    for rtsp_id in streams:
                        stop_stream(rtsp_id)
                        print(f"Stopping stream {rtsp_id}...")

                    # Clear the streams, analytics_dict, and stream_metadata
                    streams.clear()
                    analytics_dict.clear()
                    stream_metadata.clear()

                    # Save the cleared state to the JSON file
                    save_streams_to_json('streams.json', streams, analytics_dict, stream_metadata)
                    print("All streams have been stopped and streams.json has been cleared.")
                    
                    
                elif action == "get_all":
                    try:
      
                        all_stream_data = []
                        for rtsp_id in streams:
                            stream_data = {
                                "id": rtsp_id,
                                "url": streams[rtsp_id],
                                "analytics": analytics_dict.get(rtsp_id, []),
                                "metadata": stream_metadata.get(rtsp_id, {})
                            }
                            all_stream_data.append(stream_data)
                        
                        
                        print("Sent all stream data.")
                        
                    except Exception as e:
                        
                        print(f"Error retrieving all stream data: {e}")
                
                elif action == "TotalCamera":
                    try:
                            payload = {
                                "Event": "TotalCameraResponse",
                                "num_cameras": license_data.get('num_cameras', 0),
                                "num_analytics": license_data.get('num_analytics', 0),
                            }
                            zmq_socket.send_string(json.dumps(payload))
                            print(f"Sent TotalCamera response: {payload}")
                    except Exception as e:
                        print(f"Error processing TotalCamera action: {e}")
                           
                            
        except Exception as e:
            print(f"Error processing message: {e}")
        print("response sent..")


# Main function to handle initial setup and start the listener in a separate thread
def main():
    try:
        streams, analytics_dict, stream_metadata = load_streams_from_json('streams.json')
        
        license_info = load_license_file(LICENSE_FILE_PATH)
        if not license_info:
            error_msg = "Failed to load license file."
            print(error_msg)
            raise LicenseError(error_msg)
        
        print("Loaded License File for VA")
        expiry_date = date.fromisoformat(license_data['expiry_date'])
        if datetime.now().date() > expiry_date:
                error_msg = "License has expired."
                print(error_msg)
                raise LicenseError(error_msg)
        print("Checked date for VA")
             
        api_handler = APIHandler(config.get("api", {}), api_queue)
        api_thread = api_handler.start()
            
        with ThreadPoolExecutor(max_workers=len(streams) + 50) as executor:
            for rtsp_id, rtsp_url in streams.items():
                analytics_data = analytics_dict.get(rtsp_id, [])
                metadata = stream_metadata.get(rtsp_id, {})
                start_stream(rtsp_id, rtsp_url, analytics_data, metadata, executor)

            listener_thread = threading.Thread(target=zmq_listener, args=(streams, analytics_dict,stream_metadata, executor))
            listener_thread.start()
            listener_thread.join()
            
            # Cleanup
            if api_thread:
                api_queue.put(None)  # Signal API thread to stop
                api_thread.join()
                
    except Exception as e:
        print(f"Error in main function: {e}")

if __name__ == '__main__':
    main()