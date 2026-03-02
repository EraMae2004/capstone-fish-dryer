document.addEventListener("DOMContentLoaded", function () {

    /* =========================
       IMAGE PREVIEW FUNCTION
    ========================== */

    const imageInput = document.getElementById("imageInput");
    const previewImage = document.getElementById("previewImage");
    const removeBtn = document.getElementById("removeImage");

    if (imageInput && previewImage) {

        imageInput.addEventListener("change", function (e) {

            const file = e.target.files[0];
            if (!file) return;

            previewImage.src = URL.createObjectURL(file);

        });

    }

    if (removeBtn && previewImage && imageInput) {

        removeBtn.addEventListener("click", function () {

            previewImage.src = "https://via.placeholder.com/180";
            imageInput.value = "";

        });

    }

    /* =========================
       PASSWORD TOGGLE
    ========================== */

    const passwordWrappers = document.querySelectorAll(".password-wrapper");

    passwordWrappers.forEach(wrapper => {

        const input = wrapper.querySelector("input");
        const icon = wrapper.querySelector("i");

        if (!input || !icon) return;

        icon.addEventListener("click", function () {

            if (input.type === "password") {
                input.type = "text";
                icon.classList.replace("fa-eye", "fa-eye-slash");
            } else {
                input.type = "password";
                icon.classList.replace("fa-eye-slash", "fa-eye");
            }

        });

    });

});
document.addEventListener("DOMContentLoaded", function () {

    const form = document.getElementById("registerForm");

    if (!form) return;

    form.addEventListener("submit", function (e) {

        e.preventDefault();

        const formData = new FormData(form);

        // Clear previous errors
        document.querySelectorAll(".error-text")
            .forEach(el => el.innerText = "");

        document.querySelectorAll("#registerForm input")
            .forEach(input => input.classList.remove("input-error"));

        fetch(form.action, {
            method: "POST",
            headers: {
                "X-CSRF-TOKEN":
                    document.querySelector('input[name="_token"]').value
            },
            body: formData
        })
        .then(async res => {

            const data = await res.json();

            if (!res.ok) {
                throw data.errors;
            }

            return data;
        })
        .then(data => {

            if (data.success) {

                const modal = document.getElementById("successModal");
                modal.style.display = "flex";

                setTimeout(() => {
                    modal.style.display = "none";
                    window.location.href = "/";
                }, 2000);
            }

        })
        .catch(errors => {

            for (let field in errors) {

                const input = document.querySelector(`[name="${field}"]`);
                const errorElement = document.querySelector(`[data-error="${field}"]`);

                if (input) {
                    input.classList.add("input-error");
                }

                if (errorElement) {
                    errorElement.innerText = errors[field][0];
                }
            }

        });

    });

});
