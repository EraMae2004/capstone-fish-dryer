import os
import cv2
import numpy as np

images_folder = "datasets/images"
annotations_folder = "datasets/annotations"

os.makedirs(annotations_folder, exist_ok=True)

for filename in os.listdir(images_folder):

    if not filename.lower().endswith(".jpg"):
        continue

    path = os.path.join(images_folder, filename)
    img = cv2.imread(path)

    if img is None:
        continue

    h, w = img.shape[:2]

    # =========================
    # LABEL FROM NAME
    # =========================
    name = filename.lower().replace(".jpg", "")

    if "sap_sap" in name:
        species = "sap_sap"
    elif "barol" in name:
        species = "barol"
    elif "galunggong" in name:
        species = "galunggong"
    elif "burot" in name:
        species = "burot"
    elif "tamban" in name:
        species = "tamban"
    else:
        continue

    dryness = "not_dried" if "not_dried" in name else "dried"
    label = f"{species}_{dryness}"

    # =========================
    # 🔥 STEP 1: EDGE DETECTION
    # =========================
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)

    # =========================
    # 🔥 STEP 2: HORIZONTAL PROJECTION (FIND ROWS)
    # =========================
    projection = np.sum(edges, axis=1)

    rows = []
    in_row = False
    start = 0

    for i, val in enumerate(projection):
        if val > 1000 and not in_row:
            in_row = True
            start = i
        elif val <= 1000 and in_row:
            in_row = False
            rows.append((start, i))

    # =========================
    # 🔥 STEP 3: SPLIT EACH ROW INTO FISH
    # =========================
    objects_xml = ""
    count = 0

    for (y1, y2) in rows:

        row_img = edges[y1:y2, :]

        vertical_proj = np.sum(row_img, axis=0)

        in_obj = False
        x_start = 0

        for x, val in enumerate(vertical_proj):
            if val > 500 and not in_obj:
                in_obj = True
                x_start = x
            elif val <= 500 and in_obj:
                in_obj = False

                xmin = x_start
                xmax = x
                ymin = y1
                ymax = y2

                # FILTER SMALL BOXES
                if (xmax - xmin) < 50 or (ymax - ymin) < 50:
                    continue

                objects_xml += f"""
        <object>
            <name>{label}</name>
            <bndbox>
                <xmin>{xmin}</xmin>
                <ymin>{ymin}</ymin>
                <xmax>{xmax}</xmax>
                <ymax>{ymax}</ymax>
            </bndbox>
        </object>
                """

                count += 1

    print(f"{filename} → detected fish: {count}")

    # =========================
    # SAVE XML
    # =========================
    xml_content = f"""<annotation>
<filename>{filename}</filename>

<size>
<width>{w}</width>
<height>{h}</height>
<depth>3</depth>
</size>

{objects_xml}

</annotation>
"""

    xml_path = os.path.join(
        annotations_folder,
        filename.replace(".jpg", ".xml")
    )

    with open(xml_path, "w") as f:
        f.write(xml_content)

print("DONE")