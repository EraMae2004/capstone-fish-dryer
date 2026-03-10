import torch
import torchvision
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.datasets import VOCDetection
from torchvision.transforms import functional as F
from torch.utils.data import DataLoader
import os

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Load pretrained FasterRCNN
model = torchvision.models.detection.fasterrcnn_resnet50_fpn(pretrained=True)

num_classes = 2  # fish + background
in_features = model.roi_heads.box_predictor.cls_score.in_features
model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)

model.to(device)

optimizer = torch.optim.Adam(model.parameters(), lr=0.0001)

for epoch in range(10):

    images = torch.randn(1,3,224,224).to(device)

    targets=[{
        "boxes": torch.tensor([[50,50,150,150]],dtype=torch.float32).to(device),
        "labels": torch.tensor([1]).to(device)
    }]

    loss_dict = model([images[0]],targets)

    losses = sum(loss for loss in loss_dict.values())

    optimizer.zero_grad()
    losses.backward()
    optimizer.step()

    print("epoch",epoch,"loss",losses.item())

torch.save(model,"models/fasterrcnn_fish.pth")