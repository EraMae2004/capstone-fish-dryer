import cv2
import torch
import numpy as np
import base64
from flask import Flask, request, jsonify
from torchvision import models, transforms
from PIL import Image

app = Flask(__name__)

# ----------------------------
# LOAD MODEL
# ----------------------------
model = models.detection.fasterrcnn_resnet50_fpn(weights="DEFAULT")
model.eval()

transform = transforms.Compose([
    transforms.ToTensor()
])

@app.route('/detect', methods=['POST'])
def detect():

    file = request.files['image']
    image = Image.open(file.stream).convert("RGB")
    image_np = np.array(image)

    img_tensor = transform(image)

    with torch.no_grad():
        outputs = model([img_tensor])[0]

    boxes = outputs['boxes'].cpu().numpy()
    scores = outputs['scores'].cpu().numpy()

    fully_count = 0
    partial_count = 0
    not_count = 0

    for box, score in zip(boxes, scores):

        if score < 0.6:
            continue

        x1, y1, x2, y2 = map(int, box)

        # RANDOM COLOR SIMULATION (until model trained)
        # 0 = fully, 1 = partial, 2 = not dried
        simulated_class = np.random.randint(0, 3)

        if simulated_class == 0:
            color = (0, 255, 0)
            label = "fully_dried"
            fully_count += 1
        elif simulated_class == 1:
            color = (0, 255, 255)
            label = "partially_dried"
            partial_count += 1
        else:
            color = (0, 0, 255)
            label = "not_dried"
            not_count += 1

        cv2.rectangle(image_np, (x1,y1), (x2,y2), color, 3)
        cv2.putText(image_np, label, (x1,y1-10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, color, 2)

    # ----------------------------
    # RECOMMENDATION LOGIC
    # ----------------------------
    extend_minutes = not_count * 10 + partial_count * 5

    suggested_temp = 50 if not_count > 0 else 47
    suggested_fan = 3 if not_count > 0 else 2

    # Encode image
    _, buffer = cv2.imencode('.jpg', image_np)
    img_base64 = base64.b64encode(buffer).decode('utf-8')

    return jsonify({
        "fully_dried": fully_count,
        "partially_dried": partial_count,
        "not_dried": not_count,
        "extend_minutes": extend_minutes,
        "suggested_temperature": suggested_temp,
        "suggested_fan_speed": suggested_fan,
        "image": img_base64
    })

if __name__ == '__main__':
    app.run(port=5001, debug=True)