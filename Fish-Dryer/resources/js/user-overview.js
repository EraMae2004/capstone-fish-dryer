document.addEventListener("DOMContentLoaded", function () {

    let batchCount = 1;
    let currentButton = null;

    const wrapper = document.getElementById("batchScrollWrapper");
    const addBtn = document.getElementById("addBatchBtn");

    const modal = document.getElementById("cameraModal");
    const video = document.getElementById("cameraVideo");
    const takePhotoBtn = document.getElementById("takePhotoBtn");
    const closeCameraBtn = document.getElementById("closeCameraBtn");

    let stream = null;

    // ===============================
    // OPEN CAMERA
    // ===============================
    async function openCamera(button) {

        currentButton = button;

        modal.style.display = "flex";

        stream = await navigator.mediaDevices.getUserMedia({ video: true });

        video.srcObject = stream;
    }

    // ===============================
    // CLOSE CAMERA
    // ===============================
    function closeCamera() {
        modal.style.display = "none";

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }

    closeCameraBtn.addEventListener("click", closeCamera);

    // ===============================
    // TAKE PHOTO
    // ===============================
    takePhotoBtn.addEventListener("click", async function () {

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);

        const blob = await new Promise(resolve =>
            canvas.toBlob(resolve, "image/jpeg")
        );

        const formData = new FormData();
        formData.append("image", blob);

        const response = await fetch("/api/ai/detect", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        updateBatchUI(currentButton, data);

        closeCamera();
    });

    // ===============================
    // UPDATE UI
    // ===============================
    function updateBatchUI(button, data) {

        const batchCard = button.closest(".batch-card");
        const imageFrames = batchCard.querySelectorAll(".image-frame");
        const statusFields = batchCard.querySelectorAll(".batch-details strong");

        const side = button.innerText.includes("Front") ? 0 : 1;

        const img = document.createElement("img");
        img.src = "data:image/jpeg;base64," + data.image;
        img.style.width = "100%";

        imageFrames[side].innerHTML = "";
        imageFrames[side].appendChild(img);

        statusFields[1].innerText = data.fully_dried;
        statusFields[3].innerText = data.partially_dried;
        statusFields[5].innerText = data.not_dried;

        let desc = "";

        if (data.not_dried > 0) {
            desc = "Some fish are not dried yet.";
        } else if (data.partially_dried > 0) {
            desc = "Some fish are partially dried.";
        } else {
            desc = "All fish are fully dried.";
        }

        statusFields[6].innerText = desc;

        document.querySelector(".recommendation-center").innerHTML = `
            <p><strong>Extend Drying Time:</strong> ${data.extend_minutes} minutes</p>
            <p><strong>Suggested Temperature:</strong> ${data.suggested_temperature} °C</p>
            <p><strong>Suggested Fan Speed:</strong> Level ${data.suggested_fan_speed}</p>
        `;
    }

    // ===============================
    // ATTACH BUTTONS
    // ===============================
    function attachCaptureListeners(container) {
        container.querySelectorAll(".capture-btn").forEach(btn => {
            btn.addEventListener("click", function () {
                openCamera(this);
            });
        });
    }

    attachCaptureListeners(wrapper);

    // ===============================
    // ADD BATCH
    // ===============================
    addBtn.addEventListener("click", function () {

        batchCount++;

        const batchItem = document.createElement("div");
        batchItem.classList.add("batch-item");

        batchItem.innerHTML = `
            <div class="batch-card">
                <div class="batch-card-header">
                    <span class="batch-title">Batch ${batchCount}</span>
                    <button type="button" class="remove-btn">Remove</button>
                </div>

                <div class="batch-images">
                    <button type="button" class="capture-btn">Capture Front</button>
                    <button type="button" class="capture-btn">Capture Back</button>

                    <div class="image-frame"><span>Front Image</span></div>
                    <div class="image-frame"><span>Back Image</span></div>
                </div>

                <div class="batch-status-title">Status</div>

                <div class="batch-details">
                    <div><span>Appearance:</span><strong>--</strong></div>
                    <div><span>Fully Dried:</span><strong>0</strong></div>
                    <div><span>Color:</span><strong>--</strong></div>
                    <div><span>Partially Dried:</span><strong>0</strong></div>
                    <div><span>Texture:</span><strong>--</strong></div>
                    <div><span>Not Dried:</span><strong>0</strong></div>
                    <div class="full-row">
                        <span>Description:</span>
                        <strong>--</strong>
                    </div>
                </div>
            </div>
        `;

        wrapper.appendChild(batchItem);
        attachCaptureListeners(batchItem);
    });

});