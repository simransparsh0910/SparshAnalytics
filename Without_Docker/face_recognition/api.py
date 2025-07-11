import requests
import json
import logging
from queue import Queue
import threading
from datetime import datetime, timedelta
import time

class APIHandler:
    def __init__(self, api_config, api_queue):
        
        self.api_url = api_config.get("url", "").strip()
        self.auth_url = api_config.get("auth_url", "").strip()
        self.username = api_config.get("username", "")
        self.password = api_config.get("password", "")
        self.api_key = api_config.get("api_key", "")  # Support for API key if needed
        self.token = None
        self.token_expiry = None
        self.api_queue = api_queue
        # self.logger = self._configure_logging()
        self.lock = threading.Lock()

    # def _configure_logging(self):
    #     """Configure logging for APIHandler."""
    #     logger = logging.getLogger("api_handler")
    #     logger.setLevel(logging.DEBUG)
        
    #     if not logger.handlers:
    #         fh = logging.FileHandler('LOGS/api_frs_handler.log')
    #         fh.setLevel(logging.DEBUG)
    #         ch = logging.StreamHandler()
    #         ch.setLevel(logging.ERROR)
    #         formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    #         fh.setFormatter(formatter)
    #         ch.setFormatter(formatter)
    #         logger.addHandler(fh)
    #         logger.addHandler(ch)
        
    #     return logger

    def _get_auth_token(self):
        """Fetch or refresh the authentication token if required."""
        if not self.auth_url or not self.username or not self.password:
            # self.logger.info("No authentication configuration provided. Skipping token fetch.")
            return None

        try:
            with self.lock:
                if self.token and self.token_expiry and datetime.now() < self.token_expiry:
                    return self.token

                auth_payload = {
                    "username": self.username,
                    "password": self.password,
                    "grant_type": "password"
                }
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                
                # self.logger.info("Requesting new authentication token")
                response = requests.post(self.auth_url, data=auth_payload, headers=headers, timeout=10)
                
                if response.status_code == 200:
                    auth_data = response.json()
                    self.token = auth_data.get("access_token")
                    expires_in = auth_data.get("expires_in", 3600)
                    self.token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
                    # self.logger.info("Successfully obtained authentication token")
                    return self.token
                else:
                    # self.logger.error(f"Failed to obtain token. Status: {response.status_code}, Response: {response.text}")
                    return None
        except Exception as e:
            # self.logger.error(f"Error obtaining authentication token: {e}")
            return None

    def _modify_payload(self, payload):
        
        modified_payload = {
            "AlertType": "VA",  # Fixed as per documentation
            "AlertSubtype": payload.get("EventName", "Face_Detected").upper(),
            "Sensor": payload.get("device_id", "Unknown_Camera"),
            "Remarks": payload.get("remarks", "Face detected"),
            "Latitude": payload.get("latitude", "28.621028"),  # Default from sample
            "Longitude": payload.get("longitude", "74.62859707441274"),  # Default from sample
            "Severity": payload.get("severity", "Critical"),
            "SystemName": "Sparsh",  # Fixed as per your config
            "attachment": "Y" if payload.get("base64_image") else "N",
            "AlertExternalValue": payload.get("external_value", f"Face_{payload.get('device_id', 'Unknown')}"),
            "AlertExternalId": payload.get("external_id", f"ID_{payload.get('device_id', 'Unknown')}_{datetime.now().strftime('%Y%m%d%H%M%S')}"),
            "AttachmentType": 0,  # 0 for base64 string
            "FileNames": [payload.get("filename", f"alert_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg")],
            "Attachments": [payload.get("base64_image")] if payload.get("base64_image") else []
        }
        return modified_payload

    def send_to_api(self, payload):
       
        try:
            modified_payload = self._modify_payload(payload)
            print(modified_payload)
            headers = {'Content-Type': 'application/json'}
            
            # Add authentication headers if configured
            if self.api_key:
                headers['X-API-Key'] = self.api_key
                # self.logger.debug("Using API key for authentication")
            elif self.auth_url and self.username and self.password:
                token = self._get_auth_token()
                if token:
                    print(token)
                    headers['Authorization'] = f"Bearer {token}"
                    # self.logger.debug(f"Using Bearer token for authentication {token}")
            else:
                # self.logger.debug("No authentication configured. Sending request without auth headers")
                print("No authentication configured. Sending request without auth headers")
            
            response = requests.post(
                self.api_url,
                json=modified_payload,
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                # self.logger.info(f"Successfully sent payload to API: {modified_payload}")
                print(f"Successfully sent payload to API: {modified_payload}")
            else:
                # self.logger.error(f"Failed to send payload. Status: {response.status_code}, Response: {response.text}")
                print(f"Failed to send payload. Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            # self.logger.error(f"Error sending payload to API: {e}")
            print(f"Error sending payload to API: {e}")

    def process_queue(self):
        """Process payloads from the queue in a separate thread."""
        # self.logger.info("API processor thread started")
        while True:
            try:
                payload = self.api_queue.get()
                if payload is None:
                    # self.logger.info("API processor thread received shutdown signal")
                    break
                self.send_to_api(payload)
                self.api_queue.task_done()
            except Exception as e:
                # self.logger.error(f"Error in API processor: {e}")
                print(f"Error in API processor: {e}")
        # self.logger.info("API processor thread stopped")
        print("API processor thread stopped")

    def start(self):
        """Start the API processor thread."""
        if self.api_url:
            api_thread = threading.Thread(target=self.process_queue, daemon=True)
            api_thread.start()
            # self.logger.info("API handler thread started")
            print("API handler thread started")
            return api_thread
        else:
            # self.logger.warning("API URL not configured. API handler thread not started.")
            return None