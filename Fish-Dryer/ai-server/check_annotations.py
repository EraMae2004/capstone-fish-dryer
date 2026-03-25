import os
import xml.etree.ElementTree as ET

folder = "datasets/train"  # 🔁 change if needed

nan_files = []
total_objects = 0
nan_count = 0

for file in os.listdir(folder):
    if file.endswith(".xml"):
        path = os.path.join(folder, file)

        tree = ET.parse(path)
        root = tree.getroot()

        for obj in root.findall("object"):
            bbox = obj.find("bndbox")

            xmin = bbox.find("xmin").text
            ymin = bbox.find("ymin").text
            xmax = bbox.find("xmax").text
            ymax = bbox.find("ymax").text

            total_objects += 1

            values = [xmin, ymin, xmax, ymax]

            # Check for NaN or invalid values
            if any(v is None or v.lower() == "nan" for v in values):
                nan_files.append(file)
                nan_count += 1

# RESULTS
print("Total objects:", total_objects)
print("NaN boxes found:", nan_count)

if nan_files:
    print("\nFiles with NaN:")
    for f in set(nan_files):
        print(f)
else:
    print("\nNo NaN found ✅")