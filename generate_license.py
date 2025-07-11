import pickle
from cryptography.fernet import Fernet
from datetime import date
import argparse

# Hardcoded encryption key (in production, store securely)
LICENSE_KEY = b'wLDjLQ5ADsIor-anRTvyKIX38fXdkkdYk31TqEQ2grA='  # Replace with a secure key
cipher_suite = Fernet(LICENSE_KEY)
LICENSE_FILE_PATH = 'license.bin'

def generate_license_file(num_cameras, num_analytics, expiry_date, output_path='/app/virtual_analytics/license.bin'):
    """
    Generate an encrypted license file with specified parameters.
    
    Args:
        num_cameras (int): Number of allowed cameras (streams).
        num_analytics (int): Number of allowed analytics.
        expiry_date (str): Expiry date in 'YYYY-MM-DD' format.
        output_path (str): Path to save the license file.
    """
    try:
        # Validate inputs
        if not isinstance(num_cameras, int) or num_cameras < 0:
            raise ValueError("Number of cameras must be a non-negative integer")
        if not isinstance(num_analytics, int) or num_analytics < 0:
            raise ValueError("Number of analytics must be a non-negative integer")
        try:
            date.fromisoformat(expiry_date)
        except ValueError:
            raise ValueError("Expiry date must be in YYYY-MM-DD format")

        # Create license data
        license_info = {
            'num_cameras': num_cameras,
            'num_analytics': num_analytics,
            'expiry_date': expiry_date,
            'created_at': date.today().isoformat()
        }

        # Serialize and encrypt
        serialized_data = pickle.dumps(license_info)
        encrypted_data = cipher_suite.encrypt(serialized_data)

        # Save to file
        with open(output_path, 'wb') as f:
            f.write(encrypted_data)
        print(f"License file generated at {output_path}")
    except Exception as e:
        print(f"Error generating license file: {e}")

def main():
    parser = argparse.ArgumentParser(description="Generate an encrypted license file for the Virtual Analytics application.")
    parser.add_argument('--cameras', type=int, required=True, help="Number of allowed cameras")
    parser.add_argument('--analytics', type=int, required=True, help="Number of allowed analytics")
    parser.add_argument('--expiry', type=str, required=True, help="Expiry date in YYYY-MM-DD format")
    parser.add_argument('--output', type=str, default='license.bin', help="Output path for license file")

    args = parser.parse_args()
    generate_license_file(args.cameras, args.analytics, args.expiry, args.output)

if __name__ == '__main__':
    main()