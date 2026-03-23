import torch
import torchvision
import cv2
import xml.etree.ElementTree as ET
import numpy as np
import os

from torch.utils.data import Dataset, DataLoader
from torchvision.transforms import functional as F
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay
import matplotlib.pyplot as plt

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASSES = [
"background",

"sap_sap_dried","sap_sap_partially_dried","sap_sap_not_dried","sap_sap_bad",
"barol_dried","barol_partially_dried","barol_not_dried","barol_bad",
"galunggong_dried","galunggong_partially_dried","galunggong_not_dried","galunggong_bad",
"burot_dried","burot_partially_dried","burot_not_dried","burot_bad",
"tamban_dried","tamban_partially_dried","tamban_not_dried","tamban_bad"
]

# ================= DATASET =================
class FishDataset(Dataset):
    def __init__(self, img_dir, ann_dir):
        self.img_dir = img_dir
        self.ann_dir = ann_dir
        self.images = sorted([f for f in os.listdir(img_dir) if f.endswith(".jpg")])

    def __len__(self):
        return len(self.images)

    def __getitem__(self, idx):

        img_name = self.images[idx]

        img_path = os.path.join(self.img_dir, img_name)
        ann_path = os.path.join(self.ann_dir, img_name.replace(".jpg",".xml"))

        image = cv2.imread(img_path)
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        tree = ET.parse(ann_path)
        root = tree.getroot()

        boxes = []
        labels = []

        for obj in root.findall("object"):
            label = obj.find("name").text.strip()
            if label not in CLASSES:
                continue

            bbox = obj.find("bndbox")

            xmin = int(bbox.find("xmin").text)
            ymin = int(bbox.find("ymin").text)
            xmax = int(bbox.find("xmax").text)
            ymax = int(bbox.find("ymax").text)

            boxes.append([xmin, ymin, xmax, ymax])
            labels.append(CLASSES.index(label))

        boxes = torch.as_tensor(boxes, dtype=torch.float32)
        labels = torch.as_tensor(labels, dtype=torch.int64)

        target = {"boxes": boxes, "labels": labels}

        return F.to_tensor(image), target


def collate_fn(batch):
    return tuple(zip(*batch))


# ================= LOAD MODEL =================
model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights=None)

in_features = model.roi_heads.box_predictor.cls_score.in_features
model.roi_heads.box_predictor = FastRCNNPredictor(in_features, len(CLASSES))

model.load_state_dict(torch.load("fish_model.pth", map_location=DEVICE))
model.to(DEVICE)
model.eval()


# ================= IOU =================
def compute_iou(box1, box2):
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter = max(0, x2-x1) * max(0, y2-y1)
    area1 = (box1[2]-box1[0]) * (box1[3]-box1[1])
    area2 = (box2[2]-box2[0]) * (box2[3]-box2[1])

    union = area1 + area2 - inter
    return inter/union if union > 0 else 0


# ================= DATA =================
dataset = FishDataset("datasets/images", "datasets/annotations")

loader = DataLoader(dataset, batch_size=1, shuffle=False, collate_fn=collate_fn)

y_true = []
y_pred = []


# ================= EVALUATION =================
with torch.no_grad():
    for images, targets in loader:

        images = [img.to(DEVICE) for img in images]
        outputs = model(images)

        for i in range(len(images)):

            gt_boxes = targets[i]["boxes"].numpy()
            gt_labels = targets[i]["labels"].numpy()

            pred_boxes = outputs[i]["boxes"].cpu().numpy()
            pred_labels = outputs[i]["labels"].cpu().numpy()
            pred_scores = outputs[i]["scores"].cpu().numpy()

            for gt_box, gt_label in zip(gt_boxes, gt_labels):

                best_iou = 0
                best_label = 0

                for pb, pl, ps in zip(pred_boxes, pred_labels, pred_scores):

                    if ps < 0.4:
                        continue

                    iou = compute_iou(gt_box, pb)

                    if iou > best_iou:
                        best_iou = iou
                        best_label = pl

                y_true.append(gt_label)
                y_pred.append(best_label)


# ================= CONFUSION MATRIX =================
cm = confusion_matrix(y_true, y_pred)

plt.figure(figsize=(12,10))
disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=CLASSES)
disp.plot(xticks_rotation=90)
plt.title("Confusion Matrix")
plt.show()