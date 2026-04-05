import os
import torch
import torchvision
import xml.etree.ElementTree as ET
import cv2

from torch.utils.data import Dataset, DataLoader, random_split
from torchvision.transforms import functional as F
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

# DEVICE
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ⚠️ ADJUST THIS BASED ON YOUR DATASET
# Must match server.py / evaluate_model.py or label indices will not align with fish_model.pth
CLASSES = [
    "background",
    "sap_sap_dried", "sap_sap_partially_dried", "sap_sap_not_dried",
    "barol_dried", "barol_partially_dried", "barol_not_dried",
    "galunggong_dried", "galunggong_partially_dried", "galunggong_not_dried",
    "burot_dried", "burot_partially_dried", "burot_not_dried",
    "tamban_dried", "tamban_partially_dried", "tamban_not_dried",
]

# ================= DATASET =================
class FishDataset(Dataset):

    def __init__(self, root):
        self.root = root
        self.images = sorted([f for f in os.listdir(root) if f.endswith(".jpg")])

    def __len__(self):
        return len(self.images)

    def __getitem__(self, idx):

        img_name = self.images[idx]

        img_path = os.path.join(self.root, img_name)
        ann_path = img_path.replace(".jpg", ".xml")

        # Load image
        image = cv2.imread(img_path)

        if image is None:
            raise ValueError(f"Image not found: {img_path}")

        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        height, width = image.shape[:2]

        # Load annotation
        tree = ET.parse(ann_path)
        root = tree.getroot()

        boxes = []
        labels = []

        for obj in root.findall("object"):

            label = obj.find("name").text.strip()

            if label not in CLASSES:
                continue

            bbox = obj.find("bndbox")

            xmin = float(bbox.find("xmin").text)
            ymin = float(bbox.find("ymin").text)
            xmax = float(bbox.find("xmax").text)
            ymax = float(bbox.find("ymax").text)

            # Skip invalid boxes
            if xmax <= xmin or ymax <= ymin:
                continue

            if xmin < 0 or ymin < 0 or xmax > width or ymax > height:
                continue

            boxes.append([xmin, ymin, xmax, ymax])
            labels.append(CLASSES.index(label))

        # Skip images with no valid boxes
        if len(boxes) == 0:
            return self.__getitem__((idx + 1) % len(self.images))

        boxes = torch.as_tensor(boxes, dtype=torch.float32)
        labels = torch.as_tensor(labels, dtype=torch.int64)

        target = {
            "boxes": boxes,
            "labels": labels
        }

        image = F.to_tensor(image)

        return image, target


def collate_fn(batch):
    return tuple(zip(*batch))


# ================= MAIN =================
def main():

    # ⚠️ CHANGE THIS PATH IF NEEDED
    dataset = FishDataset("datasets/train")

    train_size = int(0.8 * len(dataset))
    test_size = len(dataset) - train_size

    train_dataset, test_dataset = random_split(dataset, [train_size, test_size])

    train_loader = DataLoader(
        train_dataset,
        batch_size=2,
        shuffle=True,
        collate_fn=collate_fn,
        num_workers=2
    )

    # MODEL
    model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights="DEFAULT")

    num_classes = len(CLASSES)

    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)

    model.to(DEVICE)

    # OPTIMIZER (safe learning rate)
    optimizer = torch.optim.SGD(
        model.parameters(),
        lr=0.001,
        momentum=0.9
    )

    epochs = 50

    for epoch in range(epochs):

        model.train()
        total_loss = 0

        for images, targets in train_loader:

            images = [img.to(DEVICE) for img in images]
            targets = [{k: v.to(DEVICE) for k, v in t.items()} for t in targets]

            loss_dict = model(images, targets)
            loss = sum(loss for loss in loss_dict.values())

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        print(f"Epoch {epoch+1} - Train Loss: {total_loss:.4f}")

    torch.save(model.state_dict(), "fish_model.pth")

    print("Training complete ✅")


if __name__ == "__main__":
    main()