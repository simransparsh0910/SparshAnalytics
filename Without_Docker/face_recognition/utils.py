import os
import cv2
import numpy as np
import sqlite3
from datetime import datetime
from scrfd import SCRFD
from arcface import ArcFace
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import threading
import zmq
import base64
import json
import faiss 
from base64 import b64decode
from Crypto.Cipher import AES
import subprocess
import shutil 


def decrypt(key, license_key):
    key_bytes = b64decode(key)[:32]  # Decode Base64 key and use the first 32 bytes
    nonce = license_key[:16]
    tag = license_key[16:32]
    ciphertext = license_key[32:]

    cipher = AES.new(key_bytes, AES.MODE_GCM, nonce=nonce)
    try:
        return cipher.decrypt_and_verify(ciphertext, tag)
    except ValueError:
        raise Exception("CryptoException: MAC check failed")

# Get motherboard serial number
def get_motherboard_serial():
    try:
        if os.name == "nt":  # Windows
            command = "wmic baseboard get serialnumber"
        else:  # Linux/Mac
            command = "cat /sys/class/dmi/id/board_serial"
        result = subprocess.check_output(command, shell=True).decode().strip().split('\n')[-1]
        return result
    except Exception as e:
        print(f"Error retrieving motherboard serial number: {e}")
        return None
    
def validate_license(license_file, decryption_key):
    try:
        with open(license_file, "rb") as file:
            saved_license_key = file.read()
        
        decrypted_data = decrypt(decryption_key, saved_license_key)
        license_info = json.loads(decrypted_data.decode('utf-8'))
        
        # Get current system's motherboard serial number
        system_serial_no = get_motherboard_serial()
        if not system_serial_no or system_serial_no != license_info['SerialNo']:
            raise Exception("License validation failed: Serial number mismatch.")

        # Check the expiration date
        expiration_date = datetime.strptime(license_info['Date'], '%Y-%m-%d')
        if datetime.now() > expiration_date:
            raise Exception("License validation failed: License has expired.")

        # Check the allowed number of cameras
        max_cameras = int(license_info['Noofcameras'])
        print(f"License validation successful: Max Cameras = {max_cameras}, Expiry = {expiration_date}")
        return max_cameras
    except Exception as e:
        print(f"License validation error: {e}")
        raise
    
    
    # Read RTSP URLs from a JSON file
def read_urls_from_json(file_path):
    try:
        with open(file_path, 'r') as file:
            data = json.load(file)
        result = {
            item['rtsp_id']:{
                'rtsp_url': item['rtsp_url'],
                'roi': item.get('roi',[])
            }
            for item in data
        }
        return result
    except Exception as e:
        print(f"Error reading RTSP URLs from JSON: {e}")
        return {}
    
def rescale_bbox(bbox, resized_shape, original_shape):
    """
    Rescales bounding box coordinates from the resized image (640x640) 
    back to the original frame size while maintaining aspect ratio.
    """
    x1, y1, x2, y2 = bbox.astype(int)

    # Resized shape: (height, width), Original shape: (height, width)
    resized_height, resized_width = resized_shape
    original_height, original_width = original_shape

    # Compute the scaling factors for width and height
    scale_x = original_width / resized_width  # Scaling factor for width
    scale_y = original_height / resized_height  # Scaling factor for height

    # Apply scaling to bounding box coordinates
    x1 = int(x1 * scale_x)
    y1 = int(y1 * scale_y)
    x2 = int(x2 * scale_x)
    y2 = int(y2 * scale_y)

    # Ensure bounding box remains within valid image bounds
    x1 = max(0, min(x1, original_width - 1))
    y1 = max(0, min(y1, original_height - 1))
    x2 = max(0, min(x2, original_width - 1))
    y2 = max(0, min(y2, original_height - 1))

    # Handle invalid cases where x1 > x2 or y1 > y2
    if x1 >= x2 or y1 >= y2:
        print(f"Warning: Invalid bounding box after rescaling: {x1, y1, x2, y2}")
        return None  # Return None for invalid bounding boxes

    return np.array([x1, y1, x2, y2], dtype=int)

def crop_face(frame, bbox, margin_ratio=1):
    
    x1, y1, x2, y2 = bbox.astype(int)

    # Calculate the width and height of the bounding box
    width = x2 - x1
    height = y2 - y1

    # Calculate margins based on the margin ratio
    margin_x = int(width * margin_ratio)
    margin_y = int(height * margin_ratio)

    # Expand the bounding box with the calculated margins
    x1 = max(x1 - margin_x, 0)  # Ensure the new coordinates are within frame bounds
    y1 = max(y1 - margin_y, 0)
    x2 = min(x2 + margin_x, frame.shape[1])
    y2 = min(y2 + margin_y, frame.shape[0])

    # Crop the image with the adjusted bounding box
    return frame[y1:y2, x1:x2]

# Save detected face details to the database
def save_face_to_db(rtsp_id, name, image_path, score, gender=None, glasses=None, beard=None, age=None):
    conn = sqlite3.connect('./face_data.db')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO Faces (rtsp_id, name, timestamp, image_path, score, gender, glasses, beard, age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                   (rtsp_id, name, datetime.now().strftime('%Y-%m-%d %H:%M:%S'), image_path, score, gender, glasses, beard, age))
    conn.commit()
    conn.close()

# Save person information to the database and return the row ID
def save_person_information(name, person_type, remark, group_id, age=None, sex=None):
    conn = sqlite3.connect('./face_data.db')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO PersonInformation (name, type, remark, date, group_id, age, sex) VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (name, person_type, remark, datetime.now().strftime('%Y-%m-%d'), group_id, age, sex))
    conn.commit()
    row_id = cursor.lastrowid  # Get the row ID of the inserted record
    conn.close()
    return row_id

def get_group_id(group_name):
    conn = sqlite3.connect('./face_data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT group_id FROM `Group` WHERE group_name = ?', (group_name,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return result[0]
    else:
        raise ValueError(f"Group '{group_name}' not found in the database.")
    
    
def get_person_info(folder_name):
    try:
        # Extract the ID part from the folder name (e.g., pratham_03 -> 03)
        person_id = folder_name.split('_')[-1]

        # Query the database to get the type and remark based on the ID
        conn = sqlite3.connect('./face_data.db')
        cursor = conn.cursor()
        cursor.execute('SELECT type, remark FROM PersonInformation WHERE id = ?', (person_id,))
        result = cursor.fetchone()
        conn.close()

        if result:
            person_type, remark = result
            return person_type, remark
        else:
            return "Unknown", "No remark"
    except Exception as e:
        print(f"Error fetching person info: {e}")
        return "Unknown", "No remark"

def get_all_person_information():
    try:
        conn = sqlite3.connect('./face_data.db')
        cursor = conn.cursor()

        # Modify the query to join the Group table and fetch group_name, age, and sex
        cursor.execute('''
            SELECT pi.id, pi.name, pi.type, pi.remark, pi.date, pi.group_id, g.group_name, pi.age, pi.sex
            FROM PersonInformation pi
            LEFT JOIN `Group` g ON pi.group_id = g.group_id
        ''')
        records = cursor.fetchall()
        conn.close()

        return records
    except Exception as e:
        print(f"Error fetching all person information: {e}")
        return []
    