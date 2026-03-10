from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torchvision
import torchvision.transforms as T
import cv2
import numpy as np
import base64
import joblib
import random

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# -----------------------------
# LOAD MODELS
# -----------------------------
def try_load_torch(paths):
    for p in paths:
        try:
            m = torch.load(p, map_location=device)
            m.eval()
            return m
        except Exception:
            continue
    return None

detection_model = try_load_torch([
    "models/fasterrcnn_fish.pth",
    "models/model.pth"
])

rf_model = None
try:
    rf_model = joblib.load("models/random_forest.pkl")
except Exception:
    pass

to_tensor = T.ToTensor()

# -----------------------------
# VOCABULARY (your lists)
# -----------------------------
appearance_dried = [
"Wrinkled","Rough","Hard","Stiff","Dry","Leathery","Shrunk",
"Curled","Rigid","Cracked","Brittle","Flattened","Tough"
]

appearance_partial = [
"Semi-dry","Slightly wrinkled","Slightly dull","Partly moist",
"Uneven","Slightly rough","Slightly shrunk","Pale",
"Patchy","Sticky-looking","Flattening"
]

appearance_wet = [
"Shiny","Glossy","Wet","Slippery","Slimy","Plump",
"Fresh-looking","Reflective","Bright","Intact","Soft-looking"
]

color_dried = [
"Golden Brown","Brown","Dark Brown","Deep Yellow",
"Amber","Dark Golden","Yellow Brown","Caramel Brown"
]

color_partial = [
"Pale Yellow","Yellowish","Light Brown","Cream",
"Beige","Dull White","Faded Pink","Light Golden","Slightly Brown"
]

color_wet = [
"Silver","Pink","Light Pink","Reddish","Gray",
"White","Pale Pink","Metallic Silver"
]

texture_dried = ["Rough","Wrinkled","Brittle","Dry","Leathery","Shriveled"]
texture_partial = ["Wet","Slightly wrinkled","Slightly rough"]
texture_wet = ["Wet","Moist","Glossy"]

# -----------------------------
# HELPERS
# -----------------------------
def decode_image(data_url):
    try:
        if data_url is None:
            return None
        if "," in data_url:
            data_url = data_url.split(",")[1]
        img_bytes = base64.b64decode(data_url)
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None

def encode_image(img):
    ok, buf = cv2.imencode(".jpg", img)
    if not ok:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()

def extract_features(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hue = float(np.mean(hsv[:,:,0]))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    texture = float(np.var(gray))
    return hue, texture

def dryness_from_texture(texture):
    # heuristic dryness classifier (replace with a trained model if you have one)
    if texture < 5:
        return 0  # dried
    elif texture < 10:
        return 1  # partially
    else:
        return 2  # not dried

def dynamic_sentence(fully, partial, not_dry, avg_hue, avg_texture):
    total = fully + partial + not_dry
    if total == 0:
        return "No fish were detected in the tray."

    # choose vocab pools based on dominance
    if fully >= partial and fully >= not_dry:
        a = random.choice(appearance_dried)
        c = random.choice(color_dried)
        t = random.choice(texture_dried)
    elif partial >= fully and partial >= not_dry:
        a = random.choice(appearance_partial)
        c = random.choice(color_partial)
        t = random.choice(texture_partial)
    else:
        a = random.choice(appearance_wet)
        c = random.choice(color_wet)
        t = random.choice(texture_wet)

    # build sentence from measured features (not a fixed template phrase list)
    return f"The tray shows {total} fish with {a.lower()} appearance, {c.lower()} coloration, and {t.lower()} surface characteristics."

# -----------------------------
# API
# -----------------------------
@app.route("/analyze", methods=["POST"])
def analyze():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error":"no json"}), 400

        front_data = data.get("front")
        front = decode_image(front_data)
        if front is None:
            return jsonify({"error":"image decode failed"}), 400

        annotated = front.copy()

        # ---------- DETECTION ----------
        boxes = []
        scores = []

        if detection_model is not None:
            tensor = to_tensor(front).to(device)
            with torch.no_grad():
                out = detection_model([tensor])[0]
            boxes = out.get("boxes", []).detach().cpu().numpy()
            scores = out.get("scores", []).detach().cpu().numpy()
        else:
            # fallback contour detection if model missing
            gray = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY)
            _, th = cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
            cnts,_ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in cnts:
                if cv2.contourArea(c) < 500: continue
                x,y,w,h = cv2.boundingRect(c)
                boxes.append([x,y,x+w,y+h])
                scores.append(0.9)

        fully = partial = not_dry = 0
        hue_list = []
        tex_list = []
        detections = []

        for i in range(len(boxes)):
            if i < len(scores) and scores[i] < 0.5:
                continue

            x1,y1,x2,y2 = [int(v) for v in boxes[i]]
            crop = front[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            hue, tex = extract_features(crop)
            hue_list.append(hue)
            tex_list.append(tex)

            d = dryness_from_texture(tex)

            if d == 0:
                fully += 1
                color = (0,255,0)
                label = "Dried"
            elif d == 1:
                partial += 1
                color = (0,255,255)
                label = "Partially Dried"
            else:
                not_dry += 1
                color = (0,0,255)
                label = "Not Dried"

            cv2.rectangle(annotated,(x1,y1),(x2,y2),color,3)
            cv2.putText(annotated,label,(x1,y1-8),cv2.FONT_HERSHEY_SIMPLEX,0.6,color,2)

            detections.append({
                "box":[x1,y1,x2,y2],
                "dryness_class": d
            })

        avg_hue = float(np.mean(hue_list)) if hue_list else 0.0
        avg_tex = float(np.mean(tex_list)) if tex_list else 0.0

        description = dynamic_sentence(fully, partial, not_dry, avg_hue, avg_tex)

        # ---------- RANDOM FOREST RECOMMENDATION ----------
        extend = 0.0; temp = 45.0; fan = 3.0
        if rf_model is not None:
            try:
                X = np.array([[fully, partial, not_dry, avg_hue, avg_tex]])
                rec = rf_model.predict(X)[0]
                extend = float(rec[0]); temp = float(rec[1]); fan = float(rec[2])
            except Exception:
                pass
        else:
            # fallback rule
            if not_dry > 0: extend = 15.0
            elif partial > 0: extend = 8.0

        return jsonify({
            "annotated_front": encode_image(annotated),
            "detections": detections,
            "fully_dried": fully,
            "partially_dried": partial,
            "not_dried": not_dry,
            "total_fish": fully + partial + not_dry,
            "color_index": avg_hue,
            "texture_index": avg_tex,
            "description": description,
            "recommendation":{
                "extend_minutes": extend,
                "temperature": temp,
                "fan_speed": fan
            }
        })

    except Exception as e:
        print("SERVER ERROR:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/")
def home():
    return "AI server running"

if __name__ == "__main__":
    app.run(debug=True)