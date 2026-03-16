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

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    blur = cv2.GaussianBlur(gray,(7,7),0)

    # segment fish from background
    _, thresh = cv2.threshold(blur,0,255,cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # invert if needed
    white_ratio = thresh.sum()/(255*thresh.size)
    if white_ratio > 0.5:
        thresh = cv2.bitwise_not(thresh)

    # merge fish shapes
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15))
    thresh = cv2.morphologyEx(thresh,cv2.MORPH_CLOSE,kernel,iterations=2)

    contours,_ = cv2.findContours(thresh,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)

    name = filename.replace(".jpg","")
    parts = name.split("_")

    fish = parts[0] + "_" + parts[1]
    dryness = "_".join(parts[2:-1])

    label = f"{fish}_{dryness}"

    objects_xml=""

    for c in contours:

        area = cv2.contourArea(c)

        # ignore tiny noise
        if area < 3000:
            continue

        x,y,w,h = cv2.boundingRect(c)

        xmin=max(0,x)
        ymin=max(0,y)
        xmax=min(width,x+w)
        ymax=min(height,y+h)

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

    if objects_xml.strip()=="":
        continue

    xml_content=f"""
<annotation>
<filename>{filename}</filename>

<size>
<width>{width}</width>
<height>{height}</height>
<depth>3</depth>
</size>

{objects_xml}

</annotation>
"""

    xml_path=os.path.join(
        annotations_folder,
        filename.replace(".jpg",".xml")
    )

    with open(xml_path,"w") as f:
        f.write(xml_content)

print("Annotations created")