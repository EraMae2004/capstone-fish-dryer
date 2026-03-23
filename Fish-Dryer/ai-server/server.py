import torch
import cv2
import base64
import numpy as np
import torchvision
import joblib
import random

from fastapi import FastAPI
from pydantic import BaseModel
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms import functional as F

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASSES = [
"background",
"sap_sap_dried","sap_sap_partially_dried","sap_sap_not_dried",
"barol_dried","barol_partially_dried","barol_not_dried",
"galunggong_dried","galunggong_partially_dried","galunggong_not_dried",
"burot_dried","burot_partially_dried","burot_not_dried",
"tamban_dried","tamban_partially_dried","tamban_not_dried"
]

DRYNESS_COLOR = {
    "dried": (0,255,0),
    "partially_dried": (0,255,255),
    "not_dried": (0,0,255),
    "bad": (128,128,128)
}

RULES = {
    "dried": {
        "color": ["Golden Brown","Brown","Dark Brown","Yellow Brown","Silvery-grey","Silvery-white"],
        "appearance": ["Flattened","Wrinkled","Hard","Dry","Curled","Shrunk"],
        "texture": ["Wrinkled","Hard","Dry"]
    },
    "not_dried": {
        "color": ["Silver","Pink","Light Pink","Reddish","Pale Pink","Metallic Silver"],
        "appearance": ["Glossy","Wet","Fresh-looking"],
        "texture": ["Slippery","Soft","Smooth"]
    },
    "partially_dried": {
        "color": ["Pale Yellow","Yellowish","Light Brown","Faded Pink","Light Golden","Dull White","Slightly Brown"],
        "appearance": ["Meaty but matte","Slightly wrinkled","Slightly shrunk","Pale","Flattening"],
        "texture": ["Slightly wrinkled","Semi-dry","Partly moist"]
    }
}

model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights=None)
in_features = model.roi_heads.box_predictor.cls_score.in_features
model.roi_heads.box_predictor = FastRCNNPredictor(in_features,len(CLASSES))

model.load_state_dict(torch.load("fish_model.pth",map_location=DEVICE))
model.to(DEVICE)
model.eval()

rf_model = joblib.load("drying_model.pkl")

app = FastAPI()

class ImageRequest(BaseModel):
    image:str
    drying_time_minutes:int


@app.post("/api/ai/analyze")
async def analyze(data:ImageRequest):

    img_data=data.image.split(",")[1]
    img_bytes=base64.b64decode(img_data)

    np_arr=np.frombuffer(img_bytes,np.uint8)
    image=cv2.imdecode(np_arr,cv2.IMREAD_COLOR)

    if image is None:
        return {"error":"Invalid image"}

    image_rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB)
    tensor=F.to_tensor(image_rgb).to(DEVICE)

    with torch.no_grad():
        prediction=model([tensor])[0]

    fish_details={}

    total_dried=0
    total_partial=0
    total_not=0

    for box,label,score in zip(
        prediction["boxes"],
        prediction["labels"],
        prediction["scores"]
    ):

        if score < 0.5:
            continue

        x1,y1,x2,y2 = map(int,box)

        cls=CLASSES[int(label)]

        if cls.startswith("sap_sap_"):
            species="sap_sap"
            state=cls.replace("sap_sap_","")
        else:
            parts=cls.split("_")
            species=parts[0]
            state="_".join(parts[1:])

        species_name=species.replace("_"," ").title()

        if species_name not in fish_details:
            fish_details[species_name]={
                "count":0,
                "dried":0,
                "partial":0,
                "not":0,
                "color_list":[],
                "appearance_list":[],
                "texture_list":[]
            }

        fish_details[species_name]["count"]+=1

        if state=="dried":
            total_dried+=1
            fish_details[species_name]["dried"]+=1
        elif state=="partially_dried":
            total_partial+=1
            fish_details[species_name]["partial"]+=1
        elif state=="not_dried":
            total_not+=1
            fish_details[species_name]["not"]+=1

        rule = RULES.get(state, {})

        fish_details[species_name]["color_list"].append(random.choice(rule.get("color",["Unknown"])))
        fish_details[species_name]["appearance_list"].append(random.choice(rule.get("appearance",["Unknown"])))
        fish_details[species_name]["texture_list"].append(random.choice(rule.get("texture",["Unknown"])))

        # ===== FIXED DRAWING =====
        box_color = DRYNESS_COLOR.get(state,(255,255,255))

        cv2.rectangle(image,(x1,y1),(x2,y2),box_color,4)

        label_text = species_name
        font_scale = 1.0
        thickness = 2

        (tw,th),_=cv2.getTextSize(label_text,cv2.FONT_HERSHEY_SIMPLEX,font_scale,thickness)

        y_text = max(y1, th + 10)

        cv2.rectangle(image,(x1,y_text-th-10),(x1+tw+10,y_text),box_color,-1)

        cv2.putText(image,label_text,(x1+5,y_text-5),
                    cv2.FONT_HERSHEY_SIMPLEX,font_scale,(255,255,255),thickness,cv2.LINE_AA)

    for species in fish_details:

        def majority(lst):
            return max(set(lst), key=lst.count) if lst else "Unknown"

        fish_details[species]["color"] = majority(fish_details[species].pop("color_list"))
        fish_details[species]["appearance"] = majority(fish_details[species].pop("appearance_list"))
        fish_details[species]["texture"] = majority(fish_details[species].pop("texture_list"))

    total_fish = total_dried + total_partial + total_not

    features_rf=[[total_fish,data.drying_time_minutes,total_dried,total_partial,total_not]]
    predicted_minutes=float(rf_model.predict(features_rf)[0])

    _,buffer=cv2.imencode(".jpg",image)
    encoded=base64.b64encode(buffer).decode()

    # ===== UI STRUCTURE FIX =====
    status = {
        "species": list(fish_details.keys()),
        "count": {},
        "fully_dried": {},
        "partially_dried": {},
        "not_dried": {},
        "texture": {},
        "appearance": {},
        "color": {}
    }

    for s,data_s in fish_details.items():
        status["count"][s]=data_s["count"]
        status["fully_dried"][s]=data_s["dried"]
        status["partially_dried"][s]=data_s["partial"]
        status["not_dried"][s]=data_s["not"]
        status["texture"][s]=data_s["texture"]
        status["appearance"][s]=data_s["appearance"]
        status["color"][s]=data_s["color"]

    return{
        "annotated_image":encoded,
        "status":status,
        "total_fish":total_fish,
        "duration":data.drying_time_minutes,
        "predicted_additional_minutes":predicted_minutes
    }