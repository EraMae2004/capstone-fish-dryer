import os
import cv2
import numpy as np
import joblib

from sklearn.metrics import confusion_matrix, classification_report, accuracy_score

BASE_PATH = "datasets/dataset_attributes"

# =========================
# COPY SAME FEATURE FUNCTIONS (READ-ONLY, NOT MODIFYING TRAIN FILE)
# =========================
def extract_color_features(img):
    img = cv2.resize(img, (128, 128))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    h, s, v = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]

    mean_h = np.mean(h)
    mean_s = np.mean(s)
    mean_v = np.mean(v)

    red_pixels = np.sum((h < 10) | (h > 170))
    low_sat_pixels = np.sum(s < 40)

    total = img.shape[0] * img.shape[1]

    return np.array([
        mean_h, mean_s, mean_v,
        red_pixels / total,
        low_sat_pixels / total
    ])

def extract_texture_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    laplacian = cv2.Laplacian(gray, cv2.CV_64F).var()
    sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0)
    sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1)

    edge = np.mean(np.sqrt(sobelx**2 + sobely**2))

    return np.array([laplacian, edge])

def extract_appearance_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    brightness = np.mean(gray)
    contrast = np.std(gray)

    return np.array([brightness, contrast])

# =========================
# LOAD ALL DATA (NO SPLIT, PURE EVALUATION)
# =========================
def load_dataset(task):
    X, y = [], []
    path = os.path.join(BASE_PATH, task)

    for label in os.listdir(path):
        folder = os.path.join(path, label)
        if not os.path.isdir(folder):
            continue

        for file in os.listdir(folder):
            img = cv2.imread(os.path.join(folder, file))
            if img is None:
                continue

            if task == "color":
                feat = extract_color_features(img)
            elif task == "texture":
                feat = extract_texture_features(img)
            else:
                feat = extract_appearance_features(img)

            X.append(feat)
            y.append(label)

    return np.array(X), np.array(y)

# =========================
# EVALUATE (NO TRAINING, ONLY LOAD MODEL)
# =========================
def evaluate(task):
    print(f"\n🔥 {task.upper()} MODEL RESULTS")

    model = joblib.load(f"{task}_model.pkl")
    encoder = joblib.load(f"{task}_encoder.pkl")

    X, y = load_dataset(task)

    y_true = encoder.transform(y)
    y_pred = model.predict(X)
    y_prob = model.predict_proba(X)

    # CONFUSION MATRIX
    cm = confusion_matrix(y_true, y_pred)
    print("\nConfusion Matrix:\n", cm)

    # FULL METRICS
    print("\nClassification Report:\n")
    print(classification_report(y_true, y_pred, target_names=encoder.classes_))

    # ACCURACY
    acc = accuracy_score(y_true, y_pred)
    print("Accuracy:", acc)

    # CONFIDENCE
    confidence = np.mean(np.max(y_prob, axis=1))
    print("Confidence:", confidence)

# =========================
# RUN
# =========================
evaluate("color")
evaluate("texture")
evaluate("appearance")