document.addEventListener('DOMContentLoaded', function () {

    const editIcons = document.querySelectorAll('.edit-icon');
    const modal = document.getElementById('editModal');
    const form = document.getElementById('editUserForm');
    const successModal = document.getElementById('successOverlay');

    const avatar = document.getElementById('edit_avatar');
    const imageInput = document.getElementById('edit_image_input');
    const removeImageInput = document.getElementById('remove_image');

    const btnChangeImage = document.getElementById('btnChangeImage');
    const btnRemoveImage = document.getElementById('btnRemoveImage');
    const closeBtn = document.getElementById('closeEditModal');

    let currentUserId = null;

    /* ==========================
       OPEN EDIT MODAL
    ========================== */
    editIcons.forEach(icon => {
        icon.addEventListener('click', function () {

            currentUserId = this.dataset.id;

            document.getElementById('edit_name').value = this.dataset.name || "";
            document.getElementById('edit_email').value = this.dataset.email || "";
            document.getElementById('edit_phone').value = this.dataset.phone || "";
            document.getElementById('edit_address').value = this.dataset.address || "";

            if (this.dataset.birthdate) {
                document.getElementById('edit_birthdate').value =
                    this.dataset.birthdate.split(" ")[0];
            } else {
                document.getElementById('edit_birthdate').value = "";
            }

            avatar.innerHTML = "";

            if (this.dataset.image && this.dataset.image.trim() !== "") {
                avatar.innerHTML =
                    `<img src="${this.dataset.image}"
                          style="width:100%;height:100%;
                                 border-radius:50%;
                                 object-fit:cover;">`;
            } else {
                const name = this.dataset.name || "";
                const initials = name
                    .split(" ")
                    .map(w => w.charAt(0))
                    .join("")
                    .substring(0, 2)
                    .toUpperCase();

                avatar.textContent = initials;
            }

            removeImageInput.value = 0;
            imageInput.value = "";

            modal.style.display = "flex";
        });
    });

    /* ==========================
       CLOSE MODAL
    ========================== */
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            modal.style.display = "none";
        });
    }

    /* ==========================
       CHANGE IMAGE PREVIEW
    ========================== */
    if (btnChangeImage) {
        btnChangeImage.addEventListener('click', function () {
            imageInput.click();
        });
    }

    if (imageInput) {
        imageInput.addEventListener('change', function () {

            const file = this.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                avatar.innerHTML =
                    `<img src="${e.target.result}"
                          style="width:100%;height:100%;
                                 border-radius:50%;
                                 object-fit:cover;">`;
            };
            reader.readAsDataURL(file);
        });
    }

    /* ==========================
       REMOVE IMAGE
    ========================== */
    if (btnRemoveImage) {
        btnRemoveImage.addEventListener('click', function () {
            avatar.innerHTML = "";
            removeImageInput.value = 1;
            imageInput.value = "";
        });
    }

    /* ==========================
       SAVE USING FETCH API
    ========================== */
    if (form) {
        form.addEventListener('submit', function (e) {

            e.preventDefault();

            if (!currentUserId) return;

            const formData = new FormData(form);

            fetch(`/api/admin/users/${currentUserId}`, {
                method: 'POST', // Laravel needs POST with override
                headers: {
                    "X-HTTP-Method-Override": "PUT",
                    "X-CSRF-TOKEN": document
                        .querySelector('meta[name="csrf-token"]')
                        .getAttribute('content'),
                    "Accept": "application/json"
                },
                body: formData
            })
            .then(response => response.json())
            .then(data => {

                if (data.success || data.status || responseOk(data)) {

                    modal.style.display = "none";

                    if (successModal) {
                        successModal.querySelector('h2').innerText =
                            "Profile changes saved";

                        successModal.style.display = "flex";

                        setTimeout(() => {
                            successModal.style.display = "none";
                            window.location.reload();
                        }, 1500);
                    }
                }

            })
            .catch(error => {
                console.error("Update failed:", error);
            });
        });
    }

    function responseOk(data) {
        return data && (data.message || data.success !== false);
    }

});
