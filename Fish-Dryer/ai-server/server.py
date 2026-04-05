# server.py

import json
import os
from collections import Counter

import torch
import cv2
import base64
import numpy as np
import torchvision
import joblib

from fastapi import FastAPI
from pydantic import BaseModel
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms import functional as F

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Fallback names only used if fish_classes.json is missing AND length matches the .pth head.
# Your Colab notebook order must match inference: copy the exact list into fish_classes.json.
DEFAULT_CLASSES = [
    "background",
    "sap_sap_dried", "sap_sap_partially_dried", "sap_sap_not_dried",
    "barol_dried", "barol_partially_dried", "barol_not_dried",
    "galunggong_dried", "galunggong_partially_dried", "galunggong_not_dried",
    "burot_dried", "burot_partially_dried", "burot_not_dried",
    "tamban_dried", "tamban_partially_dried", "tamban_not_dried",
]

CLASSES = []  # filled from checkpoint + fish_classes.json (see build_fish_detector)


def _infer_num_classes_from_state_dict(state_dict: dict) -> int:
    key = "roi_heads.box_predictor.cls_score.weight"
    if key in state_dict:
        return int(state_dict[key].shape[0])
    for k, v in state_dict.items():
        if k.endswith("roi_heads.box_predictor.cls_score.weight") or (
            "box_predictor" in k and k.endswith("cls_score.weight")
        ):
            return int(v.shape[0])
    raise RuntimeError("fish_model.pth: missing roi_heads.box_predictor.cls_score.weight")


def _load_class_names(num_classes: int) -> list[str]:
    path = os.environ.get("FISH_CLASSES_JSON", "fish_classes.json")
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        names = data.get("classes") or data.get("CLASSES")
        if not isinstance(names, list) or not names:
            raise RuntimeError(f"{path}: expected a non-empty 'classes' JSON array")
        if len(names) != num_classes:
            raise RuntimeError(
                f"{path} lists {len(names)} classes but fish_model.pth head has {num_classes}. "
                "Copy the exact CLASSES list from Colab (same order as training)."
            )
        return [str(x) for x in names]
    if len(DEFAULT_CLASSES) == num_classes:
        return list(DEFAULT_CLASSES)
    raise RuntimeError(
        f"fish_model.pth expects {num_classes} classes; built-in DEFAULT_CLASSES has {len(DEFAULT_CLASSES)}. "
        f"Create fish_classes.json in the ai-server folder with {{\"classes\": [...]}} — {num_classes} names in Colab order."
    )


def _load_detector_weights(path: str) -> dict:
    try:
        obj = torch.load(path, map_location=DEVICE, weights_only=False)
    except TypeError:
        obj = torch.load(path, map_location=DEVICE)
    if isinstance(obj, dict) and any(k.endswith("cls_score.weight") for k in obj):
        return obj
    if hasattr(obj, "state_dict"):
        return obj.state_dict()
    raise RuntimeError(
        "fish_model.pth must be a state_dict or a torch.nn.Module (as saved from Colab)."
    )


def _strip_dataparallel_prefix(state_dict: dict) -> dict:
    if not any(str(k).startswith("module.") for k in state_dict):
        return state_dict
    return {str(k).replace("module.", "", 1): v for k, v in state_dict.items()}


def build_fish_detector():
    global CLASSES
    weights_path = os.environ.get("FISH_MODEL_PATH", "fish_model.pth")
    state_dict = _strip_dataparallel_prefix(_load_detector_weights(weights_path))
    num_classes = _infer_num_classes_from_state_dict(state_dict)
    CLASSES = _load_class_names(num_classes)

    model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(weights=None)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    model.load_state_dict(state_dict, strict=True)
    model.to(DEVICE)
    model.eval()
    return model


model = build_fish_detector()

# High-confidence detections only (lower FISH_SCORE_THRESHOLD via env if you miss small fish).
DETECTION_SCORE_THRESHOLD = float(os.environ.get("FISH_SCORE_THRESHOLD", "0.72"))
# Extra merge of overlapping boxes (one fish, multiple proposals). Raise slightly if two touching fish merge.
DETECTION_NMS_IOU = float(os.environ.get("FISH_NMS_IOU", "0.45"))

# Attribute inference: detector boxes include tray/edges — shrink + optional GrabCut so
# color/texture/appearance see mostly fish (does not change train_attributes.py training).
ATTRIBUTE_CROP_INSET = float(os.environ.get("ATTRIBUTE_CROP_INSET", "0.22"))
_ATTRIBUTE_GC = os.environ.get("ATTRIBUTE_USE_GRABCUT", "1").strip().lower()
ATTRIBUTE_USE_GRABCUT = _ATTRIBUTE_GC in ("1", "true", "yes", "on")

# Attribute / regression models (sklearn) — loaded after the detector; limited to single-thread
# to avoid oversubscription with CUDA on Windows.
rf_model = joblib.load("drying_model.pkl")
color_model = joblib.load("color_model.pkl")
texture_model = joblib.load("texture_model.pkl")
appearance_model = joblib.load("appearance_model.pkl")

# Classifiers are trained with LabelEncoder (train_attributes.py); predict() returns class indices, not names.
color_encoder = joblib.load("color_encoder.pkl")
texture_encoder = joblib.load("texture_encoder.pkl")
appearance_encoder = joblib.load("appearance_encoder.pkl")

for _m in (color_model, texture_model, appearance_model, rf_model):
    if hasattr(_m, "set_params"):
        try:
            _m.set_params(n_jobs=1)
        except (ValueError, TypeError):
            pass

app = FastAPI()

class ImageRequest(BaseModel):
    image: str
    drying_time_minutes: int


def _parse_fish_class_label(cls_name: str):
    """
    Map checkpoint class string -> (species display, drying state).
    Tolerant of Colab / VOC naming so valid boxes are not dropped.
    """
    if not cls_name:
        return None
    n = cls_name.strip().lower().replace(" ", "_").replace("-", "_")
    while "__" in n:
        n = n.replace("__", "_")
    if n in ("background", "__background__", "bg"):
        return None

    state = None
    species_lower = None
    for suf, st in (
        ("_partially_dried", "partially_dried"),
        ("_partial_dried", "partially_dried"),
        ("_semi_dried", "partially_dried"),
        ("_not_dried", "not_dried"),
        ("_notdry", "not_dried"),
        ("_wet", "not_dried"),
    ):
        if n.endswith(suf):
            state = st
            species_lower = n[: -len(suf)]
            break
    if state is None and n.endswith("_dried"):
        state = "dried"
        species_lower = n[: -len("_dried")]
    if species_lower is None:
        species_lower = n
    if state is None:
        state = "partially_dried"

    if species_lower.startswith("sap_sap"):
        species_display = "SAP_SAP"
    else:
        species_display = species_lower.upper()
    return species_display, state


def _clamp_box(x1, y1, x2, y2, width, height):
    """Clip detection box to image bounds; return None if empty or invalid."""
    x1 = int(max(0, min(x1, width - 1)))
    y1 = int(max(0, min(y1, height - 1)))
    x2 = int(max(0, min(x2, width)))
    y2 = int(max(0, min(y2, height)))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _symmetric_inset_crop(crop_bgr: np.ndarray, frac: float) -> np.ndarray:
    """Remove outer strip of the detector crop (tray / background at box edges)."""
    if crop_bgr is None or crop_bgr.size == 0:
        return crop_bgr
    h, w = crop_bgr.shape[:2]
    if h < 6 or w < 6:
        return crop_bgr
    fy = max(0.0, min(0.45, frac))
    iy = max(1, int(round(h * fy)))
    ix = max(1, int(round(w * fy)))
    h2, w2 = h - 2 * iy, w - 2 * ix
    if h2 < 4 or w2 < 4:
        return crop_bgr
    out = crop_bgr[iy : iy + h2, ix : ix + w2]
    return out if out.size > 0 else crop_bgr


def _order_points_quad(pts: np.ndarray) -> np.ndarray:
    """tl, tr, br, bl for perspective warp (same idea as classic doc-scan helpers)."""
    p = np.asarray(pts, dtype=np.float32)
    rect = np.zeros((4, 2), dtype=np.float32)
    s = p.sum(axis=1)
    rect[0] = p[np.argmin(s)]
    rect[2] = p[np.argmax(s)]
    d = p[:, 0] - p[:, 1]
    rect[1] = p[np.argmin(d)]
    rect[3] = p[np.argmax(d)]
    return rect


def _largest_contour(binm: np.ndarray):
    m = (binm.astype(np.uint8) * 255)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def _warp_fish_by_min_area_rect(bgr: np.ndarray, cnt) -> np.ndarray | None:
    """
    Deskew diagonal fish: min-area rect of GrabCut blob → perspective warp to axis-aligned
    patch (long side horizontal), closer to how straight fish sit in training crops.
    """
    ta = bgr.shape[0] * bgr.shape[1]
    if cv2.contourArea(cnt) < max(120, int(0.04 * ta)):
        return None

    box = cv2.boxPoints(cv2.minAreaRect(cnt))
    rect = _order_points_quad(box)
    tl, tr, br, bl = rect[0], rect[1], rect[2], rect[3]

    width_a = float(np.hypot(br[0] - bl[0], br[1] - bl[1]))
    width_b = float(np.hypot(tr[0] - tl[0], tr[1] - tl[1]))
    max_w = max(int(round(width_a)), int(round(width_b)))

    height_a = float(np.hypot(tr[0] - br[0], tr[1] - br[1]))
    height_b = float(np.hypot(tl[0] - bl[0], tl[1] - bl[1]))
    max_h = max(int(round(height_a)), int(round(height_b)))

    max_w = max(max_w, 8)
    max_h = max(max_h, 8)

    dst = np.float32(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]]
    )
    try:
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(
            bgr,
            M,
            (max_w, max_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
    except cv2.error:
        return None

    if warped.size == 0 or min(warped.shape[:2]) < 6:
        return None

    # Prefer landscape patch (elongated along width) to match typical training framing.
    if max_h > max_w:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
    return warped


def _axis_aligned_tight_from_mask(bgr: np.ndarray, binm: np.ndarray) -> np.ndarray:
    """Fallback when perspective warp fails: axis-aligned crop (OK for near-horizontal fish)."""
    h, w = bgr.shape[:2]
    ys, xs = np.where(binm > 0)
    if ys.size == 0:
        return bgr

    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    pad = max(2, min(y1 - y0, x1 - x0) // 12)
    y0 = max(0, y0 - pad)
    x0 = max(0, x0 - pad)
    y1 = min(h - 1, y1 + pad)
    x1 = min(w - 1, x1 + pad)
    tight = bgr[y0 : y1 + 1, x0 : x1 + 1]
    if tight.size == 0 or tight.shape[0] < 4 or tight.shape[1] < 4:
        return bgr
    return tight


def _grabcut_fish_patch(bgr: np.ndarray) -> np.ndarray:
    """GrabCut foreground → deskewed fish patch, or axis-aligned fallback."""
    h, w = bgr.shape[:2]
    if h < 24 or w < 24:
        return bgr

    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    m = max(2, min(h, w) // 16)
    rw, rh = w - 2 * m, h - 2 * m
    if rw < 8 or rh < 8:
        return bgr
    rect = (m, m, rw, rh)

    try:
        cv2.grabCut(bgr, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return bgr

    binm = np.where((mask == 1) | (mask == 3), 1, 0).astype(np.uint8)
    total = h * w
    if int(binm.sum()) < max(80, int(0.06 * total)):
        return bgr

    cnt = _largest_contour(binm)
    if cnt is not None:
        warped = _warp_fish_by_min_area_rect(bgr, cnt)
        if warped is not None:
            return warped

    return _axis_aligned_tight_from_mask(bgr, binm)


def _crop_for_attribute_inference(crop_bgr: np.ndarray) -> np.ndarray:
    c = _symmetric_inset_crop(crop_bgr, ATTRIBUTE_CROP_INSET)
    if c is None or c.size == 0:
        return crop_bgr
    if ATTRIBUTE_USE_GRABCUT:
        t = _grabcut_fish_patch(c)
        if t is not None and t.size > 0:
            return t
    return c


def _safe_attributes(crop_bgr):
    """Never raise: attribute PKLs must not break the request after a successful detection."""
    try:
        focused = _crop_for_attribute_inference(crop_bgr)
        return predict_attributes(focused)
    except Exception:
        return {"color": "unknown", "texture": "unknown", "appearance": "unknown"}


def _format_attribute_counts(values: list[str]) -> str:
    """e.g. ['Silver','Silver','Reddish'] -> 'Silver: 2\\nReddish: 1' (sorted by label)."""
    if not values:
        return "--"
    c = Counter(values)
    lines = [f"{k}: {v}" for k, v in sorted(c.items(), key=lambda kv: kv[0].lower())]
    return "\n".join(lines)


def _caption_token(s: str) -> str:
    """Folder / class names -> Title_Case segments joined by underscore."""
    s = str(s).strip().replace("-", "_")
    parts = [p for p in s.replace(" ", "_").split("_") if p]
    if not parts:
        return "Unknown"
    return "_".join(p[:1].upper() + p[1:].lower() if len(p) > 1 else p.upper() for p in parts)


def _box_label_caption(species_name: str, attr: dict) -> str:
    """e.g. Galunggong_Silver_Wrinkle_Semidry — species + color + texture + appearance."""
    return "_".join(
        [
            _caption_token(species_name),
            _caption_token(attr.get("color", "unknown")),
            _caption_token(attr.get("texture", "unknown")),
            _caption_token(attr.get("appearance", "unknown")),
        ]
    )


def _draw_fish_label(
    img,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    text: str,
    bg_bgr: tuple[int, int, int],
) -> None:
    """Black text on a background matching the box color; scales to fit box width."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    # LINE_AA + thick strokes often looks gray/washed on bright BGR fills; LINE_8 keeps pure black.
    thickness = 3
    line_type = cv2.LINE_8
    text_bgr = (0, 0, 0)
    h_img, w_img = img.shape[:2]
    # Prefer larger type; allow label bar up to ~85% of image width if the box is narrow.
    box_w = x2 - x1
    max_w = max(100, min(max(box_w, int(w_img * 0.85)), w_img - x1 - 8))
    scale = 1.4
    tw, th = 0, 0
    while scale >= 0.68:
        (tw, th), _ = cv2.getTextSize(text, font, scale, thickness)
        if tw <= max_w:
            break
        scale -= 0.05
    (tw, th), _ = cv2.getTextSize(text, font, scale, thickness)
    pad = 12
    label_h = th + 2 * pad
    text_x = x1 + 5
    if y1 >= label_h + 2:
        rect_y1 = y1 - label_h
        rect_y2 = y1
        baseline_y = y1 - pad
    else:
        rect_y1 = y1
        rect_y2 = min(h_img - 1, y1 + label_h)
        baseline_y = min(h_img - 2, rect_y2 - pad)
    rect_x2 = min(w_img - 1, text_x + tw + pad)
    cv2.rectangle(img, (x1, rect_y1), (rect_x2, rect_y2), bg_bgr, -1)
    cv2.putText(
        img,
        text,
        (text_x, baseline_y),
        font,
        scale,
        text_bgr,
        thickness,
        line_type,
        False,
    )


# ----- Attribute features: mirror train_attributes.py (BGR crops, 128×128) -----
def extract_color_features(img):
    img = cv2.resize(img, (128, 128))

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    h = hsv[:, :, 0]
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    mean_h = np.mean(h)
    mean_s = np.mean(s)
    mean_v = np.mean(v)

    red_pixels = np.sum((h < 10) | (h > 170))

    low_sat_pixels = np.sum(s < 40)

    total_pixels = img.shape[0] * img.shape[1]

    red_ratio = red_pixels / total_pixels
    silver_ratio = low_sat_pixels / total_pixels

    return np.array(
        [
            mean_h,
            mean_s,
            mean_v,
            red_ratio,
            silver_ratio,
        ]
    )


def extract_texture_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    laplacian = cv2.Laplacian(gray, cv2.CV_64F).var()

    sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0)
    sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1)
    edge = np.mean(np.sqrt(sobelx**2 + sobely**2))

    return np.array([laplacian, edge])


def extract_appearance_features(img):
    img = cv2.resize(img, (128, 128))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    brightness = np.mean(gray)
    contrast = np.std(gray)

    return np.array([brightness, contrast])


def _classifier_label(model, encoder, features):
    x = np.asarray(features, dtype=np.float64)
    if not np.all(np.isfinite(x)):
        x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    idx = int(model.predict(x)[0])
    try:
        return str(encoder.inverse_transform(np.array([idx], dtype=np.int64))[0])
    except Exception:
        classes = getattr(encoder, "classes_", None)
        if classes is not None and 0 <= idx < len(classes):
            return str(classes[idx])
        return "unknown"


def predict_attributes(crop):
    # Same per-task vectors as train_attributes.py (color / texture / appearance each own features).
    x_color = extract_color_features(crop).reshape(1, -1)
    x_texture = extract_texture_features(crop).reshape(1, -1)
    x_appearance = extract_appearance_features(crop).reshape(1, -1)

    return {
        "color": _classifier_label(color_model, color_encoder, x_color),
        "texture": _classifier_label(texture_model, texture_encoder, x_texture),
        "appearance": _classifier_label(appearance_model, appearance_encoder, x_appearance),
    }


def _heuristic_extension_minutes(total_fish, drying_time_minutes, total_dried, total_partial, total_not):
    if total_fish <= 0:
        return 0.0
    # Similar shape to train_rf.py synthetic labels when DB is empty.
    remaining = max(0.0, 240.0 - float(drying_time_minutes))
    if total_not > 0:
        return float(min(remaining, 15.0 + 5.0 * total_not))
    if total_partial > 0:
        return float(min(remaining, 8.0 + 3.0 * total_partial))
    if total_dried < total_fish:
        return float(min(remaining, 5.0))
    return float(min(remaining, max(0.0, 240.0 - drying_time_minutes) * 0.1))


def predict_additional_drying_minutes(features_rf):
    """
    drying_model.pkl is a RandomForestRegressor (train_rf.py) on
    [total_fish, drying_time_minutes, total_fully_dried, total_partially_dried, total_not_dried].
    """
    tf, dt, td, tp, tn = features_rf[0]
    try:
        pred = rf_model.predict(features_rf)
        val = float(np.asarray(pred, dtype=np.float64).ravel()[0])
        if not np.isfinite(val):
            raise ValueError("non-finite prediction")
        return max(0.0, val)
    except Exception:
        return _heuristic_extension_minutes(int(tf), int(dt), int(td), int(tp), int(tn))


def _filter_boxes_nms(
    boxes: np.ndarray,
    labels: np.ndarray,
    scores: np.ndarray,
    score_thresh: float,
    nms_iou: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Drop low-score predictions, then class-agnostic NMS so one fish does not keep several
    overlapping boxes (Faster R-CNN can still emit duplicates after its internal NMS).
    """
    if boxes.size == 0:
        return boxes, labels, scores
    m = scores >= score_thresh
    boxes = boxes[m]
    labels = labels[m]
    scores = scores[m]
    if len(boxes) == 0:
        return boxes, labels, scores
    bt = torch.from_numpy(boxes.astype(np.float32))
    st = torch.from_numpy(scores.astype(np.float32))
    keep = torchvision.ops.nms(bt, st, float(nms_iou))
    keep_n = keep.cpu().numpy()
    return boxes[keep_n], labels[keep_n], scores[keep_n]


@app.post("/api/ai/analyze")
async def analyze(data: ImageRequest):

    img_data = data.image.split(",")[1]
    img_bytes = base64.b64decode(img_data)

    np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Invalid image"}

    height, width = image.shape[:2]

    # ----- Faster R-CNN only (no sklearn, no drawing on source image) -----
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    tensor = F.to_tensor(image_rgb).to(DEVICE)

    with torch.inference_mode():
        raw_pred = model([tensor])[0]

    del tensor

    boxes = raw_pred["boxes"].detach().cpu().numpy()
    labels = raw_pred["labels"].detach().cpu().numpy()
    scores = raw_pred["scores"].detach().cpu().numpy()
    del raw_pred

    boxes, labels, scores = _filter_boxes_nms(
        boxes,
        labels,
        scores,
        DETECTION_SCORE_THRESHOLD,
        DETECTION_NMS_IOU,
    )

    detections = []
    for box, lbl, sc in zip(boxes, labels, scores):
        label_idx = int(lbl)
        if label_idx < 0 or label_idx >= len(CLASSES):
            continue

        cls = CLASSES[label_idx]
        parsed = _parse_fish_class_label(cls)
        if parsed is None:
            continue
        species_name, state = parsed

        x1, y1, x2, y2 = map(int, box.tolist())
        clipped = _clamp_box(x1, y1, x2, y2, width, height)
        if clipped is None:
            continue
        x1, y1, x2, y2 = clipped

        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        box_area = (x2 - x1) * (y2 - y1)
        crop_copy = np.ascontiguousarray(crop.copy())

        detections.append({
            "species_name": species_name,
            "state": state,
            "box": (x1, y1, x2, y2),
            "box_area": box_area,
            "crop": crop_copy,
        })

    # ----- Attributes + drawing (per-fish crops; sklearn / OpenCV) -----
    fish_map = {}
    attr_colors: list[str] = []
    attr_textures: list[str] = []
    attr_appearances: list[str] = []

    total_dried = 0
    total_partial = 0
    total_not = 0

    annotated = image.copy()

    for det in detections:
        species_name = det["species_name"]
        state = det["state"]
        x1, y1, x2, y2 = det["box"]

        attr = _safe_attributes(det["crop"])
        attr_colors.append(attr["color"])
        attr_textures.append(attr["texture"])
        attr_appearances.append(attr["appearance"])

        if state == "dried":
            color_box = (0, 255, 0)
        elif state == "partially_dried":
            color_box = (0, 255, 255)
        else:
            color_box = (0, 0, 255)

        cv2.rectangle(annotated, (x1, y1), (x2, y2), color_box, 7)

        caption = _box_label_caption(species_name, attr)
        _draw_fish_label(annotated, x1, y1, x2, y2, caption, color_box)

        if species_name not in fish_map:
            fish_map[species_name] = {
                "count": 0,
                "fully_dried": 0,
                "partially_dried": 0,
                "not_dried": 0,
            }

        fish_map[species_name]["count"] += 1

        if state == "dried":
            total_dried += 1
            fish_map[species_name]["fully_dried"] += 1
        elif state == "partially_dried":
            total_partial += 1
            fish_map[species_name]["partially_dried"] += 1
        else:
            total_not += 1
            fish_map[species_name]["not_dried"] += 1

    total_fish = total_dried + total_partial + total_not

    features_rf = [[
        total_fish,
        data.drying_time_minutes,
        total_dried,
        total_partial,
        total_not
    ]]

    predicted_minutes = predict_additional_drying_minutes(features_rf)

    def format_map(key):
        return "\n".join([f"{k} - {v[key]}" for k,v in fish_map.items()]) or "--"

    fish_species_text = "\n".join(fish_map.keys()) or "--"

    if len(fish_map) == 1:
        fish_counts_text = str(list(fish_map.values())[0]["count"])
    else:
        fish_counts_text = "\n".join([f"{k} - {v['count']}" for k, v in fish_map.items()])

    color_display = _format_attribute_counts(attr_colors)
    texture_display = _format_attribute_counts(attr_textures)
    appearance_display = _format_attribute_counts(attr_appearances)

    _, buffer = cv2.imencode(".jpg", annotated)
    encoded = base64.b64encode(buffer).decode()

    return {
        "annotated_image": encoded,
        "fish_species": fish_species_text,
        "fish_counts": fish_counts_text,
        "fully_dried": format_map("fully_dried"),
        "partially_dried": format_map("partially_dried"),
        "not_dried": format_map("not_dried"),
        "color_display": color_display,
        "texture_display": texture_display,
        "appearance_display": appearance_display,
        "total_fish": total_fish,
        "predicted_additional_minutes": predicted_minutes
    }