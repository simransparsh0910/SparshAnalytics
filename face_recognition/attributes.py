import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import numpy as np
import cv2

# Define the model architecture (must match the trained model)
class EfficientNetB4MultiTask(nn.Module):
    def __init__(self):
        super(EfficientNetB4MultiTask, self).__init__()
        self.efficientnet = models.efficientnet_b4(weights=None)
        num_ftrs = self.efficientnet.classifier[1].in_features
        self.efficientnet.classifier = nn.Identity()

        self.classification_head = nn.Sequential(
            nn.Linear(num_ftrs, 512),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(512, 8)
        )

        self.regression_head = nn.Sequential(
            nn.Linear(num_ftrs, 512),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(512, 1),
            nn.Sigmoid()  # Output in [0, 1]
        )

    def forward(self, x):
        features = self.efficientnet(x)
        class_output = self.classification_head(features)
        age_output = self.regression_head(features)
        return class_output, age_output

# Define transforms (same as validation/test in training)
transform = transforms.Compose([
    transforms.Resize((380, 380)),  # EfficientNet-B4 expects 380x380
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# Load model once at startup
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = EfficientNetB4MultiTask().to(device)
try:
    model.load_state_dict(torch.load('/app/face_recognition/efficientnet_b4_faces_finetuned.pth', map_location=device, weights_only=True))
    model.eval()
except Exception as e:
    raise RuntimeError(f"Failed to load model: {e}")

def generate_attributes(cropped_face, max_age=100.0):
    """
    Takes a NumPy array (cropped face) and returns structured attributes.
    
    Args:
        cropped_face (np.ndarray): BGR image from OpenCV (HxWxC)
        max_age (float): Maximum age for denormalization (default: 100.0)

    Returns:
        dict: Structured attributes including Glasses, Beard, Gender, Mask, Age
    """
    # Convert from BGR (OpenCV) to RGB
    rgb_image = cv2.cvtColor(cropped_face, cv2.COLOR_BGR2RGB)

    # Convert to PIL Image
    pil_image = Image.fromarray(rgb_image)

    # Apply transforms
    input_tensor = transform(pil_image).unsqueeze(0).to(device)  # Add batch dim & move to device

    # Make prediction
    with torch.no_grad():
        class_output, age_output = model(input_tensor)

    # Process classification outputs
    class_probs = torch.sigmoid(class_output).squeeze().cpu().numpy()
    class_labels = [
        'With Glasses', 'Without Glasses',
        'Beard', 'No Beard',
        'Male', 'Female',
        'Mask', 'No Mask'
    ]

    # Grouped pairs for comparison
    grouped = {
        'Glasses': ('With Glasses', 'Without Glasses'),
        'Beard': ('Beard', 'No Beard'),
        'Gender': ('Male', 'Female'),
        'Mask': ('Mask', 'No Mask')
    }

    result = {}

    # Compare probabilities and choose winner per group
    for key, (label1, label2) in grouped.items():
        idx1 = class_labels.index(label1)
        idx2 = class_labels.index(label2)
        if class_probs[idx1] > class_probs[idx2]:
            result[key] = label1
        else:
            result[key] = label2

    # Process age output (denormalize and round)
    age = age_output.squeeze().cpu().numpy().item() * max_age
    result['Age'] = round(age)

    return result

# Example usage
if __name__ == "__main__":
    # Example: Load an image using OpenCV
    image_path = r"C:\Users\spars\Downloads\WhatsApp Image 2025-01-30 at 12.43.58 PM.jpeg"  # Replace with your image path
    try:
        # Read image with OpenCV (BGR format)
        image = cv2.imread(image_path)
        if image is None:
            raise FileNotFoundError(f"Image file {image_path} not found.")

        # Assume the image is already a cropped face (modify if face detection is needed)
        attributes = generate_attributes(image)

        print("Predicted Attributes:")
        for key, value in attributes.items():
            print(f"{key}: {value}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
    except Exception as e:
        print(f"Error during prediction: {e}")