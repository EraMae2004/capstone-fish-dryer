document.addEventListener("DOMContentLoaded", function () {

    /* ================= STATE ================= */

    let currentBatch = null;
    let currentView = "front";
    let frontBlob = null;
    let backBlob = null;
    let stream = null;
    let processType = null; // "capture" or "upload"

    /* ================= ELEMENTS ================= */

    const modal = document.getElementById("imageProcessModal");
    const video = document.getElementById("cameraVideo");
    const previewImage = document.getElementById("previewImage");
    const analyzingBox = document.getElementById("analyzingBox");
    const flipText = document.getElementById("flipText");
    const canvas = document.getElementById("photoCanvas");
    const uploadInput = document.getElementById("uploadInput");

    const takeBtn = document.getElementById("takePhotoBtn");
    const saveBtn = document.getElementById("savePhotoBtn");
    const retakeBtn = document.getElementById("retakePhotoBtn");
    const closeBtn = document.getElementById("closeModalBtn");

    const addBatchBtn = document.getElementById("addBatchBtn");
    const wrapper = document.getElementById("batchScrollWrapper");

    /* ================= MODAL ================= */

    function openModal() {
        modal.style.display = "flex";
        flipText.style.display = "none";
        analyzingBox.style.display = "none";
    }

    function closeModal() {
        modal.style.display = "none";
        stopCamera();
    }

    /* ================= CAMERA ================= */

    async function startCamera() {
        if (stream) stopCamera();

        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;

        video.style.display = "block";
        previewImage.style.display = "none";

        takeBtn.style.display = "inline-block";
        saveBtn.style.display = "none";
        retakeBtn.style.display = "none";
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
    }

    /* ================= CAPTURE FLOW ================= */

    function beginCapture(batchItem) {
        processType = "capture";
        currentBatch = batchItem;
        currentView = "front";
        frontBlob = null;
        backBlob = null;
        openModal();
        startCamera();
    }

    takeBtn.addEventListener("click", function () {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);

        previewImage.src = canvas.toDataURL("image/jpeg");

        video.style.display = "none";
        previewImage.style.display = "block";

        takeBtn.style.display = "none";
        saveBtn.style.display = "inline-block";
        retakeBtn.style.display = "inline-block";
    });

    retakeBtn.addEventListener("click", function () {
        previewImage.style.display = "none";
        video.style.display = "block";

        takeBtn.style.display = "inline-block";
        saveBtn.style.display = "none";
        retakeBtn.style.display = "none";
    });

    saveBtn.addEventListener("click", function () {

        canvas.toBlob(blob => {

            if (currentView === "front") {

                frontBlob = blob;
                showImageInFrame(currentBatch, ".front-frame", blob);

                currentView = "back";

                // 🔥 FULL RESET TO CAMERA MODE
                previewImage.style.display = "none";
                video.style.display = "none";
                takeBtn.style.display = "none";
                saveBtn.style.display = "none";
                retakeBtn.style.display = "none";

                // SHOW FLIP MESSAGE ONLY
                flipText.innerText = "Flip Tray to capture back view.....";
                flipText.style.display = "block";

                // After delay → CLEAR overlay completely → restart camera clean
                setTimeout(() => {

                    flipText.style.display = "none";

                    // CLEAN RESET BEFORE STARTING CAMERA AGAIN
                    previewImage.src = "";
                    video.style.display = "block";

                    takeBtn.style.display = "inline-block";
                    saveBtn.style.display = "none";
                    retakeBtn.style.display = "none";

                    startCamera();

                }, 1200);

            } else {

                backBlob = blob;
                showImageInFrame(currentBatch, ".back-frame", blob);
                analyzeBatch(currentBatch);
            }

        }, "image/jpeg");
    });

    /* ================= UPLOAD FLOW ================= */

    function beginUpload(batchItem) {
        processType = "upload";
        currentBatch = batchItem;
        currentView = "front";
        frontBlob = null;
        backBlob = null;
        uploadInput.click();
    }

    uploadInput.addEventListener("change", function () {

        const file = this.files[0];
        if (!file) return;

        if (currentView === "front") {

            frontBlob = file;
            showImageInFrame(currentBatch, ".front-frame", file);

            currentView = "back";

            // SHOW MESSAGE MODAL
            openModal();

            video.style.display = "none";
            previewImage.style.display = "none";
            analyzingBox.style.display = "none";

            takeBtn.style.display = "none";
            saveBtn.style.display = "none";
            retakeBtn.style.display = "none";

            flipText.innerText = "Select image that captures the back view.....";
            flipText.style.display = "block";

            setTimeout(() => {
                flipText.style.display = "none";
                uploadInput.click();
            }, 1200);

        } else {

            backBlob = file;
            showImageInFrame(currentBatch, ".back-frame", file);

            closeModal();
            analyzeBatch(currentBatch);
        }

        this.value = "";
    });

    /* ================= IMAGE FRAME ================= */

    function showImageInFrame(batch, selector, fileOrBlob) {
        const frame = batch.querySelector(selector);
        const url = URL.createObjectURL(fileOrBlob);
        frame.innerHTML = `<img src="${url}" />`;
    }

    /* ================= ANALYSIS ================= */

    async function analyzeBatch(batchItem) {

        openModal();

        analyzingBox.style.display = "flex";
        video.style.display = "none";
        previewImage.style.display = "none";
        takeBtn.style.display = "none";
        saveBtn.style.display = "none";
        retakeBtn.style.display = "none";

        // Convert blobs to data URLs
        async function blobToDataURL(b) {
            return new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = rej;
                fr.readAsDataURL(b);
            });
        }

        try {
            const frontData = frontBlob ? await blobToDataURL(frontBlob) : null;
            const backData = backBlob ? await blobToDataURL(backBlob) : null;

            const payload = { front: frontData, back: backData };

            // call ai-server directly (assumes ai-server runs on localhost:5000)
            const response = await fetch("http://localhost:5000/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            // populate batch UI
            batchItem.querySelector(".appearance").innerText = data.color_index ? 'See color index' : '--';
            batchItem.querySelector(".color").innerText = data.color_index.toFixed ? data.color_index.toFixed(1) : data.color_index;
            batchItem.querySelector(".texture").innerText = data.texture_index.toFixed ? data.texture_index.toFixed(2) : data.texture_index;
            batchItem.querySelector(".fully-dried").innerText = data.fully_dried;
            batchItem.querySelector(".partially-dried").innerText = data.partially_dried;
            batchItem.querySelector(".not-dried").innerText = data.not_dried;
            batchItem.querySelector(".description").innerText = `Total detected: ${data.total_fish}, unknowns: ${data.unknown_objects}`;

            // store recommendation on the batch DOM for apply button
            const rec = data.recommendation || {};
            batchItem.dataset.extendMinutes = rec.extend_minutes || rec.extendMinutes || rec.extend_minutes || rec.extendMinutes || 0;
            batchItem.dataset.suggestedTemp = rec.temperature || rec.temp || 0;
            batchItem.dataset.suggestedFan = rec.fan_speed || rec.fan || 0;

            // build boxes for drawing
            const boxes = (data.detections || []).map(d => {
                const color = d.type === 'unknown' ? 'purple' : (d.dryness_class === 0 ? 'green' : (d.dryness_class === 1 ? 'yellow' : 'red'));
                const label = d.type === 'unknown' ? 'unknown' : (d.species || 'fish');
                return { box: d.box, color, label, dryness: d.dryness_class };
            });

            batchItem.dataset.boxes = JSON.stringify(boxes);
            drawBoxesForBatch(batchItem);

        } catch (err) {
            console.error(err);
        }

        setTimeout(() => {
            closeModal();
        }, 1200);
    }

    /* ================= LISTENERS ================= */

    function attachBatchListeners(container) {

        container.querySelectorAll(".capture-tray-btn").forEach(btn => {
            btn.addEventListener("click", function () {
                beginCapture(this.closest(".batch-item"));
            });
        });

        container.querySelectorAll(".upload-image-btn").forEach(btn => {
            btn.addEventListener("click", function () {
                beginUpload(this.closest(".batch-item"));
            });
        });

        container.querySelectorAll(".remove-btn").forEach(btn => {
            btn.addEventListener("click", function () {
                this.closest(".batch-item").remove();
            });
        });
    }

    attachBatchListeners(wrapper);

    // Apply recommendation button in the control panel
    document.querySelectorAll('.apply-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            // pick the first batch item with recommendation
            const first = wrapper.querySelector('.batch-item');
            if (!first) return;

            const extend = first.dataset.extendMinutes;
            const temp = first.dataset.suggestedTemp;
            const fan = first.dataset.suggestedFan;

            const controlInputs = document.querySelectorAll('.control-panel-card .control-grid .control-row input');
            // indexes: 0 species,1 quantity,2 target moisture,3 humidity,4 temp,5 fan,6 duration
            function minutesToHHMMSS(m) {
                const mins = Number(m) || 0;
                const totalSec = Math.floor(mins * 60);
                const hh = Math.floor(totalSec / 3600);
                const mm = Math.floor((totalSec % 3600) / 60);
                const ss = totalSec % 60;
                const pad = (n) => String(n).padStart(2, '0');
                return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
            }

            if (controlInputs && controlInputs.length >= 7) {
                if (temp) controlInputs[4].value = temp;
                if (fan) controlInputs[5].value = fan;
                if (extend) controlInputs[6].value = minutesToHHMMSS(extend);
            }
        });
    });

    /* ================= ADD BATCH ================= */

    if (addBatchBtn) {
        addBatchBtn.addEventListener("click", function () {

            const batchCount = wrapper.children.length + 1;

            const newBatch = document.createElement("div");
            newBatch.className = "batch-item";
            newBatch.dataset.batchId = batchCount;

            newBatch.innerHTML = `
                <div class="batch-card">
                    <div class="batch-card-header">
                        <span class="batch-title">Batch ${batchCount}</span>
                        <button type="button" class="remove-btn">Remove</button>
                    </div>
                    <div class="batch-actions">
                        <button type="button" class="action-btn capture-tray-btn">
                            <i class="fa fa-camera"></i> Capture Tray
                        </button>
                        <button type="button" class="action-btn upload-image-btn">
                            <i class="fa fa-upload"></i> Upload Image
                        </button>
                    </div>
                    <div class="batch-images">
                        <div class="image-frame front-frame"><span>Front Image</span></div>
                        <div class="image-frame back-frame"><span>Back Image</span></div>
                    </div>
                    <div class="batch-status-title">Status</div>
                    <div class="batch-details">
                        <div class="status-row"><span>Appearance:</span><strong class="appearance">--</strong></div>
                        <div class="status-row"><span>Color:</span><strong class="color">--</strong></div>
                        <div class="status-row"><span>Texture:</span><strong class="texture">--</strong></div>
                        <div class="status-row"><span>Fully Dried:</span><strong class="fully-dried">0</strong></div>
                        <div class="status-row"><span>Partially Dried:</span><strong class="partially-dried">0</strong></div>
                        <div class="status-row"><span>Not Dried:</span><strong class="not-dried">0</strong></div>
                        <div class="status-row full-row"><span>Description:</span><strong class="description">--</strong></div>
                    </div>
                </div>
            `;

            wrapper.appendChild(newBatch);
            attachBatchListeners(newBatch);
        });
    }

    closeBtn.addEventListener("click", closeModal);

    function drawBoxesForBatch(batchItem) {
        const frontFrame = batchItem.querySelector('.front-frame');
        const img = frontFrame ? frontFrame.querySelector('img') : null;
        const boxesData = batchItem.dataset.boxes ? JSON.parse(batchItem.dataset.boxes) : [];
        if (!img || boxesData.length === 0) return;

        img.onload = function () {
            // ensure canvas exists
            let canvas = batchItem.querySelector('canvas.preview-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.className = 'preview-canvas';
                canvas.style.position = 'absolute';
                canvas.style.left = 0;
                canvas.style.top = 0;
                canvas.style.pointerEvents = 'none';
                frontFrame.appendChild(canvas);
            }

            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.style.width = img.width + 'px';
            canvas.style.height = img.height + 'px';

            ctx.clearRect(0,0,canvas.width,canvas.height);
            boxesData.forEach(b => {
                ctx.lineWidth = 4;
                ctx.strokeStyle = b.color || 'red';
                ctx.fillStyle = b.color || 'red';
                const [x1,y1,x2,y2] = b.box;
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
                ctx.font = '18px Arial';
                ctx.fillText((b.label || 'unknown') + (b.dryness !== undefined ? (' - ' + (b.dryness===0?'Dry':b.dryness===1?'Partial':'Not Dry')) : ''), x1+4, y1-6);
            });
        };
    }

});