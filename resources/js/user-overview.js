document.addEventListener("DOMContentLoaded", function () {

    let batchCount = 1;
    const wrapper = document.getElementById("batchScrollWrapper");
    const addBtn = document.getElementById("addBatchBtn");

    if (!wrapper || !addBtn) return;

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

                    <div class="image-frame">
                        <span>Front Image</span>
                    </div>

                    <div class="image-frame">
                        <span>Back Image</span>
                    </div>
                </div>

                <div class="batch-status-title">Status</div>

                <div class="batch-details">
                    <div><span>Appearance:</span><strong>--</strong></div>
                    <div><span>Fully Dried:</span><strong>--</strong></div>
                    <div><span>Color:</span><strong>--</strong></div>
                    <div><span>Partially Dried:</span><strong>--</strong></div>
                    <div><span>Texture:</span><strong>--</strong></div>
                    <div><span>Not Dried:</span><strong>--</strong></div>
                    <div class="full-row">
                        <span>Description:</span>
                        <strong>--</strong>
                    </div>
                </div>

            </div>
        `;

        wrapper.appendChild(batchItem);
        wrapper.scrollLeft = wrapper.scrollWidth; // auto scroll to newest
    });

    wrapper.addEventListener("click", function (e) {
        if (e.target.classList.contains("remove-btn")) {
            e.target.closest(".batch-item").remove();
        }
    });

});