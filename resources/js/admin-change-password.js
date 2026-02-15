document.addEventListener("DOMContentLoaded", function () {

    const passwordModal = document.getElementById("passwordModal");
    const confirmModal = document.getElementById("confirmModal");
    const profileActionModal = document.getElementById("profileActionModal");
    const profileMessage = document.getElementById("profileActionMessage");
    const openBtn = document.getElementById("openPasswordBtn");
    const profileForm = document.getElementById("adminProfileForm");

    // ================= OPEN PASSWORD MODAL =================
    if (openBtn && passwordModal) {
        openBtn.addEventListener("click", function () {
            clearPasswordError();
            passwordModal.style.display = "flex";
        });
    }

    // ================= PASSWORD CANCEL =================
    window.closePasswordModal = function () {
        passwordModal.style.display = "none";
        clearPasswordFields();
        clearPasswordError();
        showMessage("Password changes Discarded!");
    };

    // ================= PROFILE SAVE =================
    window.submitProfile = async function () {

        if (!profileForm) return;

        const formData = new FormData(profileForm);

        try {

            const response = await fetch("/api/admin/profile/update", {
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

    // ================= PROFILE CANCEL =================
    window.discardProfileChanges = function () {
        showMessage("Profile Changes Discarded!");
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    };

    // ================= PASSWORD VALIDATION BEFORE CONFIRM =================
    window.openConfirmModal = function () {

        const currentPass = document.getElementById("current_password").value;
        const newPass = document.getElementById("new_password").value;
        const confirmPass = document.getElementById("confirm_password").value;

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
            showPasswordError("Password does not match.");
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

            const response = await fetch("/api/admin/change-password", {
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

                // Backend validation error (wrong current password etc.)
                showPasswordError(data.message || "Password update failed.");
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

    // ================= SHOW MESSAGE MODAL =================
    function showMessage(message) {

        if (!profileActionModal || !profileMessage) {
            return;
        }

        profileMessage.innerText = message;
        profileActionModal.style.display = "flex";

        setTimeout(() => {
            profileActionModal.style.display = "none";
        }, 1500);
    }

    // ================= PASSWORD ERROR DISPLAY =================
    function showPasswordError(message) {

        const errorElement = document.getElementById("passwordErrorMessage");

        if (!errorElement) return;

        errorElement.innerText = message;
        errorElement.style.display = "block";
    }

    function clearPasswordError() {
        const errorElement = document.getElementById("passwordErrorMessage");
        if (!errorElement) return;
        errorElement.innerText = "";
        errorElement.style.display = "none";
    }

    function clearPasswordFields() {
        document.getElementById("current_password").value = "";
        document.getElementById("new_password").value = "";
        document.getElementById("confirm_password").value = "";
    }

    // ================= TOGGLE PASSWORD VISIBILITY =================
    window.togglePassword = function (inputId, icon) {

        const input = document.getElementById(inputId);
        if (!input) return;

        if (input.type === "password") {
            input.type = "text";
            icon.classList.remove("fa-eye");
            icon.classList.add("fa-eye-slash");
        } else {
            input.type = "password";
            icon.classList.remove("fa-eye-slash");
            icon.classList.add("fa-eye");
        }
    };

});
