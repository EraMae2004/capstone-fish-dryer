import os
import cv2
import numpy as np
import random

input_folder = "datasets/rename_images"
output_folder = "datasets/augmented-images"


os.makedirs(output_folder, exist_ok=True)


for filename in os.listdir(input_folder):

    if not filename.lower().endswith(".jpg"):
        continue

    path = os.path.join(input_folder, filename)
    img = cv2.imread(path)

    if img is None:
        continue

    name = filename.replace(".jpg", "")

    # =========================
    # 🔁 ROTATIONS
    # =========================
    cv2.imwrite(os.path.join(output_folder, f"{name}_rot90.jpg"),
                cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE))

    cv2.imwrite(os.path.join(output_folder, f"{name}_rot180.jpg"),
                cv2.rotate(img, cv2.ROTATE_180))

    cv2.imwrite(os.path.join(output_folder, f"{name}_rot270.jpg"),
                cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE))

    # =========================
    # ☀️ LIGHTING
    # =========================
    bright = cv2.convertScaleAbs(img, alpha=1.4, beta=40)
    cv2.imwrite(os.path.join(output_folder, f"{name}_bright.jpg"), bright)

    dark = cv2.convertScaleAbs(img, alpha=0.6, beta=-40)
    cv2.imwrite(os.path.join(output_folder, f"{name}_dark.jpg"), dark)

    high_contrast = cv2.convertScaleAbs(img, alpha=1.8, beta=0)
    cv2.imwrite(os.path.join(output_folder, f"{name}_contrast.jpg"), high_contrast)

    low_contrast = cv2.convertScaleAbs(img, alpha=0.7, beta=10)
    cv2.imwrite(os.path.join(output_folder, f"{name}_lowcontrast.jpg"), low_contrast)

    # =========================
    # 📏 DISTANCE (FAR)
    # =========================
    small = cv2.resize(img, None, fx=0.5, fy=0.5)

    canvas = 255 * np.ones_like(img)
    h, w = small.shape[:2]
    canvas[0:h, 0:w] = small

    cv2.imwrite(os.path.join(output_folder, f"{name}_far.jpg"), canvas)

    # =========================
    # 🔍 DISTANCE (NEAR)
    # =========================
    h, w = img.shape[:2]
    crop = img[int(h*0.2):int(h*0.8), int(w*0.2):int(w*0.8)]
    zoom = cv2.resize(crop, (w, h))

    cv2.imwrite(os.path.join(output_folder, f"{name}_near.jpg"), zoom)

    # =========================
    # 🌫 STRONG BLUR
    # =========================
    strong_blur = cv2.GaussianBlur(img, (21, 21), 0)
    cv2.imwrite(os.path.join(output_folder, f"{name}_blur.jpg"), strong_blur)

    # Motion blur
    kernel = np.zeros((15, 15))
    kernel[7, :] = 1
    kernel = kernel / 15
    motion_blur = cv2.filter2D(img, -1, kernel)

    cv2.imwrite(os.path.join(output_folder, f"{name}_motionblur.jpg"), motion_blur)

    # =========================
    # 🎲 NOISE
    # =========================
    noise = np.random.normal(0, 45, img.shape).astype(np.int16)
    noisy = img.astype(np.int16) + noise
    noisy = np.clip(noisy, 5, 255).astype(np.uint8)

    cv2.imwrite(os.path.join(output_folder, f"{name}_noise.jpg"), noisy)


print("ALL AUGMENTATIONS DONE ✅")