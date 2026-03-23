import os
import cv2
import xml.etree.ElementTree as ET

images_folder = "datasets/images"
annotations_folder = "datasets/annotations"

for filename in os.listdir(images_folder):

    if not filename.endswith(".jpg"):
        continue

    img_path = os.path.join(images_folder, filename)
    xml_path = os.path.join(annotations_folder, filename.replace(".jpg",".xml"))

    if not os.path.exists(xml_path):
        continue

    img = cv2.imread(img_path)

    if img is None:
        continue

    tree = ET.parse(xml_path)
    root = tree.getroot()

    for obj in root.findall("object"):

        label = obj.find("name").text

        bbox = obj.find("bndbox")

        xmin = int(bbox.find("xmin").text)
        ymin = int(bbox.find("ymin").text)
        xmax = int(bbox.find("xmax").text)
        ymax = int(bbox.find("ymax").text)

        # draw box
        cv2.rectangle(img,(xmin,ymin),(xmax,ymax),(0,255,0),2)

        # draw label
        cv2.putText(
            img,
            label,
            (xmin,ymin-10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0,255,0),
            2
        )

    cv2.imshow("Check", img)

    key = cv2.waitKey(0)

    if key == 27:  # press ESC to exit
        break

cv2.destroyAllWindows()