from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torchvision.transforms as transforms
import cv2
import numpy as np
import base64
import joblib
from skimage.feature import greycomatrix, greycoprops

app = Flask(__name__)
CORS(app)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Load trained models with fallbacks when filenames differ
def try_load_torch_model(paths):
    for p in paths:
        try:
            m = torch.load(p, map_location=device)
            m.eval()
            return m
        except Exception:
            continue
    return None

# Detection model (expected to be a Faster R-CNN style model)
detection_model = try_load_torch_model([
    "models/fasterrcnn_fish.pth",
    "models/model.pth",
    "model.pth",
])

# Optional species classifier
species_model = try_load_torch_model([
    "models/species_model.pth",
    "models/species_model.pt",
])

# Optional dryness classifier
dryness_model = try_load_torch_model([
    "models/dryness_model.pth",
    "models/dryness_model.pt",
])

# Random forest regressor for recommendation (joblib)
rf_model = None
for p in ["models/rf_model.pkl", "models/random_forest.pkl", "random_forest.pkl", "models/random_forest.pkl"]:
    try:
        rf_model = joblib.load(p)
        break
    except Exception:
        continue

transform = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((224,224)),
    transforms.ToTensor()
])

def decode_image(data_url):
    header, encoded = data_url.split(",",1)
    img_bytes = base64.b64decode(encoded)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


def extract_features(img):

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mean_hue = np.mean(hsv[:,:,0])
    mean_sat = np.mean(hsv[:,:,1])

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    glcm = greycomatrix(gray, [1], [0], 256, symmetric=True, normed=True)
    contrast = greycoprops(glcm, 'contrast')[0,0]
    homogeneity = greycoprops(glcm, 'homogeneity')[0,0]

    return mean_hue, mean_sat, contrast, homogeneity


@app.route("/analyze", methods=["POST"])
def analyze():

    front = decode_image(request.json["front"])
    back  = decode_image(request.json["back"])

    # Prepare tensor for detection if model available
    detections = {"boxes": [], "scores": [], "labels": []}
    if detection_model is not None:
        tensor = transforms.ToTensor()(front).to(device)
        with torch.no_grad():
            try:
                detections = detection_model([tensor])[0]
            except Exception:
                detections = {"boxes": [], "scores": [], "labels": []}

    fully = 0
    partial = 0
    not_dry = 0
    unknown = 0
    total = 0

    hue_list = []
    texture_list = []

    detection_list = []

    # iterate detections safely
    boxes = detections.get("boxes", [])
    scores = detections.get("scores", [])
    labels = detections.get("labels", [])

    for i in range(len(boxes)):
        try:
            score = float(scores[i])
        except Exception:
            score = 0

        if score < 0.5:
            continue

        box = boxes[i]
        x1,y1,x2,y2 = [int(v) for v in box]
        crop = front[max(0,y1):max(0,y2), max(0,x1):max(0,x2)]

        total += 1

        label = None
        try:
            label = int(labels[i])
        except Exception:
            label = None

        # default: treat label==1 as fish, else unknown
        is_fish = (label == 1)

        if not is_fish:
            unknown += 1
            detection_list.append({
                "box": [x1,y1,x2,y2],
                "score": score,
                "type": "unknown",
            })
            continue

        # Extract features for this crop
        hue, sat, contrast, homogeneity = extract_features(crop)
        hue_list.append(hue)
        texture_list.append(contrast)

        # Dryness classification: use dryness_model if present, else simple heuristic
        dryness_class = None
        if dryness_model is not None:
            try:
                input_tensor = transform(crop).unsqueeze(0).to(device)
                with torch.no_grad():
                    pred = dryness_model(input_tensor)
                    if pred is not None:
                        probs = torch.softmax(pred, dim=1)
                        dryness_class = int(probs.argmax(dim=1).item())
            except Exception:
                dryness_class = None

        if dryness_class is None:
            # heuristic: use contrast and hue -> lower contrast + higher hue -> more dry (heuristic)
            if contrast < 5 and hue > 100:
                dryness_class = 0
            elif contrast < 10:
                dryness_class = 1
            else:
                dryness_class = 2

        if dryness_class == 0:
            fully += 1
        elif dryness_class == 1:
            partial += 1
        else:
            not_dry += 1

        # Species classification if available
        species_name = "unknown"
        if species_model is not None:
            try:
                inp = transform(crop).unsqueeze(0).to(device)
                with torch.no_grad():
                    s_pred = species_model(inp)
                    species_idx = int(torch.argmax(s_pred, dim=1).item())
                    species_name = str(species_idx)
            except Exception:
                species_name = "unknown"

        detection_list.append({
            "box": [x1,y1,x2,y2],
            "score": score,
            "type": "fish",
            "dryness_class": int(dryness_class),
            "species": species_name,
        })

    avg_hue = float(np.mean(hue_list)) if hue_list else 0.0
    avg_texture = float(np.mean(texture_list)) if texture_list else 0.0

    features = np.array([[fully, partial, not_dry, avg_hue, avg_texture]])

    recommendation = [0.0, 0.0, 0.0]
    if rf_model is not None:
        try:
            recommendation = rf_model.predict(features)[0]
        except Exception:
            recommendation = [0.0, 0.0, 0.0]

    return jsonify({
        "fully_dried": int(fully),
        "partially_dried": int(partial),
        "not_dried": int(not_dry),
        "unknown_objects": int(unknown),
        "total_fish": int(total),
        "color_index": avg_hue,
        "texture_index": avg_texture,
        "detections": detection_list,
        "recommendation": {
            "extend_minutes": float(recommendation[0]) if len(recommendation)>0 else 0.0,
            "temperature": float(recommendation[1]) if len(recommendation)>1 else 0.0,
            "fan_speed": float(recommendation[2]) if len(recommendation)>2 else 0.0,
        }
    })


if __name__ == "__main__":
    app.run(debug=True)
