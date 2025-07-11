import os
import cv2
import numpy as np
import sqlite3
from datetime import datetime, date
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
from utils import decrypt,get_motherboard_serial,validate_license,read_urls_from_json,rescale_bbox,crop_face,save_face_to_db,save_person_information,get_group_id,get_person_info,get_all_person_information
from attributes import generate_attributes
import queue 
import requests
import sys
from api import APIHandler
from cryptography.fernet import Fernet
import pickle 

print("Imported all modules")
listener_lock = threading.Lock()
api_queue = queue.Queue()

#-----------Config-----------------------#
config_file = "/app/config.json"
with open(config_file, "r") as f:
    config = json.load(f)
    

port = config['data']['port']
path = config['data']['path_FRS']
enable_attributes = config.get("data", {}).get("attributes", "no").lower() == "yes"
print(f"Attributes processing {'enabled' if enable_attributes else 'disabled'}")
api_url = config.get("api", {}).get("url", "").strip()
vms_ip = config.get("vms", {}).get("ip", "").strip()
context = zmq.Context()

if vms_ip:
    print("VMS IP is set, will send alerts on FRS.")
    vms_zmq_socket = context.socket(zmq.PUB)
    vms_zmq_socket.connect(f"tcp://{vms_ip}:9907")
    
print("Loaded Config File....")

#----------------------Checks---------------#
stream_flags = {}
stream_threads = {}

license_data = {}
license_valid = False
license_lock = threading.Lock()
LICENSE_KEY = b'wLDjLQ5ADsIor-anRTvyKIX38fXdkkdYk31TqEQ2grA='  # Must match the key used in generate_license.py
cipher_suite = Fernet(LICENSE_KEY)
LICENSE_FILE_PATH = '/app/license.bin'

#-----------------EmbeddingsClass-----------#
class EmbeddingManager:
    def __init__(self, faiss_index_file, embedding_store_file):
        self.faiss_index_file = faiss_index_file
        self.embedding_store_file = embedding_store_file
        self.lock = threading.Lock()

        self._ensure_files_exist()  # Ensure FAISS index and embedding store files exist
        self._load_data()
        
    def _ensure_files_exist(self):
        """Ensure FAISS index and embedding store files exist"""
        if not os.path.exists(self.faiss_index_file):
            print(f"FAISS index file not found. Creating a new FAISS index: {self.faiss_index_file}")
            faiss_index = faiss.IndexFlatIP(512)  # Create new FAISS index
            faiss.write_index(faiss_index, self.faiss_index_file)

        if not os.path.exists(self.embedding_store_file):
            print(f"Embedding store file not found. Creating an empty JSON store: {self.embedding_store_file}")
            with open(self.embedding_store_file, "w") as f:
                json.dump({}, f)  # Initialize with an empty dictionary

    def _load_data(self):
        """Load FAISS index and label-embedding mapping"""
        with self.lock:
            try:
                self.faiss_index = faiss.read_index(self.faiss_index_file)
            except Exception as e:
                print(f"Error loading FAISS index: {e}. Creating a new FAISS index.")
                self.faiss_index = faiss.IndexFlatIP(512)
                faiss.write_index(self.faiss_index, self.faiss_index_file)

            try:
                with open(self.embedding_store_file, "r") as f:
                    self.embedding_store = json.load(f)
            except Exception as e:
                print(f"Error loading embedding store: {e}. Creating an empty JSON store.")
                self.embedding_store = {}
                with open(self.embedding_store_file, "w") as f:
                    json.dump({}, f)

    def add_embedding(self, new_embedding, label):
        """Add embedding to FAISS and store correct label separately"""
        with self.lock:
            # Normalize embedding
            new_embedding = new_embedding / np.linalg.norm(new_embedding, keepdims=True)

            # Add to FAISS
            self.faiss_index.add(new_embedding[np.newaxis, :])

            # Convert embedding to a list (for JSON storage)
            embedding_list = new_embedding.tolist()

            # Store in JSON file
            self.embedding_store[json.dumps(embedding_list)] = label

            # Save updates
            self._save_data()
            print(f"Added embedding for {label}")

    def delete_embedding(self, label):
        """Delete an embedding & update storage"""
        with self.lock:
            # Find the embedding matching this label in JSON
            found_embedding = None
            for embedding, stored_label in self.embedding_store.items():
                if stored_label == label:
                    found_embedding = embedding
                    break
            
            if not found_embedding:
                print(f"Label {label} not found in embedding store.")
                return

            # Remove from JSON
            del self.embedding_store[found_embedding]

            # Rebuild FAISS (since FAISS does not support deleting individual embeddings)
            self._rebuild_index()

            # Save updates
            self._save_data()
            print(f"Deleted embedding for {label}")

    def _rebuild_index(self):
        """Rebuild FAISS index to remove deleted embeddings"""
        embeddings = []
        for embedding in self.embedding_store.keys():
            embeddings.append(np.array(json.loads(embedding)))

        new_index = faiss.IndexFlatIP(512)  # Reinitialize FAISS
        if embeddings:
            new_index.add(np.array(embeddings))
        
        self.faiss_index = new_index

        # Save updated FAISS index
        faiss.write_index(self.faiss_index, self.faiss_index_file)
        print("Rebuilt FAISS index after deletion")

    def _save_data(self):
        """Save FAISS index and label mapping"""
        with open(self.embedding_store_file, 'w') as f:
            json.dump(self.embedding_store, f)
        faiss.write_index(self.faiss_index, self.faiss_index_file)
        print("Updated FAISS index and embedding store")

    def reload_embeddings(self):
        """Reload FAISS index and label mapping"""
        self._load_data()
        print("Reloaded FAISS index and embedding store")

    def search_embedding(self, query_embedding, threshold=0.40, top_k=1):
        """Search an embedding in FAISS and get correct label from separate storage"""
        with self.lock:
            # Normalize the query embedding
            query_embedding = query_embedding / np.linalg.norm(query_embedding, keepdims=True)

            # Search in FAISS
            distances, indices = self.faiss_index.search(query_embedding[np.newaxis, :], k=top_k)

            if indices[0][0] < 0 or distances[0][0] < threshold:
                return "unknown", 0.0  # No match found

            # Retrieve the matched embedding from FAISS
            try:
            # Retrieve the matched embedding from FAISS
                matched_embedding = self.faiss_index.reconstruct(int(indices[0][0]))

            # Convert it to a list for lookup in JSON
                matched_embedding_list = matched_embedding.tolist()

            # Get the correct label from JSON storage
                matched_label = self.embedding_store.get(json.dumps(matched_embedding_list), "unknown")

                return matched_label, float(distances[0][0])  # Ensure score is float
            except Exception as e:
                print(f"Error reconstructing FAISS embedding: {e}")
                return "unknown", 0.0

#---------------------SQL Database--------#
def init_db():
    conn = sqlite3.connect('./face_data.db')
    cursor = conn.cursor()

    # Create Faces table
    cursor.execute('''CREATE TABLE IF NOT EXISTS Faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rtsp_id TEXT,
        name TEXT,
        timestamp TEXT,
        image_path TEXT,
        score REAL,
        gender TEXT,    -- Store "Male", "Female", etc.
        glasses TEXT,   -- Store "With Glasses", "Without Glasses"
        beard TEXT,     -- Store "Beard", "No Beard"
        age INTEGER     -- New column for age
    )''') 

    # Create PersonIdentity table
    cursor.execute('''CREATE TABLE IF NOT EXISTS PersonIdentity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, detected_image_path TEXT, original_dataset_path TEXT)''')

    # Create PersonInformation table with group_id column
    cursor.execute('''CREATE TABLE IF NOT EXISTS PersonInformation (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT, 
        type TEXT, 
        remark TEXT, 
        date TEXT, 
        group_id INTEGER,
        age INTEGER,           -- New column for age
        sex TEXT,             -- New column for sex
        FOREIGN KEY (group_id) REFERENCES `Group`(group_id))''')

    # Create Group table (Group is a reserved keyword, so we use backticks)
    cursor.execute('''CREATE TABLE IF NOT EXISTS `Group` (
        group_id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT NOT NULL,
        remark TEXT)''')

    conn.commit()
    conn.close()

# ------------------------License-------------#
class LicenseError(Exception):
    """Custom exception for license-related errors."""
    pass

def load_license_file(file_path='/app/license.bin'):
    global license_data, license_valid
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
        return license_info
    except Exception as e:
        with license_lock:
            license_valid = False
        raise LicenseError(f"Failed to load or validate license file: {e}")

# Save the detected face image to a folder
def save_detected_face(cropped_face, name):
    if cropped_face is None or cropped_face.size == 0:
        print("Error: Detected face is empty or None, cannot save.")
        return None  # Return None to handle this condition gracefully

    if not os.path.exists('/app/face_recognition/detected_faces'):
        os.makedirs(f'/app/face_recognition/detected_faces')
    
    today_date = datetime.now().strftime('%Y-%m-%d')
    date_folder_path = os.path.join(f'/app/face_recognition/detected_faces',today_date)
    if not os.path.exists(date_folder_path):
        os.makedirs(date_folder_path)
        
    image_file_name = f"{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    image_path = os.path.join(date_folder_path,image_file_name)
    
    relative_image_path = os.path.join('detected_faces', today_date, image_file_name)
    
    # Attempt to save the image and handle any potential errors
    try:
        cv2.imwrite(image_path, cropped_face)
        
        return relative_image_path
    except Exception as e:
        print(f"Error saving detected face image: {e}")
        return None

# Helper function to find an image file within a folder
def find_original_image(person_name):
    folder_path = f"/app/face_recognition/faces/{person_name}/"
    if os.path.exists(folder_path):
        for file_name in os.listdir(folder_path):
            if file_name.lower().endswith(('.jpg', '.jpeg', '.png')):
                return os.path.join(folder_path, file_name)
    return None

# Get the original image from the "faces" folder
def get_original_image(person_name):
    original_image_full_path = find_original_image(person_name)
    if original_image_full_path:
        print(f"Found original image for {person_name}: {original_image_full_path}")
        original_image = cv2.imread(original_image_full_path)
        if original_image is not None:
            _, original_buffer = cv2.imencode('.jpg', original_image)
            original_img_base64 = base64.b64encode(original_buffer).decode('utf-8')
            return original_img_base64
        else:
            print(f"Failed to read the image file: {original_image_full_path}")
    else:
        print(f"No valid image found for {person_name}")
    return None

def save_received_multiple_single_face_image(person_name, row_id, image_paths):
   
    folder_name = f"{person_name}_{row_id}"
    folder_path = os.path.join("/app/face_recognition/faces", folder_name)
    
    # Create the folder if it doesn't exist
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
    
    # Move all images to the new folder
    saved_image_paths = []
    for idx, src_image_path in enumerate(image_paths):
        if not os.path.isfile(src_image_path):
            print(f"Warning: Image path {src_image_path} does not exist, skipping.")
            continue
        
        # Generate a unique filename using timestamp and index
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{person_name}_{timestamp}_{idx}.jpg"
        dest_image_path = os.path.join(folder_path, filename)
        
        try:
            shutil.move(src_image_path, dest_image_path)
            saved_image_paths.append(dest_image_path)
            print(f"Moved image from {src_image_path} to {dest_image_path}")
        except Exception as e:
            print(f"Error moving image {src_image_path} to {dest_image_path}: {e}")
    
    if not saved_image_paths:
        print(f"Error: No images were successfully moved for {person_name}")
        return folder_name
    
    # Return the path to the first image as the representative image
    return  folder_name
  
# Save received face image in the "faces" folder with "personname_rowid"
def save_received_face_image(person_name, row_id, image_base64):
    folder_name = f"{person_name}_{row_id}"
    folder_path = f"/app/face_recognition/faces/{folder_name}/"
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
    image_path = os.path.join(folder_path, f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg")
    with open(image_path, "wb") as f:
        f.write(base64.b64decode(image_base64))
    print(f"Received image saved at: {image_path}")
    return image_path, folder_name


def save_received_multiple_face_image(person_name, row_id, image_path):
    folder_name = f"{person_name}_{row_id}"
    folder_path = f"/app/face_recognition/faces/{folder_name}/"
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
    
    destination_image_path = os.path.join(folder_path, os.path.basename(image_path))
    shutil.copy(image_path, destination_image_path)
    
    print(f"Image copied from {image_path} to {destination_image_path}")
    return destination_image_path, folder_name

# Generate and update embedding for the new face
def generate_and_update_embedding(image_path, person_name, recognizer, detector, embedding_manager):
    image = cv2.imread(image_path)
    if image is None:
        print(f"Failed to read image: {image_path}")
        return

    boxes_list, kpss_list = detector.detect(image)
    if len(boxes_list) > 0:
        bbox = boxes_list[0][:4]
        kps = kpss_list[0] if kpss_list is not None and len(kpss_list) > 0 else None
        if kps is not None:
            kps = kps.reshape(5, 2)
            embedding = recognizer(image, kps)
            embedding_manager.add_embedding(embedding, person_name)
            print(f"Generated and added embedding for {person_name}")
        else:
            print(f"Failed to generate keypoints for {person_name}'s image.")
    else:
        print(f"No face detected for {person_name}'s image.")

def update_streams(rtsp_urls):
    file_path = "/app/face_recognition/streams.json"
    try:
        updated_data = [
            {
                "rtsp_id": rtsp_id,
                "rtsp_url": data["rtsp_url"],
                "roi": data["roi"]
            }
            for rtsp_id, data in rtsp_urls.items()
        ]

        # Write the updated data to the streams.json file
        with open(file_path, 'w') as file:
            json.dump(updated_data, file, indent=4)

        print(f"Updated streams.json with {len(updated_data)} streams.")
    except Exception as e:
        print(f"Error updating streams.json: {e}")

def generate_average_embedding(image_paths, recognizer, detector):
    embeddings = []
    for image_path in image_paths:
        image = cv2.imread(image_path)
        if image is None:
            print(f"Failed to read image: {image_path}")
            continue
            
        boxes_list, kpss_list = detector.detect(image)
        if len(boxes_list) == 0:
            print(f"No face detected in image: {image_path}")
            continue
            
        bbox = boxes_list[0][:4]
        kps = kpss_list[0] if kpss_list is not None and len(kpss_list) > 0 else None
        if kps is None:
            print(f"No keypoints detected in image: {image_path}")
            continue
            
        kps = kps.reshape(5, 2)
        embedding = recognizer(image, kps)
        embeddings.append(embedding)
    
    if not embeddings:
        print("No valid embeddings generated from images")
        return None
        
    # Calculate average embedding
    avg_embedding = np.mean(embeddings, axis=0)
    return avg_embedding  

def unsharp_mask(image, sigma=1.0, strength=1.5):
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    # Combine original and blurred images to enhance edges
    sharpened = cv2.addWeighted(image, 1.0 + strength, blurred, -strength, 0)
    return sharpened


def receive_person_data_zmq(zmq_socket_recv, zmq_socket_send,zmq_socket_send_data, recognizer, detector, embedding_manager,rtsp_urls,executor):
    while True:
        try:
            print("Listening FRS ...")
            json_data = zmq_socket_recv.recv_string()  # Receive data from the subscriber socket
            print(f"Raw message received for FRS: {json_data}")  # Print the raw message received

            # If the message is empty or incorrect, skip processing
            if not json_data:
                print("No data received or message is empty.")
                continue

            data = json.loads(json_data)  # Parse the received JSON data

            topic = data.get("Topic")  # Get the topic from the received data
            
            with listener_lock: 
                    
                if topic == "Query":
                    # Extract parameters
                    from_date = data.get("fromDate")
                    to_date = data.get("toDate")
                    person_name = data.get("personName")
                    gender = data.get("gender")          # e.g., "Male", "Female"
                    glasses = data.get("glasses")        # e.g., "With Glasses", "Without Glasses"
                    beard = data.get("beard")            # e.g., "Beard", "No Beard"
                    age_from = data.get("ageFrom")       # Lower bound of age range (e.g., 20)
                    age_to = data.get("ageTo")           # Upper bound of age range (e.g., 40)
                    page = int(data.get("page", 1))      # Default to page 1

                    # Base SQL query with all attributes from Faces
                    base_query = """
                        SELECT f.rtsp_id, f.name, f.timestamp, f.image_path, f.score, g.group_name,
                            f.gender, f.glasses, f.beard, f.age, pi.type
                        FROM Faces f
                        LEFT JOIN PersonInformation pi ON 
                            pi.name = SUBSTR(f.name, 1, INSTR(f.name, '_') - 1) 
                            AND pi.id = CAST(SUBSTR(f.name, INSTR(f.name, '_') + 1) AS INTEGER)
                        LEFT JOIN `Group` g ON pi.group_id = g.group_id
                        WHERE 1=1
                    """

                    count_query = """
                        SELECT COUNT(*)
                        FROM Faces f
                        LEFT JOIN PersonInformation pi ON 
                            pi.name = SUBSTR(f.name, 1, INSTR(f.name, '_') - 1) 
                            AND pi.id = CAST(SUBSTR(f.name, INSTR(f.name, '_') + 1) AS INTEGER)
                        LEFT JOIN `Group` g ON pi.group_id = g.group_id
                        WHERE 1=1
                    """
                    parameters = []

                    # Add conditions based on parameters
                    if from_date and to_date:
                        base_query += " AND f.timestamp BETWEEN ? AND ?"
                        count_query += " AND f.timestamp BETWEEN ? AND ?"
                        parameters.extend([from_date, to_date])

                    if person_name:
                        base_query += " AND f.name LIKE ?"
                        count_query += " AND f.name LIKE ?"
                        parameters.append(f"%{person_name}%")

                    if gender:
                        base_query += " AND f.gender = ?"
                        count_query += " AND f.gender = ?"
                        parameters.append(gender)

                    if glasses:
                        base_query += " AND f.glasses = ?"
                        count_query += " AND f.glasses = ?"
                        parameters.append(glasses)

                    if beard:
                        base_query += " AND f.beard = ?"
                        count_query += " AND f.beard = ?"
                        parameters.append(beard)

                    if age_from is not None and age_to is not None:
                        base_query += " AND f.age BETWEEN ? AND ?"
                        count_query += " AND f.age BETWEEN ? AND ?"
                        parameters.extend([age_from, age_to])
                    elif age_from is not None:
                        base_query += " AND f.age >= ?"
                        count_query += " AND f.age >= ?"
                        parameters.append(age_from)
                    elif age_to is not None:
                        base_query += " AND f.age <= ?"
                        count_query += " AND f.age <= ?"
                        parameters.append(age_to)

                    # Pagination logic
                    records_per_page = 50
                    offset = (page - 1) * records_per_page
                    base_query += f" LIMIT {records_per_page} OFFSET {offset}"

                    # Connect to the database
                    conn = sqlite3.connect('./face_data.db')
                    cursor = conn.cursor()

                    # Get total record count
                    cursor.execute(count_query, parameters)
                    total_records = cursor.fetchone()[0]

                    # Fetch paginated records
                    cursor.execute(base_query, parameters)
                    faces_records = cursor.fetchall()
                    conn.close()

                    # Process records into response format
                    faces_with_group_data = [
                        {
                            "rtsp_id": record[0],
                            "name": record[1],
                            "timestamp": record[2],
                            "image_path": f"https://{port}/api/images/{path}/{record[3]}",
                            "score": record[4],
                            "group_name": record[5],
                            "gender": record[6],    # From Faces
                            "glasses": record[7],   # From Faces
                            "beard": record[8],     # From Faces
                            "age": record[9],
                            "type": record[10]   
                        }
                        for record in faces_records
                    ]

                    # Prepare JSON response
                    response_data = {
                        "detectedData": "detectedData",
                        "total_records": total_records,
                        "records": faces_with_group_data
                    }

                    faces_json = json.dumps(response_data)
                    zmq_socket_send.send_string(faces_json)
                    zmq_socket_send_data.send_string(faces_json)
                    print(f"Sent paginated Faces data with score, group name, gender, glasses, beard, and age: {faces_json}")


                if topic == "Table Data":
                    # Fetch all records from PersonInformation table
                    
                    records = get_all_person_information()

                    # Prepare the data to include the image and group_name
                    records_with_images = []
                    for row in records:
                        row_id = row[0]
                        person_name = row[1]
                        group_name = row[6]  # Fetch the group_name from the record
                        age = row[7]  # Age from PersonInformation
                        sex = row[8]
                        # Construct the folder path like "faces/personname_rowid"
                        folder_name = f"{person_name}_{row_id}"
                        print(folder_name)
                        folder_path = os.path.join("faces", folder_name)

                        # Find the original image file in the folder
                        original_image_full_path = find_original_image(folder_name)

                        # If an image is found, convert it to Base64
                        if original_image_full_path:
                            original_image = cv2.imread(original_image_full_path)
                            if original_image is not None:
                                _, original_buffer = cv2.imencode('.jpg', original_image)
                                original_img_base64 = base64.b64encode(original_buffer).decode('utf-8')
                            else:
                                original_img_base64 = None
                        else:
                            original_img_base64 = None

                        # Append the data including the image and group_name to the final result
                        records_with_images.append({
                            "id": row[0],
                            "name": row[1],
                            "type": row[2],
                            "remark": row[3],
                            "date": row[4],
                            "group_name": group_name, 
                             "age": age,           # Included
                                "sex": sex ,# Add the group_name to the response
                            "image": original_img_base64  # Include the image in Base64 format
                        })

                    # Convert records_with_images to JSON format
                    records_json = json.dumps(records_with_images)
                    time.sleep(1)
                    # Send the records back using the publisher socket
                    zmq_socket_send.send_string(records_json)
                    zmq_socket_send_data.send_string(records_json)
                    print(f"Sent all records from PersonInformation table with images and group names: {records_json}")

                elif topic == "New Face":
                    # Follow the usual code for handling new face data
                    person_name = data.get("PersonName")
                    image_base64 = data.get("Image")
                    person_type = data.get("Type")
                    remark = data.get("Remark")
                    group_name = data.get("GroupName")
                    age = data.get("Age")  # Extract age from incoming data
                    sex = data.get("Sex")
                    enhance_face = data.get("enhanceFace")
                    print(age,sex)
                    try:
                        group_id = get_group_id(group_name)
                    except ValueError as e:
                        print(f"Error: {e}")
                        continue

                    temp_folder = "temp"
                    if not os.path.exists(temp_folder):
                        os.makedirs(temp_folder)
                    temp_image_path = os.path.join(temp_folder, f"temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg")
                    with open(temp_image_path, "wb") as f:
                        f.write(base64.b64decode(image_base64))

                    # Generate embedding for the new face
                    image = cv2.imread(temp_image_path)
                    if image is None:
                        print(f"Failed to read temporary image: {temp_image_path}")
                        os.remove(temp_image_path)
                        continue
                    
                    if enhance_face and enhance_face.lower() == "yes":
                        print(f"Applying unsharp mask to enhance face for {person_name}")
                        image = unsharp_mask(image, sigma=1.0, strength=1.5)

                    boxes_list, kpss_list = detector.detect(image)
                    if len(boxes_list) == 0:
                        print(f"No face detected in new image for {person_name}")
                        os.remove(temp_image_path)
                        continue

                    bbox = boxes_list[0][:4]
                    kps = kpss_list[0] if kpss_list is not None and len(kpss_list) > 0 else None
                    if kps is None:
                        print(f"No keypoints detected for {person_name}")
                        os.remove(temp_image_path)
                        continue

                    kps = kps.reshape(5, 2)
                    new_embedding = recognizer(image, kps)

                    # Check for similar faces (threshold of 0.50 for 50% similarity)
                    matched_label, similarity_score = embedding_manager.search_embedding(new_embedding, threshold=0.40, top_k=1)

                    if matched_label != "unknown" and similarity_score >= 0.40:
                        # Send alert if similar face found
                        alert_payload = {
                            "Event": "SimilarFaceDetected",
                            "NewPersonName": person_name,
                            "MatchedPersonName": matched_label,
                            "SimilarityScore": float(similarity_score),
                            "Timestamp": datetime.now().strftime('%Y-%m-%d %H%M%S'),
                            "Message": f"A face similar to {person_name} already exists as {matched_label} with {similarity_score*100:.2f}% similarity"
                        }
                        alert_json = json.dumps(alert_payload)
                        zmq_socket_send.send_string(alert_json)
                       
                        print(f"Alert sent: Similar face found - {matched_label} with {similarity_score*100:.2f}% similarity")
                        os.remove(temp_image_path)
                        continue  # Skip adding the new face

                    # Save the person information in the database and get the row ID
                    row_id = save_person_information(person_name, person_type, remark, group_id, age, sex)

                    # Save the received face image in the 'faces' folder with "personname_rowid"
                    image_path, folder_name = save_received_face_image(person_name, row_id, image_base64)

                    # Generate and update embeddings for the new face
                    generate_and_update_embedding(image_path, folder_name, recognizer, detector, embedding_manager)

                    # Reload the updated embeddings
                    embedding_manager.reload_embeddings()

                    payload = {
                        "Event": "FaceSaved"
                    }
                    alert_json = json.dumps(payload)
                    zmq_socket_send.send_string(alert_json)
                    print(f"Received data for {person_name}, saved to database with ID {row_id}, and updated embeddings.")
                    os.remove(temp_image_path)
                    
                elif topic == "delete":
                    person_id = data.get("id")
                    person_name = data.get("name")
                    
                    if not person_id or not person_name:
                        print("error : id or person name missing ")
                        continue
                    
                    conn = sqlite3.connect('./face_data.db')
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM PersonInformation WHERE id =?',(person_id,))
                    conn.commit()
                    
                    folder_name = f"{person_name}_{person_id}"
                    folder_path = os.path.join("/app/face_recognition/faces",folder_name)
                    
                    if os.path.exists(folder_path):
                        try:
                            # Delete all files in the folder before removing the folder
                            for file in os.listdir(folder_path):
                                file_path = os.path.join(folder_path, file)
                                if os.path.isfile(file_path):
                                    os.remove(file_path)
                            # Finally, remove the folder itself
                            os.rmdir(folder_path)
                            print(f"Successfully deleted folder: {folder_path}")
                        except Exception as e:
                            print(f"Error deleting folder {folder_path}: {e}")
                    else:
                        print(f"Folder for {person_name} (ID: {person_id}) does not exist.")
                        
                    embedding_label = f"{person_name}_{person_id}"  # Ensure this matches how labels are stored
                    embedding_manager.delete_embedding(embedding_label)
                    
                    # Close the database connection
                    conn.close()
                    print(f"Successfully deleted person with ID {person_id} and name {person_name}.")   
                
                elif topic == "MultipleFaces":
                    multiple_face_path  = data.get("path")
                    remark = data.get("Remark")
                    person_type = data.get("Type")
                    group_name = data.get("GroupName")    
                    
                    try:
                        group_id = get_group_id(group_name)
                    except ValueError as e:
                        print(f"Error : {e}")
                        continue
                    
                    if multiple_face_path:
                        try:
                            print(multiple_face_path)
                            zip_data = base64.b64decode(multiple_face_path)
                            
                            temp_folder = os.path.join(os.getcwd(),"TempMultipleFaces")
                            if not os.path.exists(temp_folder):
                                os.makedirs(temp_folder)
                                
                            zip_file_path = os.path.join(temp_folder,"temp.zip")
                            with open(zip_file_path,"wb") as f:
                                f.write(zip_data)
                                
                            shutil.unpack_archive(zip_file_path,temp_folder,format='zip')
                            folder_path = temp_folder
                        except Exception as e:
                            print(f"Error decoding or extracting zip file : {e}")
                            continue 
                    else:
                        folder_path = os.path.join(os.getcwd(),"MultipleFaces")
                    
                    if not os.path.exists(folder_path):
                        print(f"Error: The folder {folder_path} does not exist")
                        continue
                    
                    for image_file in os.listdir(folder_path):
                        if image_file.lower().endswith((".jpg",".jpeg",",png")):
                            extracted_name = os.path.splitext(image_file)[0]
                            image_path = os.path.join(folder_path,image_file)
                            
                            row_id = save_person_information(extracted_name,person_type,remark,group_id)   
                            saved_image_path , folder_name = save_received_multiple_face_image(extracted_name,row_id,image_path)
                            generate_and_update_embedding(saved_image_path, folder_name, recognizer, detector, embedding_manager)

                    embedding_manager.reload_embeddings()
                    print(f"Processed multiple faces from  and updated embeddings.")
                    
                    # zmq_socket_send.send_string("Multiple Faces Complete.")
                    
                elif topic == "Add_Camera":
                    rtsp_id = data.get("streamid")
                    rtsp_url = data.get("rtspstream")  
                    
                    if not rtsp_id or not rtsp_url:
                        print("Error: Missing rtsp_id or rtsp_url in request")
                        continue
                    if rtsp_id in rtsp_urls:
                        print(f"Error: RTSP ID {rtsp_id} already present ")  
                        continue
                    
                    with license_lock:
                        if not license_valid:
                            error_msg = "License is invalid or not loaded."
                            print(error_msg)
                            
                            continue
                        
                        current_cameras = len(rtsp_urls)
                        max_cameras = license_data.get('num_cameras', 0)
                        if current_cameras >= max_cameras:
                            error_msg = f"Cannot add camera: Maximum number of cameras ({max_cameras}) reached."
                            print(error_msg)
                            
                            continue
                        
                    default_roi = [
                
                    [6,38],
                    [6,611],
                    [630,611],
                    [622,63]
                
                        ]
                    
                    print("Starting new Camera in new thread..")
                    stream_flags[rtsp_id] = True
                    
                    future = executor.submit(
                        process_stream,
                        rtsp_id,
                        rtsp_url,
                        default_roi,
                        detector,
                        recognizer,
                        embedding_manager,
                        zmq_socket_send,
                        zmq_socket_send_data,
                        stream_flags
                    )
                    
                    stream_threads[rtsp_id] = future
                    
                    rtsp_urls[rtsp_id] = {
                        "rtsp_url": rtsp_url,
                        "roi": default_roi
                    }
                    
                    update_streams(rtsp_urls)
                    
                    print(f"Started new thread and Updated the Streams File..")
                
                elif topic == 'Delete_Camera':
                    rtsp_id = data.get('streamid')
                    if not rtsp_id:
                        print("Error: Missing rtsp_id in request")
                        continue
                    
                    if rtsp_id not in rtsp_urls:
                        print(f"Error: RTSP ID {rtsp_id} not found in active streams..")
                        continue
                    
                    if rtsp_id in stream_flags:
                        print(f"Stopping stream flag for rtsp_id : {rtsp_id}")
                        stream_flags[rtsp_id] = False     
                        
                    if rtsp_id in stream_threads:
                        try:
                            stream_threads[rtsp_id].result()
                        except Exception as e:
                            print(f"Error while stopping the thread for rtsp_id {rtsp_id} :{e}")
                    
                    del stream_threads[rtsp_id]
                    del stream_flags[rtsp_id]
                    del rtsp_urls[rtsp_id]
                    update_streams(rtsp_urls)
                    print(f"Successfully deleted rtsp_id : {rtsp_id}")
                
                elif topic == "new category":
                    group_name = data.get("name")
                    remark = data.get("remark")
                    print(group_name,remark)

                    if not group_name:
                        print("group_name not present")
                        continue

                    # Connect to database
                    conn = sqlite3.connect('./face_data.db')
                    cursor = conn.cursor()

                    # Check if group already exists
                    cursor.execute("SELECT group_id FROM `Group` WHERE group_name = ?", (group_name,))
                    existing_group = cursor.fetchone()

                    if existing_group:
                        print(f"Error: Group '{group_name}' already exists")
                        
                    else:
                        # Insert new group
                        cursor.execute(
                            "INSERT INTO `Group` (group_name, remark) VALUES (?, ?)",
                            (group_name, remark)
                        )
                        conn.commit()
                        
                        # Get the newly created group_id
                        new_group_id = cursor.lastrowid
                        print(f"Created new group '{group_name}' with ID {new_group_id}")


                    conn.close()

                elif topic == "SinglePerson":
                    compressed_folder = data.get("path")
                    person_name = data.get("PersonName")
                    remark = data.get("Remark")
                    person_type = data.get("Type")
                    group_name = data.get("GroupName")
                    age = data.get("Age")
                    sex = data.get("Sex")
                    
                    if not compressed_folder:
                        print("Error: No compressedFolder provided for singleperson")
                        continue
                    
                    try:
                        group_id = get_group_id(group_name)
                    except ValueError as e:
                        print(f"Error: {e}")
                        continue
                    
                    try:
                        # Decode base64 zip data
                        zip_data = base64.b64decode(compressed_folder)
                        
                        # Create temporary folder for extraction
                        temp_folder = os.path.join(os.getcwd(), "TempSinglePerson")
                        if not os.path.exists(temp_folder):
                            os.makedirs(temp_folder)
                            
                        # Save and extract zip
                        zip_file_path = os.path.join(temp_folder, "temp_singleperson.zip")
                        with open(zip_file_path, "wb") as f:
                            f.write(zip_data)
                            
                        shutil.unpack_archive(zip_file_path, temp_folder, format='zip')
                        
                        # Get list of image files
                        image_paths = [
                            os.path.join(temp_folder, f) for f in os.listdir(temp_folder)
                            if f.lower().endswith((".jpg", ".jpeg", ".png"))
                        ]
                        
                        if not image_paths:
                            print("No valid images found in compressed folder")
                            shutil.rmtree(temp_folder)
                            continue
                            
                        # Generate average embedding
                        avg_embedding = generate_average_embedding(image_paths, recognizer, detector)
                        if avg_embedding is None:
                            print(f"Failed to generate average embedding for {person_name}")
                            shutil.rmtree(temp_folder)
                            continue
                            
                        # Save person information
                        row_id = save_person_information(person_name, person_type, remark, group_id, age, sex)
                        
                        # Save all images to the faces folder
                        folder_name = save_received_multiple_single_face_image(person_name, row_id, image_paths)
                        
                        # Add average embedding to FAISS with folder_name as label
                        embedding_manager.add_embedding(avg_embedding, folder_name)
                        embedding_manager.reload_embeddings()
                        
                        # Clean up temporary folder (only the zip file remains, images have been moved)
                        shutil.rmtree(temp_folder)
                        
                        
                        print(f"Processed single person {person_name} with {len(image_paths)} images, moved all to faces folder")   

                    except Exception as e:
                        print(f"Error processing singleperson compressed folder: {e}")
                        if os.path.exists(temp_folder):
                            shutil.rmtree(temp_folder)
                

                elif topic == "auto_enrollment":
                    # Extract required fields
                    person_name = data.get("PersonName")
                    gender = data.get("gender")  # e.g., "Male", "Female"
                    age = data.get("age")        # e.g., 30
                    group_name = data.get("GroupName")      # Default group name
                    detected_image_url = data.get("DetectedImage")  # URL like https://10.20.1.173/api/images/home/sparsh/Desktop/FaceRecognition/detected_faces/2025-04-11/unknown_20250411_153246.jp

                    if not all([person_name, detected_image_url]):
                        print("Error: Missing required fields for auto enrollment")
                        continue

                    # Extract the image path from the URL
                    image_path = detected_image_url.replace(f"https://{port}/api/images", "")
                    if not os.path.exists(image_path):
                        print(f"Error: Image file does not exist at {image_path}")
                        continue

                    try:
                        group_id = get_group_id(group_name)
                    except ValueError as e:
                        print(f"Error: {e}")
                        continue

                    # Read the image directly from the path
                    image = cv2.imread(image_path)
                    if image is None:
                        print(f"Failed to read image: {image_path}")
                        continue

                    # Generate embedding for the new face
                    boxes_list, kpss_list = detector.detect(image)
                    if len(boxes_list) == 0:
                        print(f"No face detected in image for {person_name}")
                        continue

                    bbox = boxes_list[0][:4]
                    kps = kpss_list[0] if kpss_list is not None and len(kpss_list) > 0 else None
                    if kps is None:
                        print(f"No keypoints detected for {person_name}")
                        continue

                    kps = kps.reshape(5, 2)
                    new_embedding = recognizer(image, kps)

                    # Check for similar faces (threshold of 0.40)
                    matched_label, similarity_score = embedding_manager.search_embedding(new_embedding, threshold=0.40, top_k=1)

                    if matched_label != "unknown" and similarity_score >= 0.20:
                        # Send alert if similar face found
                        
                        print(f"Alert sent: Similar face found - {matched_label} with {similarity_score*100:.2f}% similarity")
                        continue  # Skip adding the new face

                    # Save person information in the database and get the row ID
                    person_type = data.get("Type", "unknown")  # Default to "unknown" if not provided
                    remark = data.get("Remark", "")  # Default to empty string if not provided
                    row_id = save_person_information(person_name, person_type, remark, group_id, age, gender)

                    # Convert image to base64 for saving (to reuse save_received_face_image)
                    _, buffer = cv2.imencode('.jpg', image)
                    image_base64 = base64.b64encode(buffer).decode('utf-8')

                    # Save the received face image in the 'faces' folder with "personname_rowid"
                    saved_image_path, folder_name = save_received_face_image(person_name, row_id, image_base64)

                    # Generate and update embeddings for the new face
                    generate_and_update_embedding(saved_image_path, folder_name, recognizer, detector, embedding_manager)

                    # Reload the updated embeddings
                    embedding_manager.reload_embeddings()

                    
                    print(f"Auto enrollment successful for {person_name}, saved to database with ID {row_id}, and updated embeddings.")

        except json.JSONDecodeError as json_err:
            print(f"Error parsing JSON data: {json_err}. Raw message: {json_data}")
        except Exception as e:
            print(f"Error receiving or processing data from ZeroMQ: {e}")
            
        
# Send the detected face, original image, type, and remark to the ZeroMQ socket
def send_detected_face_zmq(rtsp_id, detected_image_path, person_name, zmq_socket,zmq_socket_send_data,attributes,frame_path,cropped_face):
    try:
        detected_image_url = f"https://{port}/api/images/{path}/{detected_image_path.replace(os.sep, '/')}"
        print(detected_image_url)

        full_frame_dirname = os.path.basename(os.path.dirname(frame_path))
        full_frame_basename = os.path.basename(frame_path)
        full_frame_relative_path = f"{full_frame_dirname}/{full_frame_basename}"
        full_frame_url = f"https://{port}/api/images/{path}/FullFrames/{full_frame_relative_path}"
        # Initialize original_image_url to None by default
        original_image_url = None
        original_face_base64 = None

        # Only try to find the original image if the person is not "unknown"
        if person_name != "unknown":
            original_image_relative_path = find_original_image(person_name)
            if original_image_relative_path:
                original_dir_name = os.path.basename(os.path.dirname(original_image_relative_path))
                original_basename = os.path.basename(original_image_relative_path)
                original_dir_base = f"{original_dir_name}/{original_basename}"
                original_image_url = f"https://{port}/api/images/{path}/faces/{original_dir_base}"

                original_image = cv2.imread(original_image_relative_path)
                if original_image is not None:
                    _, original_buffer = cv2.imencode('.jpg', original_image)
                    original_face_base64 = base64.b64encode(original_buffer).decode('utf-8')

        # Default values for unknown person
        if person_name == "unknown":
            person_type = "unknown"
            remark = "unknown"
        else:
            person_type, remark = get_person_info(person_name)  # Get both type and remark
            
        payload = {
            "DeviceId": rtsp_id,
            "DetectedImage": detected_image_url, 
            "OriginalImage": original_image_url, 
            "FullframeImage" :  full_frame_url,
            "PersonName": person_name,
            "Type": person_type,
            "Remark": remark,
            "Event": "FaceDetected",
            "Timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "Parameters" : {
                "type" : "person" ,
                "attributes" : attributes
            }
        }

        json_data = json.dumps(payload)
        print(json_data)
        zmq_socket.send_string(json_data)
        
        _, buffer = cv2.imencode('.jpg', cropped_face)
        base64_image = base64.b64encode(buffer).decode('utf-8')
        
        if vms_ip:
        
            vms_payload = {
                    
                "DeviceId": rtsp_id,
                "FrameData": base64_image,
                "Event": "Face_Detected",
                "Detection": "True"
                }
            
            json_vms = json.dumps(vms_payload)
            print(json_vms)
                
            vms_zmq_socket.send_string(json_vms)
            print("sent data to vms for FRS")
            
        if api_url:

            api_payload = {
                "EventName": "Face_Detected",
                "DeviceId": rtsp_id,
                "base64_image": base64_image,
                "OriginalFace": original_face_base64 if original_face_base64 else None,
                "DeviceName": None,
                "DeviceIp": None,
                "UnixTimeInGmt": int(time.time()),
                "Properties": {
                    "PersonName": person_name
                }
            }
            api_queue.put(api_payload)
            print("saving data to alert queue")
        else:
            print("Not sending data to alert queue")
        
        print(f"Face detected alert sent for {rtsp_id} - {person_name} (Type: {person_type}, Remark: {remark})")
    except Exception as e:
        print(f"Failed to send detected face to ZeroMQ socket: {e}")


def map_score(original_score):
    """Map original score to display score based on defined ranges."""
    if 0.40 <= original_score <= 0.55:
        return 0.89
    elif 0.55 < original_score <= 0.70:
        return 0.92
    elif original_score > 0.70:
        return 0.95
    return original_score  # Return original score if it doesn't fall in any range

def process_stream(rtsp_id, rtsp_url,roi, detector, recognizer, embedding_manager, zmq_socket,zmq_socket_send_data,stream_flags, max_retries=-1, reconnect_delay=5,full_frames_folder=f"/app/face_recognition/FullFrames"):
    retries = 0
    target_fps = 5  # Desired fps for processing
    print(f"strating RTSP Stream : {rtsp_id} : {rtsp_url}")
    while retries < max_retries or max_retries == -1:
        cap = cv2.VideoCapture(rtsp_url,cv2.CAP_FFMPEG)
        last_save_times = {}

        if not cap.isOpened():
            print(f"Error opening stream: {rtsp_id}, retrying in {reconnect_delay} seconds...")
            retries += 1
            time.sleep(reconnect_delay)
            continue

        # Get the original frame rate of the stream
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        if original_fps <= 0:
            print(f"Failed to retrieve frame rate for stream {rtsp_id}. Setting default fps to 30.")
            original_fps = 25  # Default to 30 fps if unable to get fps
        frame_skip = int(original_fps / target_fps)  # Calculate frames to skip for target fps

        frame_count = 0
        
        while stream_flags.get(rtsp_id, True):
            ret, frame = cap.read()
            if not ret:
                print(f"Stream {rtsp_id} ended or error occurred. Retrying in {reconnect_delay} seconds...")
                retries += 1
                time.sleep(reconnect_delay)
                break
            
            original_frame = frame.copy()
            original_frame_height, original_frame_width = original_frame.shape[:2]
            
            # Process only if frame_count is a multiple of frame_skip
            if frame_count % frame_skip == 0:
                # Resize frame to 640x640 for consistent processing
                frame = cv2.resize(frame, (640, 640))

                person_name, score, cropped_face,angles = identify_person_frame(frame,original_frame,original_frame_height,original_frame_width, detector, recognizer, embedding_manager,roi)

                if person_name == "unknown" or (person_name and score > 0.40):
                    current_time = datetime.now()
                    if person_name not in last_save_times or (current_time - last_save_times[person_name]).seconds >= 5:
                        
                        if enable_attributes:
                            attributes = generate_attributes(cropped_face)
                            print(f"Attributes for {person_name}: {attributes}")
                            # Add angles to attributes dict if available
                            if angles is not None:
                                attributes["yaw"] = round(float(angles[0]), 2)
                                attributes["pitch"] = round(float(angles[1]), 2)
                                attributes["roll"] = round(float(angles[2]), 2)
                                attributes['score'] = float(score)

                        else:
                            attributes = {}
                            attributes["yaw"] = round(float(angles[0]), 2)
                            attributes["pitch"] = round(float(angles[1]), 2)
                            attributes["roll"] = round(float(angles[2]), 2)
                            attributes['score'] = float(score)
                            
                        print(f"Attributes for {person_name}: {attributes}")
                        image_path = save_detected_face(cropped_face, person_name)

                       
                        # save_face_to_db(rtsp_id, person_name, image_path, float(score), gender, glasses, beard, age) # Pass score to the database
                       
                        roi_polygon = np.array(roi, dtype=np.int32)
                        cv2.polylines(frame, [roi_polygon], isClosed=True, color=(0, 255, 0), thickness=2)
                        
                        if not os.path.exists(full_frames_folder):
                            os.makedirs(full_frames_folder)  

                        today_date = datetime.now().strftime('%Y-%m-%d')
                        date_folder_path = os.path.join(full_frames_folder,today_date)
                        
                        if not os.path.exists(date_folder_path):
                            os.makedirs(date_folder_path)
                        
                        timestamp = current_time.strftime("%Y%m%d_%H%M%S")
                        frame_filename = f"{person_name}_{timestamp}_fullframe.jpg"
                        frame_path = os.path.join(date_folder_path, frame_filename)
                        cv2.imwrite(frame_path, frame)
                        print(f"Full frame saved: {frame_path}")
                        
                        send_detected_face_zmq(rtsp_id, image_path, person_name, zmq_socket,zmq_socket_send_data,attributes,frame_path,cropped_face)
                        print(f"Stream {rtsp_id} - Identified: {person_name}, Score: {score:.4f}, Image saved at: {image_path}")
                        
                        
                        last_save_times[person_name] = current_time
                else:
                    print(f"Stream {rtsp_id} - No person identified or confidence too low.")

                cv2.putText(frame, f"Person: {person_name}, Score: {score:.4f}" if person_name else "No person identified",
                            (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                # cv2.imshow(f"RTSP Stream {rtsp_id}", frame)

                # # Handle user interrupt (Press 'q' to quit)
                # if cv2.waitKey(1) & 0xFF == ord('q'):
                #     break
            frame_count += 1
            
        if not stream_flags.get(rtsp_id, False):
            print(f"Stream flag for {rtsp_id} is set to False. Exiting process_stream function.")
            break
        
        cap.release()
        print(f"Reconnecting to stream {rtsp_id} in {reconnect_delay} seconds...")
        time.sleep(reconnect_delay)

    if retries >= max_retries:
        print(f"Stream {rtsp_id} failed after {max_retries} attempts.")


def identify_person_frame(frame, original_frame, original_frame_height, original_frame_width, 
                          detector, recognizer, embedding_manager, roi):
    """Identifies a person in a frame by matching embeddings with FAISS and retrieving correct label from JSON"""

    # Extract face embedding and bounding box
    embedding, bbox ,angles = process_image(frame, original_frame, original_frame_height, original_frame_width, 
                                    detector, recognizer, roi)
    if embedding is None:
        return None, None, None ,None # No face detected
    
    bbox_original = rescale_bbox(bbox, (640, 640), (original_frame_height, original_frame_width))
    cropped_face = crop_face(original_frame, bbox_original)
    # Search in FAISS index
    person_name, score = embedding_manager.search_embedding(embedding, threshold=0.40, top_k=1)

    if person_name == "unknown":
        return "unknown", 0.0, cropped_face,angles        
        
    display_score = map_score(score)
    return person_name, display_score, cropped_face,angles


def process_image(image,original_frame,original_frame_height,original_frame_width, detector, recognizer, roi, margin_ratio=1):
    
    # Detect faces and keypoints in the image
    boxes_list, kpss_list = detector.detect(image)
    if len(boxes_list) == 0:
        return None, None ,None # No face detected

    # Get the first detected bounding box and its keypoints
    bbox = boxes_list[0][:4]

    # Create ROI polygon
    roi_polygon = np.array(roi, dtype=np.int32)

    # Calculate the center of the bounding box
    center_x = (bbox[0] + bbox[2]) / 2
    center_y = (bbox[1] + bbox[3]) / 2
    center_point = (center_x, center_y)

    # Check if the center point of the bounding box is inside the ROI
    if cv2.pointPolygonTest(roi_polygon, center_point, measureDist=False) >= 0:
        kps = kpss_list[0] if kpss_list is not None and len(kpss_list) > 0 else None

        if kps is None:
            return None, None,None  # No keypoints detected

        # Reshape keypoints to a 5x2 array
        kps = kps.reshape(5, 2)
        bbox_original = rescale_bbox(bbox,(640,640),(original_frame_height, original_frame_width))
        # Crop the face from the image using the bounding box with margins
        cropped_face = crop_face(original_frame, bbox_original, margin_ratio)
        # cv2.imshow("cropped face ",cropped_face)
        
        boxes_list_cropped, kpss_list_cropped = detector.detect(cropped_face)
        if len(boxes_list_cropped) == 0:
            print("Error: No face detected in cropped image.")
            return None, None,None # No face detected in cropped face

        # Get the new bounding box and keypoints from the cropped face
        bbox_cropped = boxes_list_cropped[0][:4]
        kps_cropped = kpss_list_cropped[0] if kpss_list_cropped is not None and len(kpss_list_cropped) > 0 else None

        if kps_cropped is None:
            print("Error: No keypoints detected in cropped image.")
            return None, None , None # No keypoints detected in cropped face

        # Reshape keypoints
        kps_cropped = kps_cropped.reshape(5, 2)

        # Adjust keypoints relative to the cropped face
        x1, y1, x2, y2 = bbox_cropped.astype(int)

        # Scale the keypoints to the cropped face dimensions
        cropped_height, cropped_width = cropped_face.shape[:2]
        kps_cropped[:, 0] = np.clip(kps_cropped[:, 0], 0, cropped_width - 1)
        kps_cropped[:, 1] = np.clip(kps_cropped[:, 1], 0, cropped_height - 1)

        # for keypoint in kps_cropped:
        #     x, y = int(keypoint[0]), int(keypoint[1])
        #     cv2.circle(cropped_face, (x, y), radius=3, color=(0, 255, 0), thickness=-1)
        # Generate embedding with the refined keypoints
        embedding = recognizer(cropped_face, kps_cropped)

        left_eye = kps_cropped[0]    # [x, y]
        right_eye = kps_cropped[1]   # [x, y]
        nose = kps_cropped[2]        # [x, y]
        left_mouth = kps_cropped[3]  # [x, y]
        right_mouth = kps_cropped[4] # [x, y]

        angles = []
        # Calculate yaw (horizontal head turn)
        eye_center = (left_eye + right_eye) / 2
        nose_x_offset = nose[0] - eye_center[0]
        face_width = right_eye[0] - left_eye[0]
        yaw = np.arctan2(nose_x_offset, face_width) * 180 / np.pi  # Convert to degrees
        yaw = np.clip(yaw, -90, 90)  # Limit range
        angles.append(yaw)
        
        # Calculate pitch (vertical head tilt)
        eye_nose_dist = nose[1] - eye_center[1]
        mouth_nose_dist = (left_mouth[1] + right_mouth[1]) / 2 - nose[1]
        pitch = np.arctan2(eye_nose_dist - mouth_nose_dist, face_width) * 180 / np.pi
        pitch = np.clip(pitch, -90, 90)  # Limit range
        angles.append(pitch)
        
        # Calculate roll (head tilt side to side)
        eye_delta_y = right_eye[1] - left_eye[1]
        eye_delta_x = right_eye[0] - left_eye[0]
        roll = np.arctan2(eye_delta_y, eye_delta_x) * 180 / np.pi
        roll = np.clip(roll, -90, 90)
        angles.append(roll)
        print(angles)

        return embedding, bbox,angles


    return None, None,None


# Main function to initialize everything and start processing streams
def main():
    try:
        zmq_send_port = config["zmq"]["publisher"]["address"]
        zmq_send_data_port = config["zmq"]["publisher"]["main_address"]
        zmq_recv_port = config["zmq"]["subscriber"]["address_FRS"]
        print(zmq_send_port,zmq_send_data_port,zmq_recv_port)
        
        init_db()
        faiss_index_file = "/app/face_recognition/embeddings_faiss.index"
        label_map_file = "/app/face_recognition/labels.json"

        embedding_manager = EmbeddingManager(faiss_index_file, label_map_file)

        rtsp_urls = read_urls_from_json('/app/face_recognition/streams.json')
        
        license_info = load_license_file(LICENSE_FILE_PATH)
        if not license_info:
            error_msg = "Failed to load license file."
            print(error_msg)
            raise LicenseError(error_msg)
        print("License File Loaded for FRS..")
        
        expiry_date = date.fromisoformat(license_data['expiry_date'])
        if datetime.now().date() > expiry_date:
                error_msg = "License has expired."
                print(error_msg)
                raise LicenseError(error_msg)
        print("Date checked for FRS..")
        
        detector = SCRFD(model_path="/app/face_recognition/det_10g.onnx")
        recognizer = ArcFace(model_path="/app/face_recognition/face_matcher.onnx")

        # Initialize ZeroMQ socket for sending data (Publisher)
        context_send = zmq.Context()
        zmq_socket_send = context_send.socket(zmq.PUB)
        zmq_socket_send.connect(zmq_send_port)

        context_send_data = zmq.Context()
        zmq_socket_send_data = context_send_data.socket(zmq.PUB)
        zmq_socket_send_data.connect(zmq_send_data_port)
        # Initialize ZeroMQ socket for receiving data (Subscriber)
        context_recv = zmq.Context()
        zmq_socket_recv = context_recv.socket(zmq.SUB)
        zmq_socket_recv.bind(zmq_recv_port)
        zmq_socket_recv.setsockopt_string(zmq.SUBSCRIBE, "")  # Subscribe to all incoming messages

        api_handler = APIHandler(config.get("api", {}), api_queue)
        api_thread = api_handler.start()

        with ThreadPoolExecutor(max_workers=len(rtsp_urls) + 50) as executor:
            for rtsp_id, data in rtsp_urls.items():
                stream_flags[rtsp_id] = True  # Initialize stream flag
                future = executor.submit(process_stream, rtsp_id, data['rtsp_url'], data['roi'], detector, recognizer, embedding_manager, zmq_socket_send, zmq_socket_send_data, stream_flags)
                stream_threads[rtsp_id] = future
            
            listener_thread = threading.Thread(target=receive_person_data_zmq,args=(zmq_socket_recv, zmq_socket_send,zmq_socket_send_data, recognizer, detector, embedding_manager,rtsp_urls,executor))
            listener_thread.start()
            listener_thread.join()
             
            # Cleanup
            if api_thread:
                api_queue.put(None)  # Signal API thread to stop
                api_thread.join()
                
    except Exception as e:
        print(f"Error in main function: {e}")


if __name__ == "__main__":
    main()
