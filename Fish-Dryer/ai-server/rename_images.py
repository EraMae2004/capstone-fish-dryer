import os

prefix = "wrinkle_texture"   # change this when needed
folder = "datasets/rename-images"

files = sorted(os.listdir(folder))

counter = 1

for file in files:

    if not file.lower().endswith((".jpg", ".jpeg", ".png")):
        continue

    old_path = os.path.join(folder, file)

    new_name = f"{prefix}_{counter:02}.jpg"
    new_path = os.path.join(folder, new_name)

    os.rename(old_path, new_path)

    counter += 1

print("Renaming complete")