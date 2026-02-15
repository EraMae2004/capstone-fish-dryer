document.addEventListener("DOMContentLoaded", function () {

    const passwordModal = document.getElementById("passwordModal");
    const confirmModal = document.getElementById("confirmModal");
    const profileActionModal = document.getElementById("profileActionModal");
    const profileMessage = document.getElementById("profileActionMessage");
    const openBtn = document.getElementById("openPasswordBtn");
    const profileForm = document.getElementById("userProfileForm");

    const profileInput = document.getElementById("profileInput");
    const previewContainer = document.getElementById("previewContainer");
    const removeImageFlag = document.getElementById("removeImageFlag");

    // ================= OPEN PASSWORD MODAL =================
    if (openBtn && passwordModal) {
        openBtn.addEventListener("click", function () {
            clearPasswordError();
            passwordModal.style.display = "flex";
        });
    }

    // ================= CLOSE PASSWORD MODAL =================
    window.closePasswordModal = function () {
        passwordModal.style.display = "none";
        clearPasswordFields();
        clearPasswordError();
        showMessage("Password changes Discarded!");
    };

    // ================= PROFILE IMAGE PREVIEW =================
    if (profileInput) {
        profileInput.addEventListener("change", function () {

            const file = profileInput.files[0];
            if (!file) return;

            const reader = new FileReader();

            reader.onload = function (e) {
                previewContainer.innerHTML =
                    `<img src="${e.target.result}" 
                           style="width:100%;height:100%;object-fit:cover;">`;
            };

            reader.readAsDataURL(file);

            removeImageFlag.value = "0";
        });
    }

    // ================= REMOVE IMAGE =================
    window.removeImage = function () {

        previewContainer.innerHTML =
            previewContainer.getAttribute("data-initial");

        profileInput.value = "";
        removeImageFlag.value = "1";
    };

    // ================= SAVE USER PROFILE =================
    window.submitUserProfile = async function () {

        if (!profileForm) return;

        const formData = new FormData(profileForm);

        try {

            const response = await fetch("/api/user/profile/update", {
                method: "POST",
                headers: {
                    "X-CSRF-TOKEN": document
                        .querySelector('meta[name="csrf-token"]')
                        .getAttribute("content"),
                    "Accept": "application/json"
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                showMessage("Failed to save profile.");
                return;
            }

            if (data.success) {
                showMessage("Profile Changes Saved!");
                setTimeout(() => {
                    window.location.reload();
                }, 1200);
            }

        } catch (error) {
            console.error(error);
            showMessage("Server error.");
        }
    };

    // ================= DISCARD PROFILE =================
    window.discardUserChanges = function () {
        showMessage("Profile Changes Discarded!");
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    };

    // ================= PASSWORD VALIDATION =================
    window.openConfirmModal = function () {

        const currentPass =
            document.getElementById("current_password").value;

        const newPass =
            document.getElementById("new_password").value;

        const confirmPass =
            document.getElementById("confirm_password").value;

        clearPasswordError();

        if (!currentPass) {
            showPasswordError("Current password is required.");
            return;
        }

        if (!newPass || !confirmPass) {
            showPasswordError("Please fill all fields.");
            return;
        }

        if (newPass !== confirmPass) {
            showPasswordError(
                "New password and confirm password do not match."
            );
            return;
        }

        confirmModal.style.display = "flex";
    };

    window.closeConfirmModal = function () {
        confirmModal.style.display = "none";
    };

    // ================= SUBMIT PASSWORD =================
    window.submitPassword = async function () {

        confirmModal.style.display = "none";
        clearPasswordError();

        try {

            const response = await fetch("/api/user/change-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-TOKEN": document
                        .querySelector('meta[name="csrf-token"]')
                        .getAttribute("content"),
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    current_password:
                        document.getElementById("current_password").value,
                    new_password:
                        document.getElementById("new_password").value,
                    new_password_confirmation:
                        document.getElementById("confirm_password").value
                })
            });

            const data = await response.json();

            if (!response.ok) {
                showPasswordError(
                    data.message || "Password update failed."
                );
                passwordModal.style.display = "flex";
                return;
            }

            if (data.success) {
                passwordModal.style.display = "none";
                clearPasswordFields();
                showMessage("Password updated successfully.");
            }

        } catch (error) {
            console.error(error);
            showPasswordError("Server error.");
            passwordModal.style.display = "flex";
        }
    };

    // ================= MESSAGE MODAL =================
    function showMessage(message) {

        if (!profileActionModal || !profileMessage) return;

        profileMessage.innerText = message;
        profileActionModal.style.display = "flex";

        setTimeout(() => {
            profileActionModal.style.display = "none";
        }, 1500);
    }

    // ================= PASSWORD ERROR =================
    function showPasswordError(message) {

        const errorElement =
            document.getElementById("passwordErrorMessage");

        if (!errorElement) return;

        errorElement.innerText = message;
        errorElement.style.display = "block";
    }

    function clearPasswordError() {

        const errorElement =
            document.getElementById("passwordErrorMessage");

        if (!errorElement) return;

        errorElement.innerText = "";
        errorElement.style.display = "none";
    }

    function clearPasswordFields() {

        document.getElementById("current_password").value = "";
        document.getElementById("new_password").value = "";
        document.getElementById("confirm_password").value = "";
    }

    // ================= TOGGLE PASSWORD =================
    window.togglePassword = function (inputId, icon) {

        const input = document.getElementById(inputId);
        if (!input) return;

        if (input.type === "password") {
            input.type = "text";
            icon.classList.replace("fa-eye", "fa-eye-slash");
        } else {
            input.type = "password";
            icon.classList.replace("fa-eye-slash", "fa-eye");
        }
    };

});
