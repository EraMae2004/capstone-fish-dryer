import os
import cv2

images_folder = "datasets/images"
annotations_folder = "datasets/annotations"

os.makedirs(annotations_folder, exist_ok=True)

for filename in os.listdir(images_folder):

    if not filename.lower().endswith(".jpg"):
        continue

    image_path = os.path.join(images_folder, filename)
    img = cv2.imread(image_path)

    if img is None:
        continue

    height, width = img.shape[:2]

    # =========================
    # 🔥 LABEL FROM FILENAME
    # =========================
    name = filename.lower().replace(".jpg","")

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
        print(f"[WARNING] Unknown species: {filename}")
        continue

    if "not_dried" in name:
        dryness = "not_dried"
    else:
        dryness = "dried"

    label = f"{species}_{dryness}"

    # =========================
    # 🔥 MANUAL SPLIT (FIXED)
    # =========================
    num_fish = 4  # <-- CHANGE if needed

    section_height = height // num_fish

    objects_xml = ""

    for i in range(num_fish):

        ymin = i * section_height
        ymax = (i + 1) * section_height

        xmin = int(width * 0.2)
        xmax = int(width * 0.8)

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

    # =========================
    # SAVE XML
    # =========================
    xml_content = f"""<annotation>
<filename>{filename}</filename>

<size>
<width>{width}</width>
<height>{height}</height>
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