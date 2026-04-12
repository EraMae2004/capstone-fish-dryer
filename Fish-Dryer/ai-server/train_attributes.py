# train_attributes.py


import os
import cv2
import numpy as np
import joblib

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

BASE_PATH = "datasets/dataset_attributes"


# =========================
# COLOR FEATURES (STABLE)
# =========================
def extract_color_features(img):
    img = cv2.resize(img, (128, 128))

    # Convert to HSV
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    h = hsv[:, :, 0]
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    # ===== BASIC STATS =====
    mean_h = np.mean(h)
    mean_s = np.mean(s)
    mean_v = np.mean(v)

    # ===== RED DETECTION =====
    red_pixels = np.sum((h < 10) | (h > 170))

    # ===== LOW SAT (SILVER) =====
    low_sat_pixels = np.sum(s < 40)

    total_pixels = img.shape[0] * img.shape[1]

    red_ratio = red_pixels / total_pixels
    silver_ratio = low_sat_pixels / total_pixels

    return np.array([
        mean_h,
        mean_s,
        mean_v,
        red_ratio,
        silver_ratio
    ])


# =========================
# TEXTURE FEATURES
# =========================
def extract_texture_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    laplacian = cv2.Laplacian(gray, cv2.CV_64F).var()

    sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0)
    sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1)
    edge = np.mean(np.sqrt(sobelx**2 + sobely**2))

    return np.array([laplacian, edge])


# =========================
# APPEARANCE FEATURES
# =========================
def extract_appearance_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    brightness = np.mean(gray)
    contrast = np.std(gray)

    return np.array([brightness, contrast])


# =========================
# LOAD DATASET
# =========================
def load_dataset(task_path, task):
    X = []
    y = []

    for label in os.listdir(task_path):
        folder = os.path.join(task_path, label)

        if not os.path.isdir(folder):
            continue

        for file in os.listdir(folder):
            img_path = os.path.join(folder, file)

            img = cv2.imread(img_path)
            if img is None:
                continue

            if task == "color":
                features = extract_color_features(img)
            elif task == "texture":
                features = extract_texture_features(img)
            elif task == "appearance":
                features = extract_appearance_features(img)
            else:
                continue

            X.append(features)
            y.append(label)

    return np.array(X), np.array(y)


# =========================
# TRAIN FUNCTION
# =========================
def train(task):

    print(f"\n🚀 Training {task} model...")

    path = os.path.join(BASE_PATH, task)

    X, y = load_dataset(path, task)

    if len(X) == 0:
        print(f"❌ No data found for {task}")
        return

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y)

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        random_state=42,
        n_jobs=-1
    )

    model.fit(X, y_encoded)

    joblib.dump(model, f"{task}_model.pkl")
    joblib.dump(encoder, f"{task}_encoder.pkl")

    print(f"✅ {task}_model.pkl saved")
    print(f"✅ {task}_encoder.pkl saved")
    print(f"📊 Classes: {list(encoder.classes_)}")


# =========================
# MAIN
# =========================
if __name__ == "__main__":
    train("color")
    train("texture")
    train("appearance")