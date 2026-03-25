import torch
import cv2
import base64
import numpy as np
import torchvision
import joblib

from fastapi import FastAPI
from pydantic import BaseModel
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms import functional as F

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASSES = [
    "background",
    "sap_sap_dried","sap_sap_not_dried",
    "barol_dried","barol_not_dried",
    "galunggong_dried","galunggong_not_dried",
    "burot_dried","burot_not_dried",
    "tamban_dried","tamban_not_dried"
]

# ===== LOAD MODEL =====
model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights=None)
in_features = model.roi_heads.box_predictor.cls_score.in_features
model.roi_heads.box_predictor = FastRCNNPredictor(in_features, len(CLASSES))

model.load_state_dict(torch.load("fish_model.pth", map_location=DEVICE))
model.to(DEVICE)
model.eval()

# ===== LOAD RF =====
rf_model = joblib.load("drying_model.pkl")

app = FastAPI()

class ImageRequest(BaseModel):
    image: str
    drying_time_minutes: int


@app.post("/api/ai/analyze")
async def analyze(data: ImageRequest):

    # ===== DECODE IMAGE =====
    img_data = data.image.split(",")[1]
    img_bytes = base64.b64decode(img_data)

    np_arr = np.frombuffer(img_bytes, np.uint8)
    image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Invalid image"}

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    tensor = F.to_tensor(image_rgb).to(DEVICE)

    # ===== PREDICTION =====
    with torch.no_grad():
        prediction = model([tensor])[0]

    fish_map = {}
    total_dried = 0
    total_not = 0

    img_h, img_w = image.shape[:2]

    for box, label, score in zip(
        prediction["boxes"],
        prediction["labels"],
        prediction["scores"]
    ):

        if score < 0.6:
            continue

        cls = CLASSES[int(label)]

        # ===== CORRECT sap_sap HANDLING =====
        if cls.startswith("sap_sap_"):
            species = "sap_sap"
            state = cls.replace("sap_sap_", "")
        else:
            parts = cls.split("_")
            species = parts[0]
            state = "_".join(parts[1:])

        # ===== SKIP UNKNOWN STATES (NO WHITE BOXES) =====
        if state not in ["dried", "not_dried"]:
            continue

        species_name = species.replace("_", " ").upper()

        x1, y1, x2, y2 = map(int, box)

        # ===== COLOR =====
        color = (0,255,0) if state == "dried" else (0,0,255)

        # ===== COUNT =====
        if species_name not in fish_map:
            fish_map[species_name] = {
                "count": 0,
                "fully_dried": 0,
                "not_dried": 0
            }

        fish_map[species_name]["count"] += 1

        if state == "dried":
            total_dried += 1
            fish_map[species_name]["fully_dried"] += 1
        else:
            total_not += 1
            fish_map[species_name]["not_dried"] += 1

        # ===== AUTO SCALE TEXT =====
        font_scale = max(0.8, min(2.0, img_w / 600))
        thickness = int(max(2, img_w / 300))

        label_text = species_name

        (tw, th), _ = cv2.getTextSize(
            label_text,
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            thickness
        )

        # ===== POSITION TEXT SAFELY =====
        y_text = y1 - 10
        if y_text - th < 0:
            y_text = y1 + th + 10

        # ===== DRAW BOX =====
        cv2.rectangle(image, (x1, y1), (x2, y2), color, thickness + 2)

        # ===== TEXT BACKGROUND =====
        cv2.rectangle(
            image,
            (x1, y_text - th - 10),
            (x1 + tw + 10, y_text),
            color,
            -1
        )

        # ===== TEXT =====
        cv2.putText(
            image,
            label_text,
            (x1 + 5, y_text - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255,255,255),
            thickness,
            cv2.LINE_AA
        )

    total_fish = total_dried + total_not

    # ===== RANDOM FOREST =====
    features_rf = [[
        total_fish,
        data.drying_time_minutes,
        total_dried,
        0,
        total_not
    ]]

    predicted_minutes = float(rf_model.predict(features_rf)[0])

    # ===== FORMAT FOR YOUR UI =====
    species_list = []
    count_list = []
    fully_list = []
    not_list = []

    for species, val in fish_map.items():
        species_list.append(species)
        count_list.append(f"{species} - {val['count']}")
        fully_list.append(f"{species} - {val['fully_dried']}")
        not_list.append(f"{species} - {val['not_dried']}")

    fish_species_text = "\n".join(species_list) if species_list else "--"
    fish_counts_text = "\n".join(count_list) if count_list else "--"
    fully_dried_text = "\n".join(fully_list) if fully_list else "--"
    not_dried_text = "\n".join(not_list) if not_list else "--"

    # ===== DERIVED (NO RANDOM) =====
    if total_dried > total_not:
        appearance = "Dry"
        color_text = "Brown"
        texture = "Hard"
    else:
        appearance = "Wet"
        color_text = "Silver"
        texture = "Soft"

    # ===== ENCODE IMAGE =====
    _, buffer = cv2.imencode(".jpg", image)
    encoded = base64.b64encode(buffer).decode()

    return {
        "annotated_image": encoded,
        "fish_species": fish_species_text,
        "fish_counts": fish_counts_text,
        "fully_dried": fully_dried_text,
        "partially_dried": "--",
        "not_dried": not_dried_text,
        "appearance": appearance,
        "color_text": color_text,
        "texture_text": texture,
        "total_fish": total_fish,
        "predicted_additional_minutes": predicted_minutes
    }