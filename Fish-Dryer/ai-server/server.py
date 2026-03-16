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

"sap_sap_dried","sap_sap_partially_dried","sap_sap_not_dried","sap_sap_bad",
"barol_dried","barol_partially_dried","barol_not_dried","barol_bad",
"galunggong_dried","galunggong_partially_dried","galunggong_not_dried","galunggong_bad",
"burot_dried","burot_partially_dried","burot_not_dried","burot_bad",
"tamban_dried","tamban_partially_dried","tamban_not_dried","tamban_bad"
]

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


DRIED_COLORS=["Golden Brown","Brown","Dark Brown","Yellow Brown","Silvery-grey","Silvery-white"]
NOT_COLORS=["Silver","Pink","Light Pink","Reddish","Pale Pink","Metallic Silver"]
PARTIAL_COLORS=["Pale Yellow","Yellowish","Light Brown","Faded Pink","Light Golden","Dull White","Slightly Brown"]

DRIED_APPEARANCE=["Flattened","Wrinkled","Hard","Dry","Curled","Shrunk"]
PARTIAL_APPEARANCE=["Meaty but matte","Slightly wrinkled","Slightly shrunk","Pale","Flattening"]
NOT_APPEARANCE=["Glossy","Wet","Fresh-looking"]

DRIED_TEXTURE=["Wrinkled","Hard","Dry"]
PARTIAL_TEXTURE=["Slightly wrinkled","Semi-dry","Partly moist"]
NOT_TEXTURE=["Slippery","Soft","Smooth"]


def generate_surface(total_dried,total_partial,total_not):

    colors=[]
    appearance=[]
    texture=[]

    if total_dried>0:
        colors.append(random.choice(DRIED_COLORS))
        appearance.append(random.choice(DRIED_APPEARANCE))
        texture.append(random.choice(DRIED_TEXTURE))

    if total_partial>0:
        colors.append(random.choice(PARTIAL_COLORS))
        appearance.append(random.choice(PARTIAL_APPEARANCE))
        texture.append(random.choice(PARTIAL_TEXTURE))

    if total_not>0:
        colors.append(random.choice(NOT_COLORS))
        appearance.append(random.choice(NOT_APPEARANCE))
        texture.append(random.choice(NOT_TEXTURE))

    return ", ".join(appearance), ", ".join(colors), ", ".join(texture)


def generate_recommendation(minutes,not_dried,partial):

    minutes=max(0,round(minutes,2))

    if not_dried>0:

        options=[
        f"Several fish remain wet. Continue drying for about {minutes} minutes.",
        f"The batch still contains undried fish. Extend drying approximately {minutes} minutes.",
        f"Moisture is still present. Additional drying time of about {minutes} minutes is advised."
        ]

    elif partial>0:

        options=[
        f"Some fish are partially dried. Continue drying around {minutes} minutes.",
        f"The fish are close to fully dried. Extend drying about {minutes} minutes.",
        f"Remaining moisture detected. Drying for another {minutes} minutes should complete the process."
        ]

    else:

        options=[
        "All fish appear fully dried.",
        "Drying process completed successfully.",
        "The batch has reached the required dryness."
        ]

        minutes=0

    return random.choice(options),minutes


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

    species_counts={}
    dried_counts={}
    partial_counts={}
    not_counts={}

    total_dried=0
    total_partial=0
    total_not=0

    for box,label,score in zip(
        prediction["boxes"],
        prediction["labels"],
        prediction["scores"]
    ):

        if score<0.2:
            continue

        x1,y1,x2,y2=map(int,box)

        cls=CLASSES[int(label)]
        parts=cls.split("_")

        species="_".join(parts[:2])
        state="_".join(parts[2:])

        species_name=species.replace("_"," ").title()

        species_counts[species_name]=species_counts.get(species_name,0)+1

        if state=="dried":

            color=(0,255,0)

            total_dried+=1
            dried_counts[species_name]=dried_counts.get(species_name,0)+1

        elif state=="partially_dried":

            color=(0,255,255)

            total_partial+=1
            partial_counts[species_name]=partial_counts.get(species_name,0)+1

        elif state=="not_dried":

            color=(0,0,255)

            total_not+=1
            not_counts[species_name]=not_counts.get(species_name,0)+1

        else:

            color=(255,0,0)

        cv2.rectangle(image,(x1,y1),(x2,y2),color,2)

        cv2.putText(
            image,
            species_name,
            (x1,y1-10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2
        )

    total_fish=total_dried+total_partial+total_not

    species_list=list(species_counts.keys())
    fish_species_text=", ".join(species_list)

    fish_counts_text=" ".join([f"{k} - {v}" for k,v in species_counts.items()])

    features=[[total_fish,data.drying_time_minutes,total_dried,total_partial,total_not]]

    predicted_minutes=float(rf_model.predict(features)[0])

    appearance,color_text,texture_text=generate_surface(
        total_dried,total_partial,total_not
    )

    rec_text,extra_minutes=generate_recommendation(
        predicted_minutes,total_not,total_partial
    )

    _,buffer=cv2.imencode(".jpg",image)
    encoded=base64.b64encode(buffer).decode()

    return{

    "annotated_image":encoded,

    "fish_species":fish_species_text,
    "fish_counts":fish_counts_text,

    "species_counts":species_counts,

    "dried_counts":dried_counts,
    "partial_counts":partial_counts,
    "not_counts":not_counts,

    "total_fish":total_fish,

    "appearance":appearance,
    "color_text":color_text,
    "texture_text":texture_text,

    "fully_dried":total_dried,
    "partially_dried":total_partial,
    "not_dried":total_not,

    "duration":data.drying_time_minutes,

    "recommendation":{
    "description":rec_text,
    "additional_minutes":extra_minutes
    }

    }