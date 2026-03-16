import os
import torch
import torchvision
import xml.etree.ElementTree as ET
from torchvision.transforms import functional as F
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
import cv2

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASSES = [
"background",
"sap_sap_dried","sap_sap_partially_dried","sap_sap_not_dried",
"barol_dried","barol_partially_dried","barol_not_dried",
"galunggong_dried","galunggong_partially_dried","galunggong_not_dried",
"burot_dried","burot_partially_dried","burot_not_dried",
"tamban_dried","tamban_partially_dried","tamban_not_dried"
]

IMAGE_DIR = "datasets/images"
ANNOT_DIR = "datasets/annotations"

# Load model
model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights=None)

num_classes = len(CLASSES)

in_features = model.roi_heads.box_predictor.cls_score.in_features
model.roi_heads.box_predictor = FastRCNNPredictor(in_features,num_classes)

model.load_state_dict(torch.load("fish_model.pth", map_location=DEVICE))

model.to(DEVICE)
model.eval()

TP = 0
FP = 0
FN = 0

for filename in os.listdir(IMAGE_DIR):

    if not filename.endswith(".jpg"):
        continue

    img_path = os.path.join(IMAGE_DIR, filename)
    ann_path = os.path.join(ANNOT_DIR, filename.replace(".jpg",".xml"))

    # Load image
    img = cv2.imread(img_path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img_tensor = F.to_tensor(img).to(DEVICE)

    # Prediction
    with torch.no_grad():
        pred = model([img_tensor])[0]

    pred_labels = pred["labels"].cpu().numpy()

    # Ground truth
    tree = ET.parse(ann_path)
    root = tree.getroot()

    true_labels = []

    for obj in root.findall("object"):
        label = obj.find("name").text
        true_labels.append(CLASSES.index(label))

    # Compare predictions
    for label in pred_labels:
        if label in true_labels:
            TP += 1
        else:
            FP += 1

    for label in true_labels:
        if label not in pred_labels:
            FN += 1


# Metrics
precision = TP / (TP + FP) if (TP + FP) > 0 else 0
recall = TP / (TP + FN) if (TP + FN) > 0 else 0

if precision + recall == 0:
    f1 = 0
else:
    f1 = 2 * (precision * recall) / (precision + recall)

accuracy = TP / (TP + FP + FN) if (TP + FP + FN) > 0 else 0


print("\nEvaluation Results")
print("---------------------------")
print("Precision:", round(precision,3))
print("Recall:", round(recall,3))
print("F1 Score:", round(f1,3))
print("Accuracy:", round(accuracy,3))