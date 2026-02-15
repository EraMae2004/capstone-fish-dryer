document.addEventListener("DOMContentLoaded", function () {

    const input = document.getElementById("profileInput");
    const preview = document.getElementById("previewContainer");
    const removeFlag = document.getElementById("removeImageFlag");

    if (input) {

        input.addEventListener("change", function () {

            const file = this.files[0];
            if (!file) return;

            const reader = new FileReader();

            reader.onload = function (e) {
                preview.innerHTML =
                    `<img src="${e.target.result}" 
                      style="width:100%;height:100%;object-fit:cover;">`;
            };

            reader.readAsDataURL(file);

            removeFlag.value = "0";
        });
    }

    window.removeImage = function () {
        preview.innerHTML = preview.dataset.initial;
        input.value = "";
        removeFlag.value = "1";
    };

});
