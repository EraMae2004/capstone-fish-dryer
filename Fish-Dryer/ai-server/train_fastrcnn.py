import os
import torch
import torchvision
import xml.etree.ElementTree as ET
import cv2

from torch.utils.data import Dataset, DataLoader
from torchvision.transforms import functional as F
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASSES = [
"background",

"sap_sap_dried","sap_sap_partially_dried","sap_sap_not_dried","sap_sap_bad",
"barol_dried","barol_partially_dried","barol_not_dried","barol_bad",
"galunggong_dried","galunggong_partially_dried","galunggong_not_dried","galunggong_bad",
"burot_dried","burot_partially_dried","burot_not_dried","burot_bad",
"tamban_dried","tamban_partially_dried","tamban_not_dried","tamban_bad"
]


class FishDataset(Dataset):

    def __init__(self, img_dir, ann_dir):
        self.img_dir = img_dir
        self.ann_dir = ann_dir
        self.images = [f for f in os.listdir(img_dir) if f.endswith(".jpg")]

    def __len__(self):
        return len(self.images)

    def __getitem__(self, idx):

        img_name = self.images[idx]

        img_path = os.path.join(self.img_dir, img_name)
        ann_path = os.path.join(self.ann_dir, img_name.replace(".jpg",".xml"))

        image = cv2.imread(img_path)

        if image is None:
            return self.__getitem__((idx+1) % len(self.images))

        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        height, width = image.shape[:2]

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

            if xmax <= xmin or ymax <= ymin:
                continue

            if xmin < 0 or ymin < 0 or xmax > width or ymax > height:
                continue

            boxes.append([xmin, ymin, xmax, ymax])
            labels.append(CLASSES.index(label))

        if len(boxes) == 0:
            boxes = torch.zeros((0,4), dtype=torch.float32)
            labels = torch.zeros((0,), dtype=torch.int64)

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


def main():

    dataset = FishDataset("datasets/images","datasets/annotations")

    loader = DataLoader(
        dataset,
        batch_size=2,
        shuffle=True,
        collate_fn=collate_fn
    )

    model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights="DEFAULT")

    num_classes = len(CLASSES)

    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)

    model.to(DEVICE)

    optimizer = torch.optim.SGD(
        model.parameters(),
        lr=0.005,
        momentum=0.9
    )

    epochs = 10

    for epoch in range(epochs):

        model.train()
        total_loss = 0

        for images, targets in loader:

            images = list(img.to(DEVICE) for img in images)
            targets = [{k:v.to(DEVICE) for k,v in t.items()} for t in targets]

            loss_dict = model(images, targets)
            loss = sum(loss for loss in loss_dict.values())

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        print("Epoch", epoch, "Loss:", total_loss)

    torch.save(model.state_dict(), "fish_model.pth")

    print("Training complete")


if __name__ == "__main__":
    main()