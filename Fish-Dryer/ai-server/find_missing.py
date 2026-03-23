import os

images_dir = "datasets/images"
annotations_dir = "datasets/annotations"

images = [f for f in os.listdir(images_dir) if f.endswith(".jpg")]
annotations = [f.replace(".xml", ".jpg") for f in os.listdir(annotations_dir)]

missing = []

for img in images:
    if img not in annotations:
        missing.append(img)

print(f"Total images: {len(images)}")
print(f"Total annotations: {len(annotations)}")
print(f"Missing annotations: {len(missing)}\n")


for m in missing:
    print(m)